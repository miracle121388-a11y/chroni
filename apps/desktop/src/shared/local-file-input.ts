import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export function localFilePathFromText(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /[\r\n]/.test(trimmed)) return undefined;
  const path = matchingQuotes(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
  if (!path || !isAbsolute(path) || !existsSync(path)) return undefined;
  try {
    return statSync(path).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

function matchingQuotes(value: string): boolean {
  return value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
}
