# Chroni 产品化审计与路线图

更新时间：2026-07-22
审计基线：Chroni `v0.1.4`

## 1. 本轮边界

本轮目标是在不修改 Chroni 产品功能的前提下，降低普通用户的下载、安装、首次体验、模型配置、排错和反馈门槛。

本轮不会新增 Relay Server、官方试用额度、登录、云同步、订阅、移动端，也不会修改现有 Agent、planner、risk、OCR、parser、桌宠、日程或提醒逻辑。官方试用模式需要真实后端、额度存储、限流、隐私政策和持续运维，不能只在客户端放一个入口，更不能内置服务商 API Key。

## 2. 当前用户链路

```text
GitHub Releases 下载
-> Windows Setup / Portable 或 macOS DMG
-> 启动后看到桌宠
-> 左键桌宠打开日程抽屉
-> 在控制中心快速输入，或拖入文件/图片
-> 本地解析与 OCR
-> 本地规则抽取，或用户配置的 OpenAI-compatible 模型增强抽取
-> 核对 DDL 与待确认项
-> 检查并启用 TaskPlan
-> Agent 生成今日时间块
-> 桌宠、气泡、日程抽屉和系统通知提醒
```

## 3. 当前门槛审计

| 项目 | 当前状态 | 普通用户门槛 | 本轮处理 |
| --- | --- | --- | --- |
| Windows 安装 | 已有 NSIS Setup 和 Portable | 未签名版本可能触发 SmartScreen；用户不理解两个版本区别 | 安装 FAQ、校验说明、推荐选择 |
| macOS 安装 | 已有 Universal DMG/ZIP | 未公证版本可能触发 Gatekeeper；用户不清楚安全打开方式 | 安装 FAQ、来源与校验说明 |
| 首次启动 | 直接进入桌宠和控制中心 | 无应用内 onboarding，用户不知道第一步做什么 | 提供 3 分钟指南和可拖入示例材料 |
| 无 API Key | 本地规则可处理结构明确的 DDL | README 提到能力，但体验边界不够集中 | 明确 local-only 路径、适用范围和验证方法 |
| 用户自带 Key | 偏好 -> 高级 -> 大模型 API | 需要理解 Base URL、模型、费用和数据发送范围 | 独立模型模式指南和 DeepSeek 配置步骤 |
| 材料确认 | 支持抽取预览、直接填入、待确认项 | 用户可能混淆预览与保存 | 快速指南中先预览、再填入、再确认 |
| 今日计划入口 | 控制中心默认打开“每日任务” | 已符合主要入口目标，但需要说明 DDL 与每日任务的关系 | 在快速指南中固定操作顺序 |
| Demo Mode | 没有隔离式应用内 Demo Mode | 录屏或试用需要自己准备材料 | 新增仓库级示例材料，不写入或污染用户数据 |
| 反馈入口 | 有 GitHub Issue 模板与安全报告 | 应用内无独立“帮助与反馈”页 | README 与用户文档集中入口，新增体验反馈模板 |
| 安装 FAQ | README 有简要提示 | 缺少完整分平台处理流程 | 新增 `docs/user/install-faq.md` |
| 隐私说明 | README、SECURITY 和运行状态有分散说明 | 用户难以一次看清本地/联网边界 | 新增 `docs/user/privacy.md` |
| 版本与更新 | 运行状态展示版本、检查更新、发布页入口 | 用户不一定知道入口 | 在快速指南和排障文档中明确路径 |
| 诊断导出 | 可打开本地数据目录，没有一键脱敏诊断包 | 手工反馈容易夹带隐私 | 提供安全收集清单；一键诊断列入 P1 |

## 4. 当前实现位置

