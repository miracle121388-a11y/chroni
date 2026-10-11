/** Ignore presentation whitespace while retaining signs, decimal points and URLs. */
export function normalizeSourceEvidence(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").replace(/[，。！？、；“”‘’`*]/g, "").toLowerCase();
}

export function containsSourceEvidence(value: string, source: string, minimumLength = 2): boolean {
  const normalized = normalizeSourceEvidence(value);
  return normalized.length >= minimumLength && normalizeSourceEvidence(source).includes(normalized);
}
