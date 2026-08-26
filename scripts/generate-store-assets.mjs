import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "apps", "desktop", "build", "icon.png");
const outputDir = join(root, "apps", "desktop", "build", "appx");
const source = await loadImage(sourcePath);

const assets = [
  { name: "StoreLogo.png", width: 50, height: 50, iconSize: 44 },
  { name: "Square44x44Logo.png", width: 44, height: 44, iconSize: 40 },
  { name: "Square150x150Logo.png", width: 150, height: 150, iconSize: 132 },
  { name: "SmallTile.png", width: 71, height: 71, iconSize: 62 },
  { name: "Wide310x150Logo.png", width: 310, height: 150, iconSize: 130 },
  { name: "LargeTile.png", width: 310, height: 310, iconSize: 270 },
  { name: "BadgeLogo.png", width: 24, height: 24, iconSize: 22 },
  { name: "SplashScreen.png", width: 620, height: 300, iconSize: 224 },
];

mkdirSync(outputDir, { recursive: true });
for (const asset of assets) {
  const canvas = createCanvas(asset.width, asset.height);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, asset.width, asset.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const x = Math.round((asset.width - asset.iconSize) / 2);
  const y = Math.round((asset.height - asset.iconSize) / 2);
  context.drawImage(source, x, y, asset.iconSize, asset.iconSize);
  writeFileSync(join(outputDir, asset.name), canvas.toBuffer("image/png"));
}

console.log(`Chroni Store assets generated from the existing hourglass icon: ${assets.length} files.`);