| 能力 | 主要位置 |
| --- | --- |
| 用户自带 LLM 配置 UI | `apps/desktop/src/renderer/src/main.tsx` 的偏好页 |
| LLM 设置合并与环境变量优先级 | `apps/desktop/src/llm-settings.ts` |
| OpenAI-compatible 请求 | `apps/desktop/src/llm-client.ts` |
| API Key 安全存储 | `apps/desktop/src/main.ts`、`apps/desktop/src/store.ts` |
| 文件解析、OCR 与抽取 | `apps/desktop/src/intake.ts` |
| 桌宠拖入与动作反馈 | `apps/desktop/src/renderer/src/main.tsx`、`apps/desktop/src/shared/pet-actions.ts` |
| 今日计划与时间轴 | `apps/desktop/src/renderer/src/components/DailyPlanner.tsx` |
| Deadline Agent | `apps/desktop/src/agent/` |
| 版本展示与自动更新 | `apps/desktop/src/updater.ts`、运行状态页 |
| 安装与发布 | `apps/desktop/electron-builder.config.cjs`、`.github/workflows/release-build.yml` |

## 5. 安装包状态

- Windows：提供 x64 Setup 和 Portable。Setup 支持选择安装目录、桌面快捷方式、开始菜单和卸载。
- macOS：提供同时支持 Intel 与 Apple Silicon 的 Universal DMG/ZIP。
- Release：提供 `SHA256SUMS.txt`、更新元数据和 GitHub build provenance attestation。
- 当前公开构建可能没有 Windows 商业代码签名或 macOS Developer ID 公证。系统警告不等于文件损坏，但用户只能从项目官方 Releases 下载并核对校验和。
- 应用内“运行状态”显示版本号、检查更新、下载进度、重启安装和 GitHub 发布页入口。

## 6. 无 Key 与模型模式现状

当前产品实际有两种工作方式：

1. 本地规则：不填写 Key，或关闭“启用 LLM 抽取”。结构明确的标题、日期和时间可以本地处理；复杂跨段语义能力有限。
2. 用户自带 Key：使用 OpenAI-compatible 服务。Key 在支持的系统上通过 Electron `safeStorage` 加密，模型失败时回退本地规则。

当前没有官方试用额度，也没有 Chroni Relay。任何文档和推广内容都不应声称“注册送次数”“每日免费额度”或“无需 Key 使用官方模型”。

## 7. 三分钟核心闭环验收

不修改功能时，可达到的低门槛验收路径：

1. 用户从 Latest Release 下载对应安装包。
2. 启动 Chroni，不配置 API Key。
3. 从 `examples/demo/` 选择示例 TXT，拖到桌宠或控制中心。
4. Chroni 使用本地规则识别明确 DDL，并显示桌宠处理反馈。
5. 用户核对 DDL，打开规划详情并启用计划。
6. 进入 Agent 点击“帮我安排今天”，在“每日任务”查看结果。
7. 用户知道如何清理示例数据、配置 DeepSeek、检查更新或提交反馈。

该路径依赖示例材料使用明确的相对时间，且不会假装调用了未配置的模型。

## 8. 推广素材缺口

| 素材 | 当前 | 建议 |
| --- | --- | --- |
| 今日时间轴截图 | 已有 | 保持版本号一致 |
| Agent 工作台截图 | 已有 | 使用无真实个人信息的示例数据 |
| 桌宠六状态 | README 已展示 | 录屏补充拖入、阅读、完成动作 |
| 安装步骤 | 缺少 | 按 Windows/macOS 分别录制 |
| 抽取确认卡片 | 缺少标准素材 | 使用 `examples/demo/` 统一录制 |
| 模型设置 | 缺少 | Key 输入框必须保持空白或打码 |
| 15/30 秒脚本 | 缺少 | 见 `docs/marketing/xiaohongshu-launch-plan.md` |

## 9. 优先级清单

### P0：本轮完成

- 产品化审计与路线图。
- 普通用户 3 分钟快速开始。
- 可直接拖入的三组演示材料。
- Windows/macOS 安装 FAQ。
- 本地规则与用户自带 Key 模式说明。
- 隐私与数据流说明。
- 故障排查和安全反馈流程。
- 小红书录屏与发布素材清单。
- README 集中入口和 GitHub 体验反馈模板。

### P1：后续增量功能

