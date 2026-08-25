import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import builderConfig from "../electron-builder.config.cjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const releaseWorkflow = readFileSync(new URL("../../../.github/workflows/release-build.yml", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../src/renderer/src/main.tsx", import.meta.url), "utf8");
const rendererTypes = readFileSync(new URL("../src/renderer/src/vite-env.d.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const windowsSource = readFileSync(new URL("../src/windows.ts", import.meta.url), "utf8");

test("packaging commands never publish before release artifacts are verified", () => {
  for (const name of ["package", "package:win", "package:mac", "package:linux", "package:goai:win:inner", "package:goai:mac:inner"]) {
    assert.match(packageJson.scripts[name], /--publish never/);
  }
  assert.match(packageJson.scripts["package:goai:win"], /package:goai:win:inner/);
  assert.match(packageJson.scripts["package:goai:mac"], /package:goai:mac:inner/);
});

test("macOS universal packaging preserves both canvas native architectures", () => {
  assert.equal(builderConfig.mac.x64ArchFiles, "**/node_modules/@napi-rs/canvas-darwin-*/**");
});

test("release packaging removes empty certificate variables", () => {
  assert.match(releaseWorkflow, /Remove-Item Env:CSC_LINK/);
  assert.match(releaseWorkflow, /unset CSC_LINK CSC_KEY_PASSWORD/);
});

test("public release jobs use the original safe-asset packaging path", () => {
  assert.match(releaseWorkflow, /pnpm run package:goai:windows/);
  assert.match(releaseWorkflow, /pnpm run package:goai:macos/);
  assert.doesNotMatch(releaseWorkflow, /pnpm run package:(?:windows|macos)\s*$/m);
});

test("desktop packages expose first-party and XIAOTONG license notices", () => {
  assert.deepEqual(builderConfig.extraResources, [
    { from: "../../LICENSE", to: "licenses/CHRONI-MIT-LICENSE.txt" },
    { from: "../../THIRD_PARTY_NOTICES.md", to: "licenses/THIRD_PARTY_NOTICES.md" },
    { from: "../../THIRD_PARTY_DEPENDENCIES.md", to: "licenses/THIRD_PARTY_DEPENDENCIES.md" },
    { from: "third_party/fonts/OFL-1.1.txt", to: "licenses/FONTS-SIL-OFL-1.1.txt" },
    { from: "third_party/fonts/NOTICE.md", to: "licenses/FONT-NOTICE.md" },
    { from: "third_party/xiaotong/LICENSE", to: "licenses/XIAOTONG-APACHE-2.0.txt" },
    { from: "third_party/xiaotong/ADDITIONAL_TERMS.md", to: "licenses/XIAOTONG-ADDITIONAL-TERMS.md" },
    { from: "third_party/xiaotong/README.md", to: "licenses/XIAOTONG-NOTICE.md" },
  ]);
});

test("GOAI original mode excludes every XIAOTONG package resource", () => {
  const script = "process.env.CHRONI_PET_ASSET_MODE='original'; process.stdout.write(JSON.stringify(require('./electron-builder.config.cjs').extraResources))";
  const resources = JSON.parse(execFileSync(process.execPath, ["-e", script], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
  assert.equal(resources.some((entry) => /xiaotong/i.test(`${entry.from} ${entry.to}`)), false);
  assert.equal(resources.some((entry) => entry.to === "licenses/THIRD_PARTY_NOTICES.md"), true);
  assert.equal(resources.some((entry) => entry.to === "licenses/THIRD_PARTY_DEPENDENCIES.md"), true);
});

test("XIAOTONG About view preserves attribution, contact, version, and donation QR", () => {
  const qr = Buffer.from(readFileSync(new URL("../third_party/xiaotong/donate_qr.b64", import.meta.url), "utf8").trim(), "base64");
  assert.deepEqual([...qr.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  for (const requiredText of ["v1.0.1", "WWW.没有COM", "xy12981118", "请作者喝杯咖啡", "XIAOTONG-Desktop-pet"]) {
    assert.match(rendererSource, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("About view is directly reachable from the control center and desktop menu", () => {
  assert.match(rendererSource, /onClick=\{\(\) => selectTab\("about"\)\}>关于<\/button>/);
  assert.match(rendererSource, /\{tab === "about" && <AboutPane \/>\}/);
  assert.match(rendererSource, /api\.getUpdateStatus\(\)/);
  assert.match(windowsSource, /label: "关于 Chroni", click: \(\) => showControlCenter\(\{ tab: "about" \}\)/);
  assert.match(mainSource, /candidate\.tab === "about"/);
  assert.match(rendererTypes, /"services" \| "about"/);
});
