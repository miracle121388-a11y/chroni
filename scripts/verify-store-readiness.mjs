import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
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
  "../../site/support.html",
  "../../docs/store/app-store-connect.zh-CN.json",
  "../../docs/store/listing.zh-CN.md",
  "../../docs/store/privacy-declarations.md",
  "../../docs/store/release-checklist.md",
  "../../docs/store/review-notes.md",
];
for (const relativePath of requiredFiles) assert(existsSync(join(desktop, relativePath)), `Missing Store resource: ${relativePath}`);

assert(builderConfig.appId === "app.chroni.desktop", "Store bundle identifier must be app.chroni.desktop.");
assert(builderConfig.productName === "Chroni" && builderConfig.executableName === "Chroni", "Store product and executable names must be Chroni.");
assert(builderConfig.mas?.type === "distribution", "Mac App Store target must use distribution signing.");
assert(builderConfig.mas?.entitlements === "build/entitlements.mas.plist", "MAS app entitlements are not configured.");
assert(builderConfig.mas?.entitlementsInherit === "build/entitlements.mas.inherit.plist", "MAS inherited entitlements are not configured.");
assert(builderConfig.mac?.extraResources?.some((entry) => entry.to === "PrivacyInfo.xcprivacy"), "PrivacyInfo.xcprivacy is not bundled.");
assert(builderConfig.mac?.extendInfo?.CFBundleDevelopmentRegion === "zh_CN", "macOS development region must match the shipped language.");
assert(JSON.stringify(builderConfig.mac?.extendInfo?.CFBundleLocalizations) === JSON.stringify(["zh_CN"]), "macOS localizations must advertise only shipped languages.");
assert(builderConfig.mac?.extendInfo?.ITSAppUsesNonExemptEncryption === false, "macOS export-compliance metadata must declare no non-exempt encryption.");
assert(typeof builderConfig.mac?.extendInfo?.NSMicrophoneUsageDescription === "string", "macOS microphone purpose text is missing.");

if (requestedPlatform !== "macos") {
  assert(builderConfig.appx?.applicationId === "Chroni" && builderConfig.appx?.displayName === "Chroni", "AppX identity is incorrect.");
  assert(JSON.stringify(builderConfig.appx?.languages) === JSON.stringify(["zh-CN"]), "AppX must advertise only the shipped zh-CN interface.");
}

const mainSource = readFileSync(join(desktop, "src", "main.ts"), "utf8");
const preloadSource = readFileSync(join(desktop, "preload.cjs"), "utf8");
const rendererSource = readFileSync(join(desktop, "src", "renderer", "src", "main.tsx"), "utf8");
assert(mainSource.includes("process.mas || process.windowsStore"), "Store builds must disable GitHub self-update.");
assert(preloadSource.includes("storeManaged: Boolean(process.mas || process.windowsStore)"), "Renderer must know when the system Store manages the app.");
assert(rendererSource.includes('api.storeManaged && api.platform === "darwin"'), "Mac App Store imports must transfer selected file content across the sandbox boundary.");
assert(!mainSource.includes("firstLaunch"), "Fresh installs must not silently enable off-device model processing.");
for (const marker of ["是否同意并开启", "dataSharingConsentAt", "二进制原文件、原始录音和证据文件不会发送"]) {
  assert(rendererSource.includes(marker), `Model consent UI is missing: ${marker}`);
}

const privacyManifest = readFileSync(join(desktop, "build", "PrivacyInfo.xcprivacy"), "utf8");
for (const expected of [
  "NSPrivacyTracking",
  "NSPrivacyCollectedDataTypes",
  "NSPrivacyCollectedDataTypeOtherUserContent",
  "NSPrivacyCollectedDataTypeOtherUsageData",
  "NSPrivacyCollectedDataTypeOtherDataTypes",
  "NSPrivacyAccessedAPITypes",
]) assert(privacyManifest.includes(expected), `Privacy manifest is missing ${expected}.`);
assert(/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacyManifest), "Chroni must not declare tracking.");
assert(!/<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/.test(privacyManifest), "Chroni has no account or device identity to link collected model data to.");

const privacyPolicy = readFileSync(join(root, "docs", "user", "privacy.md"), "utf8");
for (const marker of ["默认保存在本机", "明确同意", "可能发送到模型服务的数据", "模型服务如何留存", "删除本地数据", "安全问题"]) {
  assert(privacyPolicy.includes(marker), `Privacy policy is missing required disclosure: ${marker}`);
}

