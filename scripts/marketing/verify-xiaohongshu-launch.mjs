import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const output = join(root, "dist", "xiaohongshu-launch");
const imageNames = [
  "01-cover.png",
  "02-origin.png",
  "03-workflow.png",
  "04-daily-planner.png",
  "05-agent-workspace.png",
  "06-pet-states.png",
  "07-open-source.png",
  "08-feedback-star.png",
];
const copyNames = [
  "xiaohongshu-post.md",
  "pinned-comment.md",
  "title-options.md",
  "publishing-guide.md",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pngDimensions(path) {
  const buffer = readFileSync(path);
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `不是有效 PNG：${path}`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function assertOpaque(path) {
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 255) throw new Error(`正式图片含透明像素：${path}`);
  }
}

for (const name of imageNames) {
  const path = join(output, "images", name);
  assert(existsSync(path), `缺少图片：${name}`);
  const dimensions = pngDimensions(path);
  assert(dimensions.width === 1242 && dimensions.height === 1660, `${name} 尺寸错误：${dimensions.width}x${dimensions.height}`);
  await assertOpaque(path);
}

for (const name of copyNames) {
  assert(existsSync(join(output, "copy", name)), `缺少文案：${name}`);
}

const requiredPaths = [
  "README.md",
  "preview/contact-sheet.png",
  "source/asset-manifest.md",
  "source/original-pet-assets/LICENSE",
  "source/original-pet-assets/ADDITIONAL_TERMS.md",
  "source/original-product-screenshots/chroni-daily-planner-v0.1.4.png",
  "source/original-product-screenshots/chroni-agent-workspace-v0.1.4.png",
];
for (const path of requiredPaths) {
  assert(existsSync(join(output, path)), `缺少交付文件：${path}`);
}

const contactDimensions = pngDimensions(join(output, "preview", "contact-sheet.png"));
assert(contactDimensions.width === 1400 && contactDimensions.height === 1040, "Contact Sheet 尺寸不正确");

const allMarkdown = [
  readFileSync(join(output, "README.md"), "utf8"),
  readFileSync(join(output, "source", "asset-manifest.md"), "utf8"),
  ...copyNames.map((name) => readFileSync(join(output, "copy", name), "utf8")),
].join("\n");
assert(!/(sk-[a-z0-9_-]{12,}|api[_ -]?key\s*[:=]\s*\S+)/i.test(allMarkdown), "文案疑似包含 API Key");
for (const requirement of [
  "持续优化",
  "宝贵意见",
  "Star",
  "MIT License",
  "Apache License 2.0",
  "Windows",
  "macOS",
]) {
  assert(allMarkdown.includes(requirement), `文案缺少必要信息：${requirement}`);
}

const manifest = readFileSync(join(output, "source", "asset-manifest.md"), "utf8");
assert(manifest.includes("XIAOTONG Desktop Pet"), "素材清单缺少 XIAOTONG Attribution");
assert(manifest.includes("ADDITIONAL_TERMS.md"), "素材清单缺少附加条款");
assert((manifest.match(/原文件 SHA-256/g) ?? []).length === 7, "素材清单 SHA-256 数量不正确");

for (const name of ["idle-0000.png", "study-0016.png", "wake-0016.png", "play-0016.png", "pet-0016.png"]) {
  assert(existsSync(join(output, "source", "original-pet-assets", name)), `缺少原始桌宠备份：${name}`);
}

console.log("Chroni 小红书素材检查通过");
console.log("- 图片：8 张，全部为 1242 × 1660、不透明 PNG");
console.log("- 文案：4 份");
console.log("- 预览：1 张 4 × 2 Contact Sheet");
console.log("- 隐私关键词、许可证、平台与素材来源检查通过");
