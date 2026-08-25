# Chroni GOAI 2026 复赛完成报告

生成日期：2026-08-25（Asia/Shanghai）

## 1. 结论

Chroni 0.1.4 已从“桌宠 DDL 管理器”升级为**面向大学项目制学习的本地学习执行 Agent**：

> 不替学生完成作业，而是把课程要求转化为可执行、可验证、可调整的学习过程。

产品闭环为 `Ground → Mission → Plan → Act → Verify → Adapt`。课程材料先形成带来源的 Learning Mission，再连接 TaskPlan、今日时间块、产出证据与阶段检查点；模型只提出候选，本地确定性系统掌握事实、约束、工具和状态变更权。桌宠作为低打扰环境式入口，不再承担产品核心立意。

```text
GOAI SEMIFINAL BUILD: READY FOR SUBMISSION
```

这里的 `READY` 只表示本地源码、隔离演示、合成评测、真实截图、Windows 安装包、PDF 与提交附件已经通过本轮门禁，不表示已获得奖项、完成学校合作、真实学习成效研究、商业签名或 macOS 公证。

## 2. 本轮产品升级

| 升级项 | 已实现结果 |
| --- | --- |
| Learning Mission | 来源、目标、交付物、完成标准、里程碑、进度、风险、证据和检查点统一建档 |
| 证据闭环 | 支持说明证据与本地文件 SHA-256；文件路径和内容不进入持久状态 |
| 阶段反馈 | 检查点可绑定里程碑，并回写 TaskPlan 步骤、Mission 进度和下一步 |
| 今日执行 | Agent 根据风险、里程碑、容量生成工作块；时间轴支持真实时长、缩放、拖动、冲突分栏和历史回顾 |
| 执行 Agent | 汇总下一步、今日工作块、高风险任务、覆盖率、规划来源、工具结果与结构化 Trace |
| 主动追问 | 清晰材料先创建基础计划；只在必需字段缺失或来源冲突时阻断，完善性问题后置 |
| 桌宠交互 | 左键进入任务视图，支持拖放材料、提醒状态与 Windows/macOS 一致的移动边界 |
| 本地 API | 增加 Mission 查询、说明证据、检查点和证据删除端点，并保留令牌鉴权、限流和日志脱敏 |

## 3. 评测与工程结果

评测生成时间：`2026-08-25T08:06:00.239Z`。数据集为 60 条固定时钟合成案例，时区 `Asia/Shanghai`，每例运行一次，不调用模型或网络。

| 指标 | 结果 |
| --- | ---: |
| Task Precision / Recall / F1 | 100.0% / 100.0% / 100.0% |
| 标题归一化准确率 | 95.5% |
| 日期 / 时间精确匹配 | 100.0% / 100.0% |
| 交付物 F1 | 83.9% |
| 来源证据命中率 | 100.0% |
| 必要追问 / 冲突安全延迟 | 100.0% / 100.0% |
| TaskPlan 本地校验 / 依赖环检出 | 100.0% / 100.0% |
| Mission 创建 / 来源关联 | 100.0% / 100.0% |
| Mission 交付物 / 完成标准 / 里程碑对齐 | 100.0% / 100.0% / 100.0% |
| 证据 / 检查点持久化 / 里程碑回写 | 100.0% / 100.0% / 100.0% |
| intake p50 / p95 | 28.34 ms / 55.42 ms |
| Mission 生命周期 p50 / p95 | 46.06 ms / 53.89 ms |
| 完整离线案例 p50 / p95 | 64.42 ms / 97.42 ms |
| 抽样峰值 RSS | 77 MiB |
| 离线成功率 | 100.0% |

这些指标证明的是**合成数据上的确定性状态闭环**，不是 DeepSeek 准确率，也不代表真实学生学习成效、学术质量或真实 OCR 总体性能。原始逐例结果、数据集哈希、失败表和环境信息位于 `benchmarks/goai-v1/reports/latest.json`。

## 4. 最终验证

| 门禁 | 本机结果 |
| --- | --- |
| `pnpm run check` | 通过：typecheck、desktop tests、gateway tests、production build 均退出 0 |
| Desktop tests | 248 项：247 pass、0 fail、1 skip |
| Gateway tests | 4 pass、0 fail |
| `pnpm run eval:goai` | 60 cases；Task F1 100.0%；Mission 闭环门槛全部通过；offline 100.0% |
| `pnpm run site:check` | 44 ids、37 references、3 installers，全部通过 |
| `pnpm run build:goai` | 扫描 219 个 renderer 文件，无受限 XIAOTONG 路径或栅格素材 |
| `pnpm run notices:generate` | 66 个生产依赖及许可证条目 |
| Windows package | NSIS 安装版与 portable 均在本机生成 |
| PDF 视觉检查 | 8 页全部渲染检查，字体、表格、截图和分页无截断 |