const masEntitlements = readFileSync(join(desktop, "build", "entitlements.mas.plist"), "utf8");
for (const entitlement of [
  "com.apple.security.app-sandbox",
  "com.apple.security.files.user-selected.read-write",
  "com.apple.security.network.client",
  "com.apple.security.network.server",
  "com.apple.security.device.audio-input",
]) assert(masEntitlements.includes(`<key>${entitlement}</key>`), `MAS entitlement is missing ${entitlement}.`);

if (requestedPlatform !== "macos") {
  const appxAssets = [
    ["BadgeLogo.png", 24, 24], ["SmallTile.png", 71, 71], ["StoreLogo.png", 50, 50],
    ["Square44x44Logo.png", 44, 44], ["Square150x150Logo.png", 150, 150],
    ["Wide310x150Logo.png", 310, 150], ["LargeTile.png", 310, 310], ["SplashScreen.png", 620, 300],
  ];
  for (const [file, width, height] of appxAssets) {
    const filePath = join(desktop, "build", "appx", file);
    assert(existsSync(filePath), `Missing AppX visual asset: ${file}`);
    await assertImageSize(filePath, width, height, file);
  }
}

const macScreenshots = requestedPlatform === "macos";
const screenshotDirectory = join(root, "docs", "store", "assets", "screenshots", ...(macScreenshots ? ["macos"] : []), "zh-CN");
const screenshotExtension = macScreenshots ? ".jpg" : ".png";
const screenshotNames = ["00-first-run", "01-today", "02-learning-mission", "03-smart-organize", "04-daily-review", "05-companion"];
assert(screenshotNames.length >= 1 && screenshotNames.length <= 10, "App Store screenshot count must be from 1 to 10.");
for (const stem of screenshotNames) {
  const name = `${stem}${screenshotExtension}`;
  const filePath = join(screenshotDirectory, name);
  assert(existsSync(filePath), `Missing Store screenshot: ${name}. Run pnpm run store:screenshots${macScreenshots ? ":macos" : ""}.`);
  await assertAcceptedScreenshot(filePath, name, macScreenshots);
}

const metadata = JSON.parse(readFileSync(join(root, "docs", "store", "app-store-connect.zh-CN.json"), "utf8"));
const supportPage = readFileSync(join(root, "site", "support.html"), "utf8");
assert(metadata.bundleId === "app.chroni.desktop" && metadata.platform === "macOS", "App Store Connect metadata identity is incorrect.");
assert(codePoints(metadata.name) <= 30 && codePoints(metadata.subtitle) <= 30, "App name and subtitle must each be at most 30 characters.");
assert(Buffer.byteLength(metadata.keywords, "utf8") <= 100, `App Store keywords use ${Buffer.byteLength(metadata.keywords, "utf8")} bytes; maximum is 100.`);
assert(metadata.primaryLocale === "zh-Hans", "App Store primary locale must be zh-Hans.");
for (const key of ["supportUrl", "marketingUrl", "privacyPolicyUrl"]) assertHttpsUrl(metadata[key], key);
assert(metadata.supportUrl === "https://getchroni.zeabur.app/support.html", "Support URL must use the public support page.");
assert(/^\d{4}\s+\S/.test(metadata.copyright) && !metadata.copyright.includes("©"), "App Store copyright must use `year rights-holder`; Apple adds the copyright symbol.");
assert(metadata.exportCompliance?.usesNonExemptEncryption === false, "Metadata export-compliance answer is inconsistent.");
assert(metadata.ageRatingQuestionnaire?.expectedGlobalRating === "4+", "Expected age rating must be documented as 4+.");

