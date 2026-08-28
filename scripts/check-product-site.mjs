import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist", "site");
const html = readFileSync(join(output, "index.html"), "utf8");
const script = readFileSync(join(output, "app.js"), "utf8");
const privacy = readFileSync(join(output, "privacy.html"), "utf8");
const expectedVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

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
if (!html.includes("./privacy.html")) throw new Error("Product site does not link to the privacy policy.");
for (const requiredText of ["默认保存在本机", "联网模型可随时关闭", "密钥不进入项目数据", "没有客户端访问码"]) {
  if (!privacy.includes(requiredText)) throw new Error(`Privacy page is missing: ${requiredText}`);
}

const requiredAssetMatchers = [
  "win-x64-setup\\.exe",
  "win-x64-portable\\.exe",
  "mac-universal\\.dmg",
];
for (const matcher of requiredAssetMatchers) {
  if (!script.includes(matcher)) throw new Error(`Missing release matcher: ${matcher}`);
}

for (const platform of ["windows", "macos", "other"]) {
  if (!script.includes(`${platform}:`)) throw new Error(`Missing platform behavior: ${platform}`);
}

if (/releases\/download\/v\d/i.test(`${html}\n${script}`)) {
  throw new Error("Product site contains a version-pinned installer fallback.");
}
if (!html.includes("https://github.com/miracle121388-a11y/chroni/releases/latest")) {
  throw new Error("Product site does not provide a safe Latest Release fallback.");
}
if (!html.includes(`"softwareVersion": "${expectedVersion}"`)) {
  throw new Error(`Product site structured version does not match ${expectedVersion}.`);
}

for (const file of ["_headers", "_redirects", "robots.txt", "sitemap.xml", ".nojekyll"]) {
  if (!existsSync(join(output, file))) throw new Error(`Missing deployment file: ${file}`);
}

console.log(`Chroni site check passed: ${ids.length} ids, ${references.length} references, 3 installers.`);
