export type GatewayAccessKey = {
  id: string;
  secret: string;
};

export type GatewayConfig = {
  port: number;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  upstreamModel: string;
  accessKeys: GatewayAccessKey[];
  requestTimeoutMs: number;
  maxBodyBytes: number;
  maxPromptCharacters: number;
  maxOutputTokens: number;
  requestsPerMinute: number;
  requestsPerDay: number;
  concurrentRequests: number;
};

type GatewayEnvironment = NodeJS.ProcessEnv;

export function loadGatewayConfig(environment: GatewayEnvironment = process.env): GatewayConfig {
  return {
    port: integerValue(environment.PORT, 3000, 0, 65_535),
    upstreamBaseUrl: normalizedUrl(environment.DEEPSEEK_BASE_URL, "https://api.deepseek.com"),
    upstreamApiKey: environment.DEEPSEEK_API_KEY?.trim() ?? "",
    upstreamModel: environment.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
    accessKeys: parseAccessKeys(environment),
    requestTimeoutMs: integerValue(environment.CHRONI_GATEWAY_TIMEOUT_MS, 75_000, 5_000, 180_000),
    maxBodyBytes: integerValue(environment.CHRONI_GATEWAY_MAX_BODY_BYTES, 1_048_576, 16_384, 8_388_608),
    maxPromptCharacters: integerValue(environment.CHRONI_GATEWAY_MAX_PROMPT_CHARACTERS, 350_000, 1_000, 1_000_000),
    maxOutputTokens: integerValue(environment.CHRONI_GATEWAY_MAX_OUTPUT_TOKENS, 8_192, 32, 65_536),
    requestsPerMinute: integerValue(environment.CHRONI_GATEWAY_REQUESTS_PER_MINUTE, 20, 1, 1_000),
    requestsPerDay: integerValue(environment.CHRONI_GATEWAY_REQUESTS_PER_DAY, 500, 1, 100_000),
    concurrentRequests: integerValue(environment.CHRONI_GATEWAY_CONCURRENT_REQUESTS, 3, 1, 50),
  };
}

export function missingGatewayConfiguration(config: GatewayConfig): string[] {
  const missing: string[] = [];
  if (!config.upstreamApiKey) missing.push("DEEPSEEK_API_KEY");
  if (!config.accessKeys.length) missing.push("CHRONI_GATEWAY_ACCESS_KEYS_JSON or CHRONI_GATEWAY_ACCESS_TOKEN");
  return missing;
}

function parseAccessKeys(environment: GatewayEnvironment): GatewayAccessKey[] {
  const keys: GatewayAccessKey[] = [];
  const json = environment.CHRONI_GATEWAY_ACCESS_KEYS_JSON?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [id, secret] of Object.entries(parsed)) {
          if (typeof secret === "string") addAccessKey(keys, id, secret);
        }
      }
    } catch {
      // Health diagnostics report the resulting empty credential list.
    }
  }

  const compact = environment.CHRONI_GATEWAY_ACCESS_KEYS?.trim();
  if (compact) {
    for (const entry of compact.split(/[,\n;]/)) {
      const separator = entry.indexOf("=");
      if (separator > 0) addAccessKey(keys, entry.slice(0, separator), entry.slice(separator + 1));
    }
  }

  const single = environment.CHRONI_GATEWAY_ACCESS_TOKEN?.trim();
  if (single) addAccessKey(keys, "beta", single);
  return [...new Map(keys.map((key) => [key.id, key])).values()];
}

function addAccessKey(keys: GatewayAccessKey[], rawId: string, rawSecret: string): void {
  const id = rawId.trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64);
  const secret = rawSecret.trim();
  if (id && secret) keys.push({ id, secret });
}

function normalizedUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return fallback;
    return candidate.replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function integerValue(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
