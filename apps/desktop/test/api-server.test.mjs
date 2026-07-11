import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startChroniApiServer } from "../dist/api-server.js";
import { ChroniStore } from "../dist/store.js";

async function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "chroni-api-test-"));
  const store = new ChroniStore(dir);
  try {
    return await fn(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function listenWithRandomPort(store, callback = () => {}) {
  const previousPort = process.env.CHRONI_API_PORT;
  process.env.CHRONI_API_PORT = "0";
  const server = startChroniApiServer(store, callback);
  process.env.CHRONI_API_PORT = previousPort;
  return new Promise((resolve) => {
    server.on("listening", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function getApiToken(server) {
  const health = await apiRequest(server, "GET", "/api/health");
  return health.body.apiToken;
}

function apiRequest(server, method, path, body, headers = {}) {
  const address = server.address();
  assert.equal(typeof address, "object");
  const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port: address.port,
      method,
      path,
      headers: {
        ...headers,
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("api port 0 listens on a random available port", async () => {
  await withStore(async (store) => {
    const server = await listenWithRandomPort(store);
    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      assert.notEqual(address.port, 8765);
    } finally {
      await closeServer(server);
    }
  });
});

test("api preference updates notify callers with preferences reason", async () => {
  await withStore(async (store) => {
    const reasons = [];
    const server = await listenWithRandomPort(store, (_snapshot, reason) => reasons.push(reason));
    try {
      const token = await getApiToken(server);
      const result = await apiRequest(server, "PATCH", "/api/preferences", { remindersEnabled: false }, {
        authorization: `Bearer ${token}`,
      });

      assert.equal(result.status, 200);
      assert.deepEqual(reasons, ["preferences"]);
    } finally {
      await closeServer(server);
    }
  });
});

test("api invalid json returns a client error instead of server error", async () => {
  await withStore(async (store) => {
    const server = await listenWithRandomPort(store);
    try {
      const token = await getApiToken(server);
      const result = await apiRequest(server, "PATCH", "/api/preferences", "{bad json", {
        authorization: `Bearer ${token}`,
      });

      assert.equal(result.status, 400);
      assert.equal(result.body.ok, false);
      assert.match(result.body.error, /JSON/);
    } finally {
      await closeServer(server);
    }
  });
});

test("api health issues a session token and protected routes require it", async () => {
  await withStore(async (store) => {
    const server = await listenWithRandomPort(store);
    try {
      const unauthorized = await apiRequest(server, "GET", "/api/snapshot");
      const health = await apiRequest(server, "GET", "/api/health");
      const authorized = await apiRequest(server, "GET", "/api/snapshot", undefined, {
        authorization: `Bearer ${health.body.apiToken}`,
      });

      assert.equal(unauthorized.status, 401);
      assert.match(health.body.apiToken, /^[A-Za-z0-9_-]{24,}$/);
      assert.equal(authorized.status, 200);
    } finally {
      await closeServer(server);
    }
  });
});

test("api responses never expose the configured LLM key", async () => {
  await withStore(async (store) => {
    store.updatePreferences({ llm: { apiKey: "sk-chroni-secret" } });
    const server = await listenWithRandomPort(store);
    try {
      const health = await apiRequest(server, "GET", "/api/health");
      const result = await apiRequest(server, "GET", "/api/snapshot", undefined, {
        authorization: `Bearer ${health.body.apiToken}`,
      });

      assert.equal(result.body.snapshot.preferences.llm.apiKey, "");
      assert.equal(JSON.stringify(result.body).includes("sk-chroni-secret"), false);
    } finally {
      await closeServer(server);
    }
  });
});

test("api does not allow arbitrary browser origins by default", async () => {
  await withStore(async (store) => {
    const server = await listenWithRandomPort(store);
    try {
      const result = await apiRequest(server, "GET", "/api/health", undefined, {
        origin: "https://example.invalid",
      });

      assert.equal(result.status, 403);
      assert.equal(result.headers["access-control-allow-origin"], undefined);
    } finally {
      await closeServer(server);
    }
  });
});

test("api permits only the explicitly configured browser origin", async () => {
  await withStore(async (store) => {
    const previousOrigin = process.env.CHRONI_API_ALLOWED_ORIGIN;
    process.env.CHRONI_API_ALLOWED_ORIGIN = "https://trusted.chroni.local";
    const server = await listenWithRandomPort(store);
    if (previousOrigin === undefined) delete process.env.CHRONI_API_ALLOWED_ORIGIN;
    else process.env.CHRONI_API_ALLOWED_ORIGIN = previousOrigin;
    try {
      const result = await apiRequest(server, "GET", "/api/health", undefined, {
        origin: "https://trusted.chroni.local",
      });

      assert.equal(result.status, 200);
      assert.equal(result.headers["access-control-allow-origin"], "https://trusted.chroni.local");
      assert.equal(result.headers.vary, "Origin");
    } finally {
      await closeServer(server);
    }
  });
});

test("api rejects oversized JSON before buffering the request", async () => {
  await withStore(async (store) => {
    const server = await listenWithRandomPort(store);
    try {
      const token = await getApiToken(server);
      const result = await apiRequest(server, "POST", "/api/extract", undefined, {
        authorization: `Bearer ${token}`,
        "content-length": String(32 * 1024 * 1024 + 1),
        "content-type": "application/json",
      });

      assert.equal(result.status, 413);
    } finally {
      await closeServer(server);
    }
  });
});
