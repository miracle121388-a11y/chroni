import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactRoot = resolve(root, "artifacts");
const packageName = "Chroni_GOAI_2026_参赛附件";
const stagingRoot = resolve(root, "tmp", "submission", `${packageName}-${process.pid}`);
const packageDirectory = resolve(stagingRoot, packageName);
const zipPath = resolve(artifactRoot, `${packageName}.zip`);
const pdfPath = resolve(root, "output/pdf/Chroni_GOAI_2026_参赛作品说明.pdf");

assertInside(packageDirectory, stagingRoot);
mkdirSync(artifactRoot, { recursive: true });
mkdirSync(packageDirectory, { recursive: true });

const copies = [
  [relative(root, pdfPath), "Chroni_GOAI_2026_参赛作品说明.pdf"],
  ["docs/assets/chroni-learning-mission-v0.1.4.png", "01_产品展示/Learning_Mission控制台.png"],
  ["docs/assets/chroni-daily-planner-v0.1.4.png", "01_产品展示/今日执行时间轴.png"],
  ["docs/assets/chroni-agent-workspace-v0.1.4.png", "01_产品展示/学习执行Agent工作台.png"],
  ["docs/assets/chroni-agent-architecture.svg", "01_产品展示/Chroni_Agent架构.svg"],
  ["docs/goai/04-demo-video-script.md", "02_演示材料/三分钟演示脚本.md"],
  ["examples/goai/A-clear-database-assignment.txt", "02_演示材料/A_明确任务.txt"],
  ["examples/goai/B-ambiguous-startup-materials.txt", "02_演示材料/B_缺失截止时间.txt"],
  ["examples/goai/C-conflicting-deadlines.txt", "02_演示材料/C_来源时间冲突.txt"],
  ["examples/goai/synthetic-output-evidence.txt", "02_演示材料/合成产出证据.txt"],
  ["docs/goai/03-technical-solution.md", "03_技术与评测/技术方案.md"],
  ["docs/goai/07-evaluation-report.md", "03_技术与评测/评测报告.md"],
  ["apps/desktop/dist-electron/Chroni-0.1.4-win-x64-setup.exe", "04_可运行程序/Chroni-0.1.4-win-x64-setup.exe"],
];

for (const [source, destination] of copies) copyRequired(source, destination);

const installerPath = resolve(packageDirectory, "04_可运行程序/Chroni-0.1.4-win-x64-setup.exe");
const evaluation = JSON.parse(readFileSync(resolve(root, "benchmarks/goai-v1/reports/latest.json"), "utf8"));
delete evaluation.commitSha;
delete evaluation.repository;
writeGenerated("提交说明.md", submissionGuide());
writeGenerated("03_技术与评测/评测结果.json", `${JSON.stringify(evaluation, null, 2)}\n`);
writeGenerated("04_可运行程序/安装说明.md", installGuide(sha256(installerPath)));

scanForSecrets();
verifyExactContents([
  ...copies.map(([, destination]) => destination),
  "提交说明.md",
  "03_技术与评测/评测结果.json",
  "04_可运行程序/安装说明.md",
]);
createZip();

console.log(`Created ${zipPath}`);
console.log(`Files: ${walk(packageDirectory).length}; ZIP bytes: ${statSync(zipPath).size}; SHA-256: ${sha256(zipPath)}`);

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

function verifyExactContents(expectedRelativePaths) {
  const expected = expectedRelativePaths.map(normalizePath).sort();
  const actual = walk(packageDirectory).map((path) => normalizePath(relative(packageDirectory, path))).sort();
  const missing = expected.filter((path) => !actual.includes(path));
  const extras = actual.filter((path) => !expected.includes(path));
  if (missing.length || extras.length) {
    throw new Error(`Unexpected submission contents. Missing: ${missing.join(", ") || "none"}; extras: ${extras.join(", ") || "none"}`);
  }
}

function scanForSecrets() {
  const findings = [];
  const textExtensions = new Set([".html", ".json", ".md", ".txt"]);
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

function submissionGuide() {
  return `# Chroni：面向大学项目制学习的本地学习执行 Agent

Chroni 不替学生完成作业。它把课程通知、截图、文档、表格和日历转成有来源的 Learning Mission：目标、交付物、完成标准、里程碑、今日行动、产出证据与阶段检查点，并依据真实反馈调整下一步。

核心闭环：**Ground → Plan → Act → Verify → Adapt**。模型负责提出候选，本地系统负责事实校验、约束、持久化、工具执行、回退和状态变更；桌宠是低打扰的环境式交互入口。

## 建议评审顺序

1. 打开根目录的 **Chroni_GOAI_2026_参赛作品说明.pdf**。
2. 查看 **01_产品展示/Learning_Mission控制台.png**，再查看今日执行、执行 Agent 和架构图。
3. 按 **02_演示材料/三分钟演示脚本.md** 体验三个闭环场景；其中合成产出证据只用于演示哈希登记，不是课程答案或真实学生成果。
4. 查看 **03_技术与评测** 中的技术方案、评测报告和原始结果。
5. Windows 评审环境可安装 **04_可运行程序/Chroni-0.1.4-win-x64-setup.exe**。

开源仓库：https://github.com/miracle121388-a11y/chroni
`;
}

function installGuide(installerHash) {
  return `# Windows 安装说明

1. 双击 **Chroni-0.1.4-win-x64-setup.exe**。
2. 如 Windows SmartScreen 提示，请选择“更多信息”后确认运行。当前内测安装包尚未购买 Authenticode 代码签名证书。
3. 启动 Chroni 后，可直接使用 GOAI 离线演示；该演示不需要 API Key 或网络。
4. 如需体验真实模型增强，可在应用设置中填写 DeepSeek 的 OpenAI-compatible 配置。

安装包 SHA-256：${installerHash}
`;
}
