import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const desktopPackage = JSON.parse(readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"));
const requestedTag = (process.argv[2] || process.env.GITHUB_REF_NAME || "").trim();

if (rootPackage.version !== desktopPackage.version) {
  throw new Error(`Version mismatch: root=${rootPackage.version}, desktop=${desktopPackage.version}`);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(desktopPackage.version)) {
  throw new Error(`Invalid package version: ${desktopPackage.version}`);
}
if (requestedTag && requestedTag !== `v${desktopPackage.version}`) {
  throw new Error(`Release tag ${requestedTag} must match package version v${desktopPackage.version}.`);
}

console.log(`Chroni release version verified: v${desktopPackage.version}`);
