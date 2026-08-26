import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps", "desktop");
const output = join(desktop, "dist-electron");
const platform = process.argv.find((value) => value.startsWith("--platform="))?.split("=")[1];

if (platform === "windows") verifyWindowsArtifact();
else if (platform === "macos") verifyMacArtifact();
else throw new Error("Use --platform=windows or --platform=macos.");

function verifyWindowsArtifact() {
  if (process.platform !== "win32") throw new Error("Windows Store artifacts must be verified on Windows.");
  const packagePath = onlyArtifact(".appx");
  assert(statSync(packagePath).size > 100 * 1024 * 1024, "AppX package is unexpectedly small; bundled runtime or companion assets may be missing.");
  const identityName = requireEnvironment("CHRONI_WINDOWS_STORE_IDENTITY_NAME");
  const publisher = requireEnvironment("CHRONI_WINDOWS_STORE_PUBLISHER");
  const publisherDisplayName = requireEnvironment("CHRONI_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME");
  const packageVersion = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version;
  const makeAppx = findMakeAppx();
  const extractionRoot = mkdtempSync(join(tmpdir(), "chroni-appx-verify-"));
  try {
    const unpacked = join(extractionRoot, "unpacked");
    execFileSync(makeAppx, ["unpack", "/p", packagePath, "/d", unpacked, "/o"], { stdio: "pipe" });

    const manifestPath = join(unpacked, "AppxManifest.xml");
    assert(existsSync(manifestPath), "AppX manifest is missing.");
    const manifest = readFileSync(manifestPath, "utf8");
    const manifestIdentityName = xmlAttribute(manifest, "Identity", "Name");
    const manifestPublisher = xmlAttribute(manifest, "Identity", "Publisher");
    assert(manifestIdentityName === identityName, `AppX Identity.Name is ${manifestIdentityName}; expected ${identityName}.`);
    assert(manifestPublisher === publisher, `AppX Identity.Publisher is ${manifestPublisher}; expected ${publisher}.`);
    assert(xmlAttribute(manifest, "Identity", "ProcessorArchitecture") === "x64", "AppX architecture must be x64.");
    assert(xmlAttribute(manifest, "Identity", "Version") === `${packageVersion}.0`, "AppX manifest version does not match package.json.");
    assert(/<DisplayName>Chroni<\/DisplayName>/.test(manifest), "AppX display name must be Chroni.");
    assert(xmlElement(manifest, "PublisherDisplayName") === publisherDisplayName, "AppX PublisherDisplayName does not match Partner Center.");
    assert(/Executable=["']app\\Chroni\.exe["']/.test(manifest), "AppX entry point must launch app\\Chroni.exe.");
    assert(/runFullTrust/.test(manifest), "Packaged desktop app must declare runFullTrust.");

    for (const file of [
      "app/Chroni.exe",
      "app/resources/app.asar",
      "assets/StoreLogo.png",
      "assets/Square44x44Logo.png",
      "assets/Square150x150Logo.png",
      "assets/Wide310x150Logo.png",
      "assets/LargeTile.png",
      "assets/SplashScreen.png",
      "app/resources/privacy/PRIVACY.md",
      "app/resources/licenses/XIAOTONG-APACHE-2.0.txt",
      "app/resources/licenses/XIAOTONG-ADDITIONAL-TERMS.md",
      "app/resources/licenses/XIAOTONG-NOTICE.md",
    ]) {
      assert(resolveCaseInsensitive(unpacked, file), `AppX payload is missing ${file}.`);
    }
    const asarPath = resolveCaseInsensitive(unpacked, "app/resources/app.asar");
    assert(asarPath && statSync(asarPath).size > 10 * 1024 * 1024, "AppX app.asar is unexpectedly small.");

    writeReport("windows", packagePath, {
      identityName,
      publisher,
      publisherDisplayName,
      architecture: "x64",
      packageStructureCheck: `makeappx unpack (${makeAppx})`,
      manifestVersion: xmlAttribute(manifest, "Identity", "Version"),
    });
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true });
  }
}

