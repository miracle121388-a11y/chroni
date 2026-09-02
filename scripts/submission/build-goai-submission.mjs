import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactRoot = resolve(root, "artifacts", "submission");
const stagingBase = resolve(root, "tmp", "submission");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = packageJson.version;
const packageName = "Chroni_GOAI_2026_复赛最终提交";
const stagingRoot = resolve(stagingBase, `${packageName}-${process.pid}`);
const packageDirectory = resolve(stagingRoot, packageName);
const zipPath = resolve(artifactRoot, `${packageName}.zip`);
const checksumPath = resolve(artifactRoot, `${packageName}_SHA256.txt`);
const pdfName = "Chroni_GOAI_2026_更新版项目方案.pdf";
const pdfPath = resolve(root, "output", "pdf", pdfName);
const installerName = `Chroni-${version}-win-x64-setup.exe`;
const installerSource = resolve(root, "apps", "desktop", "dist-electron", installerName);
const buildManifestSource = resolve(root, "apps", "desktop", "dist", "build-manifest.json");
const branch = git(["branch", "--show-current"]);
const commitSha = git(["rev-parse", "HEAD"]);
const worktreeStatus = git(["status", "--porcelain", "--untracked-files=no"]);
const baselineTag = "v0.1.4";
const baselineCommit = git(["rev-list", "-n", "1", baselineTag]);
const commitsSinceBaseline = Number(git(["rev-list", "--count", `${baselineTag}..HEAD`]));
const diffSinceBaseline = git(["diff", "--shortstat", `${baselineTag}..HEAD`]);
const comparisonName = `从${baselineTag}到v${version}.md`;

if (worktreeStatus) {
  throw new Error("Submission packaging requires clean tracked and staged files so every artifact maps to an exact commit.");
}
if (!existsSync(buildManifestSource)) throw new Error("Submission packaging requires a completed Windows product build.");
const buildManifest = JSON.parse(readFileSync(buildManifestSource, "utf8"));
if (buildManifest.version !== version || buildManifest.variant !== "product" || buildManifest.petAssetMode !== "xiaotong") {
  throw new Error("Submission installer must be the product/xiaotong build so the animated desktop companion is present.");
}
if (!existsSync(installerSource) || statSync(installerSource).mtimeMs < statSync(buildManifestSource).mtimeMs) {
  throw new Error(`Submission installer is missing or older than its product build manifest: ${installerName}`);
}

assertInside(packageDirectory, stagingRoot);
mkdirSync(artifactRoot, { recursive: true });
cleanObsoleteArtifacts();
cleanStagingBase();
mkdirSync(packageDirectory, { recursive: true });

