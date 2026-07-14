export function formatOperationError(error: unknown, fallback: string): string {
  const detail = safeOperationErrorDetail(error);
  if (!detail) return fallback;
  if (detail === fallback || detail.startsWith(`${fallback}：`) || detail.startsWith(`${fallback}。`)) return detail;
  const label = fallback.replace(/[。！？!?]+$/u, "");
  return `${label || fallback}：${detail}`;
}

/** Sanitize a message that may originate from a provider or persisted failure. */
export function formatUserFacingMessage(message: unknown, fallback: string): string {
  return safeOperationErrorDetail(message) || fallback;
}

/**
 * Keep implementation details from leaking into user-facing fallback states.
 * Electron IPC wraps useful messages in English boilerplate, while network and
 * filesystem failures often expose platform-specific codes or local paths.
 */
function safeOperationErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  let detail = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!detail || /^(?:undefined|null|unknown|\[object Object\])$/i.test(detail)) return "";

  for (let index = 0; index < 2; index += 1) {
    detail = detail
      .replace(/^(?:Error|InputValidationError):\s*/i, "")
      .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "")
      .trim();
  }

  if (!detail) return "";

  if (/ENOSPC|no space left on device|disk (?:is )?full/i.test(detail)) {
    return "本地存储空间不足，请清理空间后重试。";
  }
  if (/EACCES|EPERM|permission denied|operation not permitted/i.test(detail)) {
    return "没有权限访问相关文件或目录，请检查系统权限后重试。";
  }
  if (/ENOENT|no such file or directory/i.test(detail)) {
    return "相关文件不存在或已被移动，请重新选择文件。";
  }
  if (/AbortError|aborted|ETIMEDOUT|ESOCKETTIMEDOUT|timed?\s*out/i.test(detail)) {
    return "请求超时，请稍后重试。";
  }
  if (/Failed to fetch|fetch failed|NetworkError|network request failed|ECONN(?:REFUSED|RESET)|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(detail)) {
    return "网络连接失败，请检查网络和服务地址后重试。";
  }
  if (/Unexpected (?:token|end of JSON)|JSON (?:parse|format)|is not valid JSON/i.test(detail)) {
    return "收到的数据格式异常，请重试。";
  }
  if (/Object has been destroyed|render frame was disposed|webContents.*destroyed/i.test(detail)) {
    return "窗口状态已变化，请重试。";
  }
  if (/Agent ICS export is unavailable/i.test(detail)) {
    return "当前环境暂不支持导出日历文件。";
  }

  // A partly localized exception can still contain a stack fragment, local
  // path or credential copied from an upstream service. Do not let the
  // presence of a few Chinese words make those implementation details safe.
  if (/\b(?:TypeError|ReferenceError|SyntaxError|RangeError|AxiosError)\b|Cannot read properties|\bat\s+[^\s]+\s+\(/i.test(detail)) {
    return "";
  }
  detail = detail
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[已隐藏]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [已隐藏]")
    .replace(/((?:api[_ -]?key|token)\s*[:=]\s*)[^\s，。！？；;]+/gi, "$1[已隐藏]")
    .replace(/(?:[A-Za-z]:\\|\/(?:Users|home|private|var|tmp|Volumes)\/)[^\s，。！？；;]+/g, "相关文件");

  // Chinese messages are written for the product UI and remain actionable.
  // Suppress unknown English/runtime messages rather than exposing internals.
  if (!/[\u3400-\u9fff]/u.test(detail) || /^(?:HTTP\b|TypeError\b|ReferenceError\b|SyntaxError\b|RangeError\b|AxiosError\b)/i.test(detail)) return "";
  return detail.length > 160 ? `${detail.slice(0, 157)}…` : detail;
}
