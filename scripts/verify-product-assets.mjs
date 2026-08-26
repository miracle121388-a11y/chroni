import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const desktop = join(root, "apps", "desktop");
const companionSource = join(desktop, "src", "renderer", "src", "assets", "tongluv", "frames");
const expectedCompanionDigest = "de2c82d469e902723c7289374c69d70a8d0e4385cd72027fda73acfcc64087e2";
const renderer = join(desktop, "dist", "renderer");
if (!existsSync(renderer)) throw new Error("Chroni renderer build is missing. Run pnpm run build first.");

const companionSourceFiles = walk(companionSource)
  .filter((file) => extname(file).toLowerCase() === ".png")
  .sort();
const companionDigest = createHash("sha256");
let companionSourceBytes = 0;
for (const file of companionSourceFiles) {
  const content = readFileSync(file);
  companionSourceBytes += content.length;
  companionDigest.update(relative(companionSource, file).replaceAll("\\", "/"));
  companionDigest.update("\0");
  companionDigest.update(createHash("sha256").update(content).digest("hex"));
  companionDigest.update("\n");
}
assert(companionSourceFiles.length === 244, `Desktop companion source frame count changed: ${companionSourceFiles.length}.`);
assert(companionSourceBytes === 11_646_115, `Desktop companion source bytes changed: ${companionSourceBytes}.`);
assert(companionDigest.digest("hex") === expectedCompanionDigest, "Desktop companion artwork changed. Restore the approved appearance before release.");

const files = walk(renderer);
const searchable = files
  .filter((file) => [".css", ".html", ".js"].includes(extname(file).toLowerCase()))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

for (const marker of ["今日执行", "学习任务", "任务来源", "执行 Agent", "偏好设置", "运行状态", "智能安排"]) {
  if (!searchable.includes(marker)) throw new Error(`Product build is missing required UI marker: ${marker}`);
}

for (const forbidden of ["GOAI 演示", "GOAI 2026 · 可复现演示环境"]) {
  if (searchable.includes(forbidden)) throw new Error(`Product build contains a retired primary-navigation marker: ${forbidden}`);
}

const productCode = walk(join(desktop, "dist"))
  .filter((file) => [".css", ".html", ".js"].includes(extname(file).toLowerCase()))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
for (const forbidden of ["GOAI", "复赛", "参赛", "无界应用"]) {
  if (productCode.includes(forbidden)) throw new Error(`Product build contains unrelated event copy: ${forbidden}`);
}
for (const requiredLegalMarker of ["XIAOTONG Desktop Pet", "支持原作者", "附加条款"]) {
  if (!searchable.includes(requiredLegalMarker)) throw new Error(`Product build is missing required companion attribution: ${requiredLegalMarker}`);
}

const animationFrames = files.filter((file) => extname(file).toLowerCase() === ".png");
const animationBytes = animationFrames.reduce((total, file) => total + statSync(file).size, 0);
if (animationFrames.length < 100 || animationBytes < 5_000_000) {
  throw new Error(`Product build does not contain the complete desktop companion animation set (${animationFrames.length} PNG files, ${animationBytes} bytes).`);
}

console.log(`Chroni product asset verification passed: ${animationFrames.length} companion PNG frames (${animationBytes} bytes) and all six workspaces are present.`);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
