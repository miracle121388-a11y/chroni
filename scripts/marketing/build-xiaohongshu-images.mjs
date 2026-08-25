import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const output = join(root, "dist", "xiaohongshu-launch");
const imagesDir = join(output, "images");
const petSourceDir = join(output, "source", "original-pet-assets");
const screenshotSourceDir = join(output, "source", "original-product-screenshots");
const copyDir = join(output, "copy");
const previewDir = join(output, "preview");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;

const W = 1242;
const H = 1660;
const M = 78;
const colors = {
  paper: "#f7f5ef",
  paperStrong: "#fffefa",
  ink: "#17211e",
  muted: "#64706b",
  line: "#d7ddd8",
  green: "#2e6a5d",
  greenDeep: "#17483e",
  mint: "#e3f0ea",
  coral: "#e98178",
  coralSoft: "#f9e4df",
  yellow: "#d5a244",
  yellowSoft: "#faefd3",
  blue: "#6489aa",
  blueSoft: "#e7eff5",
  brown: "#795d43",
  brownSoft: "#eee6dc",
};

const assetDefinitions = [
  {
    key: "pet-idle",
    source: "apps/desktop/src/renderer/src/assets/tongluv/frames/idle/0000.png",
    target: "idle-0000.png",
    type: "pet",
  },
  {
    key: "pet-study",
    source: "apps/desktop/src/renderer/src/assets/tongluv/frames/study/0016.png",
    target: "study-0016.png",
    type: "pet",
  },
  {
    key: "pet-wake",
    source: "apps/desktop/src/renderer/src/assets/tongluv/frames/wake/0016.png",
    target: "wake-0016.png",
    type: "pet",
  },
  {
    key: "pet-play",
    source: "apps/desktop/src/renderer/src/assets/tongluv/frames/play/0016.png",
    target: "play-0016.png",
    type: "pet",
  },
  {
    key: "pet-response",
    source: "apps/desktop/src/renderer/src/assets/tongluv/frames/pet/0016.png",
    target: "pet-0016.png",
    type: "pet",
  },
  {
    key: "daily-planner",
    source: "docs/assets/chroni-daily-planner-v0.2.0.png",
    target: "chroni-daily-planner-v0.2.0.png",
    type: "screenshot",
  },
  {
    key: "agent-workspace",
    source: "docs/assets/chroni-agent-workspace-v0.2.0.png",
    target: "chroni-agent-workspace-v0.2.0.png",
    type: "screenshot",
  },
];

const fontFamily = '"Noto Sans SC", "Microsoft YaHei", sans-serif';
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

function ensureDirectories() {
  rmSync(output, { force: true, recursive: true });
  for (const path of [imagesDir, petSourceDir, screenshotSourceDir, copyDir, previewDir]) {
    mkdirSync(path, { recursive: true });
  }
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyAssets() {
  const copied = new Map();
  for (const asset of assetDefinitions) {
    const sourcePath = join(root, asset.source);
    const targetDir = asset.type === "pet" ? petSourceDir : screenshotSourceDir;
    const targetPath = join(targetDir, asset.target);
    copyFileSync(sourcePath, targetPath);
    copied.set(asset.key, {
      ...asset,
      sourcePath,
      targetPath,
      hash: hashFile(sourcePath),
    });
  }

  for (const file of ["LICENSE", "ADDITIONAL_TERMS.md"]) {
    copyFileSync(
      join(root, "apps", "desktop", "third_party", "xiaotong", file),
      join(petSourceDir, file),
    );
  }
  return copied;
}

function roundedPath(ctx, x, y, width, height, radius = 18) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fill, stroke) {
  roundedPath(ctx, x, y, width, height, radius);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function setFont(ctx, size, weight = 500) {
  // Skia treats non-standard numeric weights such as 730 as malformed font sizes.
  const normalizedWeight = Math.max(400, Math.min(800, Math.round(weight / 100) * 100));
  ctx.font = `${normalizedWeight} ${size}px ${fontFamily}`;
}

function drawText(ctx, text, x, y, options = {}) {
  const {
    size = 34,
    weight = 500,
    color = colors.ink,
    maxWidth = W - x - M,
    lineHeight = Math.round(size * 1.48),
    maxLines = Infinity,
    align = "left",
  } = options;
  setFont(ctx, size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";

  let currentY = y;
  let lineCount = 0;
  for (const paragraph of String(text).split("\n")) {
    if (lineCount >= maxLines) break;
    if (!paragraph) {
      currentY += lineHeight;
      lineCount += 1;
      continue;
    }
    const tokens = [...segmenter.segment(paragraph)].map((entry) => entry.segment);
    let line = "";
    for (const token of tokens) {
      const candidate = line + token;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        ctx.fillText(line.trimEnd(), x, currentY);
        currentY += lineHeight;
        lineCount += 1;
        if (lineCount >= maxLines) break;
        line = token.trimStart();
      } else {
        line = candidate;
      }
    }
    if (lineCount < maxLines && line) {
      ctx.fillText(line.trimEnd(), x, currentY);
      currentY += lineHeight;
      lineCount += 1;
    }
  }
  return currentY;
}

function drawExplicitLines(ctx, lines, x, y, options = {}) {
  const lineHeight = options.lineHeight ?? Math.round((options.size ?? 72) * 1.22);
  let currentY = y;
  for (const line of lines) {
    drawText(ctx, line, x, currentY, { ...options, lineHeight, maxLines: 1 });
    currentY += lineHeight;
  }
  return currentY;
}

function drawBrand(ctx, page, label) {
  drawText(ctx, "Chroni", M, 64, { size: 34, weight: 760, color: colors.greenDeep });
  ctx.fillStyle = colors.coral;
  ctx.fillRect(M, 112, 54, 5);
  drawText(ctx, label, M + 126, 72, { size: 18, weight: 680, color: colors.muted });
  drawText(ctx, String(page).padStart(2, "0"), W - M, 68, {
    size: 20,
    weight: 700,
    color: colors.green,
    align: "right",
    maxWidth: 100,
  });
}

function createCard(page, label, background = colors.paper) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(46, 106, 93, 0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(22.5, 22.5, W - 45, H - 45);
  drawBrand(ctx, page, label);
  return { canvas, ctx };
}

function drawImageContain(ctx, image, x, y, width, height, options = {}) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.save();
  if (options.shadow) {
    ctx.shadowColor = options.shadowColor ?? "rgba(29, 45, 40, 0.2)";
    ctx.shadowBlur = options.shadowBlur ?? 28;
    ctx.shadowOffsetY = options.shadowOffsetY ?? 16;
  }
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();
  return { x: drawX, y: drawY, width: drawWidth, height: drawHeight };
}

