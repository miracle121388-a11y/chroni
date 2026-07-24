import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { missingGatewayConfiguration, type GatewayAccessKey, type GatewayConfig } from "./config.js";

type RateState = {
  minuteStartedAt: number;
  minuteCount: number;
  day: string;
  dayCount: number;
  active: number;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ValidatedChatRequest = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "text" | "json_object" };
};

type GatewayDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: (entry: Record<string, unknown>) => void;
};

export function createGatewayServer(config: GatewayConfig, dependencies: GatewayDependencies = {}): Server {
  const rateStates = new Map<string, RateState>();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? ((entry) => console.log(JSON.stringify(entry)));

  return createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      const requestId = request.headers["x-request-id"]?.toString().slice(0, 128) || randomUUID();
      logger({
        event: "gateway_request",
        request_id: requestId,
        status: 500,
        error: error instanceof Error ? error.name : "UnknownError",
      });
      sendError(response, 500, requestId, "gateway_error", "服务暂时不可用，请稍后重试。");
    });
  });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = request.headers["x-request-id"]?.toString().slice(0, 128) || randomUUID();
    const startedAt = now();
    applyResponseHeaders(response, requestId);
    const url = new URL(request.url ?? "/", "http://chroni-gateway.local");

    if (request.method === "GET" && url.pathname === "/healthz") {
      const missing = missingGatewayConfiguration(config);
      sendJson(response, missing.length ? 503 : 200, {
        status: missing.length ? "misconfigured" : "ok",
        service: "chroni-llm-gateway",
        provider: "deepseek",
        model: config.upstreamModel,
        ...(missing.length ? { missing } : {}),
      });
      return;
    }

    const accessKey = authenticate(request, config.accessKeys);
    if (!accessKey) {
      sendError(response, 401, requestId, "invalid_access_token", "内测访问码无效或已失效。");
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, 200, {
        object: "list",
        data: [{ id: "chroni-beta", object: "model", owned_by: "chroni" }],
      });
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      sendError(response, 404, requestId, "not_found", "请求地址不存在。");
      return;
    }

    const unavailable = missingGatewayConfiguration(config);
    if (unavailable.length) {
      sendError(response, 503, requestId, "gateway_not_configured", "智能服务尚未完成配置。");
      return;
    }

    const rate = acquireRateSlot(rateStates, accessKey.id, config, now());
    if (!rate.ok) {
      response.setHeader("retry-after", rate.retryAfterSeconds);
      sendError(response, 429, requestId, rate.code, rate.message);
      return;
    }

    let status = 500;
    let upstreamStatus: number | undefined;
    let usage: Record<string, unknown> | undefined;
    try {
      const body = await readJsonBody(request, config.maxBodyBytes);
      const validated = validateChatRequest(body, config);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
      let upstream: Response;
      try {
        upstream = await fetchImpl(`${config.upstreamBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.upstreamApiKey}`,
            "content-type": "application/json",
            "x-request-id": requestId,
          },
          body: JSON.stringify({
            model: config.upstreamModel,
            messages: validated.messages,
            thinking: { type: "disabled" },
            ...(validated.temperature !== undefined ? { temperature: validated.temperature } : {}),
            ...(validated.maxTokens !== undefined ? { max_tokens: validated.maxTokens } : {}),
            ...(validated.responseFormat ? { response_format: validated.responseFormat } : {}),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          status = 504;
          sendError(response, status, requestId, "upstream_timeout", "模型响应超时，请稍后重试。");
          return;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      upstreamStatus = upstream.status;
      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => undefined);
        status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 503 : 502;
        sendError(
          response,
          status,
          requestId,
          upstream.status === 429 ? "provider_busy" : "provider_error",
          upstream.status === 429 ? "模型服务正忙，请稍后重试。" : "模型服务响应异常，请稍后重试。",
        );
        return;
      }

      const payload = await upstream.json() as Record<string, unknown>;
      if (!hasCompletionContent(payload)) {
        status = 502;
        sendError(response, status, requestId, "invalid_provider_response", "模型返回内容无法识别，请重试。");
        return;
      }
      usage = plainRecord(payload.usage);
      status = 200;
      sendJson(response, status, payload);
    } catch (error) {
      if (error instanceof RequestError) {
        status = error.status;
        sendError(response, status, requestId, error.code, error.message);
        return;
      }
      throw error;
    } finally {
      releaseRateSlot(rateStates, accessKey.id);
      logger({
        event: "gateway_request",
        request_id: requestId,
        credential_id: accessKey.id,
        status,
        ...(upstreamStatus !== undefined ? { upstream_status: upstreamStatus } : {}),
        latency_ms: Math.max(0, now() - startedAt),
        ...(usage ? {
          prompt_tokens: numberField(usage, "prompt_tokens"),
          completion_tokens: numberField(usage, "completion_tokens"),
          total_tokens: numberField(usage, "total_tokens"),
        } : {}),
      });
    }
  }
}

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "RequestError";
  }
}

