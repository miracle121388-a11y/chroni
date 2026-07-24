import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist", "site");
const html = readFileSync(join(output, "index.html"), "utf8");
const script = readFileSync(join(output, "app.js"), "utf8");

const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicateIds.length > 0) {
  throw new Error(`Duplicate site ids: ${[...new Set(duplicateIds)].join(", ")}`);
}

const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
for (const reference of references.filter((value) => value.startsWith("./"))) {
  const target = join(output, reference.slice(2));
  if (!existsSync(target)) {
    throw new Error(`Missing built site reference: ${reference}`);
  }
}

const requiredIds = [
  "primary-download",
  "windows-setup",
  "windows-portable",
  "macos-dmg",
  "release-version",
  "release-status",
];
for (const id of requiredIds) {
  if (!ids.includes(id)) throw new Error(`Missing required site element: #${id}`);
}

const requiredAssetPatterns = [
  /win-x64-setup\.exe/i,
  /win-x64-portable\.exe/i,
  /mac-universal\.dmg/i,
];
for (const pattern of requiredAssetPatterns) {
  if (!pattern.test(script)) throw new Error(`Missing release matcher: ${pattern}`);
}

for (const platform of ["windows", "macos", "other"]) {
  if (!script.includes(`${platform}:`)) throw new Error(`Missing platform behavior: ${platform}`);
}

for (const file of ["_headers", "_redirects", "robots.txt", "sitemap.xml", ".nojekyll"]) {
  if (!existsSync(join(output, file))) throw new Error(`Missing deployment file: ${file}`);
}

console.log(`Chroni site check passed: ${ids.length} ids, ${references.length} references, 3 installers.`);
