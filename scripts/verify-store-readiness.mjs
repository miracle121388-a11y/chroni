import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage } from "@napi-rs/canvas";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps", "desktop");
const require = createRequire(import.meta.url);
const builderConfig = require(join(desktop, "electron-builder.config.cjs"));
const args = new Set(process.argv.slice(2));
const requestedPlatform = process.argv.find((value) => value.startsWith("--platform="))?.split("=")[1];
const releaseCheck = args.has("--release");

assert(!requestedPlatform || requestedPlatform === "windows" || requestedPlatform === "macos", "Use --platform=windows or --platform=macos.");

const requiredFiles = [
  "build/icon.ico",
  "build/icon.icns",
  "build/icon.png",
  "build/PrivacyInfo.xcprivacy",
  "build/entitlements.mas.plist",
  "build/entitlements.mas.inherit.plist",
  "../../docs/user/privacy.md",
  "../../site/privacy.html",
  "../../docs/store/listing.zh-CN.md",
  "../../docs/store/privacy-declarations.md",
  "../../docs/store/release-checklist.md",
  "../../docs/store/review-notes.md",
];
for (const relativePath of requiredFiles) {
  assert(existsSync(join(desktop, relativePath)), `Missing Store resource: ${relativePath}`);
}

assert(builderConfig.appId === "app.chroni.desktop", "Store bundle identifier must be app.chroni.desktop.");
assert(builderConfig.productName === "Chroni", "Store product name must be Chroni.");
assert(builderConfig.executableName === "Chroni", "Store executable name must be Chroni.");
assert(builderConfig.mas?.type === "distribution", "Mac App Store target must use distribution signing.");
assert(builderConfig.mas?.entitlements === "build/entitlements.mas.plist", "MAS app entitlements are not configured.");
assert(builderConfig.mas?.entitlementsInherit === "build/entitlements.mas.inherit.plist", "MAS inherited entitlements are not configured.");
assert(builderConfig.mac?.extraResources?.some((entry) => entry.to === "PrivacyInfo.xcprivacy"), "PrivacyInfo.xcprivacy is not bundled.");
assert(builderConfig.mac?.extendInfo?.CFBundleDevelopmentRegion === "zh_CN", "macOS development region must match the shipped language.");
assert(JSON.stringify(builderConfig.mac?.extendInfo?.CFBundleLocalizations) === JSON.stringify(["zh_CN"]), "macOS localizations must advertise only shipped languages.");
assert(builderConfig.appx?.applicationId === "Chroni", "AppX application ID must be Chroni.");
assert(builderConfig.appx?.displayName === "Chroni", "AppX display name must be Chroni.");
assert(JSON.stringify(builderConfig.appx?.languages) === JSON.stringify(["zh-CN"]), "AppX must advertise only the shipped zh-CN interface.");

const mainSource = readFileSync(join(desktop, "src", "main.ts"), "utf8");
const preloadSource = readFileSync(join(desktop, "preload.cjs"), "utf8");
const rendererSource = readFileSync(join(desktop, "src", "renderer", "src", "main.tsx"), "utf8");
assert(mainSource.includes("process.mas || process.windowsStore"), "Store builds must disable GitHub self-update.");
assert(preloadSource.includes("storeManaged: Boolean(process.mas || process.windowsStore)"), "Renderer must know when the system Store manages the app.");
assert(rendererSource.includes('api.storeManaged && api.platform === "darwin"'), "Mac App Store imports must transfer selected file content across the sandbox boundary.");

const privacyManifest = readFileSync(join(desktop, "build", "PrivacyInfo.xcprivacy"), "utf8");
for (const expected of [
  "NSPrivacyTracking",
  "NSPrivacyCollectedDataTypes",
  "NSPrivacyCollectedDataTypeOtherUserContent",
  "NSPrivacyCollectedDataTypeOtherUsageData",
  "NSPrivacyCollectedDataTypeUserID",
  "NSPrivacyAccessedAPITypes",
]) {
  assert(privacyManifest.includes(expected), `Privacy manifest is missing ${expected}.`);
}
assert(/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacyManifest), "Chroni must not declare tracking.");

