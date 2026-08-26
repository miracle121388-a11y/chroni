import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage } from "@napi-rs/canvas";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps", "desktop");
const args = new Set(process.argv.slice(2));
const requestedPlatform = process.argv.find((value) => value.startsWith("--platform="))?.split("=")[1];
const releaseCheck = args.has("--release");

const requiredFiles = [
  "build/icon.ico",
  "build/icon.icns",
  "build/icon.png",
  "build/PrivacyInfo.xcprivacy",
  "build/entitlements.mas.plist",
  "build/entitlements.mas.inherit.plist",
  "../../docs/user/privacy.md",
  "../../site/privacy.html",
];
for (const relativePath of requiredFiles) {
  assert(existsSync(join(desktop, relativePath)), `Missing Store resource: ${relativePath}`);
}

const builderConfig = readFileSync(join(desktop, "electron-builder.config.cjs"), "utf8");
for (const expected of [
  "app.chroni.desktop",
  "productName: \"Chroni\"",
  "executableName: \"Chroni\"",
  "appx:",
  "identityName: windowsStoreIdentityName",
  "entitlements.mas.plist",
  "PrivacyInfo.xcprivacy",
]) {
  assert(builderConfig.includes(expected), `Store builder configuration is missing: ${expected}`);
}

const mainSource = readFileSync(join(desktop, "src", "main.ts"), "utf8");
assert(mainSource.includes("process.mas || process.windowsStore"), "Store builds must disable GitHub self-update.");

const privacyManifest = readFileSync(join(desktop, "build", "PrivacyInfo.xcprivacy"), "utf8");
for (const expected of ["NSPrivacyTracking", "NSPrivacyCollectedDataTypes", "NSPrivacyAccessedAPITypes"]) {
  assert(privacyManifest.includes(`<key>${expected}</key>`), `Privacy manifest is missing ${expected}.`);
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
  const image = await loadImage(filePath);
  assert(image.width === width && image.height === height, `${file} must be ${width}x${height}.`);
}

if (releaseCheck && requestedPlatform === "windows") {
  requireEnvironment("CHRONI_WINDOWS_STORE_IDENTITY_NAME");
  requireEnvironment("CHRONI_WINDOWS_STORE_PUBLISHER");
}
if (releaseCheck && requestedPlatform === "macos") {
  assert(process.platform === "darwin", "Mac App Store packages must be built and signed on macOS.");
  const profile = requireEnvironment("CHRONI_MAC_STORE_PROVISIONING_PROFILE");
  assert(existsSync(resolve(profile)), "CHRONI_MAC_STORE_PROVISIONING_PROFILE does not point to a file.");
}

console.log(`Chroni Store readiness check passed${releaseCheck ? ` for ${requestedPlatform}` : ""}.`);

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required for a release Store package.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
