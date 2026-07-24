import {
  CHRONI_MANAGED_LLM_BASE_URL,
  CHRONI_MANAGED_LLM_MODEL,
  type ChroniLlmMode,
  type ChroniLlmSettings,
} from "./shared/types.js";

export type LlmEnvironment = Partial<Record<
  "CHRONI_LLM_ENABLED" | "CHRONI_LLM_MODE" | "CHRONI_LLM_BASE_URL" | "CHRONI_LLM_API_KEY" | "CHRONI_LLM_MODEL",
  string | undefined
>>;

const fallbackSettings: ChroniLlmSettings = {
  enabled: false,
  mode: "managed",
  provider: "openai-compatible",
  baseUrl: CHRONI_MANAGED_LLM_BASE_URL,
  apiKey: "",
  model: CHRONI_MANAGED_LLM_MODEL,
};

export function resolveLlmSettings(settings?: ChroniLlmSettings, environment: LlmEnvironment = process.env): ChroniLlmSettings {
  const current = settings ?? fallbackSettings;
  return {
    enabled: booleanEnvironmentValue(environment.CHRONI_LLM_ENABLED) ?? current.enabled,
    mode: modeEnvironmentValue(environment.CHRONI_LLM_MODE) ?? current.mode ?? "custom",
    provider: "openai-compatible",
    baseUrl: stringEnvironmentValue(environment.CHRONI_LLM_BASE_URL) ?? current.baseUrl,
    apiKey: stringEnvironmentValue(environment.CHRONI_LLM_API_KEY) ?? current.apiKey,
    model: stringEnvironmentValue(environment.CHRONI_LLM_MODEL) ?? current.model,
  };
}

export function hasLlmEnvironmentConfiguration(environment: LlmEnvironment = process.env): boolean {
  return llmEnabledEnvironmentOverride(environment) !== undefined || [
    environment.CHRONI_LLM_MODE,
    environment.CHRONI_LLM_BASE_URL,
    environment.CHRONI_LLM_API_KEY,
    environment.CHRONI_LLM_MODEL,
  ].some((value) => !!value?.trim());
}

export function llmEnabledEnvironmentOverride(environment: LlmEnvironment = process.env): boolean | undefined {
  return booleanEnvironmentValue(environment.CHRONI_LLM_ENABLED);
}

function stringEnvironmentValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function booleanEnvironmentValue(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized ?? "")) return true;
  if (["0", "false", "no", "off"].includes(normalized ?? "")) return false;
  return undefined;
}

function modeEnvironmentValue(value: string | undefined): ChroniLlmMode | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "managed" || normalized === "custom" ? normalized : undefined;
}
