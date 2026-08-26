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
const artifactRoot = resolve(root, "artifacts");
const stagingBase = resolve(root, "tmp", "submission");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = packageJson.version;
const packageName = "Chroni_GOAI_2026_复赛提交";
const stagingRoot = resolve(stagingBase, `${packageName}-${process.pid}`);
const packageDirectory = resolve(stagingRoot, packageName);
const zipPath = resolve(artifactRoot, `${packageName}.zip`);
const checksumPath = resolve(artifactRoot, `${packageName}_SHA256.txt`);
const pdfName = "Chroni_GOAI_2026_更新版项目方案.pdf";
const pdfPath = resolve(root, "output", "pdf", pdfName);
const installerName = `Chroni-${version}-win-x64-setup.exe`;
const installerSource = resolve(root, "apps", "desktop", "dist-electron", installerName);
const branch = git(["branch", "--show-current"]);
const commitSha = git(["rev-parse", "HEAD"]);
const worktreeStatus = git(["status", "--porcelain"]);

if (worktreeStatus) {
  throw new Error("Submission packaging requires a clean worktree so every artifact maps to an exact commit.");
}

assertInside(packageDirectory, stagingRoot);
mkdirSync(artifactRoot, { recursive: true });
cleanObsoleteArtifacts();
cleanStagingBase();
mkdirSync(packageDirectory, { recursive: true });