const privacyPolicy = readFileSync(join(root, "docs", "user", "privacy.md"), "utf8");
for (const marker of ["默认保存在本机", "可能发送到模型服务的数据", "模型服务如何留存", "删除本地数据", "安全问题"]) {
  assert(privacyPolicy.includes(marker), `Privacy policy is missing required disclosure: ${marker}`);
}

const masEntitlements = readFileSync(join(desktop, "build", "entitlements.mas.plist"), "utf8");
for (const entitlement of [
  "com.apple.security.app-sandbox",
  "com.apple.security.files.user-selected.read-write",
  "com.apple.security.network.client",
  "com.apple.security.network.server",
]) {
  assert(masEntitlements.includes(`<key>${entitlement}</key>`), `MAS entitlement is missing ${entitlement}.`);
}

const appxAssets = [
  ["BadgeLogo.png", 24, 24],
  ["SmallTile.png", 71, 71],
  ["StoreLogo.png", 50, 50],
  ["Square44x44Logo.png", 44, 44],
  ["Square150x150Logo.png", 150, 150],
  ["Wide310x150Logo.png", 310, 150],
  ["LargeTile.png", 310, 310],
  ["SplashScreen.png", 620, 300],
];
for (const [file, width, height] of appxAssets) {
  const filePath = join(desktop, "build", "appx", file);
  assert(existsSync(filePath), `Missing AppX visual asset: ${file}`);
  await assertImageSize(filePath, width, height, file);
}

const screenshotDirectory = join(root, "docs", "store", "assets", "screenshots", "zh-CN");
for (const name of ["00-first-run.png", "01-today.png", "02-learning-mission.png", "03-agent.png", "04-sources.png", "05-companion.png"]) {
  const filePath = join(screenshotDirectory, name);
  assert(existsSync(filePath), `Missing Store screenshot: ${name}. Run pnpm run store:screenshots.`);
  await assertImageSize(filePath, 1440, 900, name);
}

for (const document of ["listing.zh-CN.md", "review-notes.md", "privacy-declarations.md"]) {
  const content = readFileSync(join(root, "docs", "store", document), "utf8");
  for (const forbidden of ["GOAI", "复赛", "参赛", "无界应用", "TODO", "TBD"]) {
    assert(!content.includes(forbidden), `${document} contains unrelated or placeholder copy: ${forbidden}`);
  }
}

if (releaseCheck && requestedPlatform === "windows") {
  assert(process.platform === "win32", "Microsoft Store packages must be built on Windows.");
  const identity = requireEnvironment("CHRONI_WINDOWS_STORE_IDENTITY_NAME");
  const publisher = requireEnvironment("CHRONI_WINDOWS_STORE_PUBLISHER");
  const publisherDisplayName = requireEnvironment("CHRONI_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME");
  assert(/^[A-Za-z0-9.-]{3,50}$/.test(identity), "CHRONI_WINDOWS_STORE_IDENTITY_NAME has an invalid Partner Center format.");
  assert(/^CN=.{1,255}$/i.test(publisher), "CHRONI_WINDOWS_STORE_PUBLISHER must be the exact Partner Center CN= value.");
  assert(publisherDisplayName.length <= 256, "CHRONI_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME is too long.");
}
if (releaseCheck && requestedPlatform === "macos") {
  assert(process.platform === "darwin", "Mac App Store packages must be built and signed on macOS.");
  requireEnvironment("CSC_LINK");
  requireEnvironment("CSC_KEY_PASSWORD");
  requireEnvironment("CSC_INSTALLER_LINK");
  requireEnvironment("CSC_INSTALLER_KEY_PASSWORD");
  const profile = requireEnvironment("CHRONI_MAC_STORE_PROVISIONING_PROFILE");
  assert(existsSync(resolve(profile)), "CHRONI_MAC_STORE_PROVISIONING_PROFILE does not point to a file.");
}

console.log(`Chroni Store readiness check passed${releaseCheck ? ` for ${requestedPlatform}` : ""}.`);

async function assertImageSize(filePath, width, height, label) {
  const image = await loadImage(filePath);
  assert(image.width === width && image.height === height, `${label} must be ${width}x${height}; received ${image.width}x${image.height}.`);
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required for a release Store package.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
