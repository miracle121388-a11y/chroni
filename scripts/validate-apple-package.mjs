import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

if (process.platform !== "darwin") throw new Error("App Store package validation must run on macOS.");
const packageDirectory = resolve("apps/desktop/dist-electron");
assert(existsSync(packageDirectory), "Mac App Store package directory is missing.");
const packages = readdirSync(packageDirectory).filter((name) => extname(name).toLowerCase() === ".pkg");
assert(packages.length === 1, `Expected one Mac App Store PKG, found ${packages.length}.`);
const keyId = requireEnvironment("APP_STORE_CONNECT_API_KEY_ID");
const issuerId = requireEnvironment("APP_STORE_CONNECT_API_ISSUER_ID");
const packagePath = join(packageDirectory, packages[0]);

execFileSync("xcrun", [
  "altool",
  "--validate-app",
  "--file", packagePath,
  "--type", "macos",
  "--apiKey", keyId,
  "--apiIssuer", issuerId,
  "--output-format", "json",
], { stdio: "inherit" });

console.log(`Apple accepted the Chroni package validation request: ${packages[0]}.`);

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required for App Store Connect validation.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