const copies = [
  [relative(root, pdfPath), `01_更新版项目方案/${pdfName}`],
  ["docs/goai/01-project-introduction.md", "01_更新版项目方案/项目介绍.md"],
  ["docs/goai/12-semifinal-update.md", `01_更新版项目方案/${comparisonName}`],
  ["docs/goai/13-judge-feedback-optimization.md", "01_更新版项目方案/评委反馈专项优化.md"],

  ["docs/store/assets/screenshots/zh-CN/00-first-run.png", "02_产品与Demo/真实截图/01_首次启动.png"],
  ["docs/store/assets/screenshots/zh-CN/03-smart-organize.png", "02_产品与Demo/真实截图/02_智能整理.png"],
  ["docs/store/assets/screenshots/zh-CN/02-learning-mission.png", "02_产品与Demo/真实截图/03_学习任务.png"],
  ["docs/store/assets/screenshots/zh-CN/01-today.png", "02_产品与Demo/真实截图/04_今日执行.png"],
  ["docs/store/assets/screenshots/zh-CN/04-daily-review.png", "02_产品与Demo/真实截图/05_每日回顾.png"],
  ["docs/store/assets/screenshots/zh-CN/05-companion.png", "02_产品与Demo/真实截图/06_桌宠交互.png"],
  ["docs/assets/chroni-agent-architecture.svg", "02_产品与Demo/Chroni_Agent架构.svg"],
  ["docs/goai/04-demo-video-script.md", "02_产品与Demo/三分钟演示脚本.md"],
  ["examples/goai/D-five-task-comprehensive-notice.md", "02_产品与Demo/示例材料/A_五项任务综合通知.md"],
  ["examples/goai/B-ambiguous-startup-materials.txt", "02_产品与Demo/示例材料/B_缺失截止时间.txt"],
  ["examples/goai/C-conflicting-deadlines.txt", "02_产品与Demo/示例材料/C_来源时间冲突.txt"],

  ["docs/goai/03-technical-solution.md", "03_工程与复现/技术方案.md"],
  ["docs/goai/agent-capability-contracts.md", "03_工程与复现/Agent能力契约.md"],
  ["docs/local-api.md", "03_工程与复现/本地API.md"],
  ["docs/user/quick-start.md", "03_工程与复现/快速开始.md"],
  ["apps/desktop/src/intake.ts", "03_工程与复现/核心源码/intake.ts"],
  ["apps/desktop/src/learning-mission.ts", "03_工程与复现/核心源码/learning-mission.ts"],
  ["apps/desktop/src/agent/deadline-agent.ts", "03_工程与复现/核心源码/deadline-agent.ts"],
  ["apps/desktop/src/agent/agent-tools.ts", "03_工程与复现/核心源码/agent-tools.ts"],
  ["apps/desktop/src/agent/task-plan-agent.ts", "03_工程与复现/核心源码/task-plan-agent.ts"],
  ["apps/desktop/src/agent/agent-planner.ts", "03_工程与复现/核心源码/agent-planner.ts"],
  ["apps/desktop/src/agent/evidence-report.ts", "03_工程与复现/核心源码/evidence-report.ts"],
  ["apps/desktop/src/shared/learning-insights.ts", "03_工程与复现/核心源码/learning-insights.ts"],
  ["apps/desktop/src/shared/task-priority.ts", "03_工程与复现/核心源码/task-priority.ts"],
  ["apps/desktop/src/store.ts", "03_工程与复现/核心源码/store.ts"],
  ["apps/desktop/src/renderer/src/components/DailyReviewWorkspace.tsx", "03_工程与复现/核心源码/DailyReviewWorkspace.tsx"],

  ["benchmarks/goai-v1/README.md", "04_评测与运行证据/评测集说明.md"],
  ["benchmarks/goai-v1/run.mjs", "04_评测与运行证据/评测程序/run.mjs"],
  ["benchmarks/goai-v1/cases/index.mjs", "04_评测与运行证据/评测程序/cases/index.mjs"],
  ["benchmarks/goai-v1/schema/case.schema.json", "04_评测与运行证据/评测程序/schema/case.schema.json"],
  ["apps/desktop/test/intake-goai-hardening.test.mjs", "04_评测与运行证据/关键测试/intake-goai-hardening.test.mjs"],
  ["apps/desktop/test/learning-mission.test.mjs", "04_评测与运行证据/关键测试/learning-mission.test.mjs"],
  ["apps/desktop/test/daily-task.test.mjs", "04_评测与运行证据/关键测试/daily-task.test.mjs"],
  ["apps/desktop/test/learning-insights.test.mjs", "04_评测与运行证据/关键测试/learning-insights.test.mjs"],

  ["docs/goai/05-open-source-and-ip.md", "05_数据安全与合规/开源与知识产权.md"],
  ["docs/goai/06-security-and-privacy.md", "05_数据安全与合规/安全与隐私.md"],
  ["docs/user/privacy.md", "05_数据安全与合规/用户隐私说明.md"],
  ["docs/security/threat-model.md", "05_数据安全与合规/威胁模型.md"],
  ["LICENSE", "05_数据安全与合规/LICENSE"],
  ["THIRD_PARTY_DEPENDENCIES.md", "05_数据安全与合规/THIRD_PARTY_DEPENDENCIES.md"],
  ["THIRD_PARTY_NOTICES.md", "05_数据安全与合规/THIRD_PARTY_NOTICES.md"],
  ["apps/desktop/third_party/xiaotong/LICENSE", "05_数据安全与合规/桌宠素材/XIAOTONG-APACHE-2.0.txt"],
  ["apps/desktop/third_party/xiaotong/ADDITIONAL_TERMS.md", "05_数据安全与合规/桌宠素材/XIAOTONG-ADDITIONAL-TERMS.md"],
  ["apps/desktop/third_party/xiaotong/README.md", "05_数据安全与合规/桌宠素材/XIAOTONG-NOTICE.md"],

  [relative(root, installerSource), `06_可运行产品/${installerName}`],
];

