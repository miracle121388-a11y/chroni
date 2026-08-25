# Chroni GOAI 2026 复赛评审入口

## 20 秒定位

**Chroni 是面向大学项目制学习的本地学习执行 Agent。**

它不替学生完成作业，而是把课程通知、项目说明、截图和文档转化为一条可追溯的 Learning Mission：目标、交付物、完成标准、里程碑、今日行动、产出证据与阶段检查点。DDL 是任务触发器，桌宠是 Agent 的环境交互界面，真正的产品核心是：

```text
Ground → Plan → Act → Verify → Adapt
```

## 三分钟评审路径

1. 安装依赖并运行 `pnpm run dev`，在控制中心打开 **GOAI 演示**。全过程不需要 API Key 或网络。
2. 运行场景 A“数据库课程项目”，随后进入 **学习任务**：检查来源、目标、PDF/SQL 交付物、完成标准、里程碑、隔离演示证据和阶段检查点。
3. 进入 **今日执行**：查看计划如何按真实时长落入时间轴；再进入 **执行 Agent**，查看风险、覆盖率、本地工具动作、验证结果与 Trace。
4. 运行场景 B，验证只有真正缺失的截止时间才会追问；运行场景 C，验证多来源截止时间冲突由用户裁决。
5. 在 **执行 Agent** 导出默认脱敏证据；回到 **GOAI 演示** 选择“退出演示”，合成状态会被删除并恢复主 Store。
6. 运行 `pnpm run eval:goai` 复现 60 条离线评测，运行 `pnpm run check` 复现类型、测试与生产构建。

示例文件位于 `examples/goai/`，确定性评测集位于 `benchmarks/goai-v1/`。场景 A 的产出证据和检查点均为明确标注的隔离合成数据，不代表真实学生或学校使用结果。

## 评分证据矩阵

| 评审关注 | 可直接验证的产品证据 |
| --- | --- |
| 行业/教育价值 | Learning Mission 将课程要求、执行过程、产出证据和反思放进同一任务档案；产品明确拒绝代写与虚假完成。 |
| Agent 与闭环 | 材料输入、来源校验、TaskPlan、每日排程、本地工具执行、证据/检查点、风险重算与 Trace 可连续演示。 |
| 产品与 Demo | Windows/macOS Electron 产品、桌宠拖放、控制中心、日程抽屉、无 Key 隔离 Demo、真实产品截图。 |
| 技术深度 | 多格式解析/OCR、LLM + 确定性验证、版本化计划、容量调度、SHA-256 证据、typed IPC、回环 API、失败回退。 |
| 安全与可追溯 | Local-first、来源证据、用户确认、密钥安全存储、默认脱敏导出、合成数据标识、威胁模型与 IP 清单。 |
| 开源与复用 | MIT 自研代码、能力契约、60 条评测、自动化测试、CI、双端打包与本地 API 文档。 |

## 评审文档

| 主题 | 入口 |
| --- | --- |
| 最终完成状态与门禁 | [GOAI_COMPLETION_REPORT.md](../../GOAI_COMPLETION_REPORT.md) |
| 项目立意与教育价值 | [01-project-introduction.md](./01-project-introduction.md) |
| 11 页路演结构 | [02-pitch-deck-outline.md](./02-pitch-deck-outline.md) |
| 架构、数据流与 Learning Mission | [03-technical-solution.md](./03-technical-solution.md) |
| 180/60 秒真实演示脚本 | [04-demo-video-script.md](./04-demo-video-script.md) |
| 开源与 IP 边界 | [05-open-source-and-ip.md](./05-open-source-and-ip.md) |
| 安全、隐私与未成年人边界 | [06-security-and-privacy.md](./06-security-and-privacy.md) |
| 机器生成评测 | [07-evaluation-report.md](./07-evaluation-report.md) |
| 评委问答 | [08-judge-qa.md](./08-judge-qa.md) |
| 路线图与行业需求 | [09-roadmap-and-industry-needs.md](./09-roadmap-and-industry-needs.md) |
| 一页纸 | [10-one-pager.md](./10-one-pager.md) |
| 复赛评分审计 | [11-semifinal-judge-scorecard.md](./11-semifinal-judge-scorecard.md) |
| v0.2.0 复赛更新说明 | [12-semifinal-update.md](./12-semifinal-update.md) |
| Agent 能力契约 | [agent-capability-contracts.md](./agent-capability-contracts.md) |
| 基线审计 | [audit-baseline.md](./audit-baseline.md) |
| 威胁模型 | [../security/threat-model.md](../security/threat-model.md) |

## 可复现命令

```bash
pnpm run check
pnpm run eval:smoke
pnpm run eval:goai
pnpm run build:goai
pnpm run goai:assets:check
pnpm run notices:generate
pnpm run submission:goai
```

带真实模型的评测是显式 opt-in：`pnpm run eval:goai:model` 在没有凭据时不会访问网络。GOAI 安装包使用 `pnpm run package:goai:windows` 或 `pnpm run package:goai:macos` 构建。

## 当前事实边界

- 仓库版本为 `0.2.0`，本轮正式附件为 `Chroni_GOAI_2026_复赛提交.zip`。
- 无 Key演示、Learning Mission、证据与检查点、60 条离线评测、脱敏证据导出和原始自研图标 GOAI 构建已经实现。
- 项目不声称拥有自研基础模型、真实生产用户数、学校合作、学习成绩提升、收入、融资、已签名 Windows 安装包或已公证 macOS 安装包。
- OCR 与真实模型的质量必须通过后续真实、获授权数据集继续验证；当前结果与未测项以评测报告和完成报告为准。