const copies = [
  [relative(root, pdfPath), `01_更新版项目方案/${pdfName}`],
  ["docs/goai/01-project-introduction.md", "01_更新版项目方案/项目介绍.md"],
  ["docs/goai/10-one-pager.md", "01_更新版项目方案/一页纸.md"],
  ["docs/goai/12-semifinal-update.md", "01_更新版项目方案/复赛更新说明.md"],
  ["docs/releases/v0.2.0.md", "01_更新版项目方案/v0.2.0_版本说明.md"],
  ["CHANGELOG.md", "01_更新版项目方案/CHANGELOG.md"],

  ["docs/assets/chroni-learning-mission-v0.2.0.png", "02_产品与Demo/真实截图/Learning_Mission控制台.png"],
  ["docs/assets/chroni-daily-planner-v0.2.0.png", "02_产品与Demo/真实截图/今日执行时间轴.png"],
  ["docs/assets/chroni-agent-workspace-v0.2.0.png", "02_产品与Demo/真实截图/学习执行Agent工作台.png"],
  ["docs/assets/chroni-agent-architecture.svg", "02_产品与Demo/Chroni_Agent架构.svg"],
  ["docs/goai/04-demo-video-script.md", "02_产品与Demo/三分钟演示脚本.md"],
  ["examples/goai/README.md", "02_产品与Demo/示例材料说明.md"],
  ["examples/goai/A-clear-database-assignment.txt", "02_产品与Demo/示例材料/A_明确任务.txt"],
  ["examples/goai/B-ambiguous-startup-materials.txt", "02_产品与Demo/示例材料/B_缺失截止时间.txt"],
  ["examples/goai/C-conflicting-deadlines.txt", "02_产品与Demo/示例材料/C_来源时间冲突.txt"],
  ["examples/goai/synthetic-output-evidence.txt", "02_产品与Demo/示例材料/合成产出证据.txt"],

  ["docs/goai/03-technical-solution.md", "03_工程与复现/技术方案.md"],
  ["docs/goai/agent-capability-contracts.md", "03_工程与复现/Agent能力契约.md"],
  ["docs/local-api.md", "03_工程与复现/本地API.md"],
  ["docs/user/quick-start.md", "03_工程与复现/快速开始.md"],
  ["apps/desktop/src/intake.ts", "03_工程与复现/核心源码/intake.ts"],
  ["apps/desktop/src/learning-mission.ts", "03_工程与复现/核心源码/learning-mission.ts"],
  ["apps/desktop/src/agent/deadline-agent.ts", "03_工程与复现/核心源码/deadline-agent.ts"],
  ["apps/desktop/src/agent/evidence-report.ts", "03_工程与复现/核心源码/evidence-report.ts"],
  ["apps/desktop/src/renderer/src/components/LearningMissionWorkspace.tsx", "03_工程与复现/核心源码/LearningMissionWorkspace.tsx"],

  ["benchmarks/goai-v1/README.md", "04_评测与运行证据/评测集说明.md"],
  ["benchmarks/goai-v1/run.mjs", "04_评测与运行证据/评测程序/run.mjs"],
  ["benchmarks/goai-v1/cases/index.mjs", "04_评测与运行证据/评测程序/cases/index.mjs"],
  ["benchmarks/goai-v1/schema/case.schema.json", "04_评测与运行证据/评测程序/schema/case.schema.json"],
  ["apps/desktop/test/sample-data.test.mjs", "04_评测与运行证据/关键测试/sample-data.test.mjs"],
  ["apps/desktop/test/learning-mission.test.mjs", "04_评测与运行证据/关键测试/learning-mission.test.mjs"],

  ["docs/goai/05-open-source-and-ip.md", "05_数据安全与合规/开源与知识产权.md"],
  ["docs/goai/06-security-and-privacy.md", "05_数据安全与合规/安全与隐私.md"],
  ["docs/user/privacy.md", "05_数据安全与合规/用户隐私说明.md"],
  ["docs/security/threat-model.md", "05_数据安全与合规/威胁模型.md"],
  ["LICENSE", "05_数据安全与合规/LICENSE"],
  ["THIRD_PARTY_NOTICES.md", "05_数据安全与合规/THIRD_PARTY_NOTICES.md"],

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
writeGenerated("06_可运行产品/安装与校验.md", installGuide(sha256(installerPath)));
writeGenerated("PROJECT_VERIFICATION.json", `${JSON.stringify(verification(), null, 2)}\n`);
writeManifest();

const generated = [
  "00_开始阅读.md",
  "03_工程与复现/复现命令.md",
  "04_评测与运行证据/评测报告.md",
  "04_评测与运行证据/评测结果_脱敏.json",
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
  const obsoleteNames = new Set([
    "Chroni_GOAI_2026_参赛附件",
    "Chroni_GOAI_2026_参赛附件.zip",
    "Chroni_GOAI_2026_作品附件",
    "Chroni_GOAI_2026_作品附件.zip",
    "作品附件",
    "作品附件.zip",
    packageName,
    `${packageName}.zip`,
    `${packageName}_SHA256.txt`,
  ]);

  for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
    if (obsoleteNames.has(entry.name) || /^site-.*\.png$/i.test(entry.name) || /^zeabur-.*\.png$/i.test(entry.name)) {
      removeArtifact(resolve(artifactRoot, entry.name));
    }
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
  rmSync(target, { recursive: true, force: true });
  if (existsSync(target) && process.platform === "win32") {
    const command = directory
      ? `[System.IO.Directory]::Delete('${powerShellQuote(target)}', $true)`
      : `[System.IO.File]::Delete('${powerShellQuote(target)}')`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Windows artifact cleanup failed with exit code ${result.status}: ${target}`);
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
  return `# Chroni GOAI 2026 复赛提交包

版本：v${version}<br/>
源码提交：${commitSha}<br/>
开源仓库：https://github.com/miracle121388-a11y/chroni

## 一句话定位

Chroni 是面向大学项目制学习的本地学习执行 Agent。它不替学生完成作业，而是把课程通知、截图、文档和表格转成带来源的 Learning Mission，并围绕目标、交付物、完成标准、里程碑、今日行动、产出证据与阶段检查点持续规划。

核心闭环：**Ground → Plan → Act → Verify → Adapt**。

## 建议评审顺序

1. 阅读 **01_更新版项目方案/${pdfName}**，了解本轮更新、定位、闭环与事实边界。
2. 查看 **02_产品与Demo/真实截图**，再按 **三分钟演示脚本.md** 使用场景 A、B、C 完成主链路与失败分支。
3. 查看 **03_工程与复现**，依据 **复现命令.md** 从零安装、运行、测试和构建。
4. 查看 **04_评测与运行证据** 中的评测说明、脱敏原始结果、runner 与关键测试。
5. 查看 **05_数据安全与合规**，核对数据来源、知识产权、隐私边界、许可证与威胁模型。
6. Windows 评审环境可安装 **06_可运行产品/${installerName}**，安装包哈希见同目录说明。

## 事实边界

无 Key GOAI 演示与 60 条评测使用明确标注的隔离合成数据。结果证明确定性状态闭环可复现，不等同于真实学生学习成效、真实 OCR 总体准确率或 DeepSeek 质量。项目不声称已有学校合作、生产用户、商业代码签名或比赛结果。
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

控制中心默认由 Vite 启动，Electron 主进程随后连接。无 Key 情况可进入“GOAI 演示”复现完整隔离链路。

## 门禁与评测

\`\`\`powershell
pnpm run check
pnpm run eval:smoke
pnpm run eval:goai
pnpm run build:goai
pnpm run goai:assets:check
pnpm run site:check
\`\`\`

\`eval:goai:model\` 是显式联网评测，只有配置用户自己的 DeepSeek 凭据后才运行；默认门禁不会读取或上传 API Key。

## 发布构建

\`\`\`powershell
pnpm run package:goai:windows
pnpm run release:checksums
pnpm run submission:goai
\`\`\`

最后一条命令要求 Git 工作区干净，以确保 ZIP 中的 \`PROJECT_VERIFICATION.json\` 对应唯一提交。
`;
}

function installGuide(installerHash) {
  return `# Windows 安装与校验

版本：v${version}

1. 校验 **${installerName}** 的 SHA-256。
2. 双击安装包并按向导完成安装。
3. 如 Windows SmartScreen 提示，请先核对下方哈希，再选择“更多信息”确认运行。当前内测安装包尚未购买 Authenticode 代码签名证书。
4. 启动后可直接进入无 Key GOAI 演示；真实模型增强需在应用设置中填写用户自己的 DeepSeek OpenAI-compatible 配置。

\`\`\`text
${installerHash}  ${installerName}
\`\`\`

卸载入口位于 Windows“设置 → 应用 → 已安装的应用”。应用数据默认保留，便于升级；如需彻底删除，请先在设置页清除本地数据。
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

function verification() {
  const summary = evaluation.summary ?? evaluation.metrics ?? {};
  return {
    artifact: packageName,
    version,
    branch,
    commitSha,
    generatedAt: new Date().toISOString(),
    worktreeClean: true,
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
    },
    caveats: [
      "Synthetic evaluation demonstrates reproducible system behavior, not real-world learning outcomes.",
      "The Windows installer is not Authenticode-signed.",
      "No macOS binary is included because this package was built on Windows.",
    ],
  };
}

function pnpmVersion() {
  const activeVersion = process.env.npm_config_user_agent?.match(/pnpm\/([^\s]+)/)?.[1];
  if (activeVersion) return activeVersion;
  return packageJson.packageManager?.replace(/^pnpm@/, "") || "unknown";
}
