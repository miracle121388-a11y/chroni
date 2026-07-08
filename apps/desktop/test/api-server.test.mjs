import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startChroniApiServer } from "../dist/api-server.js";
import { ChroniStore } from "../dist/store.js";

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "chroni-api-test-"));
  const store = new ChroniStore(dir);
  try {
    return fn(store);
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

function apiRequest(server, method, path, body) {
  const address = server.address();
  assert.equal(typeof address, "object");
  const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port: address.port,
      method,
      path,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : undefined,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
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
      const result = await apiRequest(server, "PATCH", "/api/preferences", { remindersEnabled: false });

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
      const result = await apiRequest(server, "PATCH", "/api/preferences", "{bad json");

      assert.equal(result.status, 400);
      assert.equal(result.body.ok, false);
      assert.match(result.body.error, /JSON/);
    } finally {
      await closeServer(server);
    }
  });
});
