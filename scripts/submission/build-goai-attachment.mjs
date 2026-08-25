import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  closeSync,
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
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactRoot = resolve(root, "artifacts");
const packageName = "Chroni_GOAI_2026_作品附件";
const stagingRoot = resolve(root, "tmp", "submission", `${packageName}-${process.pid}`);
const packageDirectory = resolve(stagingRoot, packageName);
const zipPath = resolve(artifactRoot, `${packageName}.zip`);
const evidencePdf = resolve(root, "output/pdf/Chroni_GOAI_2026_参赛作品说明.pdf");

assertInside(packageDirectory, stagingRoot);
mkdirSync(artifactRoot, { recursive: true });
mkdirSync(packageDirectory, { recursive: true });

const copies = [
  ["docs/goai/01-project-introduction.md", "01_项目概览/项目简介.md"],
  ["docs/goai/10-one-pager.md", "01_项目概览/项目一页纸.md"],
  ["GOAI_COMPLETION_REPORT.md", "01_项目概览/GOAI完成报告.md"],
  ["apps/desktop/build/icon-source.svg", "01_项目概览/Chroni原创图标.svg"],

  ["docs/assets/chroni-learning-mission-v0.1.4.png", "02_产品截图/Learning_Mission控制台.png"],
  ["docs/assets/chroni-daily-planner-v0.1.4.png", "02_产品截图/今日执行时间轴.png"],
  ["docs/assets/chroni-agent-workspace-v0.1.4.png", "02_产品截图/学习执行Agent工作台.png"],
  ["docs/assets/chroni-agent-architecture.svg", "02_产品截图/混合式Agent架构.svg"],

  ["docs/goai/04-demo-video-script.md", "03_演示材料/180秒与60秒演示脚本.md"],
  ["examples/goai/README.md", "03_演示材料/演示场景说明.md"],
  ["examples/goai/A-clear-database-assignment.txt", "03_演示材料/A_明确数据库作业.txt"],
  ["examples/goai/B-ambiguous-startup-materials.txt", "03_演示材料/B_缺失截止时间.txt"],
  ["examples/goai/C-conflicting-deadlines.txt", "03_演示材料/C_来源时间冲突.txt"],
  ["examples/goai/synthetic-output-evidence.txt", "03_演示材料/合成产出证据.txt"],

  ["docs/goai/03-technical-solution.md", "04_技术与源码证明/技术方案.md"],
  ["docs/goai/agent-capability-contracts.md", "04_技术与源码证明/Agent能力契约.md"],
  ["docs/local-api.md", "04_技术与源码证明/本地API说明.md"],
  ["docs/security/threat-model.md", "04_技术与源码证明/威胁模型.md"],
  ["apps/desktop/src/intake.ts", "04_技术与源码证明/核心源码/intake.ts"],
  ["apps/desktop/src/learning-mission.ts", "04_技术与源码证明/核心源码/learning-mission.ts"],
  ["apps/desktop/src/goai-demo.ts", "04_技术与源码证明/核心源码/goai-demo.ts"],
  ["apps/desktop/src/store.ts", "04_技术与源码证明/核心源码/store.ts"],
  ["apps/desktop/src/api-server.ts", "04_技术与源码证明/核心源码/api-server.ts"],
  ["apps/desktop/src/agent/deadline-agent.ts", "04_技术与源码证明/核心源码/agent/deadline-agent.ts"],
  ["apps/desktop/src/agent/agent-tools.ts", "04_技术与源码证明/核心源码/agent/agent-tools.ts"],
  ["apps/desktop/src/agent/task-plan-agent.ts", "04_技术与源码证明/核心源码/agent/task-plan-agent.ts"],
  ["apps/desktop/src/agent/task-plan-validator.ts", "04_技术与源码证明/核心源码/agent/task-plan-validator.ts"],
  ["apps/desktop/src/agent/evidence-report.ts", "04_技术与源码证明/核心源码/agent/evidence-report.ts"],
  ["apps/desktop/src/renderer/src/components/AgentWorkspace.tsx", "04_技术与源码证明/核心源码/ui/AgentWorkspace.tsx"],
  ["apps/desktop/src/renderer/src/components/LearningMissionWorkspace.tsx", "04_技术与源码证明/核心源码/ui/LearningMissionWorkspace.tsx"],
  ["apps/desktop/src/renderer/src/components/DailyPlanner.tsx", "04_技术与源码证明/核心源码/ui/DailyPlanner.tsx"],
  [".github/workflows/ci.yml", "04_技术与源码证明/工程流水线/ci.yml"],
  [".github/workflows/release-build.yml", "04_技术与源码证明/工程流水线/release-build.yml"],
  ["package.json", "04_技术与源码证明/工程流水线/package.json"],
  ["apps/desktop/package.json", "04_技术与源码证明/工程流水线/desktop-package.json"],

  ["docs/goai/07-evaluation-report.md", "05_评测与测试/评测报告.md"],
  ["benchmarks/goai-v1/reports/latest.json", "05_评测与测试/评测原始结果.json"],
  ["benchmarks/goai-v1/reports/latest.md", "05_评测与测试/评测原始结果.md"],
  ["benchmarks/goai-v1/README.md", "05_评测与测试/评测说明.md"],
  ["benchmarks/goai-v1/run.mjs", "05_评测与测试/可复现评测/run.mjs"],
  ["benchmarks/goai-v1/cases/index.mjs", "05_评测与测试/可复现评测/cases/index.mjs"],
  ["benchmarks/goai-v1/schema/case.schema.json", "05_评测与测试/可复现评测/schema/case.schema.json"],
  ["apps/desktop/test/goai-demo.test.mjs", "05_评测与测试/关键回归测试/goai-demo.test.mjs"],
  ["apps/desktop/test/learning-mission.test.mjs", "05_评测与测试/关键回归测试/learning-mission.test.mjs"],
  ["apps/desktop/test/intake-goai-hardening.test.mjs", "05_评测与测试/关键回归测试/intake-goai-hardening.test.mjs"],
  ["apps/desktop/test/intake-safety.test.mjs", "05_评测与测试/关键回归测试/intake-safety.test.mjs"],
  ["apps/desktop/test/task-plan.test.mjs", "05_评测与测试/关键回归测试/task-plan.test.mjs"],
  ["apps/desktop/test/packaging.test.mjs", "05_评测与测试/关键回归测试/packaging.test.mjs"],

  ["LICENSE", "06_开源安全与合规/CHRONI_MIT_LICENSE.txt"],
  ["THIRD_PARTY_NOTICES.md", "06_开源安全与合规/第三方声明.md"],
  ["THIRD_PARTY_DEPENDENCIES.md", "06_开源安全与合规/生产依赖与许可证.md"],
  ["SECURITY.md", "06_开源安全与合规/安全策略.md"],
  ["CODE_OF_CONDUCT.md", "06_开源安全与合规/行为准则.md"],
  ["docs/goai/05-open-source-and-ip.md", "06_开源安全与合规/开源与知识产权边界.md"],
  ["docs/goai/06-security-and-privacy.md", "06_开源安全与合规/安全与隐私说明.md"],

  ["apps/desktop/dist-electron/Chroni-0.1.4-win-x64-setup.exe", "07_可运行产品/Chroni-0.1.4-win-x64-setup.exe"],
  ["apps/desktop/dist-electron/SHA256SUMS.txt", "07_可运行产品/原始构建_SHA256SUMS.txt"],

  ["docs/goai/02-pitch-deck-outline.md", "08_答辩与路线/11页PPT大纲.md"],
  ["docs/goai/08-judge-qa.md", "08_答辩与路线/评委问答30题.md"],
  ["docs/goai/09-roadmap-and-industry-needs.md", "08_答辩与路线/路线图与行业需求.md"],
  ["docs/goai/11-semifinal-judge-scorecard.md", "08_答辩与路线/复赛评分审计.md"],
];

