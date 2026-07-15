import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentIcsExportResult, AgentMemoryPatch, AgentRunResult, BehaviorMemoryPatch, ClarificationAnswerPayload, ClarificationResult, ChroniSnapshot, ExplicitPreferenceInput, TaskPlanResult, TaskPlanUpdatePayload } from "./shared/types.js";
import { extractPayload, processIntake, reprocessSource } from "./intake.js";
import type { ChroniStore } from "./store.js";
import { formatOperationError } from "./shared/errors.js";
import { InputValidationError, validateAgentMemoryPatch, validateBehaviorMemoryPatch, validateClarificationAnswer, validateDailyTaskCreate, validateDailyTaskPatch, validateExplicitPreference, validateIdentifier, validateIntakePayload, validateItemPatch, validatePlanActivation, validatePreferenceStatusPatch, validatePreferencesPatch, validateTaskPlanUpdate } from "./validation.js";

type SnapshotUpdateReason = "data" | "preferences";
type SnapshotCallback = (snapshot: ChroniSnapshot, reason: SnapshotUpdateReason) => void;
export const MAX_API_BODY_BYTES = 32 * 1024 * 1024;

export type AgentApiOperations = {
  run(): Promise<AgentRunResult>;
  latest(): AgentRunResult | undefined;
  updateMemory(patch: AgentMemoryPatch): ChroniSnapshot;
  exportIcs(): Promise<AgentIcsExportResult>;
  answerClarification(id: string, payload: ClarificationAnswerPayload): Promise<ClarificationResult>;
  dismissClarification(id: string): ChroniSnapshot;
  cancelIntakeDraft(id: string): ChroniSnapshot;
  generateTaskPlan(taskId: string, regenerate: boolean): Promise<TaskPlanResult>;
  activateTaskPlan(taskId: string, planId: string): TaskPlanResult;
  updateTaskPlan(taskId: string, payload: TaskPlanUpdatePayload): TaskPlanResult;
  updateBehaviorMemory(patch: BehaviorMemoryPatch): ChroniSnapshot;
  upsertPlanningPreference(input: ExplicitPreferenceInput): ChroniSnapshot;
  setPlanningPreferenceStatus(id: string, status: "active" | "disabled"): ChroniSnapshot;
  deletePlanningPreference(id: string): ChroniSnapshot;
  clearBehaviorMemory(): ChroniSnapshot;
};

type ApiServerOptions = {
  discoveryFilePath?: string;
  agent?: AgentApiOperations;
  version?: string;
};

class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export function resolveApiPort(value: string | undefined, fallback = 8765): number {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : fallback;
}

function publicApiError(error: unknown, status: number): string {
  if (error instanceof HttpError) return error.message;
  const fallback = status >= 500
    ? "服务暂时无法完成请求，请稍后重试。"
    : status === 404
      ? "找不到请求的内容。"
      : "请求内容无法处理，请检查后重试。";
  if (error instanceof InputValidationError) {
    const field = error.message.match(/^([A-Za-z][A-Za-z0-9_.\[\]-]*)\b/)?.[1];
    return field ? `请求字段 ${field} 的值无效，请检查后重试。` : fallback;
  }
  if (status >= 500) return fallback;
  return formatOperationError(error, fallback);
}

