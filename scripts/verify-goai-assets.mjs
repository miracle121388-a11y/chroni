import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const renderer = join(root, "apps", "desktop", "dist", "renderer");
if (!existsSync(renderer)) throw new Error("GOAI renderer build is missing. Run pnpm run build:goai first.");
const buildManifest = JSON.parse(readFileSync(join(root, "apps", "desktop", "dist", "build-manifest.json"), "utf8"));
if (buildManifest.variant !== "goai" || buildManifest.petAssetMode !== "original") {
  throw new Error(`GOAI build manifest is invalid: ${JSON.stringify(buildManifest)}`);
}

const forbiddenPath = [
  /tongluv/i,
  /xiaotong/i,
  /donate[_-]?qr/i,
];

const files = walk(renderer);
const violations = [];
for (const file of files) {
  const relative = file.slice(renderer.length + 1);
  if (forbiddenPath.some((pattern) => pattern.test(relative))) violations.push(relative);
  const extension = file.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension ?? "")) violations.push(relative);
}

if (violations.length) {
  throw new Error(`GOAI safe-asset verification failed: ${[...new Set(violations)].join(", ")}`);
}
console.log(`GOAI safe-asset verification passed: ${files.length} renderer files, no restricted XIAOTONG assets.`);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
