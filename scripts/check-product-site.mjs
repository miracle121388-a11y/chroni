import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist", "site");
const html = readFileSync(join(output, "index.html"), "utf8");
const script = readFileSync(join(output, "app.js"), "utf8");
const privacy = readFileSync(join(output, "privacy.html"), "utf8");
const releaseWorkflow = readFileSync(join(root, ".github", "workflows", "release-build.yml"), "utf8");
const releaseAliases = readFileSync(join(root, "scripts", "create-release-aliases.mjs"), "utf8");
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
const directAssetNames = [
  "Chroni-win-x64-setup.exe",
  "Chroni-win-x64-portable.exe",
  "Chroni-mac-universal.dmg",
];
for (const assetName of directAssetNames) {
  const directUrl = `https://github.com/miracle121388-a11y/chroni/releases/latest/download/${assetName}`;
  if (!html.includes(directUrl)) throw new Error(`Product site is missing direct installer link: ${assetName}`);
  if (!script.includes(assetName)) throw new Error(`Product site fallback is missing direct installer: ${assetName}`);
  if (!releaseAliases.includes(assetName)) throw new Error(`Release alias generator is missing: ${assetName}`);
}
for (const platform of ["windows", "macos"]) {
  if (!releaseWorkflow.includes(`create-release-aliases.mjs apps/desktop/dist-electron ${platform}`)) {
    throw new Error(`Release workflow does not create ${platform} direct-download aliases.`);
  }
}
if (html.includes('href="https://github.com/miracle121388-a11y/chroni/releases/latest"')) {
  throw new Error("An installer still falls back to the GitHub release page.");
}
if (`${html}\n${script}`.includes("__CHRONI_VERSION__")) {
  throw new Error("Product site contains an unresolved version placeholder.");
}
if (!html.includes(`"softwareVersion": "${expectedVersion}"`)) {
  throw new Error(`Product site structured version does not match ${expectedVersion}.`);
}
if (!html.includes("把日程、课程要求、截图或项目材料拖给我。")) {
  throw new Error("Product site intake prompt does not cover schedules and mixed materials.");
}
if (script.includes("正在理解课程材料")) {
  throw new Error("Product site contains course-only generic understanding copy.");
}
for (const staleCopy of ["读取失败时将打开 Latest Release 页面", "请从 Latest Release 页面选择当前安装包"]) {
  if (script.includes(staleCopy)) throw new Error(`Product site contains release-page fallback copy: ${staleCopy}`);
}
if (!html.includes("点击对应平台即可直接下载")) {
  throw new Error("Product site does not state the direct-download behavior.");
}

for (const file of ["_headers", "_redirects", "robots.txt", "sitemap.xml", ".nojekyll"]) {
  if (!existsSync(join(output, file))) throw new Error(`Missing deployment file: ${file}`);
}

console.log(`Chroni site check passed: ${ids.length} ids, ${references.length} references, 3 installers.`);