export function startChroniApiServer(store: ChroniStore, onSnapshot: SnapshotCallback, options: ApiServerOptions = {}): Server {
  const apiToken = process.env.CHRONI_API_TOKEN?.trim() || randomBytes(24).toString("base64url");
  const allowedOrigin = process.env.CHRONI_API_ALLOWED_ORIGIN?.trim() || "";
  const server = createServer(async (request, response) => {
    try {
      applyCors(request, response, allowedOrigin);
      await route(request, response, store, onSnapshot, apiToken, () => baseUrl, options.agent, options.version ?? "0.1.0");
    } catch (error) {
      const status = error instanceof HttpError ? error.statusCode : error instanceof InputValidationError ? 400 : 500;
      sendJson(response, status, { ok: false, error: publicApiError(error, status) });
    }
  });
  const configuredPort = resolveApiPort(process.env.CHRONI_API_PORT);
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

async function route(request: IncomingMessage, response: ServerResponse, store: ChroniStore, onSnapshot: SnapshotCallback, apiToken: string, getBaseUrl: () => string, agent: AgentApiOperations | undefined, version: string): Promise<void> {
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
      version,
      baseUrl: getBaseUrl(),
      apiToken,
      authentication: "除 /api/health 外，请在 Authorization 请求头中使用 Bearer <apiToken>。",
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
    throw new HttpError(401, "需要提供有效的 Chroni API 访问令牌。");
  }
  if (request.method === "GET" && pathname === "/api/snapshot") {
    sendJson(response, 200, { ok: true, snapshot: store.snapshot() });
    return;
  }
  if (request.method === "GET" && pathname === "/api/daily-tasks") {
    sendJson(response, 200, { ok: true, dailyTasks: store.snapshot().dailyTasks.filter((task) => !task.dismissed) });
    return;
  }
  if (request.method === "POST" && pathname === "/api/daily-tasks") {
    const snapshot = store.createDailyTask(validateDailyTaskCreate(await readJson(request)));
    onSnapshot(snapshot, "data");
    sendJson(response, 201, { ok: true, snapshot });
    return;
  }
  const dailyTaskRoute = pathname.match(/^\/api\/daily-tasks\/([^/]+)$/);
  if (request.method === "PATCH" && dailyTaskRoute) {
    const id = validateIdentifier(decodeURIComponent(dailyTaskRoute[1]), "daily task id");
    if (!store.snapshot().dailyTasks.some((task) => task.id === id)) throw new HttpError(404, "找不到这条每日任务。");
    const snapshot = store.updateDailyTask(id, validateDailyTaskPatch(await readJson(request)));
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "DELETE" && dailyTaskRoute) {
    const id = validateIdentifier(decodeURIComponent(dailyTaskRoute[1]), "daily task id");
    if (!store.snapshot().dailyTasks.some((task) => task.id === id)) throw new HttpError(404, "找不到这条每日任务。");
    const snapshot = store.deleteDailyTask(id);
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "POST" && pathname === "/api/agent/run") {
    if (!agent) throw new HttpError(503, "Deadline Agent 当前不可用，请先启动桌面应用。");
    const result = await agent.run();
    const snapshot = store.snapshot();
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, result, snapshot });
    return;
  }
  if (request.method === "GET" && pathname === "/api/agent/latest") {
    if (!agent) throw new HttpError(503, "Deadline Agent 当前不可用，请先启动桌面应用。");
    sendJson(response, 200, { ok: true, latest: agent.latest() });
    return;
  }
  if (request.method === "PATCH" && pathname === "/api/agent/memory") {
    const patch = validateAgentMemoryPatch(await readJson(request), store.snapshot().agent.memory);
    if (!agent) throw new HttpError(503, "Deadline Agent 当前不可用，请先启动桌面应用。");
    const snapshot = agent.updateMemory(patch);
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "POST" && pathname === "/api/agent/export-ics") {
    if (!agent) throw new HttpError(503, "Deadline Agent 当前不可用，请先启动桌面应用。");
    sendJson(response, 200, { ok: true, ...await agent.exportIcs() });
    return;
  }
  if (request.method === "GET" && pathname === "/api/agent/clarifications") {
    sendJson(response, 200, { ok: true, clarifications: store.snapshot().clarifications.filter((item) => item.status === "pending") });
    return;
  }
  const clarificationAnswer = pathname.match(/^\/api\/agent\/clarifications\/([^/]+)\/answer$/);
  if (request.method === "POST" && clarificationAnswer) {
    if (!agent) throw new HttpError(503, "待确认处理功能当前不可用，请先启动桌面应用。");
    const result = await agent.answerClarification(validateIdentifier(decodeURIComponent(clarificationAnswer[1]), "clarification id"), validateClarificationAnswer(await readJson(request)));
    onSnapshot(result.snapshot, "data");
    sendJson(response, 200, result);
    return;
  }
  const clarificationDismiss = pathname.match(/^\/api\/agent\/clarifications\/([^/]+)\/dismiss$/);
  if (request.method === "POST" && clarificationDismiss) {
    if (!agent) throw new HttpError(503, "待确认处理功能当前不可用，请先启动桌面应用。");
    const snapshot = agent.dismissClarification(validateIdentifier(decodeURIComponent(clarificationDismiss[1]), "clarification id"));
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  const intakeDraft = pathname.match(/^\/api\/intake-drafts\/([^/]+)$/);
  if (request.method === "GET" && intakeDraft) {
    const id = validateIdentifier(decodeURIComponent(intakeDraft[1]), "draft id");
    const draft = store.snapshot().intakeDrafts.find((item) => item.id === id);
    if (!draft) throw new HttpError(404, "找不到这条待确认草稿，可能已经处理或放弃。");
    sendJson(response, 200, { ok: true, draft });
    return;
  }
  if (request.method === "DELETE" && intakeDraft) {
    if (!agent) throw new HttpError(503, "草稿处理功能当前不可用，请先启动桌面应用。");
    const snapshot = agent.cancelIntakeDraft(validateIdentifier(decodeURIComponent(intakeDraft[1]), "draft id"));
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  const planRoute = pathname.match(/^\/api\/items\/([^/]+)\/plan$/);
  if (request.method === "GET" && planRoute) {
    const taskId = validateIdentifier(decodeURIComponent(planRoute[1]), "task id");
    sendJson(response, 200, { ok: true, plan: store.taskPlanByTaskId(taskId) });
    return;
  }
  if ((request.method === "POST" || request.method === "PUT") && planRoute) {
    if (!agent) throw new HttpError(503, "任务规划功能当前不可用，请先启动桌面应用。");
    const taskId = validateIdentifier(decodeURIComponent(planRoute[1]), "task id");
    const result = request.method === "POST"
      ? await agent.generateTaskPlan(taskId, false)
      : agent.updateTaskPlan(taskId, validateTaskPlanUpdate(await readJson(request)));
    onSnapshot(result.snapshot, "data");
    sendJson(response, 200, result);
    return;
  }
  const regenerateRoute = pathname.match(/^\/api\/items\/([^/]+)\/plan\/regenerate$/);
  if (request.method === "POST" && regenerateRoute) {
    if (!agent) throw new HttpError(503, "任务规划功能当前不可用，请先启动桌面应用。");
    const result = await agent.generateTaskPlan(validateIdentifier(decodeURIComponent(regenerateRoute[1]), "task id"), true);
    onSnapshot(result.snapshot, "data");
    sendJson(response, 200, result);
    return;
  }
  const activateRoute = pathname.match(/^\/api\/items\/([^/]+)\/plan\/activate$/);
  if (request.method === "POST" && activateRoute) {
    if (!agent) throw new HttpError(503, "任务规划功能当前不可用，请先启动桌面应用。");
    const result = agent.activateTaskPlan(validateIdentifier(decodeURIComponent(activateRoute[1]), "task id"), validatePlanActivation(await readJson(request)));
    onSnapshot(result.snapshot, "data");
    sendJson(response, 200, result);
    return;
  }
  const revisionsRoute = pathname.match(/^\/api\/items\/([^/]+)\/plan\/revisions$/);
  if (request.method === "GET" && revisionsRoute) {
    const taskId = validateIdentifier(decodeURIComponent(revisionsRoute[1]), "task id");
    sendJson(response, 200, { ok: true, revisions: store.snapshot().taskPlanRevisions.filter((item) => item.taskId === taskId) });
    return;
  }
  if (request.method === "PATCH" && pathname === "/api/agent/behavior-memory") {
    if (!agent) throw new HttpError(503, "个性化规划功能当前不可用，请先启动桌面应用。");
    const snapshot = agent.updateBehaviorMemory(validateBehaviorMemoryPatch(await readJson(request)));
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "POST" && pathname === "/api/agent/behavior-memory/preferences") {
    if (!agent) throw new HttpError(503, "个性化规划功能当前不可用，请先启动桌面应用。");
    const snapshot = agent.upsertPlanningPreference(validateExplicitPreference(await readJson(request)));
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  const preferenceRoute = pathname.match(/^\/api\/agent\/behavior-memory\/preferences\/([^/]+)$/);
  if (request.method === "PATCH" && preferenceRoute) {
    if (!agent) throw new HttpError(503, "个性化规划功能当前不可用，请先启动桌面应用。");
    const snapshot = agent.setPlanningPreferenceStatus(validateIdentifier(decodeURIComponent(preferenceRoute[1]), "preference id"), validatePreferenceStatusPatch(await readJson(request)));
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "DELETE" && preferenceRoute) {
    if (!agent) throw new HttpError(503, "个性化规划功能当前不可用，请先启动桌面应用。");
    const snapshot = agent.deletePlanningPreference(validateIdentifier(decodeURIComponent(preferenceRoute[1]), "preference id"));
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "DELETE" && pathname === "/api/agent/behavior-memory") {
    if (!agent) throw new HttpError(503, "个性化规划功能当前不可用，请先启动桌面应用。");
    const snapshot = agent.clearBehaviorMemory();
    onSnapshot(snapshot, "data");
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }
  if (request.method === "POST" && pathname === "/api/extract") {
    const payload = validateIntakePayload(await readJson(request));
    sendJson(response, 200, await extractPayload(payload, { llm: store.llmSettings() }));
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

  sendJson(response, 404, { ok: false, error: "找不到这个 Chroni API 地址，请检查请求路径和方法。", endpoints: apiEndpoints() });
}

function apiEndpoints(): string[] {
  return [
    "GET /api/health",
    "GET /api/snapshot",
    "GET|POST /api/daily-tasks",
    "PATCH|DELETE /api/daily-tasks/:id",
    "POST /api/agent/run",
    "GET /api/agent/latest",
    "PATCH /api/agent/memory",
    "POST /api/agent/export-ics",
    "GET /api/agent/clarifications",
    "POST /api/agent/clarifications/:id/answer",
    "POST /api/agent/clarifications/:id/dismiss",
    "GET|DELETE /api/intake-drafts/:id",
    "GET|POST|PUT /api/items/:id/plan",
    "POST /api/items/:id/plan/regenerate",
    "POST /api/items/:id/plan/activate",
    "GET /api/items/:id/plan/revisions",
    "PATCH|DELETE /api/agent/behavior-memory",
    "POST /api/agent/behavior-memory/preferences",
    "PATCH|DELETE /api/agent/behavior-memory/preferences/:id",
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
    throw new HttpError(413, `请求内容过大，不能超过 ${MAX_API_BODY_BYTES} 字节。`);
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > MAX_API_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, `请求内容过大，不能超过 ${MAX_API_BODY_BYTES} 字节。`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new HttpError(400, "请求内容不能为空，并且必须使用 JSON 格式。");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "请求内容不是有效的 JSON。");
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
  if (!allowedOrigin || origin !== allowedOrigin) throw new HttpError(403, "当前网页来源没有访问 Chroni API 的权限。");
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
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
    key === "apiKey" ? "" : key === "snapshot" ? redactSnapshotSourceText(entry) : redactSensitiveData(entry),
  ]));
}

function redactSnapshotSourceText(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return redactSensitiveData(value);
  const snapshot = value as Record<string, unknown>;
  const sources = Array.isArray(snapshot.sources)
    ? snapshot.sources.map((source) => source && typeof source === "object" ? { ...(source as Record<string, unknown>), text: "" } : source)
    : snapshot.sources;
  const agent = snapshot.agent && typeof snapshot.agent === "object"
    ? { ...(snapshot.agent as Record<string, unknown>), recentPlanningFeedback: [] }
    : snapshot.agent;
  return redactSensitiveData({ ...snapshot, sources, agent });
}
