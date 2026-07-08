import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ChroniPreferencesPatch, ChroniSnapshot, IntakePayload, ItemPatch } from "./shared/types.js";
import { extractPayload, processIntake, reprocessSource } from "./intake.js";
import type { ChroniStore } from "./store.js";

type SnapshotUpdateReason = "data" | "preferences";
type SnapshotCallback = (snapshot: ChroniSnapshot, reason: SnapshotUpdateReason) => void;

class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export function startChroniApiServer(store: ChroniStore, onSnapshot: SnapshotCallback): Server {
  const server = createServer(async (request, response) => {
    try {
      await route(request, response, store, onSnapshot);
    } catch (error) {
      const status = error instanceof HttpError ? error.statusCode : 500;
      sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  const configuredPort = Number(process.env.CHRONI_API_PORT || 8765);
  server.listen(configuredPort, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : configuredPort;
    console.log(`Chroni API listening at http://127.0.0.1:${port}`);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && configuredPort !== 0) {
      server.listen(0, "127.0.0.1");
      return;
    }
    console.error("Chroni API failed.", error);
  });
  return server;
}

async function route(request: IncomingMessage, response: ServerResponse, store: ChroniStore, onSnapshot: SnapshotCallback): Promise<void> {
  setCors(response);
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
      defaultBaseUrl: "http://127.0.0.1:8765",
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
  if (request.method === "GET" && pathname === "/api/snapshot") {
    sendJson(response, 200, { ok: true, snapshot: store.snapshot() });
    return;
  }
  if (request.method === "POST" && pathname === "/api/extract") {
    const payload = await readJson<IntakePayload>(request);
    sendJson(response, 200, await extractPayload(payload, { llm: store.snapshot().preferences.llm }));
    return;
  }
  if (request.method === "POST" && pathname === "/api/intake") {
    const payload = await readJson<IntakePayload>(request);
    const result = await processIntake(payload, store);
    onSnapshot(result.snapshot, "data");
    sendJson(response, result.ok ? 200 : 422, result);
    return;
  }
  if (request.method === "PATCH" && pathname.startsWith("/api/items/")) {
    const id = decodeURIComponent(pathname.slice("/api/items/".length));
    const patch = await readJson<ItemPatch>(request);
    const snapshot = store.updateItem(id, patch);
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "DELETE" && pathname.startsWith("/api/items/")) {
    const id = decodeURIComponent(pathname.slice("/api/items/".length));
    const snapshot = store.deleteItem(id);
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "PATCH" && pathname === "/api/preferences") {
    const patch = await readJson<ChroniPreferencesPatch>(request);
    const snapshot = store.updatePreferences(patch);
    onSnapshot(snapshot, "preferences");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "POST" && pathname.startsWith("/api/sources/") && pathname.endsWith("/reprocess")) {
    const id = decodeURIComponent(pathname.slice("/api/sources/".length, -"/reprocess".length));
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

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new HttpError(400, "Request body must be JSON.");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  setCors(response);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

function setCors(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}
