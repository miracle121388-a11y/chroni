import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import builderConfig from "../electron-builder.config.cjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("packaging commands never publish before release artifacts are verified", () => {
  for (const name of ["package", "package:win", "package:mac", "package:linux"]) {
    assert.match(packageJson.scripts[name], /--publish never$/);
  }
});

test("macOS universal packaging preserves both canvas native architectures", () => {
  assert.equal(builderConfig.mac.x64ArchFiles, "**/node_modules/@napi-rs/canvas-darwin-*/**");
});