| 任务 | 预计修改位置 | 验收标准 | 回滚方式 |
| --- | --- | --- | --- |
| 首次启动引导 | renderer、store、types、tests | 新用户 3 分钟完成首个 DDL 和今日计划；老用户不出现 | 特性开关关闭 onboarding |
| 应用内 Demo Mode | store、intake、renderer、tests | Demo 数据可重置、可清除、不混入真实来源 | 删除 demo namespace 与入口 |
| 帮助与反馈页 | renderer、preload、main、tests | 可打开文档/Issue、复制脱敏诊断 | 移除独立导航项 |
| 一键诊断导出 | main、preload、renderer、tests | 不含 Key、原文和完整路径 | 保留手工诊断流程 |
| 今日手账 Markdown | agent、store、renderer、tests | 可本地生成、编辑、导出 | 停用入口，不迁移核心数据 |

### P2：需要服务端和运营能力

| 任务 | 前置条件 | 关键风险 |
| --- | --- | --- |
| 官方试用 Relay | 部署、域名、数据库、密钥管理、监控、隐私政策 | 成本滥用、服务可用性、数据合规 |
| 三模式路由 | Relay 稳定后再接客户端 | 迁移、额度错误、离线回退 |
| 登录与云同步 | 账号体系、加密、删除机制 | 数据泄露、冲突合并 |
| 订阅收费 | 法务、支付、退款和客服 | 合规与持续运营 |
| 签名和公证自动化 | Windows 证书、Apple Developer | 证书安全与续期 |

## 10. 官方试用架构建议

后续若实施官方试用，必须采用：

```text
Chroni Desktop -> Chroni Relay -> Model Provider
```

客户端只保存匿名设备令牌，不得包含真实服务商 Key。Relay 至少需要设备额度、分钟限流、输入上限、请求超时、最小日志、原文不落盘、密钥轮换和停机回退。上线前应完成独立威胁建模和费用压测。

## 11. 验收与质量门槛

- 本轮 `git diff` 不应包含 `apps/desktop/src` 功能代码改动。
- 文档不出现真实 API Key、用户原文、私人路径或虚构的官方试用额度。
- README 和文档中的相对链接全部存在。
- 示例材料不包含真实学校、姓名、邮箱、群号或企业信息。
- 现有 `pnpm run check` 通过，证明文档整理没有破坏产品回归。
- 安装指南分别覆盖 Setup、Portable、DMG、SmartScreen、Gatekeeper 和 SHA-256。

### 2026-07-22 实际验证结果

| 命令或检查 | 结果 |
| --- | --- |
| 新增 Markdown 相对链接检查 | 通过，10 个入口文档的本地链接均存在 |
| Issue Template YAML 解析 | 通过 |
| API Key / 长 Bearer Token 模式扫描 | 通过，未发现嵌入密钥 |
| `npx pnpm@11.7.0 run typecheck` | 通过 |
| `npx pnpm@11.7.0 run build` | 通过 |
| `npx pnpm@11.7.0 run check` | 未完全通过：229 项测试中 225 通过、3 失败、1 跳过 |

当前 3 项失败均位于未被本轮修改的 `apps/desktop/test/core.test.mjs` 抽取回归：

- `intake persists model tasks, detailed plans, and pending clarifications together`
- `DeepSeek extraction processes every source independently`
- `local rules fill deadlines that the model missed within the same source`

失败表现为本地规则额外合并交付物、将“通知：”前缀带入标题，以及未为同来源补齐模型漏掉的截止项。单独复跑后稳定复现。由于修复会改变抽取功能，本轮只将其列为下一正式 Release 前的阻塞项，不在文档产品化任务中调整算法或测试预期。

基础演示材料 `01-course-assignment.txt` 已通过当前本地规则真实执行检查，能够生成 1 条“明天 20:00”的 DDL。复杂示例定位为模型增强和待确认演示，不承诺纯规则生成完美标题。

## 12. 风险与回滚

- 文档与产品不一致：每次 Release 将用户文档纳入发布检查。
- 示例日期过期：示例使用“明天”“本周日”等相对日期，并在文档中提示测试时间边界。
- 模型名称变化：只引用服务商官方文档，并在指南中提醒以当前模型列表为准。
- 用户误传隐私：反馈模板强制要求移除 Key、原文和真实路径。
- 本轮回滚：所有新增内容均为文档、示例和 GitHub 模板，可单独回退，不涉及用户数据迁移。