function verifyMacArtifact() {
  if (process.platform !== "darwin") throw new Error("Mac App Store artifacts must be verified on macOS.");
  const packagePath = onlyArtifact(".pkg");
  assert(statSync(packagePath).size > 100 * 1024 * 1024, "Mac App Store package is unexpectedly small.");
  const appPath = findDirectories(output, "Chroni.app")[0];
  assert(appPath, "Signed Chroni.app is missing from the MAS build output.");
  const infoPlist = join(appPath, "Contents", "Info.plist");
  const privacyManifest = join(appPath, "Contents", "Resources", "PrivacyInfo.xcprivacy");
  const provisioningProfile = join(appPath, "Contents", "embedded.provisionprofile");
  assert(existsSync(infoPlist), "Chroni.app Info.plist is missing.");
  assert(existsSync(privacyManifest), "Chroni.app privacy manifest is missing.");
  assert(existsSync(provisioningProfile), "Chroni.app embedded provisioning profile is missing.");

  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { stdio: "pipe" });
  const entitlements = execText("codesign", ["--display", "--entitlements", ":-", appPath]);
  for (const entitlement of [
    "com.apple.security.app-sandbox",
    "com.apple.security.cs.allow-jit",
    "com.apple.security.files.user-selected.read-write",
    "com.apple.security.network.client",
    "com.apple.security.network.server",
  ]) {
    assert(entitlements.includes(`<key>${entitlement}</key>`), `Signed app is missing ${entitlement}.`);
  }
  const bundleId = execText("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPlist]).trim();
  assert(bundleId === "app.chroni.desktop", `Unexpected MAS bundle identifier: ${bundleId}`);
  const signatureDetails = execCombined("codesign", ["--display", "--verbose=4", appPath]);
  assert(/Authority=(?:Apple Distribution|3rd Party Mac Developer Application)/i.test(signatureDetails), "Chroni.app does not report a Mac App Store application signature.");
  const packageSignature = execCombined("pkgutil", ["--check-signature", packagePath]);
  assert(/Mac Installer Distribution|3rd Party Mac Developer Installer/i.test(packageSignature), "PKG does not report a Mac App Store installer signature.");
  writeReport("macos", packagePath, {
    bundleId,
    applicationSignature: signatureDetails.trim().split(/\r?\n/).filter((line) => /^(Identifier|Authority|TeamIdentifier)=/.test(line)),
    packageSignature: packageSignature.trim().split(/\r?\n/).slice(0, 5),
  });
}

function onlyArtifact(extension) {
  assert(existsSync(output), "Store package output directory is missing.");
  const artifacts = readdirSync(output)
    .filter((name) => extname(name).toLowerCase() === extension)
    .map((name) => join(output, name));
  assert(artifacts.length === 1, `Expected one ${extension} artifact, found ${artifacts.length}.`);
  return artifacts[0];
}

function findMakeAppx() {
  const kits = process.env["ProgramFiles(x86)"]
    ? join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin")
    : "";
  assert(kits && existsSync(kits), "Windows SDK is missing; install the current Windows App Certification Kit.");
  const candidates = readdirSync(kits, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(kits, entry.name, "x64", "makeappx.exe"))
    .filter(existsSync);
  const unversioned = join(kits, "x64", "makeappx.exe");
  if (existsSync(unversioned)) candidates.push(unversioned);
  assert(candidates.length > 0, "makeappx.exe x64 is missing from the Windows SDK.");
  return candidates.sort().at(-1);
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

function xmlAttribute(xml, element, attribute) {
  return xml.match(new RegExp(`<${element}\\b[^>]*\\b${attribute}=(["'])(.*?)\\1`, "is"))?.[2];
}

function xmlElement(xml, element) {
  return xml.match(new RegExp(`<${element}>([^<]+)<\\/${element}>`, "i"))?.[1];
}

function resolveCaseInsensitive(rootDirectory, relativePath) {
  let current = rootDirectory;
  for (const segment of relativePath.split("/")) {
    if (!existsSync(current)) return undefined;
    const matching = readdirSync(current).find((entry) => entry.toLowerCase() === segment.toLowerCase());
    if (!matching) return undefined;
    current = join(current, matching);
  }
  return current;
}

function writeReport(target, artifactPath, details) {
  const content = readFileSync(artifactPath);
  const report = {
    schemaVersion: "chroni-store-verification-v1",
    target,
    artifact: basename(artifactPath),
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    verifiedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || undefined,
    details,
  };
  const reportPath = join(output, `store-verification-${target}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Chroni ${target} Store artifact verified: ${basename(artifactPath)} (${report.sha256}).`);
}

function execText(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function execCombined(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim()}`);
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required for Store artifact verification.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
