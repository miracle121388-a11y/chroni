# Chroni GOAI 2026 复赛评审入口

## 20 秒定位

**Chroni 是面向大学项目制学习的本地学习执行 Agent。**

它不替学生完成作业，而是把课程通知、项目说明、截图和文档转化为可追溯的 Learning Mission，并持续连接：

```text
理解要求 → 拆解路径 → 安排今日 → 留下证据 → 每日回顾 → 动态调整
```

模型提出候选，本地系统掌握事实、状态、工具、证据和失败回退；桌宠是低打扰的桌面入口，而不是产品的全部。

## 与初版相比

对比基线是 `v0.1.4`（commit `225f63b`）。初版重点解决“材料 → DDL → TaskPlan → 时间轴 → 提醒”；`v0.2.4` 进一步完成 Learning Mission、证据/检查点、智能整理、语义优先级与容量自适应、14 日回顾趋势、托管模型入口、隔离评测、安全与发布工程。完整逐项差异见 [12-semifinal-update.md](./12-semifinal-update.md)。

## 三分钟评审路径

1. 安装附件中的 Windows 版本，打开 **智能整理**。
2. 导入 `A_明确任务.txt`，观察明确的任务被直接整理，不先弹出无意义问题。
3. 打开 **学习任务**，检查来源、目标、交付物、完成标准、里程碑、证据与阶段检查点。
4. 打开 **今日执行**，查看 Agent 如何把步骤按真实时长放入时间轴；重叠任务会分栏，窄窗口不截断标题。
5. 打开 **每日回顾**，查看活动轨迹、完成率、总结、个人记录和未完成项顺延；切换日期可回顾历史或查看未来计划。
6. 载入 **连续使用与动态干预** 示例，验证期末作业优先于稍早的社团初稿、连续未完成触发 15 分钟重新启动，以及前后 7 天指标对比。
7. 导入 B/C 示例，验证缺失信息只问一个阻断项，多来源日期冲突不会被模型静默覆盖。
8. 运行 `pnpm run eval:goai` 和 `pnpm run check`，复现离线评测、自动化测试和生产构建。

真实模型增强是可选项。未配置 DeepSeek 时，结构明确的示例仍可通过本地规则完成；模型不可用时会回退，不会让评委卡在 Key 或网络上。

## 评分证据矩阵

| 评审维度 | 可直接验证的证据 |
| --- | --- |
| 行业场景价值 25% | 面向项目制学习中“要求分散、计划不落地、过程不可见、反馈不连续”的真实问题；每日执行和回顾形成持续使用价值。 |
| Agent 与任务闭环 25% | 多格式输入、意图/来源校验、TaskPlan、工具排程、证据/检查点、每日回顾、风险重算与结构化 Trace 可连续演示。 |
| 产品体验与 Demo 20% | 可安装 Electron 产品、首次体验、智能整理、学习任务、今日执行、每日回顾和桌宠入口；成功与异常分支都有明确反馈。 |
| 技术实现深度 15% | 本地解析/OCR、DeepSeek-compatible 候选、确定性验证、版本化计划、容量调度、SHA-256 证据、typed IPC、回环 API 与跨平台构建。 |
| 安全合规 10% | Local-first、最小化出站、系统安全存储、默认脱敏、合成数据、人工确认、威胁模型和教育边界。 |
| 开放复用 5% | MIT 自研代码、能力契约、benchmark、示例数据、Trace/证据格式、API 文档、CI 和 Release 工作流。 |

## 关键材料

| 主题 | 入口 |
| --- | --- |
| v0.1.4 → v0.2.4 更新说明 | [12-semifinal-update.md](./12-semifinal-update.md) |
| 项目立意与教育价值 | [01-project-introduction.md](./01-project-introduction.md) |
| 架构、数据流与 Learning Mission | [03-technical-solution.md](./03-technical-solution.md) |
| 真实演示脚本 | [04-demo-video-script.md](./04-demo-video-script.md) |
| 开源与 IP 边界 | [05-open-source-and-ip.md](./05-open-source-and-ip.md) |
| 安全、隐私与教育边界 | [06-security-and-privacy.md](./06-security-and-privacy.md) |
| 可复现评测 | [07-evaluation-report.md](./07-evaluation-report.md) |
| 一页纸 | [10-one-pager.md](./10-one-pager.md) |
| 评委建议专项优化与连续案例 | [13-judge-feedback-optimization.md](./13-judge-feedback-optimization.md) |

## 可复现命令

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm run eval:goai
pnpm run build
pnpm run package:submission:windows
pnpm run submission:goai
```

带真实模型的评测是显式 opt-in：只有用户主动配置 DeepSeek 后才运行 `pnpm run eval:goai:model`。默认评测不会读取 API Key，也不访问网络。

## 当前事实边界

- 当前产品版本为 `0.2.4`，最终附件名为 `Chroni_GOAI_2026_复赛最终提交.zip`。
- 复赛安装包必须通过 `product/xiaotong` 构建清单校验，包含动态桌宠、完整许可证和可达 About；付费或其他商业发行仍需另行取得书面许可或替换自有素材。
- 精确源码提交、构建环境、评测数据集和安装包哈希以附件根目录验证文件为准。
- 项目不声称自研基础模型、学校合作、真实学习成效、生产用户规模、已签名 Windows 安装包或已公证 macOS 安装包。
