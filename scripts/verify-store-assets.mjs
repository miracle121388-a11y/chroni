import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const desktop = join(root, "apps", "desktop");
const renderer = join(desktop, "dist", "renderer");
if (!existsSync(renderer)) throw new Error("Mac App Store renderer build is missing.");

const buildManifest = JSON.parse(readFileSync(join(desktop, "dist", "build-manifest.json"), "utf8"));
assert(buildManifest.variant === "store", `Expected store build, received ${buildManifest.variant}.`);
assert(buildManifest.petAssetMode === "original", `Mac App Store builds must use first-party assets; received ${buildManifest.petAssetMode}.`);

const files = walk(renderer);
const searchable = files
  .filter((file) => [".css", ".html", ".js"].includes(extname(file).toLowerCase()))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
for (const marker of ["今日执行", "每日回顾", "学习任务", "智能整理", "偏好设置", "运行状态"]) {
  assert(searchable.includes(marker), `Store build is missing required UI marker: ${marker}`);
}
for (const forbidden of ["XIAOTONG Desktop Pet", "支持原作者", "捐赠二维码", "GOAI", "复赛", "参赛", "无界应用"]) {
  assert(!searchable.includes(forbidden), `Store build contains excluded copy: ${forbidden}`);
}
const violations = files
  .map((file) => relative(renderer, file).replaceAll("\\", "/"))
  .filter((file) => /tongluv|xiaotong|donate[_-]?qr/i.test(file));
assert(violations.length === 0, `Store build contains restricted companion assets: ${violations.join(", ")}`);

console.log(`Chroni Mac App Store asset verification passed: ${files.length} renderer files, first-party assets only.`);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
