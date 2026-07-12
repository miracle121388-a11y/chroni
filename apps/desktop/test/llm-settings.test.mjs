import assert from "node:assert/strict";
import test from "node:test";

import { hasLlmEnvironmentConfiguration, llmEnabledEnvironmentOverride, resolveLlmSettings } from "../dist/llm-settings.js";

const persisted = {
  enabled: false,
  provider: "openai-compatible",
  baseUrl: "https://persisted.example/v1",
  apiKey: "persisted-key",
  model: "persisted-model",
};

test("LLM environment variables override persisted settings without mutating them", () => {
  const resolved = resolveLlmSettings(persisted, {
    CHRONI_LLM_ENABLED: "1",
    CHRONI_LLM_BASE_URL: " https://api.deepseek.com/ ",
    CHRONI_LLM_API_KEY: " env-key ",
    CHRONI_LLM_MODEL: " deepseek-v4-flash ",
  });

  assert.deepEqual(resolved, {
    enabled: true,
    provider: "openai-compatible",
    baseUrl: "https://api.deepseek.com/",
    apiKey: "env-key",
    model: "deepseek-v4-flash",
  });
  assert.equal(persisted.enabled, false);
  assert.equal(persisted.apiKey, "persisted-key");
});

test("LLM environment flags can explicitly disable a persisted model", () => {
  const resolved = resolveLlmSettings({ ...persisted, enabled: true }, { CHRONI_LLM_ENABLED: "false" });
  assert.equal(resolved.enabled, false);
  assert.equal(llmEnabledEnvironmentOverride({ CHRONI_LLM_ENABLED: "false" }), false);
  assert.equal(llmEnabledEnvironmentOverride({ CHRONI_LLM_ENABLED: "1" }), true);
  assert.equal(llmEnabledEnvironmentOverride({}), undefined);
});

test("blank or unrelated environment values leave persisted settings intact", () => {
  const environment = {
    CHRONI_LLM_ENABLED: "not-a-boolean",
    CHRONI_LLM_BASE_URL: "  ",
    CHRONI_LLM_API_KEY: "",
    CHRONI_LLM_MODEL: undefined,
  };

  assert.deepEqual(resolveLlmSettings(persisted, environment), persisted);
  assert.equal(hasLlmEnvironmentConfiguration(environment), false);
  assert.equal(hasLlmEnvironmentConfiguration({}), false);
});
