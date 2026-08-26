import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps", "desktop");
const output = join(desktop, "dist-electron");
const packageJson = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const args = new Set(process.argv.slice(2));
const requestedPlatform = process.argv.find((value) => value.startsWith("--platform="))?.split("=")[1];
const expectedVariant = process.argv.find((value) => value.startsWith("--variant="))?.split("=")[1];
const storeBuild = args.has("--store");
const platform = requestedPlatform || ({ darwin: "macos", win32: "windows", linux: "linux" })[process.platform];

assert(["macos", "windows", "linux"].includes(platform), "Use --platform=macos, --platform=windows, or --platform=linux.");
assert(expectedVariant === "product" || expectedVariant === "goai", "Use --variant=product or --variant=goai.");
assert(existsSync(output), "Desktop package output is missing.");

const require = createRequire(import.meta.url);
const electronBuilderRequire = createRequire(require.resolve("../apps/desktop/node_modules/electron-builder/package.json"));
const asar = electronBuilderRequire("@electron/asar");
const packageRoot = findPackageRoot();
const asarPath = platform === "macos"
  ? join(packageRoot, "Contents", "Resources", "app.asar")
  : join(packageRoot, "resources", "app.asar");

assert(existsSync(asarPath), `Packaged app.asar is missing: ${asarPath}`);
const files = asar.listPackage(asarPath).map((file) => file.replace(/^\//, ""));
const fileSet = new Set(files);
const buildManifest = JSON.parse(asar.extractFile(asarPath, "dist/build-manifest.json").toString("utf8"));

assert(buildManifest.schemaVersion === 1, "Packaged build manifest schema is invalid.");
assert(buildManifest.productName === "Chroni", "Packaged build manifest product name is invalid.");
assert(buildManifest.version === packageJson.version, "Packaged build manifest version does not match package.json.");
assert(buildManifest.variant === expectedVariant, `Packaged variant is ${buildManifest.variant}; expected ${expectedVariant}.`);

const rendererPngs = files.filter((file) => /^dist\/renderer\/assets\/.*\.png$/i.test(file));
const rendererPngBytes = rendererPngs.reduce((total, file) => total + Number(asar.statFile(asarPath, file).size || 0), 0);
const rendererScripts = files
  .filter((file) => /^dist\/renderer\/assets\/.*\.js$/i.test(file))
  .map((file) => asar.extractFile(asarPath, file).toString("utf8"))
  .join("\n");

if (expectedVariant === "product") {
  assert(buildManifest.petAssetMode === "xiaotong", "Product artifact does not declare xiaotong companion assets.");
  assert(rendererPngs.length >= 200, `Product artifact contains only ${rendererPngs.length} companion PNG files.`);
  assert(rendererPngBytes >= 10_000_000, `Product companion payload is unexpectedly small: ${rendererPngBytes} bytes.`);
  for (const marker of ["XIAOTONG Desktop Pet", "支持原作者", "附加条款"]) {
    assert(rendererScripts.includes(marker), `Product artifact is missing companion attribution: ${marker}`);
  }
  assert(!files.some((file) => /icon-source-.*\.svg$/i.test(file)), "Product artifact incorrectly contains the hourglass companion placeholder.");
} else {
  assert(buildManifest.petAssetMode === "original", "GOAI artifact does not declare the safe companion asset mode.");
  assert(rendererPngs.length === 0, "GOAI artifact unexpectedly contains restricted companion PNG files.");
  assert(files.some((file) => /icon-source-.*\.svg$/i.test(file)), "GOAI artifact is missing its safe placeholder asset.");
}

if (platform === "macos") verifyMacArtifact(packageRoot, asarPath, fileSet);
else verifyPortableArtifactResources(packageRoot, asarPath, fileSet);

console.log(`Chroni ${platform} ${expectedVariant} artifact verified: ${basename(packageRoot)}, ${rendererPngs.length} companion PNG files, ${rendererPngBytes} bytes.`);

function findPackageRoot() {
  if (platform === "macos") {
    const apps = findDirectories(output, "Chroni.app")
      .filter((path) => storeBuild ? path.includes(`${sep}mas-`) : !path.includes(`${sep}mas-`));
    assert(apps.length === 1, `Expected one packaged Chroni.app, found ${apps.length}.`);
    return apps[0];
  }
  const executable = platform === "windows" ? "Chroni.exe" : "Chroni";
  const candidates = findFilesCaseInsensitive(output, executable)
    .filter((path) => path.includes(`${sep}${platform === "windows" ? "win-" : "linux-"}`));
  assert(candidates.length === 1, `Expected one unpacked ${executable}, found ${candidates.length}.`);
  return dirname(candidates[0]);
}

function verifyPortableArtifactResources(appRoot, packagedAsar, fileSet) {
  const resources = join(appRoot, "resources");
  if (expectedVariant === "product") {
    for (const relative of [
      "licenses/XIAOTONG-APACHE-2.0.txt",
      "licenses/XIAOTONG-ADDITIONAL-TERMS.md",
      "licenses/XIAOTONG-NOTICE.md",
      "privacy/PRIVACY.md",
    ]) assert(existsSync(join(resources, relative)), `Packaged resources are missing ${relative}.`);
  }
  const canvasModules = [...fileSet].filter((file) => platform === "windows"
    ? /^node_modules\/@napi-rs\/canvas-win32-x64-msvc\/skia\.win32-x64-msvc\.node$/.test(file)
    : /^node_modules\/@napi-rs\/canvas-linux-x64-(?:gnu|musl)\/skia\.linux-x64-(?:gnu|musl)\.node$/.test(file));
  assert(canvasModules.length > 0, `${platform} package is missing its x64 Canvas native module.`);
  for (const modulePath of canvasModules) {
    assert(existsSync(join(`${packagedAsar}.unpacked`, modulePath)), `${platform} package did not unpack ${modulePath}.`);
  }
}

function verifyMacArtifact(appPath, packagedAsar, fileSet) {
  assert(process.platform === "darwin", "macOS artifacts must be verified on macOS.");
  const contents = join(appPath, "Contents");
  const resources = join(contents, "Resources");
  const infoPlistPath = join(contents, "Info.plist");
  const info = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", infoPlistPath], { encoding: "utf8" }));

  assert(info.CFBundleIdentifier === "app.chroni.desktop", `Unexpected bundle identifier: ${info.CFBundleIdentifier}`);
  assert(info.CFBundleDisplayName === "Chroni" && info.CFBundleName === "Chroni", "macOS bundle name is not Chroni.");
  assert(info.CFBundleShortVersionString === packageJson.version && info.CFBundleVersion === packageJson.version, "macOS bundle version is stale.");
  assert(info.CFBundleIconFile === "icon.icns" && existsSync(join(resources, "icon.icns")), "macOS app icon is missing.");
  verifyMacIcon(resources);
  assert(info.LSMinimumSystemVersion === "12.0", `Unexpected minimum macOS version: ${info.LSMinimumSystemVersion}`);
  assert(info.CFBundleDevelopmentRegion === "zh_CN", `Unexpected development region: ${info.CFBundleDevelopmentRegion}`);
  assert(JSON.stringify(info.CFBundleLocalizations) === JSON.stringify(["zh_CN"]), "macOS localization declaration is incorrect.");
  const privacyManifestPath = join(resources, "PrivacyInfo.xcprivacy");
  assert(existsSync(privacyManifestPath), "Packaged macOS privacy manifest is missing.");
  const privacyManifest = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", privacyManifestPath], { encoding: "utf8" }));
  assert(privacyManifest.NSPrivacyTracking === false, "macOS privacy manifest incorrectly declares tracking.");
  assert(Array.isArray(privacyManifest.NSPrivacyCollectedDataTypes), "macOS privacy manifest has no collected-data declaration.");
  assert(Array.isArray(privacyManifest.NSPrivacyAccessedAPITypes), "macOS privacy manifest has no required-reason API declaration.");
  for (const key of [
    "NSAudioCaptureUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
  ]) assert(!(key in info), `Unused protected-resource declaration remains in Info.plist: ${key}`);
  assert(info.NSAppTransportSecurity?.NSAllowsArbitraryLoads !== true, "macOS bundle permits arbitrary insecure network loads.");

  const integrity = info.ElectronAsarIntegrity?.["Resources/app.asar"];
  const actualHeaderHash = createHash("sha256").update(asar.getRawHeader(packagedAsar).headerString).digest("hex");
  assert(integrity?.algorithm === "SHA256" && integrity.hash === actualHeaderHash, "Electron ASAR integrity metadata does not match app.asar.");

  assertArchitectures(join(contents, "MacOS", "Chroni"), ["arm64", "x86_64"], "Chroni executable");
  for (const [modulePath, architecture] of [
    ["node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node", "arm64"],
    ["node_modules/@napi-rs/canvas-darwin-x64/skia.darwin-x64.node", "x86_64"],
  ]) {
    assert(fileSet.has(modulePath), `Universal ASAR is missing ${modulePath}.`);
    const unpackedPath = join(`${packagedAsar}.unpacked`, modulePath);
    assert(existsSync(unpackedPath), `Universal app is missing unpacked native module ${modulePath}.`);
    assertArchitectures(unpackedPath, [architecture], modulePath);
  }

  if (expectedVariant === "product") {
    for (const relative of [
      "licenses/XIAOTONG-APACHE-2.0.txt",
      "licenses/XIAOTONG-ADDITIONAL-TERMS.md",
      "licenses/XIAOTONG-NOTICE.md",
      "privacy/PRIVACY.md",
    ]) assert(existsSync(join(resources, relative)), `macOS bundle is missing ${relative}.`);
  }

  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { stdio: "pipe" });
  const entitlements = execCombined("/usr/bin/codesign", ["--display", "--entitlements", ":-", appPath]);
  for (const entitlement of [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-library-validation",
  ]) assert(entitlements.includes(`<key>${entitlement}</key>`), `macOS signature is missing ${entitlement}.`);
  const signature = execCombined("/usr/bin/codesign", ["--display", "--verbose=4", appPath]);
  if (process.env.CHRONI_REQUIRE_SIGNING === "1") {
    assert(/Authority=Developer ID Application:/i.test(signature), "Public macOS artifact is not signed with Developer ID Application.");
    assert(/flags=.*runtime/i.test(signature), "Public macOS artifact does not enable hardened runtime.");
    assert(/TeamIdentifier=(?!not set)/i.test(signature), "Public macOS artifact has no signing TeamIdentifier.");
  }
  if (process.env.CHRONI_REQUIRE_NOTARIZATION === "1") {
    execFileSync("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", appPath], { stdio: "pipe" });
    execFileSync("/usr/bin/xcrun", ["stapler", "validate", appPath], { stdio: "pipe" });
  }

  if (!storeBuild) {
    const expectedPrefix = `Chroni-${packageJson.version}-mac-universal`;
    const dmgPath = join(output, `${expectedPrefix}.dmg`);
    const zipPath = join(output, `${expectedPrefix}.zip`);
    assert(existsSync(dmgPath), `macOS release is missing ${expectedPrefix}.dmg.`);
    assert(existsSync(zipPath), `macOS release is missing ${expectedPrefix}.zip.`);
    verifyDmgContainer(dmgPath);
    execFileSync("/usr/bin/unzip", ["-tq", zipPath], { stdio: "pipe" });
    const updateMetadataPath = join(output, "latest-mac.yml");
    assert(existsSync(updateMetadataPath), "macOS update metadata is missing.");
    const updateMetadata = readFileSync(updateMetadataPath, "utf8");
    assert(updateMetadata.includes(`version: ${packageJson.version}`), "macOS update metadata version is stale.");
    assert(updateMetadata.includes(`${expectedPrefix}.dmg`) && updateMetadata.includes(`${expectedPrefix}.zip`), "macOS update metadata does not reference both release containers.");
  }
}

