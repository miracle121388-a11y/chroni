import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { loadChroniEnvironment, sanitizedElectronEnvironment } = require("../scripts/run-electron.cjs");

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

test("loadChroniEnvironment loads a repository env file without overriding the shell", () => {
  const directory = mkdtempSync(join(tmpdir(), "chroni-env-test-"));
  const filePath = join(directory, ".env");
  const previousKey = process.env.CHRONI_ENV_FILE_TEST;
  const previousShell = process.env.CHRONI_ENV_SHELL_TEST;
  try {
    writeFileSync(filePath, "CHRONI_ENV_FILE_TEST=from-file\nCHRONI_ENV_SHELL_TEST=from-file\n", "utf8");
    delete process.env.CHRONI_ENV_FILE_TEST;
    process.env.CHRONI_ENV_SHELL_TEST = "from-shell";

    assert.equal(loadChroniEnvironment(filePath), true);
    assert.equal(process.env.CHRONI_ENV_FILE_TEST, "from-file");
    assert.equal(process.env.CHRONI_ENV_SHELL_TEST, "from-shell");
    assert.equal(loadChroniEnvironment(join(directory, "missing.env")), false);
  } finally {
    if (previousKey === undefined) delete process.env.CHRONI_ENV_FILE_TEST;
    else process.env.CHRONI_ENV_FILE_TEST = previousKey;
    if (previousShell === undefined) delete process.env.CHRONI_ENV_SHELL_TEST;
    else process.env.CHRONI_ENV_SHELL_TEST = previousShell;
    rmSync(directory, { recursive: true, force: true });
  }
});
