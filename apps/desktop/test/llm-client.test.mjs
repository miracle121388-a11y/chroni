import assert from "node:assert/strict";
import test from "node:test";

import { requestChatCompletion, testLlmConnection } from "../dist/llm-client.js";

const settings = {
  enabled: true,
  mode: "custom",
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
  assert.deepEqual(JSON.parse(received.init.body).thinking, { type: "disabled" });
});

test("requestChatCompletion keeps provider defaults scoped and overridable", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };

  await requestChatCompletion({ ...settings, baseUrl: "https://example.test/v1" }, [{ role: "user", content: "ping" }], { fetchImpl });
  await requestChatCompletion(settings, [{ role: "user", content: "ping" }], {
    fetchImpl,
    body: { thinking: { type: "enabled" } },
  });

  assert.equal("thinking" in bodies[0], false);
  assert.deepEqual(bodies[1].thinking, { type: "enabled" });
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
    [401, "authentication", /API Key 无效/],
    [404, "model", /API 地址或模型名称不可用/],
    [429, "rate_limit", /模型服务正忙或额度不足/],
  ];
  for (const [status, kind, message] of cases) {
    const result = await testLlmConnection(settings, {
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "provider detail" } }), { status }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, kind);
    assert.match(result.message, message);
    assert.doesNotMatch(result.message, /provider detail|HTTP/i);
  }
});

test("testLlmConnection leaves room for a DeepSeek final answer", async () => {
  let body;
  const result = await testLlmConnection(settings, {
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
    },
  });

  assert.equal(result.ok, true);
  assert.ok(body.max_tokens >= 32);
  assert.deepEqual(body.thinking, { type: "disabled" });
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

test("managed connections use beta-specific status messages", async () => {
  const managed = {
    ...settings,
    mode: "managed",
    baseUrl: "https://api-getchroni.zeabur.app/v1",
    apiKey: "beta-code",
    model: "chroni-beta",
  };
  const failed = await testLlmConnection(managed, {
    fetchImpl: async () => new Response(null, { status: 401 }),
  });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /内测访问码/);

  const succeeded = await testLlmConnection(managed, {
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 }),
  });
  assert.deepEqual(succeeded, { ok: true, message: "Chroni 内测智能服务可以正常响应。" });
});
