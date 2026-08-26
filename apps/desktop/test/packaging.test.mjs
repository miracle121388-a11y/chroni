import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import builderConfig from "../electron-builder.config.cjs";

const require = createRequire(import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const builderSchema = JSON.parse(readFileSync(require.resolve("app-builder-lib/scheme.json"), "utf8"));
const releaseWorkflow = readFileSync(new URL("../../../.github/workflows/release-build.yml", import.meta.url), "utf8");
const storeWorkflow = readFileSync(new URL("../../../.github/workflows/store-build.yml", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../src/renderer/src/main.tsx", import.meta.url), "utf8");
const rendererTypes = readFileSync(new URL("../src/renderer/src/vite-env.d.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const windowsSource = readFileSync(new URL("../src/windows.ts", import.meta.url), "utf8");

test("packaging commands never publish before release artifacts are verified", () => {
  for (const name of ["package", "package:win", "package:mac", "package:linux", "package:win:store", "package:mac:store", "package:goai:win:inner", "package:goai:mac:inner"]) {
    assert.match(packageJson.scripts[name], /--publish never/);
  }
  for (const name of ["package", "package:win", "package:mac", "package:linux"]) {
    assert.match(packageJson.scripts[name], /verify:product-assets/);
  }
  assert.match(packageJson.scripts["package:goai:win"], /package:goai:win:inner/);
  assert.match(packageJson.scripts["package:goai:mac"], /package:goai:mac:inner/);
  for (const name of ["package:win:store", "package:mac:store"]) {
    assert.match(packageJson.scripts[name], /verify:product-assets/);
    assert.match(packageJson.scripts[name], /verify-store-readiness\.mjs/);
    assert.match(packageJson.scripts[name], /verify-store-artifact\.mjs/);
  }
});

test("macOS universal packaging preserves both canvas native architectures", () => {
  assert.equal(builderConfig.mac.x64ArchFiles, "**/node_modules/@napi-rs/canvas-darwin-*/**");
});

test("Store packages keep Chroni identity, sandbox permissions, and system-managed updates", () => {
  assert.equal(builderConfig.appId, "app.chroni.desktop");
  assert.equal(builderConfig.productName, "Chroni");
  assert.equal(builderConfig.executableName, "Chroni");
  assert.equal(builderConfig.appx.applicationId, "Chroni");
  assert.equal(builderConfig.appx.displayName, "Chroni");
  assert.deepEqual(builderConfig.appx.languages, ["zh-CN"]);
  const validAppxKeys = new Set(Object.keys(builderSchema.definitions.AppXOptions.properties));
  assert.deepEqual(Object.keys(builderConfig.appx).filter((key) => !validAppxKeys.has(key)), []);
  assert.equal(builderConfig.mas.type, "distribution");
  assert.equal(builderConfig.mas.entitlements, "build/entitlements.mas.plist");
  assert.equal(builderConfig.mas.entitlementsInherit, "build/entitlements.mas.inherit.plist");
  assert.deepEqual(builderConfig.mac.extendInfo.CFBundleLocalizations, ["zh_CN"]);
  assert.equal(builderConfig.mac.extraResources.some((entry) => entry.to === "PrivacyInfo.xcprivacy"), true);
  assert.match(mainSource, /managedByStore: Boolean\(process\.mas \|\| process\.windowsStore\)/);
  assert.match(preloadSource, /storeManaged: Boolean\(process\.mas \|\| process\.windowsStore\)/);
  assert.match(rendererSource, /api\.storeManaged && api\.platform === "darwin"/);
  assert.match(rendererSource, /updateStatus\.managedByStore/);
  assert.match(storeWorkflow, /store-verification-windows\.json/);
  assert.match(storeWorkflow, /store-verification-macos\.json/);
  assert.match(storeWorkflow, /MAC_STORE_INSTALLER_CSC_LINK/);
  assert.match(storeWorkflow, /MAC_STORE_INSTALLER_CSC_KEY_PASSWORD/);
});

test("release packaging removes empty certificate variables", () => {
  assert.match(releaseWorkflow, /Remove-Item Env:CSC_LINK/);
  assert.match(releaseWorkflow, /unset CSC_LINK CSC_KEY_PASSWORD/);
});

test("public release jobs use the verified product packaging path", () => {
  assert.match(releaseWorkflow, /pnpm run package:windows/);
  assert.match(releaseWorkflow, /pnpm run package:macos/);
  assert.doesNotMatch(releaseWorkflow, /pnpm run package:goai:(?:windows|macos)/);
});

test("default desktop packages include the companion's required notices", () => {
  assert.deepEqual(builderConfig.extraResources, [
    { from: "../../LICENSE", to: "licenses/CHRONI-MIT-LICENSE.txt" },
    { from: "../../THIRD_PARTY_NOTICES.md", to: "licenses/THIRD_PARTY_NOTICES.md" },
    { from: "../../THIRD_PARTY_DEPENDENCIES.md", to: "licenses/THIRD_PARTY_DEPENDENCIES.md" },
    { from: "../../docs/user/privacy.md", to: "privacy/PRIVACY.md" },
    { from: "third_party/fonts/OFL-1.1.txt", to: "licenses/FONTS-SIL-OFL-1.1.txt" },
    { from: "third_party/fonts/NOTICE.md", to: "licenses/FONT-NOTICE.md" },
    { from: "third_party/xiaotong/LICENSE", to: "licenses/XIAOTONG-APACHE-2.0.txt" },
    { from: "third_party/xiaotong/ADDITIONAL_TERMS.md", to: "licenses/XIAOTONG-ADDITIONAL-TERMS.md" },
    { from: "third_party/xiaotong/README.md", to: "licenses/XIAOTONG-NOTICE.md" },
  ]);
});

test("explicit original mode excludes companion-specific package notices", () => {
  const script = "process.env.CHRONI_PET_ASSET_MODE='original'; process.stdout.write(JSON.stringify(require('./electron-builder.config.cjs').extraResources))";
  const resources = JSON.parse(execFileSync(process.execPath, ["-e", script], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
  assert.equal(resources.some((entry) => /xiaotong/i.test(`${entry.from} ${entry.to}`)), false);
  assert.equal(resources.some((entry) => entry.to === "licenses/THIRD_PARTY_NOTICES.md"), true);
  assert.equal(resources.some((entry) => entry.to === "licenses/THIRD_PARTY_DEPENDENCIES.md"), true);
});

test("public UI restores the animated companion without dedicated competition or credits navigation", () => {
  assert.match(rendererSource, /petAnimationFrames, petAssetMode, xiaotongDonationQr/);
  assert.match(rendererSource, /当前桌宠形象基于 XIAOTONG Desktop Pet/);
  assert.match(rendererSource, /WWW\.没有COM/);
  assert.doesNotMatch(rendererSource, /selectTab\("demo"\)|selectTab\("about"\)|>GOAI 演示<|>关于</);
});

test("control center keeps all six product workspaces directly accessible", () => {
  for (const label of ["今日执行", "学习任务", "任务来源", "执行 Agent", "偏好设置", "运行状态"]) assert.match(rendererSource, new RegExp(`>${label}<`));
  assert.match(rendererSource, /useState<ControlTab>\("daily"\)/);
  assert.match(rendererSource, /\{tab === "preferences" && <PreferencesPane/);
  assert.match(rendererSource, /\{tab === "services" && <ServicesPane/);
  assert.match(rendererSource, /<DemoDataTools setSnapshot=\{setSnapshot\}/);
  assert.match(rendererSource, /api\.getUpdateStatus\(\)/);
  assert.match(windowsSource, /label: "偏好设置", click: \(\) => showControlCenter\(\{ tab: "preferences" \}\)/);
  assert.match(mainSource, /candidate\.tab === "preferences".*candidate\.tab === "services"/);
  assert.match(rendererTypes, /"agent" \| "preferences" \| "services"/);
});
