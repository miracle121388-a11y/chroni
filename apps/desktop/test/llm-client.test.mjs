import assert from "node:assert/strict";
import test from "node:test";

import { requestChatCompletion, testLlmConnection } from "../dist/llm-client.js";

const settings = {
  enabled: true,
  provider: "openai-compatible",
  baseUrl: "https://api.deepseek.com",
  apiKey: "sk-test",
  model: "deepseek-v4-flash",
};

test("requestChatCompletion sends an OpenAI-compatible request", async () => {
  let received;
  const content = await requestChatCompletion(settings, [{ role: "user", content: "ping" }], {
    fetchImpl: async (url, init) => {
      received = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { content: "pong" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(content, "pong");
  assert.equal(received.url, "https://api.deepseek.com/chat/completions");
  assert.equal(received.init.headers.authorization, "Bearer sk-test");
});

test("requestChatCompletion aborts requests after the configured timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    requestChatCompletion(settings, [{ role: "user", content: "ping" }], {
      timeoutMs: 20,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    }),
    (error) => error?.kind === "timeout",
  );
  assert.ok(Date.now() - started < 1000);
});

test("testLlmConnection categorizes common provider failures", async () => {
  const cases = [
    [401, "authentication"],
    [404, "model"],
    [429, "rate_limit"],
  ];
  for (const [status, kind] of cases) {
    const result = await testLlmConnection(settings, {
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "provider detail" } }), { status }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, kind);
    assert.match(result.message, /provider detail/);
  }
});

test("testLlmConnection rejects incomplete settings without making a request", async () => {
  let called = false;
  const result = await testLlmConnection({ ...settings, apiKey: "" }, {
    fetchImpl: async () => {
      called = true;
      return new Response();
    },
  });

  assert.deepEqual(result, { ok: false, kind: "configuration", message: "请先填写 API Key。" });
  assert.equal(called, false);
});