function authenticate(request: IncomingMessage, accessKeys: GatewayAccessKey[]): GatewayAccessKey | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const received = authorization.slice(7).trim();
  if (!received) return undefined;
  const receivedDigest = digest(received);
  return accessKeys.find((key) => timingSafeEqual(receivedDigest, digest(key.secret)));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function acquireRateSlot(
  states: Map<string, RateState>,
  id: string,
  config: GatewayConfig,
  timestamp: number,
): { ok: true } | { ok: false; code: string; message: string; retryAfterSeconds: number } {
  const minute = 60_000;
  const day = new Date(timestamp).toISOString().slice(0, 10);
  const state = states.get(id) ?? { minuteStartedAt: timestamp, minuteCount: 0, day, dayCount: 0, active: 0 };
  if (timestamp - state.minuteStartedAt >= minute) {
    state.minuteStartedAt = timestamp;
    state.minuteCount = 0;
  }
  if (state.day !== day) {
    state.day = day;
    state.dayCount = 0;
  }
  states.set(id, state);
  if (state.active >= config.concurrentRequests) {
    return { ok: false, code: "concurrency_limit", message: "当前已有多个分析任务，请等待片刻再试。", retryAfterSeconds: 2 };
  }
  if (state.minuteCount >= config.requestsPerMinute) {
    return {
      ok: false,
      code: "minute_limit",
      message: "请求过于频繁，请稍后继续。",
      retryAfterSeconds: Math.max(1, Math.ceil((minute - (timestamp - state.minuteStartedAt)) / 1000)),
    };
  }
  if (state.dayCount >= config.requestsPerDay) {
    return { ok: false, code: "daily_limit", message: "今日内测额度已用完，请明天继续。", retryAfterSeconds: 3_600 };
  }
  state.active += 1;
  state.minuteCount += 1;
  state.dayCount += 1;
  return { ok: true };
}

function releaseRateSlot(states: Map<string, RateState>, id: string): void {
  const state = states.get(id);
  if (state) state.active = Math.max(0, state.active - 1);
}

async function readJsonBody(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new RequestError(415, "unsupported_media_type", "请求必须使用 JSON。");
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new RequestError(413, "request_too_large", "发送给模型的文本过长，请缩小文件或分批处理。");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumBytes) throw new RequestError(413, "request_too_large", "发送给模型的文本过长，请缩小文件或分批处理。");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestError(400, "invalid_json", "请求 JSON 格式无效。");
  }
}

function validateChatRequest(value: unknown, config: GatewayConfig): ValidatedChatRequest {
  const body = plainRecord(value);
  if (!body) throw new RequestError(400, "invalid_request", "请求体必须是对象。");
  if (body.stream === true) throw new RequestError(400, "stream_not_supported", "内测服务暂不支持流式响应。");
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 32) {
    throw new RequestError(400, "invalid_messages", "messages 必须包含 1 至 32 条消息。");
  }
  let characters = 0;
  const messages = body.messages.map((value) => {
    const message = plainRecord(value);
    if (!message || !["system", "user", "assistant"].includes(String(message.role)) || typeof message.content !== "string") {
      throw new RequestError(400, "invalid_messages", "消息角色或内容格式无效。");
    }
    characters += message.content.length;
    return { role: message.role as ChatMessage["role"], content: message.content };
  });
  if (characters > config.maxPromptCharacters) {
    throw new RequestError(413, "prompt_too_large", "发送给模型的文本过长，请缩小文件或分批处理。");
  }

  const result: ValidatedChatRequest = { messages };
  if (body.temperature !== undefined) {
    if (typeof body.temperature !== "number" || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2) {
      throw new RequestError(400, "invalid_temperature", "temperature 参数无效。");
    }
    result.temperature = body.temperature;
  }
  if (body.max_tokens !== undefined) {
    if (!Number.isInteger(body.max_tokens) || (body.max_tokens as number) < 1) {
      throw new RequestError(400, "invalid_max_tokens", "max_tokens 参数无效。");
    }
    result.maxTokens = Math.min(body.max_tokens as number, config.maxOutputTokens);
  }
  if (body.response_format !== undefined) {
    const format = plainRecord(body.response_format);
    if (!format || (format.type !== "text" && format.type !== "json_object")) {
      throw new RequestError(400, "invalid_response_format", "response_format 参数无效。");
    }
    result.responseFormat = { type: format.type };
  }
  return result;
}

function hasCompletionContent(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.choices) || !value.choices.length) return false;
  const first = plainRecord(value.choices[0]);
  const message = plainRecord(first?.message);
  return typeof message?.content === "string" && !!message.content.trim();
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] as number : undefined;
}

function applyResponseHeaders(response: ServerResponse, requestId: string): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-request-id", requestId);
}

function sendError(response: ServerResponse, status: number, requestId: string, code: string, message: string): void {
  sendJson(response, status, {
    error: { message, type: "chroni_gateway_error", code },
    request_id: requestId,
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.writableEnded) return;
  response.statusCode = status;
  response.end(JSON.stringify(body));
}