## 5. 可运行产品

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `Chroni-0.1.4-win-x64-setup.exe` | 149,076,957 bytes | `21ca10e79fc6350a1f522cb7cd115e43b3c2cd1d84396c03249af602bdd6f1c2` |
| `Chroni-0.1.4-win-x64-portable.exe` | 148,748,762 bytes | `afea6827d3c5efaf09400513454536f7d50d87b56c4567bc4f562299b5935c15` |

产物位于 `apps/desktop/dist-electron/`，校验清单为 `SHA256SUMS.txt`。两个 EXE 的 Authenticode 状态均为 `NotSigned`，Windows 可能显示 SmartScreen；材料没有把它描述为已签名产品。macOS universal 构建工作流已经配置，但本 Windows 主机没有伪造 macOS 产物。

## 6. 三分钟演示

1. 进入 **GOAI 演示**并加载场景 A，全程无需 API Key，数据写入独立合成 Store。
2. 打开 **学习任务**，展示数据库课程项目的来源、PDF/SQL 交付物、完成标准和 TaskPlan 里程碑。
3. 登记隔离的合成说明证据与检查点，展示证据覆盖、里程碑状态、进度和下一步同步变化。
4. 打开 **今日执行**，展示 Agent 工作块的真实时长、颜色、缩放和可调整时间轴。
5. 打开 **执行 Agent**，展示风险、容量、覆盖率、规划来源、工具结果与 Verify/Adapt Trace。
6. 场景 B 只追问缺失截止；场景 C 不静默覆盖冲突时间，必须由用户选择来源。
7. 导出脱敏证据，退出 Demo 并删除合成目录，恢复主 Store。

完整 180 秒与 60 秒脚本见 `docs/goai/04-demo-video-script.md`。`examples/goai/synthetic-output-evidence.txt` 只用于演示文件哈希登记，不是课程答案或真实学生成果。

## 7. 评委评分映射

| 手册维度 | 主要证明 |
| --- | --- |
| 行业价值 25 | 大学项目制学习从“课程要求”到“真实执行与反馈”的断层；首个聚焦场景为数据库课程项目 |
| Agent 与闭环 25 | Ground/Mission/Plan/Act/Verify/Adapt、工具调用、证据、检查点、冲突裁决和可审查 Trace |
| 产品与演示 20 | 三张真实当前界面、隔离无 Key Demo、Windows 安装包、180/60 秒脚本 |
| 技术深度 15 | 多格式 intake、OCR、结构化模型候选、本地校验、持久化、离线回退、可复现 runner |
| 安全合规 10 | 本地优先、密钥安全存储、提示注入边界、ZIP 防护、证据脱敏、未成年人/学术诚信边界 |
| 开源复用 5 | MIT、能力契约、本地 API、CI/Release、依赖许可证、威胁模型和贡献治理 |

保守自评与扣分依据见 `docs/goai/11-semifinal-judge-scorecard.md`。该文件用于暴露风险，不是对比赛结果的承诺。

## 8. 安全与教育边界

- 原始课程材料和模型输出都视为不可信候选；提示注入不能直接创建任务或调用工具。
- DOCX/XLSX 在解析前检查魔数、中央目录、条目数、64 MiB 展开配额、200 倍压缩比、加密和路径穿越。
- 本地文件证据使用流式 SHA-256、512 MiB 上限和变更检测；持久状态不保存绝对路径或文件正文。
- Key 使用系统安全存储；导出删除原文、路径、标题、证据/检查点正文和 Token。
- Chroni 不代写、不自动判定学术质量、不把“文件存在”冒充“学习完成”；最终完成仍由用户确认。
- GOAI/公开 Release 强制 `original` 素材模式，不打包受限 XIAOTONG 帧或捐赠码。

## 9. 已知限制与下一步

1. 交付物 F1 83.9%、标题归一化 95.5%，字段抽取不能描述为“完美”。
2. 尚无带凭据的 DeepSeek 基准、真实图片 OCR 大样本、长时间稳定性或置信区间。
3. 尚无经知情同意的真实学生试点，因此不宣称提升成绩、按时率或学习效果。
4. Windows 未购买代码签名证书；macOS 尚需在真实 runner 完成签名、公证和双端交互回归。
5. 真实课程材料研究必须最小化采集、匿名化、可撤回，并优先采用过程指标而非成绩宣称。

## 10. 版本状态

- Branch：`feat/goai-2026`
- Base HEAD：`68cd9a713f706437ce0c1a42dd47274478d0ae95`
- Node.js：`v24.12.0`
- pnpm：`11.19.0`
- 工作区：dirty；当前附件包含经过校验的选定源文件与产物，不冒充已经推送的 GitHub Release。
- 未收到 commit/push 指令，因此本轮没有擅自改写 Git 历史或发布远端版本。

```text
GOAI SEMIFINAL BUILD: READY FOR SUBMISSION
```
