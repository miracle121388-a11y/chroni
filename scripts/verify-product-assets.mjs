import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const renderer = join(root, "apps", "desktop", "dist", "renderer");
if (!existsSync(renderer)) throw new Error("Chroni renderer build is missing. Run pnpm run build first.");

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