const listing = readFileSync(join(root, "docs", "store", "listing.zh-CN.md"), "utf8");
const description = listing.match(/## 完整描述\s+([\s\S]*?)(?=\n## )/)?.[1]?.trim() ?? "";
assert(description && codePoints(description) <= 4_000, `App description must be from 1 to 4000 characters; received ${codePoints(description)}.`);

for (const document of ["listing.zh-CN.md", "review-notes.md", "privacy-declarations.md"]) {
  const content = readFileSync(join(root, "docs", "store", document), "utf8");
  for (const forbidden of ["GOAI", "复赛", "参赛", "无界应用", "TODO", "TBD"]) assert(!content.includes(forbidden), `${document} contains unrelated or placeholder copy: ${forbidden}`);
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
  for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "CSC_INSTALLER_LINK", "CSC_INSTALLER_KEY_PASSWORD", "CHRONI_MAC_STORE_COPYRIGHT"]) requireEnvironment(key);
  const legalCopyright = requireEnvironment("CHRONI_MAC_STORE_COPYRIGHT");
  assert(metadata.copyright === legalCopyright && !/contributors/i.test(legalCopyright), "Replace App Store metadata copyright with the company rights holder and keep CHRONI_MAC_STORE_COPYRIGHT identical.");
  const supportEmail = requireEnvironment("CHRONI_APP_STORE_SUPPORT_EMAIL");
  assert(supportPage.includes(`mailto:${supportEmail}`), "The public support page must contain CHRONI_APP_STORE_SUPPORT_EMAIL as a mailto link.");
  const buildNumber = requireEnvironment("CHRONI_MAC_BUILD_NUMBER");
  assert(/^\d+(?:\.\d+){0,2}$/.test(buildNumber), "CHRONI_MAC_BUILD_NUMBER has an invalid Apple build-number format.");
  assert(builderConfig.buildVersion === buildNumber, "electron-builder did not receive CHRONI_MAC_BUILD_NUMBER.");
  const profilePath = resolve(requireEnvironment("CHRONI_MAC_STORE_PROVISIONING_PROFILE"));
  assert(existsSync(profilePath), "CHRONI_MAC_STORE_PROVISIONING_PROFILE does not point to a file.");
  verifyProvisioningProfile(profilePath);
  const xcodeVersion = execFileSync("xcodebuild", ["-version"], { encoding: "utf8" }).match(/^Xcode\s+(\d+(?:\.\d+)?)/m)?.[1];
  assert(xcodeVersion && Number(xcodeVersion) >= 14, `Xcode 14 or newer is required; received ${xcodeVersion ?? "unknown"}.`);
  const xcodeLicense = spawnSync("xcodebuild", ["-license", "check"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert(xcodeLicense.status === 0, "Xcode license is not accepted. Run `sudo xcodebuild -license` in Terminal before packaging.");
}

console.log(`Chroni Store readiness check passed${requestedPlatform ? ` for ${requestedPlatform}` : ""}${releaseCheck ? " (release credentials present)" : ""}.`);

async function assertImageSize(filePath, width, height, label) {
  const image = await loadImage(filePath);
  assert(image.width === width && image.height === height, `${label} must be ${width}x${height}; received ${image.width}x${image.height}.`);
}

async function assertAcceptedScreenshot(filePath, label, rejectAlpha) {
  const image = await loadImage(filePath);
  const accepted = new Set(["1280x800", "1440x900", "2560x1600", "2880x1800"]);
  assert(accepted.has(`${image.width}x${image.height}`), `${label} has unsupported Mac screenshot dimensions ${image.width}x${image.height}.`);
  if (!rejectAlpha || extname(filePath).toLowerCase() !== ".png") return;
  const bytes = readFileSync(filePath);
  const colorType = bytes[25];
  assert(colorType !== 4 && colorType !== 6 && !bytes.includes(Buffer.from("tRNS")), `${label} contains an alpha channel, which App Store screenshots do not accept.`);
}

function verifyProvisioningProfile(profilePath) {
  const xml = execFileSync("security", ["cms", "-D", "-i", profilePath]);
  const profile = plistToJson(xml);
  const teamId = Array.isArray(profile.TeamIdentifier) ? profile.TeamIdentifier[0] : undefined;
  assert(typeof teamId === "string" && teamId, "Provisioning profile has no TeamIdentifier.");
  assert(profile.Entitlements?.["application-identifier"] === `${teamId}.app.chroni.desktop`, "Provisioning profile does not match app.chroni.desktop.");
  assert(profile.Entitlements?.["get-task-allow"] !== true, "Provisioning profile must be a distribution profile.");
  assert(new Date(profile.ExpirationDate).getTime() > Date.now(), "Provisioning profile is expired.");
}

function plistToJson(input) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }));
}

function codePoints(value) {
  return [...String(value ?? "")].length;
}

function assertHttpsUrl(value, field) {
  const url = new URL(String(value ?? ""));
  assert(url.protocol === "https:", `${field} must be an HTTPS URL.`);
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required for a release Store package.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