for (const [source, destination] of copies) copyRequired(source, destination);

const evaluation = sanitizeEvidence(
  JSON.parse(readFileSync(resolve(root, "benchmarks", "goai-v1", "reports", "latest.json"), "utf8")),
);
const installerPath = resolve(packageDirectory, "06_可运行产品", installerName);

writeGenerated("00_开始阅读.md", submissionGuide());
writeGenerated("03_工程与复现/复现命令.md", reproductionGuide());
writeGenerated("04_评测与运行证据/评测报告.md", evaluationGuide());
writeGenerated("04_评测与运行证据/评测结果_脱敏.json", `${JSON.stringify(evaluation, null, 2)}\n`);
writeGenerated("04_评测与运行证据/最终验证结果.md", validationGuide());
writeGenerated("05_数据安全与合规/桌宠素材使用说明.md", companionAssetGuide());
writeGenerated("06_可运行产品/安装与校验.md", installGuide(sha256(installerPath)));
writeGenerated("PROJECT_VERIFICATION.json", `${JSON.stringify(verification(), null, 2)}\n`);
writeManifest();

const generated = [
  "00_开始阅读.md",
  "03_工程与复现/复现命令.md",
  "04_评测与运行证据/评测报告.md",
  "04_评测与运行证据/评测结果_脱敏.json",
  "04_评测与运行证据/最终验证结果.md",
  "05_数据安全与合规/桌宠素材使用说明.md",
  "06_可运行产品/安装与校验.md",
  "PROJECT_VERIFICATION.json",
  "FILE_MANIFEST_SHA256.txt",
];

verifyExactContents([...copies.map(([, destination]) => destination), ...generated]);
scanForSecrets();

const fileCount = walk(packageDirectory).length;
createZip();
const zipHash = sha256(zipPath);
writeFileSync(checksumPath, `${zipHash}  ${basename(zipPath)}\n`, "utf8");
verifyArtifactRoot();
removePath(stagingRoot);

console.log(`Created ${zipPath}`);
console.log(`Files: ${fileCount}; ZIP bytes: ${statSync(zipPath).size}; SHA-256: ${zipHash}`);

function copyRequired(sourceRelative, destinationRelative) {
  const source = resolve(root, sourceRelative);
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`Required submission file is missing: ${sourceRelative}`);
  }
  const destination = resolve(packageDirectory, destinationRelative);
  assertInside(destination, packageDirectory);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function writeGenerated(destinationRelative, content) {
  const destination = resolve(packageDirectory, destinationRelative);
  assertInside(destination, packageDirectory);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, "utf8");
}

function writeManifest() {
  const lines = walk(packageDirectory)
    .map((path) => `${sha256(path)}  ${normalizePath(relative(packageDirectory, path))}`)
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  writeGenerated("FILE_MANIFEST_SHA256.txt", `${lines.join("\n")}\n`);
}

function verifyExactContents(expectedRelativePaths) {
  const expected = expectedRelativePaths.map(normalizePath).sort();
  const actual = walk(packageDirectory)
    .map((path) => normalizePath(relative(packageDirectory, path)))
    .sort();
  const missing = expected.filter((path) => !actual.includes(path));
  const extras = actual.filter((path) => !expected.includes(path));
  if (missing.length || extras.length) {
    throw new Error(
      `Unexpected submission contents. Missing: ${missing.join(", ") || "none"}; extras: ${extras.join(", ") || "none"}`,
    );
  }
}

