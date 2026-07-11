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
  const timeoutMs = options.timeoutMs ?? 25_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        ...options.body,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await responseErrorDetail(response);
      throw new LlmRequestError(kindForStatus(response.status), `HTTP ${response.status}${detail ? `: ${detail}` : ""}`, response.status);
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
    throw new LlmRequestError("network", error instanceof Error ? error.message : "无法连接模型服务。");
  } finally {
    clearTimeout(timeout);
  }
}

export async function testLlmConnection(settings: ChroniLlmSettings, options: Omit<RequestOptions, "body"> = {}): Promise<LlmConnectionResult> {
  try {
    assertCompleteSettings(settings);
    await requestChatCompletion(settings, [{ role: "user", content: "Reply with OK only." }], {
      ...options,
      body: { temperature: 0, max_tokens: 8 },
    });
    return { ok: true, message: `连接成功，模型 ${settings.model} 可以正常响应。` };
  } catch (error) {
    const failure = error instanceof LlmRequestError
      ? error
      : new LlmRequestError("network", error instanceof Error ? error.message : "无法连接模型服务。");
    return { ok: false, kind: failure.kind, message: connectionMessage(failure) };
  }
}

function assertCompleteSettings(settings: ChroniLlmSettings): void {
  if (!settings.baseUrl.trim()) throw new LlmRequestError("configuration", "请先填写 API 地址。");
  if (!settings.apiKey.trim()) throw new LlmRequestError("configuration", "请先填写 API Key。");
  if (!settings.model.trim()) throw new LlmRequestError("configuration", "请先填写模型名称。");
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function kindForStatus(status: number): LlmRequestFailureKind {
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "model";
  if (status === 429) return "rate_limit";
  return "response";
}

async function responseErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 2_000);
    if (!text) return "";
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const detail = parsed.error?.message ?? parsed.message;
    return typeof detail === "string" ? detail.slice(0, 300) : text.slice(0, 300);
  } catch {
    return "";
  }
}

function connectionMessage(error: LlmRequestError): string {
  const detail = error.message;
  if (error.kind === "configuration") return detail;
  if (error.kind === "authentication") return `API Key 无效或无权限。${detail}`;
  if (error.kind === "model") return `API 地址或模型名称不可用。${detail}`;
  if (error.kind === "rate_limit") return `模型服务限流或余额不足。${detail}`;
  if (error.kind === "timeout") return `连接超时。${detail}`;
  if (error.kind === "response") return `模型响应异常。${detail}`;
  return `无法连接模型服务。${detail}`;
}