function verifyMacIcon(resources) {
  const packagedIcon = join(resources, "icon.icns");
  const sourceIcon = join(desktop, "build", "icon.icns");
  assert(fileDigest(packagedIcon) === fileDigest(sourceIcon), "Packaged macOS icon differs from the approved Chroni icon.");
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "chroni-icon-verify-"));
  const iconset = join(temporaryDirectory, "Chroni.iconset");
  try {
    execFileSync("/usr/bin/iconutil", ["--convert", "iconset", "--output", iconset, packagedIcon], { stdio: "pipe" });
    for (const name of [
      "icon_16x16.png",
      "icon_16x16@2x.png",
      "icon_32x32.png",
      "icon_32x32@2x.png",
      "icon_128x128.png",
      "icon_128x128@2x.png",
      "icon_256x256.png",
      "icon_256x256@2x.png",
      "icon_512x512.png",
      "icon_512x512@2x.png",
    ]) assert(existsSync(join(iconset, name)), `macOS icon is missing ${name}.`);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function verifyDmgContainer(dmgPath) {
  const mountPoint = mkdtempSync(join(tmpdir(), "chroni-dmg-verify-"));
  let attached = false;
  try {
    execFileSync("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath], { stdio: "pipe" });
    attached = true;
    const mountedApp = join(mountPoint, "Chroni.app");
    const applicationsLink = join(mountPoint, "Applications");
    assert(existsSync(mountedApp), "DMG does not contain Chroni.app.");
    assert(existsSync(applicationsLink) && lstatSync(applicationsLink).isSymbolicLink(), "DMG does not contain the Applications shortcut.");
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", mountedApp], { stdio: "pipe" });
  } finally {
    if (attached) execFileSync("/usr/bin/hdiutil", ["detach", mountPoint], { stdio: "pipe" });
    rmSync(mountPoint, { force: true, recursive: true });
  }
}

function assertArchitectures(file, expected, label) {
  const actual = execFileSync("/usr/bin/lipo", ["-archs", file], { encoding: "utf8" }).trim().split(/\s+/).sort();
  assert(JSON.stringify(actual) === JSON.stringify([...expected].sort()), `${label} architectures are ${actual.join(", ")}; expected ${expected.join(", ")}.`);
}

function findDirectories(directory, name) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (!entry.isDirectory()) return [];
    if (entry.name === name) return [path];
    return findDirectories(path, name);
  });
}

function findFilesCaseInsensitive(directory, name) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? findFilesCaseInsensitive(path, name)
      : entry.name.toLowerCase() === name.toLowerCase()
        ? [path]
        : [];
  });
}

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function execCombined(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${basename(command)} failed: ${(result.stderr || result.stdout).trim()}`);
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
