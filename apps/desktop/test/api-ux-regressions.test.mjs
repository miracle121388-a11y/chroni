import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveApiPort, startChroniApiServer } from "../dist/api-server.js";
import { ChroniStore } from "../dist/store.js";

test("invalid API ports fall back without preventing desktop startup", () => {
  assert.equal(resolveApiPort(undefined), 8765);
  assert.equal(resolveApiPort("not-a-port"), 8765);
  assert.equal(resolveApiPort("-1"), 8765);
  assert.equal(resolveApiPort("65536"), 8765);
  assert.equal(resolveApiPort("0"), 0);
  assert.equal(resolveApiPort("43120"), 43120);
});

test("browser preflight includes PUT and public errors remain actionable Chinese", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chroni-api-ux-"));
  const store = new ChroniStore(directory);
  const previousPort = process.env.CHRONI_API_PORT;
  const previousOrigin = process.env.CHRONI_API_ALLOWED_ORIGIN;
  process.env.CHRONI_API_PORT = "0";
  process.env.CHRONI_API_ALLOWED_ORIGIN = "https://chroni.test";
  const server = startChroniApiServer(store, () => {});
  if (previousPort === undefined) delete process.env.CHRONI_API_PORT;
  else process.env.CHRONI_API_PORT = previousPort;
  if (previousOrigin === undefined) delete process.env.CHRONI_API_ALLOWED_ORIGIN;
  else process.env.CHRONI_API_ALLOWED_ORIGIN = previousOrigin;

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const preflight = await fetch(`${baseUrl}/api/items/example/plan`, {
      method: "OPTIONS",
      headers: { origin: "https://chroni.test" },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /\bPUT\b/);

    const health = await fetch(`${baseUrl}/api/health`);
    const { apiToken } = await health.json();
    const missing = await fetch(`${baseUrl}/api/not-real`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    const body = await missing.json();
    assert.equal(missing.status, 404);
    assert.match(body.error, /[\u3400-\u9fff]/u);
    assert.doesNotMatch(body.error, /Unknown|undefined|null/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