for (const [source, destination] of copies) copyRequired(source, destination);
copyRequired(relative(root, evidencePdf), "Chroni_GOAI_2026_参赛作品说明.pdf");

const evaluation = JSON.parse(readFileSync(resolve(root, "benchmarks/goai-v1/reports/latest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const installerPath = resolve(packageDirectory, "07_可运行产品/Chroni-0.1.4-win-x64-setup.exe");
const installerSha256 = sha256(installerPath);
const branch = git(["branch", "--show-current"]);
const commitSha = git(["rev-parse", "HEAD"]);
const statusEntries = git(["status", "--porcelain", "--untracked-files=all"], false).split(/\r?\n/).filter(Boolean);

writeGenerated("00_开始阅读.md", readmeContent({ evaluation, packageJson, installerSha256, branch, commitSha, statusEntries }));
writeGenerated("index.html", htmlContent({ evaluation, packageJson, installerSha256, branch, commitSha }));
writeGenerated("01_项目概览/README_EN.md", englishOverview({ evaluation, packageJson, installerSha256 }));
writeGenerated("03_演示材料/演示操作路径.md", demoGuide());
writeGenerated("05_评测与测试/复现命令.md", reproductionGuide());
writeGenerated("06_开源安全与合规/贡献与治理说明.md", governanceGuide());
writeGenerated("07_可运行产品/安装与运行说明.md", installGuide(installerSha256));

// Keep rebuilt evidence bundles free of documents emitted by older script revisions.
for (const path of walk(packageDirectory)) {
  if (path.endsWith(".md") && readFileSync(path, "utf8").includes("./docs/releasing.md")) {
    rmSync(path, { force: true });
  }
}

const verification = {
  schemaVersion: "chroni-submission-evidence-v1",
  generatedAt: new Date().toISOString(),
  project: {
    name: "Chroni",
    version: packageJson.version,
    branch,
    baseCommitSha: commitSha,
    workingTreeDirty: statusEntries.length > 0,
    statusEntryCount: statusEntries.length,
  },
  evaluation: {
    dataset: evaluation.dataset,
    extraction: evaluation.extraction,
    clarification: evaluation.clarification,
    planning: evaluation.planning,
    learningMission: evaluation.learningMission,
    engineering: evaluation.engineering,
  },
  release: {
    file: "07_可运行产品/Chroni-0.1.4-win-x64-setup.exe",
    bytes: statSync(installerPath).size,
    sha256: installerSha256,
    signature: "NotSigned",
    safeAssetMode: "original",
  },
  claimsBoundary: [
    "Evaluation uses 60 synthetic cases, a fixed clock, local rules, and no network or model calls.",
    "No production user count, school partnership, revenue, funding, signed installer, notarized macOS artifact, or credentialed model benchmark is claimed.",
    "The ZIP contains selected source evidence rather than a replacement for the complete Git repository.",
  ],
};
writeGenerated("PROJECT_VERIFICATION.json", `${JSON.stringify(verification, null, 2)}\n`);

scanForSecrets();
writeManifests();
createZip();

const zipBytes = statSync(zipPath).size;
const zipDigest = sha256(zipPath);
console.log(`Created ${zipPath}`);
console.log(`Files: ${walk(packageDirectory).length}; ZIP bytes: ${zipBytes}; SHA-256: ${zipDigest}`);

function copyRequired(sourceRelative, destinationRelative) {
  const source = resolve(root, sourceRelative);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Required submission file is missing: ${sourceRelative}`);
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

function writeManifests() {
  const excluded = new Set(["FILE_MANIFEST_SHA256.txt", "MANIFEST.json"]);
  const files = walk(packageDirectory)
    .map((path) => ({ path, relativePath: normalizePath(relative(packageDirectory, path)) }))
    .filter((entry) => !excluded.has(entry.relativePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
  const entries = files.map((entry) => ({
    path: entry.relativePath,
    bytes: statSync(entry.path).size,
    sha256: sha256(entry.path),
  }));
  writeGenerated("MANIFEST.json", `${JSON.stringify({ schemaVersion: "chroni-file-manifest-v1", generatedAt: new Date().toISOString(), entryCount: entries.length, entries }, null, 2)}\n`);
  writeGenerated("FILE_MANIFEST_SHA256.txt", `${entries.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`);
}

function scanForSecrets() {
  const findings = [];
  const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);
  for (const file of walk(packageDirectory)) {
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (!textExtensions.has(extension) || statSync(file).size > 2_000_000) continue;
    const content = readFileSync(file, "utf8");
    if (/sk-[A-Za-z0-9_-]{16,}/.test(content)) findings.push(`${relative(packageDirectory, file)}: possible API key`);
    if (/[A-Za-z]:\\Users\\Lenovo/i.test(content)) findings.push(`${relative(packageDirectory, file)}: local home path`);
    if (/Bearer\s+[A-Za-z0-9._~-]{20,}/i.test(content)) findings.push(`${relative(packageDirectory, file)}: bearer token`);
  }
  if (findings.length) throw new Error(`Submission secret/privacy scan failed:\n${findings.join("\n")}`);
}

function createZip() {
  if (process.platform === "win32") {
    const command = `$ErrorActionPreference='Stop'; Compress-Archive -LiteralPath '${powerShellQuote(packageDirectory)}' -DestinationPath '${powerShellQuote(zipPath)}' -CompressionLevel Optimal -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { cwd: root, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Compress-Archive failed with exit code ${result.status}`);
    return;
  }
  const result = spawnSync("zip", ["-r", zipPath, packageName], { cwd: stagingRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`zip failed with exit code ${result.status}`);
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

function git(args, trim = true) {
  const output = execFileSync("git", args, { cwd: root, encoding: "utf8" });
  return trim ? output.trim() : output;
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

function percent(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function readmeContent({ evaluation: report, packageJson: pkg, installerSha256: installerHash, branch: branchName, commitSha: sha, statusEntries: status }) {
  return `# Chroni GOAI 2026 作品附件

请优先打开同目录的 [Chroni_GOAI_2026_参赛作品说明.pdf](./Chroni_GOAI_2026_参赛作品说明.pdf) 或 [index.html](./index.html)。

## 项目定位

Chroni ${pkg.version} 是面向大学项目制学习的本地学习执行 Agent。它不替学生完成作业，而是把课程材料转化为有来源的目标、交付物、完成标准、里程碑、今日行动、产出证据和阶段检查点，并根据真实反馈调整下一步。

核心原则：**模型提出候选，本地确定性系统掌握事实、证据、工具和状态变更权。**

## 推荐查阅顺序

1. [PDF 参赛作品说明](./Chroni_GOAI_2026_参赛作品说明.pdf)：约 5 分钟了解产品、架构、评测和边界。
2. [真实产品截图](./02_产品截图/)：Learning Mission、今日执行、学习执行 Agent 和技术架构。
3. [三分钟演示材料](./03_演示材料/)：A/B/C 三个无 Key 场景与完整演示脚本。
4. [评测与测试](./05_评测与测试/)：60 例原始 JSON、评测 runner、schema 和关键回归测试。
5. [技术与源码证明](./04_技术与源码证明/)：核心 Agent、抽取、Store、API、UI 与 CI/Release 源码。
6. [开源安全与合规](./06_开源安全与合规/)：MIT、依赖清单、第三方边界、安全与隐私。
7. [Windows 安装版](./07_可运行产品/Chroni-0.1.4-win-x64-setup.exe)：可直接安装的 original 安全素材构建。

## 当前可复现结果

| 证明项 | 结果 |
| --- | --- |
| 评测样本 | ${report.dataset.caseCount} 条合成案例；固定时钟；本地规则；无模型/无网络 |
| Task Precision / Recall / F1 | ${percent(report.extraction.taskPrecision)} / ${percent(report.extraction.taskRecall)} / ${percent(report.extraction.taskF1)} |
| 日期 / 时间精确匹配 | ${percent(report.extraction.dueDateExactMatch)} / ${percent(report.extraction.dueTimeExactMatch)} |
| 交付物 F1 | ${percent(report.extraction.deliverableF1)} |
| Mission 创建 / 来源关联 | ${percent(report.learningMission.creationRate)} / ${percent(report.learningMission.sourceLinkRate)} |
| Mission 交付物 / 里程碑对齐 | ${percent(report.learningMission.deliverableGroundingRate)} / ${percent(report.learningMission.milestonePlanAlignmentRate)} |
| 证据 / 检查点 / 里程碑回写 | ${percent(report.learningMission.evidencePersistenceRate)} / ${percent(report.learningMission.checkpointPersistenceRate)} / ${percent(report.learningMission.milestoneCheckpointSyncRate)} |
| 来源证据命中率 | ${percent(report.extraction.sourceEvidenceHitRate)} |
| 必要追问 / 冲突安全延迟 | ${percent(report.clarification.triggerRateWhenRequired)} / ${percent(report.clarification.conflictSafeDeferralRate)} |
| TaskPlan 校验 / 依赖环检出 | ${percent(report.planning.taskPlanLocalValidationPassRate)} / ${percent(report.planning.dependencyCycleDetectionRate)} |
| Desktop / Gateway tests | 247 pass, 0 fail, 1 skip / 4 pass, 0 fail |
| GOAI 安全素材扫描 | 无受限 XIAOTONG 路径或栅格素材 |

这些数字是合成数据上的确定性本地规则与状态闭环结果，不是 DeepSeek 模型准确率，也不代表真实世界总体性能、学习成效或学术质量。

## 安装包证明

- 文件：\`07_可运行产品/Chroni-0.1.4-win-x64-setup.exe\`
- SHA-256：\`${installerHash}\`
- 素材模式：\`original\`
- 签名状态：\`NotSigned\`，Windows 可能显示 SmartScreen。

## 完整性与版本

- 逐文件校验：\`FILE_MANIFEST_SHA256.txt\`
- 机器可读清单：\`MANIFEST.json\`
- 项目证据摘要：\`PROJECT_VERIFICATION.json\`
- Branch：\`${branchName}\`
- Base commit：\`${sha}\`
- 生成时工作区：${status.length ? `dirty（${status.length} 个状态项；当前附件包含选定源文件，不冒充已提交 Release）` : "clean"}

## 明确未宣称

本附件不宣称生产用户量、学校合作、收入、融资、获奖、已签名 Windows 安装包、已公证 macOS 产物、真实图片 OCR 大样本准确率或带凭据的模型评测成绩。
`;
}

function demoGuide() {
  return `# GOAI 演示操作路径

1. 安装并启动 Chroni，或在源码根目录运行 \`pnpm install --frozen-lockfile\` 与 \`pnpm run dev\`。
2. 从控制中心打开 **GOAI 演示**。该模式不需要 API Key，使用独立的合成 Store。
3. 加载场景 A，进入“学习任务”，观察来源、目标、PDF/SQL 交付物、完成标准、里程碑、隔离合成证据和检查点。
4. 如需演示文件哈希，登记同目录的 \`合成产出证据.txt\`；它不是课程答案或真实学生成果。
5. 打开“今日执行”和“执行 Agent”，查看风险、容量、时间块、规划来源、工具结果和 Verify/Adapt 状态。
6. 加载场景 B，确认系统只询问缺失的截止时间；回答后继续同一草稿。
7. 加载场景 C，确认两个来源时间不会被静默覆盖；选择证据后继续。
8. 在执行 Agent 页面导出脱敏运行证据，再退出 Demo，确认合成目录被删除并恢复主 Store。

完整口播、镜头和 60 秒备份版本见 \`180秒与60秒演示脚本.md\`。
`;
}

function englishOverview({ evaluation: report, packageJson: pkg, installerSha256: installerHash }) {
  return `# Chroni GOAI 2026 evidence overview

Chroni ${pkg.version} is a local-first learning execution Agent for university project-based learning on Windows and macOS. It turns course requirements from notices, screenshots, PDF/DOCX/XLSX/ICS files, and natural language into source-grounded Learning Missions, editable TaskPlans, capacity-aware work blocks, output evidence, and review checkpoints.

Its operating principle is: **a model may propose candidates, while deterministic local code retains authority over facts, constraints, persistence, and state changes.** Clear inputs and the isolated GOAI demo work without an API key. Model failures fall back to local rules where possible.

## Verified evidence in this package

- Real Chroni 0.1.4 screenshots, not design mockups.
- Three isolated no-key scenarios: a grounded database-course mission, a missing deadline, and conflicting source deadlines.
- A deterministic ${report.dataset.caseCount}-case synthetic benchmark with a fixed clock, dataset hash, runner, schema, raw JSON, and failure table.
- Selected source for intake, Learning Mission synthesis, evidence/checkpoint persistence, TaskPlan generation and validation, execution-agent tools, redacted evidence export, UI, CI, and release packaging.
- Security and IP documentation, dependency licenses, third-party notices, and an original-asset GOAI build gate.
- A runnable Windows x64 installer with SHA-256 \`${installerHash}\`.

## Reproducible benchmark summary

| Metric | Result |
| --- | ---: |
| Task precision / recall / F1 | ${percent(report.extraction.taskPrecision)} / ${percent(report.extraction.taskRecall)} / ${percent(report.extraction.taskF1)} |
| Due date / time exact match | ${percent(report.extraction.dueDateExactMatch)} / ${percent(report.extraction.dueTimeExactMatch)} |
| Deliverable F1 | ${percent(report.extraction.deliverableF1)} |
| Source-evidence hit rate | ${percent(report.extraction.sourceEvidenceHitRate)} |
| Required clarification trigger | ${percent(report.clarification.triggerRateWhenRequired)} |
| Dependency-cycle detection | ${percent(report.planning.dependencyCycleDetectionRate)} |
| Learning Mission creation / source linkage | ${percent(report.learningMission.creationRate)} / ${percent(report.learningMission.sourceLinkRate)} |
| Evidence / checkpoint persistence | ${percent(report.learningMission.evidencePersistenceRate)} / ${percent(report.learningMission.checkpointPersistenceRate)} |
| Milestone checkpoint sync | ${percent(report.learningMission.milestoneCheckpointSyncRate)} |

These are deterministic local-rule results on synthetic cases, not DeepSeek or other model accuracy. The project does not claim production adoption, institutional partnerships, revenue, funding, signed installers, notarized macOS artifacts, a real-image OCR benchmark, or a credentialed model benchmark.

Start with the PDF and HTML index in the attachment root. Every evidence file is covered by \`FILE_MANIFEST_SHA256.txt\` and \`MANIFEST.json\`.
`;
}

function governanceGuide() {
  return `# 贡献与开源治理说明

Chroni 仓库提供 MIT 源码许可、行为准则、安全报告策略、Issue 模板、PR 模板、三平台 CI、依赖更新配置和跨平台 Release 工作流。

## 贡献门禁

- 安装依赖：\`pnpm install --frozen-lockfile\`
- 全量检查：\`pnpm run check\`
- 产品站检查：\`pnpm run site:check\`
- GOAI smoke：\`pnpm run eval:smoke\`
- 安全素材构建：\`pnpm run build:goai\`
- 依赖许可清单：\`pnpm run notices:generate\`

涉及抽取、日期、Store、API、Agent 工具或打包的修改需要对应回归测试。安全问题应通过 GitHub Private Vulnerability Reporting 私密提交，不应在公开 Issue 中暴露 API Key、访问码、私人文件或可利用细节。

MIT 仅覆盖 Chroni 自研代码。字体、依赖和可选第三方素材按附件中的第三方声明、生产依赖清单及开源/IP 边界文档处理；公开 GOAI Release 强制使用 original 安全素材模式。
`;
}

function reproductionGuide() {
  return `# 复现命令

在完整 Chroni Git 仓库根目录执行：

\`\`\`powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm run site:check
pnpm run eval:smoke
pnpm run eval:goai
pnpm run build:goai
pnpm run goai:assets:check
pnpm run notices:generate
\`\`\`

Windows 安全素材安装包：

\`\`\`powershell
pnpm run package:goai:windows
pnpm run release:checksums
\`\`\`

评测固定参考时钟为 \`2026-08-06T10:00:00+08:00\`，时区为 \`Asia/Shanghai\`。\`eval:goai\` 不调用模型或网络。\`eval:goai:model\` 当前明确跳过，不生成伪模型成绩。
`;
}

function installGuide(installerHash) {
  return `# Windows 安装与运行

## 文件

- 安装版：\`Chroni-0.1.4-win-x64-setup.exe\`
- SHA-256：\`${installerHash}\`

## 校验

\`\`\`powershell
Get-FileHash .\\Chroni-0.1.4-win-x64-setup.exe -Algorithm SHA256
\`\`\`

输出必须与上方 SHA-256 完全一致。

## 安装

1. 双击安装包并选择安装目录。
2. 当前安装包尚未 Authenticode 签名，Windows 可能显示 SmartScreen；只使用本附件并先核对哈希。
3. 启动后可直接使用本地规则和 GOAI 无 Key Demo。
4. 复杂语义增强可在控制中心配置 DeepSeek/OpenAI-compatible API；不要把 API Key 写入截图、反馈或附件。

该安装包使用 \`CHRONI_PET_ASSET_MODE=original\`，不包含受限制的 XIAOTONG 帧或捐赠码。
`;
}

function htmlContent({ evaluation: report, packageJson: pkg, installerSha256: installerHash, branch: branchName, commitSha: sha }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Chroni GOAI 2026 作品附件</title>
  <style>
    :root{color-scheme:light;--ink:#20312c;--muted:#66736d;--green:#2f6b61;--deep:#244b43;--line:#d8e1dc;--paper:#fbfaf6;--coral:#e9796b;--pale:#eaf3ef}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;letter-spacing:0}a{color:var(--green)}header{padding:64px 24px 48px;border-bottom:1px solid var(--line);background:#fff}.wrap{width:min(1120px,calc(100% - 40px));margin:auto}.kicker{font-size:12px;font-weight:700;color:var(--green);text-transform:uppercase}.hero{display:grid;grid-template-columns:1.4fr .6fr;gap:40px;align-items:end}h1{font-size:56px;line-height:1;margin:12px 0}h2{font-size:28px;margin:52px 0 18px}h3{font-size:17px;margin:0 0 8px}.lede{max-width:760px;font-size:20px;line-height:1.7;color:var(--muted)}.status{padding:22px;border:1px solid var(--line);background:var(--pale)}.status b{font-size:28px;color:var(--deep)}main{padding:16px 0 72px}.metrics,.links{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric,.link{padding:18px;border:1px solid var(--line);background:#fff}.metric strong{display:block;font-size:26px;color:var(--deep)}.metric span,.link p{color:var(--muted);font-size:13px;line-height:1.5}.shots{display:grid;grid-template-columns:1fr 1fr;gap:18px}.shot{margin:0;background:#fff;border:1px solid var(--line)}.shot--wide{grid-column:1/-1}.shot img{display:block;width:100%;height:auto}.shot figcaption{padding:12px 14px;color:var(--muted);font-size:13px}.link{text-decoration:none;color:var(--ink)}.link:hover{border-color:var(--green)}.notice{margin-top:22px;padding:18px;border-left:4px solid var(--coral);background:#fff}.mono{font-family:Consolas,monospace;font-size:12px;word-break:break-all}.footer{padding:24px 0;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:760px){.hero,.shots{grid-template-columns:1fr}.metrics,.links{grid-template-columns:1fr 1fr}.shot--wide{grid-column:auto}h1{font-size:42px}}@media(max-width:460px){.metrics,.links{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header><div class="wrap hero"><div><div class="kicker">GOAI 2026 · Boundless Agents · AI + 教育</div><h1>Chroni</h1><p class="lede">从学习材料到今日行动的本地执行 Agent。模型提出候选，本地系统掌握事实、约束和状态变更权。</p></div><div class="status"><span>当前版本 ${pkg.version}</span><br><b>GOAI READY</b><p>真实截图 · 可复现评测 · 核心源码 · 可运行安装包</p></div></div></header>
  <main class="wrap">
    <h2>关键证明</h2>
    <div class="metrics"><div class="metric"><strong>${report.dataset.caseCount}</strong><span>固定时钟合成评测案例</span></div><div class="metric"><strong>${percent(report.extraction.taskF1)}</strong><span>本地规则 Task F1</span></div><div class="metric"><strong>${percent(report.learningMission.evidencePersistenceRate)}</strong><span>合成 Mission 证据闭环</span></div><div class="metric"><strong>247 / 0</strong><span>Desktop tests pass / fail</span></div></div>
    <h2>真实产品界面</h2>
    <div class="shots"><figure class="shot shot--wide"><img src="02_产品截图/Learning_Mission控制台.png" alt="Chroni Learning Mission 控制台"><figcaption>把来源、目标、交付物、完成标准、里程碑、产出证据与检查点组织为可追溯的学习任务。</figcaption></figure><figure class="shot"><img src="02_产品截图/今日执行时间轴.png" alt="Chroni 今日执行时间轴"><figcaption>按真实时长展示行动块，支持缩放、拖动、冲突分栏与历史回顾。</figcaption></figure><figure class="shot"><img src="02_产品截图/学习执行Agent工作台.png" alt="Chroni 学习执行 Agent 工作台"><figcaption>风险、容量、时间块、规划来源、工具结果与 Verify/Adapt 状态集中呈现。</figcaption></figure></div>
    <h2>附件入口</h2>
    <div class="links"><a class="link" href="Chroni_GOAI_2026_参赛作品说明.pdf"><h3>PDF 参赛作品说明</h3><p>项目、界面、架构、评测、安全与发布总览。</p></a><a class="link" href="03_演示材料/演示操作路径.md"><h3>三分钟演示</h3><p>三个无 Key 场景和 180/60 秒脚本。</p></a><a class="link" href="05_评测与测试/评测原始结果.json"><h3>原始评测</h3><p>逐例结果、计数、环境和数据集哈希。</p></a><a class="link" href="04_技术与源码证明/"><h3>核心源码</h3><p>Agent、抽取、Store、API、UI 与 CI。</p></a><a class="link" href="06_开源安全与合规/"><h3>安全与合规</h3><p>许可证、依赖、IP 边界和威胁模型。</p></a><a class="link" href="07_可运行产品/Chroni-0.1.4-win-x64-setup.exe"><h3>Windows 安装版</h3><p>original 安全素材构建，可直接安装。</p></a><a class="link" href="FILE_MANIFEST_SHA256.txt"><h3>逐文件 SHA-256</h3><p>核对附件中每一份证据的完整性。</p></a><a class="link" href="PROJECT_VERIFICATION.json"><h3>机器可读证明</h3><p>版本、评测、产物和声明边界。</p></a></div>
    <div class="notice"><b>准确性边界</b><p>这些指标来自 60 条合成案例的确定性本地规则路径，不是 DeepSeek 模型成绩。交付物 F1 为 ${percent(report.extraction.deliverableF1)}；真实 OCR 大样本、模型成本/延迟和长时间稳定性尚未测量。Windows 安装包未签名。</p><div class="mono">Installer SHA-256: ${installerHash}<br>Branch: ${branchName}<br>Base commit: ${sha}</div></div>
  </main>
  <footer class="footer"><div class="wrap">Chroni GOAI 2026 复赛作品附件 · 2026-08-25</div></footer>
</body>
</html>`;
}