function scanForSecrets() {
  const findings = [];
  const textExtensions = new Set([".html", ".json", ".md", ".mjs", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);
  for (const file of walk(packageDirectory)) {
    if (!textExtensions.has(extname(file).toLowerCase()) || statSync(file).size > 2_000_000) continue;
    const content = readFileSync(file, "utf8");
    const displayPath = normalizePath(relative(packageDirectory, file));
    if (/sk-[A-Za-z0-9_-]{16,}/.test(content)) findings.push(`${displayPath}: possible API key`);
    if (/[A-Za-z]:\\Users\\[^\\\s]+/i.test(content)) findings.push(`${displayPath}: local home path`);
    if (/Bearer\s+[A-Za-z0-9._~-]{20,}/i.test(content)) findings.push(`${displayPath}: bearer token`);
  }
  if (findings.length) throw new Error(`Submission secret/privacy scan failed:\n${findings.join("\n")}`);
}

function cleanObsoleteArtifacts() {
  for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
    removeArtifact(resolve(artifactRoot, entry.name));
  }
}

function removeArtifact(target) {
  assertInside(target, artifactRoot);
  removePath(target);
}

function cleanStagingBase() {
  mkdirSync(stagingBase, { recursive: true });
  for (const entry of readdirSync(stagingBase, { withFileTypes: true })) {
    const target = resolve(stagingBase, entry.name);
    assertInside(target, stagingBase);
    removePath(target);
  }
}

