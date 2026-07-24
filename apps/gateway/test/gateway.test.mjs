import assert from "node:assert/strict";
import test from "node:test";

import { loadGatewayConfig } from "../dist/config.js";
import { createGatewayServer } from "../dist/server.js";

const baseConfig = loadGatewayConfig({
  PORT: "0",
  DEEPSEEK_API_KEY: "provider-secret",
  DEEPSEEK_MODEL: "deepseek-v4-flash",
  CHRONI_GATEWAY_ACCESS_KEYS_JSON: JSON.stringify({ tester: "beta-secret" }),
  CHRONI_GATEWAY_REQUESTS_PER_MINUTE: "2",
  CHRONI_GATEWAY_REQUESTS_PER_DAY: "10",
});

test("health check reports missing secrets without exposing values", async () => {
  const config = loadGatewayConfig({});
  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.deepEqual(body.missing, [
      "DEEPSEEK_API_KEY",
      "CHRONI_GATEWAY_ACCESS_KEYS_JSON or CHRONI_GATEWAY_ACCESS_TOKEN",
    ]);
    assert.doesNotMatch(JSON.stringify(body), /provider-secret|beta-secret/);
  });
});

test("gateway requires a beta access token", async () => {
  await withServer(baseConfig, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "chroni-beta", messages: [{ role: "user", content: "ping" }] }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "invalid_access_token");
  });
});

test("gateway validates requests and controls upstream model settings", async () => {
  let upstreamRequest;
  const fetchImpl = async (url, init) => {
    upstreamRequest = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      id: "completion-1",
      choices: [{ message: { role: "assistant", content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const logs = [];
  await withServer(baseConfig, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer beta-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "unauthorized-model",
        messages: [{ role: "user", content: "private prompt text" }],
        thinking: { type: "enabled" },
        max_tokens: 99_999,
        response_format: { type: "json_object" },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).choices[0].message.content, "{\"ok\":true}");
  }, { fetchImpl, logger: (entry) => logs.push(entry) });

  assert.equal(upstreamRequest.url, "https://api.deepseek.com/chat/completions");
  assert.equal(upstreamRequest.init.headers.authorization, "Bearer provider-secret");
  assert.equal(upstreamRequest.body.model, "deepseek-v4-flash");
  assert.deepEqual(upstreamRequest.body.thinking, { type: "disabled" });
  assert.equal(upstreamRequest.body.max_tokens, 8_192);
  assert.equal(logs[0].credential_id, "tester");
  assert.equal(logs[0].total_tokens, 13);
  assert.doesNotMatch(JSON.stringify(logs), /private prompt text|provider-secret|beta-secret/);
});

test("gateway applies per-credential minute limits", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: "ok" } }],
  }), { status: 200 });
  await withServer(baseConfig, async (baseUrl) => {
    const request = () => fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer beta-secret", "content-type": "application/json" },
      body: JSON.stringify({ model: "chroni-beta", messages: [{ role: "user", content: "ping" }] }),
    });
    assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 200);
    const limited = await request();
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, "minute_limit");
  }, { fetchImpl, logger: () => undefined });
});

async function withServer(config, run, dependencies = {}) {
  const server = createGatewayServer(config, dependencies);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