function drawImageCover(ctx, image, x, y, width, height, focusX = 0.5, focusY = 0.5) {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = Math.max(0, Math.min(image.width - sourceWidth, (image.width - sourceWidth) * focusX));
  const sourceY = Math.max(0, Math.min(image.height - sourceHeight, (image.height - sourceHeight) * focusY));
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawWindow(ctx, image, x, y, width, height, options = {}) {
  ctx.save();
  ctx.shadowColor = options.shadowColor ?? "rgba(32, 50, 44, 0.18)";
  ctx.shadowBlur = options.shadowBlur ?? 40;
  ctx.shadowOffsetY = options.shadowOffsetY ?? 18;
  fillRoundRect(ctx, x, y, width, height, 20, colors.paperStrong);
  ctx.restore();

  roundedPath(ctx, x, y, width, height, 20);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#eef1ee";
  ctx.fillRect(x, y, width, 48);
  ctx.fillStyle = colors.coral;
  ctx.beginPath();
  ctx.arc(x + 24, y + 24, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d6ad55";
  ctx.beginPath();
  ctx.arc(x + 44, y + 24, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6c9c8e";
  ctx.beginPath();
  ctx.arc(x + 64, y + 24, 6, 0, Math.PI * 2);
  ctx.fill();
  if (options.fit === "contain") {
    ctx.fillStyle = colors.paperStrong;
    ctx.fillRect(x, y + 48, width, height - 48);
    drawImageContain(ctx, image, x, y + 48, width, height - 48);
  } else {
    drawImageCover(
      ctx,
      image,
      x,
      y + 48,
      width,
      height - 48,
      options.focusX ?? 0.5,
      options.focusY ?? 0.25,
    );
  }
  ctx.restore();
  roundedPath(ctx, x, y, width, height, 20);
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawPill(ctx, text, x, y, options = {}) {
  const size = options.size ?? 22;
  const paddingX = options.paddingX ?? 22;
  const height = options.height ?? 48;
  setFont(ctx, size, options.weight ?? 680);
  const width = options.width ?? Math.ceil(ctx.measureText(text).width + paddingX * 2);
  fillRoundRect(
    ctx,
    x,
    y,
    width,
    height,
    options.radius ?? height / 2,
    options.fill ?? colors.mint,
    options.stroke,
  );
  ctx.fillStyle = options.color ?? colors.greenDeep;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + width / 2, y + height / 2 + 1);
  return width;
}

function drawArrow(ctx, fromX, fromY, toX, toY, color = colors.green) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - 14 * Math.cos(angle - Math.PI / 6), toY - 14 * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - 14 * Math.cos(angle + Math.PI / 6), toY - 14 * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSectionLabel(ctx, text, x, y, color = colors.coral) {
  drawText(ctx, text.toUpperCase(), x, y, { size: 19, weight: 760, color });
}

async function renderCover(assets) {
  const { canvas, ctx } = createCard(1, "首发记录");
  drawExplicitLines(ctx, ["我们把课程作业，", "做成了真的能用的 AI 桌宠"], M, 155, {
    size: 68,
    weight: 780,
    lineHeight: 86,
  });
  drawExplicitLines(ctx, ["会读通知、识别 DDL、拆解任务，", "再把它们安排进今天。"], M, 354, {
    size: 30,
    weight: 520,
    color: colors.muted,
    lineHeight: 46,
  });

  fillRoundRect(ctx, 80, 520, 425, 292, 18, colors.paperStrong, colors.line);
  drawSectionLabel(ctx, "输入通知", 110, 552);
  drawText(ctx, "软件工程课程群", 110, 594, { size: 24, weight: 700 });
  drawText(ctx, "请在 7 月 30 日 23:59 前提交源码与 README PDF。", 110, 648, {
    size: 23,
    lineHeight: 39,
    maxWidth: 360,
  });
  ctx.fillStyle = colors.yellowSoft;
  ctx.fillRect(109, 744, 252, 35);
  drawText(ctx, "已标记：截止时间 / 提交物", 118, 746, {
    size: 18,
    weight: 670,
    color: colors.brown,
  });

  drawWindow(ctx, assets.get("daily-planner"), 280, 865, 882, 650, {
    focusX: 0.66,
    focusY: 0.35,
  });
  drawImageContain(ctx, assets.get("pet-study"), 430, 470, 430, 430, {
    shadow: true,
    shadowBlur: 34,
  });
  drawPill(ctx, "真实桌面应用 · v" + version, 78, 1550, {
    fill: colors.greenDeep,
    color: "#ffffff",
    size: 18,
    height: 48,
  });
  return canvas;
}

async function renderOrigin(assets) {
  const { canvas, ctx } = createCard(2, "项目起点", "#f5f1e9");
  drawExplicitLines(ctx, ["它最初，", "只是一次课程作业。"], M, 164, {
    size: 72,
    weight: 780,
    lineHeight: 88,
  });
  drawExplicitLines(ctx, ["起点很简单：能不能让桌宠不只卖萌，", "而是真正帮我们处理散落的截止事项？"], M, 366, {
    size: 29,
    color: colors.muted,
    lineHeight: 46,
  });

  const steps = [
    ["课程项目", "桌宠 + DDL 管理的最初原型"],
    ["继续打磨", "补上 OCR、任务拆解与每日排程"],
    ["成为产品", "跨平台打包、产品主页与下载流程"],
    ["选择开源", "公开源码，也让真实用户参与改进"],
  ];
  const startY = 575;
  ctx.strokeStyle = "#bfcac4";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(144, startY + 35);
  ctx.lineTo(144, startY + 3 * 195 + 35);
  ctx.stroke();
  steps.forEach(([title, body], index) => {
    const y = startY + index * 195;
    ctx.fillStyle = index === 3 ? colors.coral : colors.green;
    ctx.beginPath();
    ctx.arc(144, y + 35, 17, 0, Math.PI * 2);
    ctx.fill();
    drawText(ctx, title, 195, y, { size: 34, weight: 730 });
    drawText(ctx, body, 195, y + 55, {
      size: 23,
      color: colors.muted,
      maxWidth: 580,
      lineHeight: 38,
    });
  });
  drawImageContain(ctx, assets.get("pet-idle"), 760, 680, 400, 500, {
    shadow: true,
    shadowBlur: 30,
  });
  fillRoundRect(ctx, 760, 1220, 390, 175, 18, colors.paperStrong, colors.line);
  drawText(ctx, "课程结束后，", 792, 1254, { size: 24, color: colors.green, weight: 700 });
  drawText(ctx, "我们没有让它停在作业文件夹里。", 792, 1302, {
    size: 25,
    weight: 650,
    maxWidth: 330,
    lineHeight: 40,
  });
  drawPill(ctx, "从原型到开源产品", 78, 1510, {
    fill: colors.brownSoft,
    color: colors.brown,
    size: 20,
  });
  return canvas;
}

async function renderWorkflow(assets) {
  const { canvas, ctx } = createCard(3, "核心流程");
  drawExplicitLines(ctx, ["拖给它，", "剩下的交给 Chroni。"], M, 160, {
    size: 70,
    weight: 780,
    lineHeight: 86,
  });
  drawExplicitLines(ctx, ["不是把文字搬进日历，", "而是先理解，再行动。"], M, 355, {
    size: 30,
    color: colors.muted,
    lineHeight: 46,
  });

  drawSectionLabel(ctx, "输入", 88, 540);
  const inputLabels = ["截图", "PDF", "文字", "表格", "日历文件"];
  inputLabels.forEach((label, index) => {
    const y = 590 + index * 78;
    fillRoundRect(ctx, 82, y, 245, 58, 12, index % 2 ? colors.blueSoft : colors.paperStrong, colors.line);
    drawText(ctx, label, 204, y + 14, {
      size: 22,
      weight: 680,
      align: "center",
      maxWidth: 180,
    });
  });
  drawArrow(ctx, 345, 770, 450, 770);
  drawImageContain(ctx, assets.get("pet-study"), 408, 560, 400, 440, {
    shadow: true,
    shadowBlur: 30,
  });
  drawPill(ctx, "本地解析 / OCR", 470, 1004, {
    width: 282,
    fill: colors.greenDeep,
    color: "#ffffff",
    size: 21,
  });
  drawArrow(ctx, 800, 770, 900, 770);

  drawSectionLabel(ctx, "结构化结果", 886, 540);
  fillRoundRect(ctx, 866, 590, 300, 420, 18, colors.paperStrong, "#b9c9c2");
  const fields = [
    ["截止时间", "7 月 30 日 23:59"],
    ["提交物", "源码 / README"],
    ["提交方式", "课程平台"],
    ["风险提示", "提前完成最终测试"],
  ];
  fields.forEach(([label, value], index) => {
    const y = 620 + index * 91;
    drawText(ctx, label, 894, y, { size: 17, color: colors.muted });
    drawText(ctx, value, 894, y + 30, {
      size: 20,
      weight: 680,
      maxWidth: 245,
      lineHeight: 31,
    });
    if (index < fields.length - 1) {
      ctx.fillStyle = colors.line;
      ctx.fillRect(894, y + 77, 244, 1);
    }
  });

  const flow = [
    ["01", "提取 DDL"],
    ["02", "校验时间与来源"],
    ["03", "生成可执行计划"],
  ];
  flow.forEach(([number, text], index) => {
    const x = 80 + index * 370;
    const fill = [colors.coralSoft, colors.mint, colors.yellowSoft][index];
    const accent = [colors.coral, colors.green, colors.yellow][index];
    fillRoundRect(ctx, x, 1180, 340, 185, 18, fill);
    drawText(ctx, number, x + 25, 1210, { size: 20, weight: 750, color: accent });
    drawText(ctx, text, x + 25, 1260, {
      size: 27,
      weight: 720,
      maxWidth: 285,
      lineHeight: 41,
    });
  });
  drawText(ctx, "清楚的信息先进入计划；真正不确定的部分，再请用户确认。", 80, 1455, {
    size: 25,
    weight: 620,
    color: colors.greenDeep,
    maxWidth: 1040,
    lineHeight: 42,
  });
  return canvas;
}

async function renderDailyPlanner(assets) {
  const { canvas, ctx } = createCard(4, "每日任务", "#f6f7f3");
  drawExplicitLines(ctx, ["不只是记下来，", "是安排下来。"], M, 160, {
    size: 72,
    weight: 780,
    lineHeight: 88,
  });
  drawExplicitLines(ctx, ["结合截止时间、剩余工时、依赖关系和每天可用时间，", "Chroni 会告诉你今天先做什么。"], M, 355, {
    size: 28,
    color: colors.muted,
    lineHeight: 44,
  });

  drawWindow(ctx, assets.get("daily-planner"), 78, 510, 1086, 870, {
    fit: "contain",
    focusX: 0.55,
    focusY: 0.35,
    shadowBlur: 34,
  });
  const features = [
    ["真实时长", "按任务耗时占位", colors.coralSoft, colors.coral],
    ["冲突重排", "拖动后重新安排", colors.mint, colors.green],
    ["风险可见", "容量与缓冲清楚", colors.blueSoft, colors.blue],
  ];
  features.forEach(([title, body, fill, accent], index) => {
    const x = 78 + index * 370;
    fillRoundRect(ctx, x, 1430, 340, 135, 16, fill);
    ctx.fillStyle = accent;
    ctx.fillRect(x + 22, 1454, 8, 72);
    drawText(ctx, title, x + 50, 1446, { size: 23, weight: 730 });
    drawText(ctx, body, x + 50, 1490, { size: 18, color: colors.muted });
  });
  return canvas;
}

async function renderAgent(assets) {
  const { canvas, ctx } = createCard(5, "Deadline Agent", "#f3f6f5");
  drawExplicitLines(ctx, ["它会解释，", "为什么今天先做这件事。"], M, 160, {
    size: 68,
    weight: 780,
    lineHeight: 84,
  });
  drawExplicitLines(ctx, ["Deadline Agent 不只给结果，", "也呈现风险、覆盖率和下一步。"], M, 352, {
    size: 29,
    color: colors.muted,
    lineHeight: 45,
  });

  drawWindow(ctx, assets.get("agent-workspace"), 78, 510, 1086, 880, {
    fit: "contain",
    focusX: 0.54,
    focusY: 0.32,
    shadowBlur: 34,
  });
  const callouts = [
    ["下一步", 190, 690, colors.coralSoft, colors.coral],
    ["计划覆盖", 780, 660, colors.mint, colors.green],
    ["今日工作块", 190, 1070, colors.blueSoft, colors.blue],
    ["高风险任务", 805, 1070, colors.yellowSoft, colors.yellow],
  ];
  for (const [text, x, y, fill, accent] of callouts) {
    const width = drawPill(ctx, text, x, y, {
      fill,
      color: accent,
      size: 19,
      height: 44,
      stroke: "rgba(255,255,255,0.8)",
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + width / 2, y + 44);
    ctx.lineTo(x + width / 2, y + 70);
    ctx.stroke();
  }
  drawText(ctx, "复查容量缺口 · 展示排程理由 · 模型不可用时保留本地规则回退", 78, 1460, {
    size: 24,
    weight: 620,
    color: colors.greenDeep,
    maxWidth: 1050,
    lineHeight: 40,
  });
  return canvas;
}

async function renderPetStates(assets) {
  const { canvas, ctx } = createCard(6, "桌宠状态");
  drawExplicitLines(ctx, ["桌宠不是装饰。"], M, 168, {
    size: 74,
    weight: 780,
    lineHeight: 88,
  });
  drawExplicitLines(ctx, ["它的动作，", "代表任务正在发生什么。"], M, 300, {
    size: 31,
    color: colors.muted,
    lineHeight: 47,
  });

  const states = [
    ["安静陪伴", "待机时不过度打扰", "pet-idle", colors.mint],
    ["阅读材料", "解析文件、OCR 与规划", "pet-study", colors.blueSoft],
    ["需要注意", "临期、逾期或待补信息", "pet-wake", colors.yellowSoft],
    ["完成庆祝", "任务完成后给出回应", "pet-play", colors.coralSoft],
  ];
  const cellWidth = 512;
  const cellHeight = 485;
  states.forEach(([title, body, asset, fill], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 78 + column * 574;
    const y = 495 + row * 520;
    fillRoundRect(ctx, x, y, cellWidth, cellHeight, 18, fill, "rgba(46, 79, 69, 0.09)");
    drawText(ctx, title, x + 28, y + 26, { size: 27, weight: 740 });
    drawText(ctx, body, x + 28, y + 70, {
      size: 18,
      color: colors.muted,
      maxWidth: cellWidth - 56,
    });
    drawImageContain(ctx, assets.get(asset), x + 80, y + 120, cellWidth - 160, 320, {
      shadow: true,
      shadowBlur: 22,
      shadowOffsetY: 10,
    });
  });
  drawText(ctx, "全部画面均来自项目实际使用的原始 PNG 帧，未重绘角色。", 78, 1540, {
    size: 19,
    color: colors.muted,
    maxWidth: 1000,
  });
  return canvas;
}

async function renderOpenSource(assets) {
  const { canvas, ctx } = createCard(7, "开源致谢", "#f3f0e8");
  drawExplicitLines(ctx, ["这个项目，", "也站在开源社区的肩膀上。"], M, 160, {
    size: 65,
    weight: 780,
    lineHeight: 82,
  });
  drawExplicitLines(ctx, ["感谢愿意公开代码、分享设计", "与记录开发过程的创作者。"], M, 352, {
    size: 29,
    color: colors.muted,
    lineHeight: 45,
  });

  fillRoundRect(ctx, 78, 520, 1086, 355, 20, colors.paperStrong, "#d3cec4");
  drawSectionLabel(ctx, "视觉资产来源", 112, 558, colors.coral);
  drawText(ctx, "XIAOTONG Desktop Pet / 蓝色小嗵", 112, 612, {
    size: 34,
    weight: 740,
    maxWidth: 700,
  });
  drawText(ctx, "依据 Apache License 2.0 与项目附加条款使用。完整原始许可证、附加条款和仓库链接随素材包保留。", 112, 682, {
    size: 23,
    color: colors.muted,
    lineHeight: 39,
    maxWidth: 680,
  });
  drawImageContain(ctx, assets.get("pet-idle"), 810, 535, 300, 310, {
    shadow: true,
    shadowBlur: 22,
  });

  drawSectionLabel(ctx, "实际使用的开源生态", 78, 952, colors.green);
  const ecosystems = [
    ["Electron", "桌面运行与系统集成"],
    ["React", "控制中心界面"],
    ["TypeScript", "类型与工程基础"],
    ["Vite", "前端构建"],
    ["Tesseract.js", "本地图片 OCR"],
    ["开源字体", "Source / Noto 字体家族"],
  ];
  ecosystems.forEach(([name, body], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 78 + column * 556;
    const y = 1000 + row * 130;
    ctx.fillStyle = column ? colors.blue : colors.green;
    ctx.fillRect(x, y + 8, 8, 72);
    drawText(ctx, name, x + 28, y, { size: 25, weight: 730 });
    drawText(ctx, body, x + 28, y + 43, { size: 18, color: colors.muted });
  });
  fillRoundRect(ctx, 78, 1440, 1086, 126, 16, colors.greenDeep);
  drawText(ctx, "Chroni 自研源代码以 MIT License 开源", W / 2, 1476, {
    size: 28,
    weight: 700,
    color: "#ffffff",
    align: "center",
    maxWidth: 900,
  });
  return canvas;
}

async function renderFeedback(assets) {
  const { canvas, ctx } = createCard(8, "体验与反馈");
  drawExplicitLines(ctx, ["它现在还不完美，", "但我们会继续把它做好。"], M, 160, {
    size: 66,
    weight: 780,
    lineHeight: 84,
  });
  drawExplicitLines(ctx, ["持续优化识别准确性、任务规划、", "跨平台稳定性和桌宠交互体验。"], M, 355, {
    size: 28,
    color: colors.muted,
    lineHeight: 44,
  });

  drawImageContain(ctx, assets.get("pet-response"), 695, 485, 420, 430, {
    shadow: true,
    shadowBlur: 28,
  });
  drawText(ctx, "欢迎来试试，", 82, 555, { size: 33, color: colors.green, weight: 720 });
  drawText(ctx, "也欢迎告诉我们哪里还不够好。", 82, 615, {
    size: 38,
    weight: 730,
    maxWidth: 600,
    lineHeight: 58,
  });

  const actions = [
    ["01", "下载体验", "在 Windows / macOS 上试用", colors.coralSoft, colors.coral],
    ["02", "提出意见", "Bug、使用感受与功能建议", colors.mint, colors.green],
    ["03", "点亮 Star", "让更多人看到这个学生项目", colors.blueSoft, colors.blue],
  ];
  actions.forEach(([number, title, body, fill, accent], index) => {
    const y = 930 + index * 170;
    fillRoundRect(ctx, 78, y, 1086, 142, 18, fill);
    drawText(ctx, number, 110, y + 30, { size: 20, weight: 760, color: accent });
    drawText(ctx, title, 195, y + 22, { size: 29, weight: 730 });
    drawText(ctx, body, 195, y + 72, { size: 20, color: colors.muted });
    drawText(ctx, "→", 1110, y + 43, {
      size: 30,
      weight: 600,
      color: accent,
      align: "right",
      maxWidth: 80,
    });
  });
  drawText(ctx, "你的每一条宝贵意见，都会成为 Chroni 下一次优化的依据。", W / 2, 1490, {
    size: 25,
    weight: 680,
    color: colors.greenDeep,
    align: "center",
    maxWidth: 1050,
    lineHeight: 40,
  });
  return canvas;
}

function writeCanvas(canvas, filename) {
  writeFileSync(join(imagesDir, filename), canvas.toBuffer("image/png"));
}

async function buildContactSheet(imageFiles) {
  const width = 1400;
  const height = 1040;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ecece8";
  ctx.fillRect(0, 0, width, height);
  drawText(ctx, "Chroni 小红书首发素材 · Contact Sheet", 50, 28, {
    size: 30,
    weight: 730,
    color: colors.ink,
    maxWidth: 1200,
  });
  const thumbWidth = 270;
  const thumbHeight = 360;
  const columnGap = 74;
  const rowGap = 100;
  for (const [index, filename] of imageFiles.entries()) {
    const image = await loadImage(join(imagesDir, filename));
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = 50 + column * (thumbWidth + columnGap);
    const y = 100 + row * (thumbHeight + rowGap);
    ctx.save();
    ctx.shadowColor = "rgba(25, 35, 32, 0.15)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(image, x, y, thumbWidth, thumbHeight);
    ctx.restore();
    drawText(ctx, filename, x + thumbWidth / 2, y + thumbHeight + 18, {
      size: 16,
      weight: 650,
      color: colors.muted,
      maxWidth: thumbWidth,
      align: "center",
    });
  }
  writeFileSync(join(previewDir, "contact-sheet.png"), canvas.toBuffer("image/png"));
}

function buildCopyFiles() {
  const post = `# 我们把课程作业，做成了真的能用的 AI 桌宠

大家好，这是 Chroni，一个会读 DDL 的桌面小伙伴。

它最初其实只是一份课程作业。那时我们遇到的问题很普通：课程群通知、PDF、截图和表格里的截止时间总是散落在不同地方。看到了要手动记，记下来以后还要自己判断先做什么，一忙就很容易漏掉。

所以我们开始想，桌宠能不能不只是在桌面上卖萌，而是真的帮人处理这些麻烦的信息？

现在，把文字、PDF、Word、表格、日历文件或截图交给 Chroni，它会先在本地完成文件解析或 OCR，再提取截止时间、提交物、提交方式和风险信息。本地规则会继续校验日期和来源；遇到无法安全确定的关键时间，它会保留待确认项，而不是悄悄编一个日程。

识别出来之后也不是结束。Deadline Agent 会把任务拆成可编辑的步骤，结合截止时间、预计耗时、依赖关系和每天可用的时间，安排到“每日任务”的时间轴里。它会告诉你今天先做什么、计划还有没有容量缺口，以及为什么这样安排。模型暂时不可用时，系统也保留本地规则回退。

桌宠的动作对应真实状态：待机时安静陪伴，收到文件后进入阅读，临期或缺信息时提醒，完成后给出回应。点击桌宠可以打开日程，拖入材料可以直接开始识别。

课程结束以后，我们没有让它停在作业文件夹里。我们继续调整 Windows 和 macOS 的窗口交互，补上 Agent、每日排程、OCR、安装包、产品主页、隐私说明、测试和发布流程，最后决定把自研代码开源，让真实使用者也能参与改进。

Chroni 的自研源码使用 MIT License。桌宠视觉资产来自 XIAOTONG Desktop Pet / 蓝色小嗵，依据 Apache License 2.0 与项目附加条款使用。也感谢 Electron、React、TypeScript、Vite、Tesseract.js，以及 Source / Noto 开源字体生态。没有这些愿意公开代码、素材和开发记录的创作者，这个项目很难走到现在。

它目前还是一个持续优化中的开源内测项目，并不完美。识别准确性、复杂任务规划、跨平台稳定性和桌宠交互还有不少需要继续打磨的地方。欢迎在 Windows 或 macOS 上下载体验，也欢迎把 Bug、使用感受和功能建议告诉我们。每一条宝贵意见，我们都会认真查看。

项目主页和 GitHub 可以从置顶评论找到。觉得这个学生项目值得继续做下去，也欢迎在 GitHub 点亮一颗 Star，让更多人看到它。

#桌面宠物 #AI工具 #开源项目 #大学生开发 #效率工具 #时间管理 #独立开发 #软件分享
`;

  const titles = `# Chroni 小红书标题备选

## 故事型

1. 我们把课程作业，做成了真的能用的 AI 桌宠
2. 课程结束后，我们继续把这只桌宠做成了产品

## 功能型

3. 把课程通知拖给桌宠，它会自动整理 DDL
4. 不只记截止时间：这只桌宠还会安排今天

## 学生项目型

5. 大学生做了一个会读通知的桌面 Deadline Agent
6. 从课程原型到 Windows/macOS 安装包，我们继续做了下去

## 开源型

7. 我们开源了一个会读 DDL 的桌面小伙伴
8. 一个学生开源项目：桌宠、OCR、Agent 和每日计划

首选标题：**我们把课程作业，做成了真的能用的 AI 桌宠**
`;

  const pinned = `Chroni 当前支持 Windows 10/11 x64 和 macOS 12+（Intel / Apple Silicon）。

产品页：getchroni.zeabur.app
GitHub：搜索“miracle121388-a11y/chroni”即可找到源码、Release、安装说明和 Issue。

项目还在持续更新中。安装、识别、规划、界面或桌宠交互方面遇到问题，都欢迎直接在 GitHub Issue 留言。每条建议我们都会认真查看，也请记得先移除姓名、课程群内容、API Key 和本机路径等隐私信息。`;

  const guide = `# Chroni 小红书发布指南

## 图片上传顺序

严格按以下顺序上传：

1. \`01-cover.png\`
2. \`02-origin.png\`
3. \`03-workflow.png\`
4. \`04-daily-planner.png\`
5. \`05-agent-workspace.png\`
6. \`06-pet-states.png\`
7. \`07-open-source.png\`
8. \`08-feedback-star.png\`

## 标题

首选：**我们把课程作业，做成了真的能用的 AI 桌宠**

需要偏功能或开源角度时，从 \`title-options.md\` 选择，不要同时堆叠多个标题。

## 正文与标签

直接粘贴 \`xiaohongshu-post.md\` 正文。发布前确认平台没有把 Markdown 标题符号一起显示；如有，删除开头的 \`# \`。标签保留在正文末尾。

建议标签：

\`#桌面宠物 #AI工具 #开源项目 #大学生开发 #效率工具 #时间管理 #独立开发 #软件分享\`

## 置顶评论

发布后粘贴 \`pinned-comment.md\`。产品页面向普通用户，GitHub 面向源码、Issue、版本和校验文件。

## 发布前隐私检查

- 图片中没有真实姓名、学校、课程群、邮箱、API Key、令牌或本机路径。
- 正文没有团队成员私人联系方式。
- 下载入口指向正式产品页或 GitHub Release。
- 不承诺免费模型额度、不声称已有大量用户。
- 如安装包仍未签名，评论区如实说明 SmartScreen / Gatekeeper 可能提示。

## 发布后回复建议

- 安装问题：先询问系统版本和安装包类型，再引导查看安装 FAQ。
- 识别问题：请对方使用脱敏示例和最小复现，不要公开上传真实课程材料。
- 模型问题：说明本地规则可处理明确日期；复杂材料可使用内测模式或自定义兼容 API。
- 功能建议：确认具体场景、操作顺序和期望结果，记录为 Issue。
- Star 相关：表达感谢即可，不反复催促。
`;

  writeFileSync(join(copyDir, "xiaohongshu-post.md"), post);
  writeFileSync(join(copyDir, "title-options.md"), titles);
  writeFileSync(join(copyDir, "pinned-comment.md"), pinned);
  writeFileSync(join(copyDir, "publishing-guide.md"), guide);
}

function buildAssetManifest(copied) {
  const entries = [
    {
      key: "pet-idle",
      use: "02-origin、06-pet-states、07-open-source",
      treatment: "透明背景合成；等比例缩放；轻微投影；未裁切角色。",
    },
    {
      key: "pet-study",
      use: "01-cover、03-workflow、06-pet-states",
      treatment: "透明背景合成；等比例缩放；轻微投影；未裁切角色。",
    },
    {
      key: "pet-wake",
      use: "06-pet-states",
      treatment: "透明背景合成；等比例缩放；轻微投影；未修改角色。",
    },
    {
      key: "pet-play",
      use: "06-pet-states",
      treatment: "透明背景合成；等比例缩放；轻微投影；保留原帧内全部角色。",
    },
    {
      key: "pet-response",
      use: "08-feedback-star",
      treatment: "透明背景合成；等比例缩放；轻微投影；未修改角色。",
    },
    {
      key: "daily-planner",
      use: "01-cover、04-daily-planner",
      treatment: "01 封面按真实界面局部裁切；04 等比例置入窗口；添加窗口边框与投影。",
    },
    {
      key: "agent-workspace",
      use: "05-agent-workspace",
      treatment: "真实截图等比例置入窗口；添加不遮挡主体的说明标签、窗口边框与投影。",
    },
  ];

  const lines = [
    "# Chroni 小红书素材清单",
    "",
    "所有桌宠均来自仓库原始 PNG 帧。没有使用 AI 绘图、生成式放大、重绘、风格迁移或相似角色替代。",
    "",
    "## 桌宠视觉资产许可",
    "",
    "- 原项目： [XIAOTONG Desktop Pet / 蓝色小嗵](https://github.com/gildingmazzonimo621-design/XIAOTONG-Desktop-pet)",
    "- 许可：Apache License 2.0 与项目 `ADDITIONAL_TERMS.md`。",
    "- 原始许可证与附加条款已原样复制到 `source/original-pet-assets/`。",
    "- Copyright (c) 2026 蓝色小嗵 (Blue Xiaotong)。",
    "",
    "## 实际使用素材",
    "",
  ];
  for (const entry of entries) {
    const asset = copied.get(entry.key);
    lines.push(
      `### ${asset.target}`,
      "",
      `- 素材名称：${entry.key}`,
      `- 原始仓库路径：\`${asset.source}\``,
      `- 交付备份：\`${asset.type === "pet" ? "source/original-pet-assets" : "source/original-product-screenshots"}/${asset.target}\``,
      `- 使用图片：${entry.use}`,
      `- 处理：${entry.treatment}`,
      `- 原文件 SHA-256：\`${asset.hash}\``,
      `- 备份 SHA-256：\`${hashFile(asset.targetPath)}\``,
      `- 来源说明：${asset.type === "pet" ? "XIAOTONG Desktop Pet 原始帧；Apache-2.0 + Additional Terms。" : "Chroni v0.2.0 仓库真实产品截图；Chroni 项目素材。"}`,
      "",
    );
  }
  lines.push(
    "## 排版字体",
    "",
    "- 生成环境使用系统已安装的 `Noto Sans SC` / `Microsoft YaHei` 字体进行渲染。",
    "- 字体文件未打包到交付目录。",
    "- Chroni 应用分发的 Source / Noto 字体家族依据 SIL Open Font License 1.1。",
    "",
  );
  writeFileSync(join(output, "source", "asset-manifest.md"), lines.join("\n"));
}

function buildReadme() {
  const readme = `# Chroni 小红书首发素材包

## 本次生成内容

- 8 张 1242 × 1660、3:4、PNG 小红书正式图片。
- 1 张 4 × 2 总览 Contact Sheet。
- 主文案、置顶评论、8 个标题选项与发布指南。
- 本次实际使用的 5 个原始桌宠帧、2 张真实产品截图、桌宠许可证与素材清单。

## 图片上传顺序

\`01-cover.png\` → \`02-origin.png\` → \`03-workflow.png\` → \`04-daily-planner.png\` → \`05-agent-workspace.png\` → \`06-pet-states.png\` → \`07-open-source.png\` → \`08-feedback-star.png\`

## 文案位置

- 正文：\`copy/xiaohongshu-post.md\`
- 置顶评论：\`copy/pinned-comment.md\`
- 标题选项：\`copy/title-options.md\`
- 发布步骤：\`copy/publishing-guide.md\`

## 真实素材

桌宠：\`idle/0000.png\`、\`study/0016.png\`、\`wake/0016.png\`、\`play/0016.png\`、\`pet/0016.png\`。

产品截图：\`chroni-daily-planner-v0.2.0.png\`、\`chroni-agent-workspace-v0.2.0.png\`。

逐项路径、使用页面、处理方式、许可证和 SHA-256 见 \`source/asset-manifest.md\`。

## 重新生成

在 Chroni 仓库根目录执行：

\`\`\`powershell
npx pnpm@11.7.0 install
npx pnpm@11.7.0 run marketing:xiaohongshu
\`\`\`

单独步骤：

\`\`\`powershell
npx pnpm@11.7.0 run marketing:xiaohongshu:build
npx pnpm@11.7.0 run marketing:xiaohongshu:verify
npx pnpm@11.7.0 run marketing:xiaohongshu:package
\`\`\`

## 当前已知限制

- 图文基于公开版本 v${version} 的仓库截图，未来界面更新后应重新生成。
- 安装包可能仍触发 Windows SmartScreen 或 macOS Gatekeeper 的未签名提示。
- 图片只展示已经实现的能力，不代表所有复杂材料都能一次识别成功。
- Contact Sheet 仅用于团队审查，不作为正式发布图片。

## 发布前人工检查

- 在手机上依次预览 8 张图，确认平台压缩后标题仍清楚。
- 核对正式产品页、GitHub Release 和置顶评论入口。
- 确认没有临时版本号、测试链接或团队成员私人信息。
- 确认 XIAOTONG Attribution、Apache-2.0 与 Additional Terms 随交付保留。
- 发布时按 \`copy/publishing-guide.md\` 再做一次隐私检查。
`;
  writeFileSync(join(output, "README.md"), readme);
}

async function main() {
  ensureDirectories();
  const copied = copyAssets();
  const assets = new Map();
  for (const [key, asset] of copied.entries()) {
    assets.set(key, await loadImage(asset.targetPath));
  }

  const renderers = [
    ["01-cover.png", renderCover],
    ["02-origin.png", renderOrigin],
    ["03-workflow.png", renderWorkflow],
    ["04-daily-planner.png", renderDailyPlanner],
    ["05-agent-workspace.png", renderAgent],
    ["06-pet-states.png", renderPetStates],
    ["07-open-source.png", renderOpenSource],
    ["08-feedback-star.png", renderFeedback],
  ];
  for (const [filename, renderer] of renderers) {
    writeCanvas(await renderer(assets), filename);
  }

  buildCopyFiles();
  buildAssetManifest(copied);
  buildReadme();
  await buildContactSheet(renderers.map(([filename]) => filename));

  console.log(`Chroni 小红书图片与文案已生成：${output}`);
}

await main();