function removePath(target) {
  if (!existsSync(target)) return;
  const directory = statSync(target).isDirectory();
  if (process.platform === "win32") {
    const longTarget = target.startsWith("\\\\?\\") ? target : `\\\\?\\${target}`;
    const command = directory
      ? `[System.IO.Directory]::Delete('${powerShellQuote(longTarget)}', $true)`
      : `[System.IO.File]::Delete('${powerShellQuote(longTarget)}')`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Windows artifact cleanup failed with exit code ${result.status}: ${target}`);
  } else if (directory) {
    rmSync(target, { recursive: true, force: true });
  } else {
    rmSync(target, { force: true });
  }
  if (existsSync(target)) throw new Error(`Artifact cleanup did not persist: ${target}`);
}

function verifyArtifactRoot() {
  const expected = new Set([basename(zipPath), basename(checksumPath)]);
  const actual = readdirSync(artifactRoot).sort();
  const extras = actual.filter((name) => !expected.has(name));
  const missing = [...expected].filter((name) => !actual.includes(name));
  if (extras.length || missing.length) {
    throw new Error(
      `Artifact directory is not canonical. Missing: ${missing.join(", ") || "none"}; extras: ${extras.join(", ") || "none"}`,
    );
  }
}

function createZip() {
  if (process.platform === "win32") {
    const command = `$ErrorActionPreference='Stop'; Compress-Archive -LiteralPath '${powerShellQuote(packageDirectory)}' -DestinationPath '${powerShellQuote(zipPath)}' -CompressionLevel Optimal -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Compress-Archive failed with exit code ${result.status}`);
    return;
  }

  const result = spawnSync("zip", ["-r", zipPath, packageName], { cwd: stagingRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`ZIP creation failed with exit code ${result.status}`);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function sha256(path) {
  const digest = createHash("sha256");
  const descriptor = openSync(path, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead > 0) digest.update(chunk.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return digest.digest("hex");
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function assertInside(target, parent) {
  const normalizedParent = `${resolve(parent)}${sep}`.toLowerCase();
  const normalizedTarget = resolve(target).toLowerCase();
  if (!normalizedTarget.startsWith(normalizedParent)) throw new Error(`Unsafe artifact path: ${target}`);
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function powerShellQuote(value) {
  return value.replace(/'/g, "''");
}

function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["commitSha", "repository", "workspace", "workingDirectory"].includes(key))
        .map(([key, item]) => [key, sanitizeEvidence(item)]),
    );
  }
  if (typeof value === "string") {
    return value
      .replaceAll(root, "<repository>")
      .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "<local-home>");
  }
  return value;
}

function percent(value) {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`;
}

function submissionGuide() {
  return `# Chroni GOAI 2026 复赛最终提交

版本：v${version}<br/>
源码提交：${commitSha}<br/>
开源仓库：https://github.com/miracle121388-a11y/chroni

## 一句话定位

Chroni 是面向大学项目制学习的本地学习执行 Agent。它不替学生完成作业，而是把课程材料转成带来源的 Learning Mission，并持续连接目标、交付物、里程碑、今日行动、产出证据、每日回顾与下一步调整。

核心闭环：**Ground → Plan → Act → Verify → Review → Adapt**。

## 相比初版新增了什么

对比基线是 ${baselineTag}（${baselineCommit}）。当前版本相对初版新增 ${commitsSinceBaseline} 个提交；Git 统计为：${diffSinceBaseline}。逐项差异见 **01_更新版项目方案/${comparisonName}**。

当前版在原有材料抽取、DDL 规划和桌宠提醒基础上，新增 Learning Mission、语义优先级与容量自适应规划、错过计划后的 15/25 分钟补救行动、14 日回顾趋势、托管模型零配置入口、直接下载安装链路，以及可追溯的来源证据和冲突确认机制。

## 建议评审顺序

1. 先读 **01_更新版项目方案/${pdfName}**，十分钟内了解初版差异、场景价值、闭环、技术和事实边界。
2. 直接安装 **06_可运行产品/${installerName}**，打开智能整理并导入 A；随后检查学习任务、今日执行和每日回顾。
3. 导入 B/C，验证“只问阻断项”和“冲突由用户确认”两个异常分支。
4. 查看 **04_评测与运行证据**，核对 60 条离线评测、关键测试、runner、schema 与最终验证结果。
5. 查看 **03_工程与复现** 和 **05_数据安全与合规**，核对源码、API、依赖、数据、隐私、IP 与安全边界。

## 事实边界

A/B/C 和 60 条评测均为明确标注的合成数据。结果证明确定性状态闭环可复现，不等同于真实学生学习成效、真实 OCR 总体准确率或 DeepSeek 总体质量。项目不声称已有学校合作、生产用户、商业代码签名或比赛结果。
`;
}

function reproductionGuide() {
  return `# 工程复现命令

## 环境

- Windows 10/11 或 macOS 13+
- Node.js 22.13+
- pnpm 11.7.0

## 从零运行

\`\`\`powershell
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm run dev
\`\`\`

控制中心默认由 Vite 启动，Electron 主进程随后连接。无 Key 情况可将附件示例 A 拖入“智能整理”，复现结构明确的本地规则链路。

## 门禁与评测

\`\`\`powershell
pnpm run check
pnpm run eval:smoke
pnpm run eval:goai
pnpm run build
pnpm run store:check
pnpm run site:check
\`\`\`

\`eval:goai:model\` 是显式联网评测，只有配置用户自己的 DeepSeek 凭据后才运行；默认门禁不会读取或上传 API Key。完整源码不重复塞进附件，评委可按根目录记录的精确 commit 克隆公开仓库，附件只保留最能证明闭环的核心实现。

## 发布构建

\`\`\`powershell
pnpm run package:submission:windows
node scripts/verify-desktop-artifact.mjs --platform=windows --variant=product
pnpm run release:checksums
pnpm run submission:goai
\`\`\`

复赛最终安装包使用与公开产品一致的 \`product/xiaotong\` 构建，包含动态桌宠帧、完整许可证与应用内署名。最后一条命令要求 Git 已跟踪文件保持干净，以确保 ZIP 中的 \`PROJECT_VERIFICATION.json\` 对应唯一提交。
`;
}

function installGuide(installerHash) {
  return `# Windows 安装与校验

版本：v${version}

1. 校验 **${installerName}** 的 SHA-256。
2. 双击安装包并按向导完成安装。
3. 如 Windows SmartScreen 提示，请先核对下方哈希，再选择“更多信息”确认运行。当前内测安装包尚未购买 Authenticode 代码签名证书。
4. 启动后可直接导入附件示例 A 体验本地规则链路；真实模型增强需在应用设置中填写用户自己的 DeepSeek OpenAI-compatible 配置。
5. 桌面应显示可交互的蓝色动态桌宠，而不是 Chroni 应用图标；左键可打开日程，拖动可重新放置。若显示应用图标，说明拿到的是错误的占位资源构建，请不要继续验收。

\`\`\`text
${installerHash}  ${installerName}
\`\`\`

卸载入口位于 Windows“设置 → 应用 → 已安装的应用”。应用数据默认保留，便于升级；如需彻底删除，请先在设置页清除本地数据。
`;
}

function companionAssetGuide() {
  return `# 桌宠素材使用说明

复赛安装包使用 XIAOTONG 项目提供的蓝色动态桌宠帧。素材来源、许可证、附加条款和署名文件均完整收录在同目录的 **桌宠素材** 文件夹；应用“关于”页也可在两次点击内查看第三方声明。

- 使用场景：Chroni GOAI 2026 非商业竞赛展示与免费开源产品体验。
- 构建标识：\`variant=product\`，\`petAssetMode=xiaotong\`。
- 完整性：安装包包含 219 张动作帧，不以 Chroni 应用图标替代桌宠。
- 权利边界：本项目不声称获得独立商业授权。任何付费下载、应用商店收费、广告变现或其他商业发行，均需先取得素材权利方书面许可，或替换为自有素材。
- 署名边界：Apache-2.0、附加条款、原项目说明与第三方声明随安装包和本附件一并提供。

本说明只陈述仓库中可核验的授权文件，不扩张原权利人的许可范围。
`;
}

function evaluationGuide() {
  const extraction = evaluation.extraction ?? {};
  const mission = evaluation.learningMission ?? {};
  const clarification = evaluation.clarification ?? {};
  const engineering = evaluation.engineering ?? {};
  return `# Chroni GOAI v1 评测报告

本报告由仓库评测器生成。数据集是合成数据，参考时钟固定，本次运行没有调用模型或网络。精确源码提交见附件根目录 \`PROJECT_VERIFICATION.json\`。

- 案例数：${evaluation.dataset?.caseCount ?? 60}
- 评测生成时间：${evaluation.generatedAt}
- 数据集 SHA-256：${evaluation.dataset?.sha256 ?? "未记录"}
- 固定时钟：${evaluation.dataset?.referenceNow ?? "未记录"}（${evaluation.dataset?.timezone ?? "Asia/Shanghai"}）
- 环境：${evaluation.environment?.platform ?? process.platform} ${evaluation.environment?.architecture ?? process.arch}，${evaluation.environment?.node ?? process.version}
- 模型调用：0；网络：不需要
- 每例重复次数：1

## 核心指标

| 指标 | 结果 |
| --- | ---: |
| Task precision / recall / F1 | ${percent(extraction.taskPrecision)} / ${percent(extraction.taskRecall)} / ${percent(extraction.taskF1)} |
| 标题归一化准确率 | ${percent(extraction.titleNormalizationAccuracy)} |
| 日期 / 时间精确匹配 | ${percent(extraction.dueDateExactMatch)} / ${percent(extraction.dueTimeExactMatch)} |
| 交付物 F1 | ${percent(extraction.deliverableF1)} |
| 来源证据命中率 | ${percent(extraction.sourceEvidenceHitRate)} |
| 必要追问 / 冲突安全延迟 | ${percent(clarification.triggerRateWhenRequired)} / ${percent(clarification.conflictSafeDeferralRate)} |
| Mission 创建 / 来源关联 | ${percent(mission.creationRate)} / ${percent(mission.sourceLinkRate)} |
| 证据 / 检查点持久化 | ${percent(mission.evidencePersistenceRate)} / ${percent(mission.checkpointPersistenceRate)} |
| 检查点同步里程碑 | ${percent(mission.milestoneCheckpointSyncRate)} |
| 离线成功率 | ${percent(engineering.offlineSuccessRate)} |

## 性能记录

| 路径 | p50 | p95 |
| --- | ---: | ---: |
| intake | ${engineering.localRulesLatencyP50Ms} ms | ${engineering.localRulesLatencyP95Ms} ms |
| Mission 证据/检查点生命周期 | ${engineering.learningMissionLifecycleP50Ms} ms | ${engineering.learningMissionLifecycleP95Ms} ms |
| 完整离线案例 | ${engineering.offlineCaseP50Ms} ms | ${engineering.offlineCaseP95Ms} ms |

抽样峰值 RSS 为 ${engineering.sampledPeakRssMiB} MiB。

## 事实边界

- 该结果证明固定合成案例上的确定性系统行为可复现，不是 DeepSeek 增强结果。
- 标题归一化和交付物抽取并非 100%，不能描述为“完美提取”。
- 图片 OCR 总体准确率、真实模型 p50/p95 与成本、长时间稳定性、置信区间尚未在本评测中完成。
- Mission 生命周期指标不代表学习成效、学术质量或真实用户行为。

逐例结果和原始计数位于同目录 \`评测结果_脱敏.json\`；runner、cases、schema 与关键测试一并提供。
`;
}

function validationGuide() {
  return `# 最终验证结果

本文件记录最终附件对应源码在 Windows x64 环境上的提交前门禁。全部命令均在仓库根目录执行；精确提交见附件根目录 \`PROJECT_VERIFICATION.json\`。

| 验证项 | 最终结果 | 覆盖范围 |
| --- | --- | --- |
| Desktop 自动化测试 | 278 项：277 pass / 0 fail / 1 skip | 抽取、Store、Mission、Agent、语义规划、每日任务/回顾、窗口、API、更新与打包 |
| Gateway 自动化测试 | 6 pass / 0 fail | 访问码、限流、超时、上游错误、托管模型与日志边界 |
| TypeScript / Renderer 构建 | 通过 | Main、preload、React Renderer 与生产资源 |
| GOAI 60 条离线评测 | ${percent(evaluation.engineering?.offlineSuccessRate)} | 固定时钟、合成数据、本地规则、零模型/零网络 |
| Windows 安装包验证 | 通过 | product/xiaotong 资源、ASAR、许可证、冷启动、回环 API 与产品标识 |
| 商店/产品素材检查 | 通过 | 六个核心工作区、真实截图、219 张动态桌宠帧与图标边界 |

## 复现命令

    pnpm run check
    pnpm run eval:goai
    pnpm run package:submission:windows

## 结果边界

离线 benchmark 证明固定合成案例上的系统行为，不代表真实课程总体分布、真实 OCR 总体准确率、DeepSeek 总体质量或学生学习成效。Windows 安装包当前未使用商业 Authenticode 证书。
`;
}

function verification() {
  const summary = evaluation.summary ?? evaluation.metrics ?? {};
  return {
    artifact: packageName,
    version,
    branch,
    commitSha,
    generatedAt: new Date().toISOString(),
    worktreeClean: true,
    comparison: {
      baselineTag,
      baselineCommit,
      currentCommit: commitSha,
      commitsSinceBaseline,
      diffSinceBaseline,
    },
    runtime: {
      node: process.version,
      pnpm: pnpmVersion(),
      platform: `${process.platform}-${process.arch}`,
    },
    evidence: {
      evaluationDataset: "benchmarks/goai-v1",
      cases: evaluation.caseCount ?? evaluation.cases?.length ?? summary.caseCount ?? 60,
      offlineSuccessRate: percent(summary.offlineSuccessRate ?? evaluation.offlineSuccessRate ?? 1),
      sourceEvidenceHitRate: percent(summary.sourceEvidenceHitRate ?? evaluation.sourceEvidenceHitRate ?? 1),
      syntheticData: true,
      modelNetworkCalls: false,
      dailyReviewWorkspace: true,
      adaptiveSemanticPlanning: true,
      reviewTrendDays: 14,
      buildVariant: buildManifest.variant,
      petAssetMode: buildManifest.petAssetMode,
      companionLicenseIncluded: true,
    },
    caveats: [
      "Synthetic evaluation demonstrates reproducible system behavior, not real-world learning outcomes.",
      "The Windows installer is not Authenticode-signed.",
      "No macOS binary is included because this package was built and verified on Windows.",
      "The competition package is noncommercial; paid or otherwise commercial distribution of the XIAOTONG companion requires written permission or replacement assets.",
    ],
  };
}

function pnpmVersion() {
  const activeVersion = process.env.npm_config_user_agent?.match(/pnpm\/([^\s]+)/)?.[1];
  if (activeVersion) return activeVersion;
  return packageJson.packageManager?.replace(/^pnpm@/, "") || "unknown";
}
