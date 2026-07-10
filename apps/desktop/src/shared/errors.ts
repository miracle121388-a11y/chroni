export function formatOperationError(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return detail ? `${fallback}：${detail}` : fallback;
}
