import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "site");
const output = join(root, "dist", "site");

const assets = [
  ["docs/assets/chroni-daily-planner-v0.1.4.png", "assets/daily-planner.png"],
  ["docs/assets/chroni-agent-workspace-v0.1.4.png", "assets/agent-workspace.png"],
  ["apps/desktop/build/icon-source.svg", "assets/chroni-icon.svg"],
  ["apps/desktop/src/renderer/src/assets/tongluv/frames/idle/0000.png", "assets/pet-idle.png"],
  ["apps/desktop/src/renderer/src/assets/tongluv/frames/study/0016.png", "assets/pet-study.png"],
  ["apps/desktop/src/renderer/src/assets/tongluv/frames/drag/0000.png", "assets/pet-drag.png"],
  ["apps/desktop/src/renderer/src/assets/tongluv/frames/pet/0016.png", "assets/pet-response.png"],
  ["apps/desktop/src/renderer/src/assets/tongluv/frames/play/0016.png", "assets/pet-play.png"],
  ["apps/desktop/src/renderer/src/assets/tongluv/frames/sleep/0013.png", "assets/pet-sleep.png"],
  ["apps/desktop/src/renderer/src/assets/tongluv/frames/wake/0016.png", "assets/pet-wake.png"],
];

if (!existsSync(source)) {
  throw new Error(`Product site source is missing: ${source}`);
}

rmSync(output, { force: true, recursive: true });
mkdirSync(output, { recursive: true });
cpSync(source, output, { recursive: true });

for (const [inputPath, outputPath] of assets) {
  const input = join(root, inputPath);
  const target = join(output, outputPath);
  if (!existsSync(input)) {
    throw new Error(`Product site asset is missing: ${inputPath}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(input, target);
}

writeFileSync(join(output, ".nojekyll"), "");
console.log(`Chroni product site built at ${output}`);
