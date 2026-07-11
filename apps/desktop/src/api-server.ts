import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChroniSnapshot } from "./shared/types.js";
import { extractPayload, processIntake, reprocessSource } from "./intake.js";
import type { ChroniStore } from "./store.js";
import { InputValidationError, validateIdentifier, validateIntakePayload, validateItemPatch, validatePreferencesPatch } from "./validation.js";

type SnapshotUpdateReason = "data" | "preferences";
type SnapshotCallback = (snapshot: ChroniSnapshot, reason: SnapshotUpdateReason) => void;
export const MAX_API_BODY_BYTES = 32 * 1024 * 1024;

class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export function startChroniApiServer(store: ChroniStore, onSnapshot: SnapshotCallback, options: { discoveryFilePath?: string } = {}): Server {
  const apiToken = process.env.CHRONI_API_TOKEN?.trim() || randomBytes(24).toString("base64url");
  const allowedOrigin = process.env.CHRONI_API_ALLOWED_ORIGIN?.trim() || "";
  const server = createServer(async (request, response) => {
    try {
      applyCors(request, response, allowedOrigin);
      await route(request, response, store, onSnapshot, apiToken, () => baseUrl);
    } catch (error) {
      const status = error instanceof HttpError ? error.statusCode : error instanceof InputValidationError ? 400 : 500;
      sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  const configuredPort = Number(process.env.CHRONI_API_PORT || 8765);
  let baseUrl = `http://127.0.0.1:${configuredPort}`;
  server.listen(configuredPort, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : configuredPort;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Chroni API listening at ${baseUrl}`);
    if (options.discoveryFilePath) publishDiscoveryFile(options.discoveryFilePath, baseUrl);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && configuredPort !== 0) {
      server.listen(0, "127.0.0.1");
      return;
    }
    console.error("Chroni API failed.", error);
  });
  if (options.discoveryFilePath) server.on("close", () => removeOwnedDiscoveryFile(options.discoveryFilePath!));
  return server;
}

async function route(request: IncomingMessage, response: ServerResponse, store: ChroniStore, onSnapshot: SnapshotCallback, apiToken: string, getBaseUrl: () => string): Promise<void> {
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      product: "Chroni",
      version: "0.1.0",
      baseUrl: getBaseUrl(),
      apiToken,
      authentication: "Use Authorization: Bearer <apiToken> for every endpoint except /api/health.",
      supportedInputs: [
        "text",
        "txt",
        "md",
        "csv",
        "tsv",
        "json",
        "ics",
        "html",
        "xml",
        "yaml",
        "rtf",
        "docx",
        "pdf",
        "xlsx",
        "png",
        "jpg",
        "jpeg",
        "webp",
        "bmp",
        "tif",
        "tiff",
      ],
      endpoints: apiEndpoints(),
    });
    return;
  }
  if (!hasValidBearerToken(request, apiToken)) {
    response.setHeader("www-authenticate", "Bearer");
    throw new HttpError(401, "Chroni API authorization is required.");
  }
  if (request.method === "GET" && pathname === "/api/snapshot") {
    sendJson(response, 200, { ok: true, snapshot: store.snapshot() });
    return;
  }
  if (request.method === "POST" && pathname === "/api/extract") {
    const payload = validateIntakePayload(await readJson(request));
    sendJson(response, 200, await extractPayload(payload, { llm: store.snapshot().preferences.llm }));
    return;
  }
  if (request.method === "POST" && pathname === "/api/intake") {
    const payload = validateIntakePayload(await readJson(request));
    const result = await processIntake(payload, store);
    onSnapshot(result.snapshot, "data");
    sendJson(response, result.ok ? 200 : 422, result);
    return;
  }
  if (request.method === "PATCH" && pathname.startsWith("/api/items/")) {
    const id = validateIdentifier(decodeURIComponent(pathname.slice("/api/items/".length)), "item id");
    const patch = validateItemPatch(await readJson(request));
    const snapshot = store.updateItem(id, patch);
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "DELETE" && pathname.startsWith("/api/items/")) {
    const id = validateIdentifier(decodeURIComponent(pathname.slice("/api/items/".length)), "item id");
    const snapshot = store.deleteItem(id);
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "PATCH" && pathname === "/api/preferences") {
    const patch = validatePreferencesPatch(await readJson(request));
    const snapshot = store.updatePreferences(patch);
    onSnapshot(snapshot, "preferences");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "POST" && pathname.startsWith("/api/sources/") && pathname.endsWith("/reprocess")) {
    const id = validateIdentifier(decodeURIComponent(pathname.slice("/api/sources/".length, -"/reprocess".length)), "source id");
    const result = await reprocessSource(id, store);
    onSnapshot(result.snapshot, "data");
    sendJson(response, result.ok ? 200 : 422, result);
    return;
  }

  sendJson(response, 404, { ok: false, error: "Unknown Chroni API endpoint.", endpoints: apiEndpoints() });
}

function apiEndpoints(): string[] {
  return [
    "GET /api/health",
    "GET /api/snapshot",
    "POST /api/extract",
    "POST /api/intake",
    "PATCH /api/items/:id",
    "DELETE /api/items/:id",
    "PATCH /api/preferences",
    "POST /api/sources/:id/reprocess",
  ];
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_API_BODY_BYTES) {
    throw new HttpError(413, `Request body exceeds ${MAX_API_BODY_BYTES} bytes.`);
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > MAX_API_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, `Request body exceeds ${MAX_API_BODY_BYTES} bytes.`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new HttpError(400, "Request body must be JSON.");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function publishDiscoveryFile(filePath: string, baseUrl: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ baseUrl, pid: process.pid, startedAt: new Date().toISOString() }, null, 2), "utf8");
    renameSync(temporaryPath, filePath);
  } catch (error) {
    console.warn("Chroni API discovery file could not be written.", error);
  }
}

function removeOwnedDiscoveryFile(filePath: string): void {
  try {
    const record = JSON.parse(readFileSync(filePath, "utf8")) as { pid?: unknown };
    if (record.pid === process.pid) rmSync(filePath, { force: true });
  } catch {
    // A missing or replaced discovery file belongs to no cleanup work here.
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(redactSensitiveData(body), null, 2));
}

function applyCors(request: IncomingMessage, response: ServerResponse, allowedOrigin: string): void {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
  if (!origin) return;
  if (!allowedOrigin || origin !== allowedOrigin) throw new HttpError(403, "Browser origin is not allowed to access the Chroni API.");
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type");
}

function hasValidBearerToken(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const received = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === "apiKey" ? "" : redactSensitiveData(entry),
  ]));
}
