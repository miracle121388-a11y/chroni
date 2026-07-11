import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { sanitizedElectronEnvironment } = require("../scripts/run-electron.cjs");

test("sanitizedElectronEnvironment removes Electron's Node-mode switch", () => {
  const source = {
    ELECTRON_RUN_AS_NODE: "1",
    CHRONI_RENDERER_URL: "http://127.0.0.1:5173",
    PATH: "example-path",
  };

  const result = sanitizedElectronEnvironment(source);

  assert.equal("ELECTRON_RUN_AS_NODE" in result, false);
  assert.equal(result.CHRONI_RENDERER_URL, source.CHRONI_RENDERER_URL);
  assert.equal(result.PATH, source.PATH);
  assert.equal(source.ELECTRON_RUN_AS_NODE, "1");
});
