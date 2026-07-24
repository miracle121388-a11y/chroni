import type { ChroniLlmSettings, LlmConnectionResult } from "./shared/types.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmRequestFailureKind = "configuration" | "authentication" | "model" | "rate_limit" | "timeout" | "response" | "network";

export class LlmRequestError extends Error {
  constructor(
    readonly kind: LlmRequestFailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmRequestError";
  }
}

type RequestOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  body?: Record<string, unknown>;
};

export async function requestChatCompletion(
  settings: ChroniLlmSettings,
  messages: ChatMessage[],
  options: RequestOptions = {},
): Promise<string> {
  assertCompleteSettings(settings);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 75_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...(isDeepSeekBaseUrl(settings.baseUrl) ? { thinking: { type: "disabled" } } : {}),
        ...options.body,
        model: settings.model,
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Provider response bodies may contain English diagnostics, request IDs or
      // deployment details. The status is enough to give the user a next step.
      await response.body?.cancel().catch(() => undefined);
      const kind = kindForStatus(response.status);
      throw new LlmRequestError(kind, requestFailureMessage(kind), response.status);
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new LlmRequestError("response", "模型返回内容为空或格式不兼容。");
    }
    return content;
  } catch (error) {
    if (error instanceof LlmRequestError) throw error;
    if (controller.signal.aborted) throw new LlmRequestError("timeout", `模型请求超过 ${Math.ceil(timeoutMs / 1000)} 秒。`);
    throw new LlmRequestError("network", "无法连接模型服务，请检查 API 地址和网络。");
  } finally {
    clearTimeout(timeout);
  }
}

export async function testLlmConnection(settings: ChroniLlmSettings, options: Omit<RequestOptions, "body"> = {}): Promise<LlmConnectionResult> {
  try {
    assertCompleteSettings(settings);
    await requestChatCompletion(settings, [{ role: "user", content: "Reply with OK only." }], {
      ...options,
      body: { temperature: 0, max_tokens: 32 },
    });
    return {
      ok: true,
      message: settings.mode === "managed"
        ? "Chroni 内测智能服务可以正常响应。"
        : `连接成功，模型 ${settings.model} 可以正常响应。`,
    };
  } catch (error) {
    const failure = error instanceof LlmRequestError
      ? error
      : new LlmRequestError("network", "无法连接模型服务，请检查 API 地址和网络。");
    return { ok: false, kind: failure.kind, message: connectionMessage(failure, settings.mode ?? "custom") };
  }
}

function assertCompleteSettings(settings: ChroniLlmSettings): void {
  if (!settings.baseUrl.trim()) throw new LlmRequestError("configuration", "请先填写 API 地址。");
  if (!settings.apiKey.trim()) {
    throw new LlmRequestError("configuration", settings.mode === "managed" ? "请先填写内测访问码。" : "请先填写 API Key。");
  }
  if (!settings.model.trim()) throw new LlmRequestError("configuration", "请先填写模型名称。");
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isDeepSeekBaseUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

function kindForStatus(status: number): LlmRequestFailureKind {
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "model";
  if (status === 429) return "rate_limit";
  return "response";
}

function requestFailureMessage(kind: LlmRequestFailureKind): string {
  if (kind === "authentication") return "访问凭据无效或没有模型访问权限。";
  if (kind === "model") return "API 地址或模型名称不可用，请检查配置。";
  if (kind === "rate_limit") return "模型服务正忙或额度不足，请稍后重试。";
  return "模型服务响应异常，请稍后重试。";
}

function connectionMessage(error: LlmRequestError, mode: ChroniLlmSettings["mode"]): string {
  if (error.kind === "configuration") return error.message;
  if (error.kind === "authentication") {
    return mode === "managed"
      ? "内测访问码无效或已失效，请检查后重试。"
      : "API Key 无效或没有模型访问权限，请检查后重试。";
  }
  if (error.kind === "model") return "API 地址或模型名称不可用，请检查后重试。";
  if (error.kind === "rate_limit") return "模型服务正忙或额度不足，请稍后重试。";
  if (error.kind === "timeout") return "连接模型服务超时，请稍后重试。";
  if (error.kind === "response") return "模型服务返回了无法识别的内容，请稍后重试。";
  return "无法连接模型服务，请检查 API 地址和网络。";
}
