# Chroni 产品化审计与路线图

更新时间：2026-08-28
审计基线：Chroni `v0.2.3`

## 1. 本轮边界

本轮目标是在不修改 Chroni 产品功能的前提下，降低普通用户的下载、安装、首次体验、模型配置、排错和反馈门槛。

初始产品化轮次没有新增 Relay Server、登录、云同步、订阅或移动端。`v0.2.3` 将真实 LLM Gateway 升级为公开桌面服务：DeepSeek Key 只在服务端，客户端不持有任何共享凭据；网关具备来源网络和全局限流、超时、参数白名单、脱敏日志与健康检查。

## 2. 当前用户链路

```text
GitHub Releases 下载
-> Windows Setup / Portable 或 macOS DMG
-> 启动后看到桌宠
-> 左键桌宠打开日程抽屉
-> 在控制中心快速输入，或拖入文件/图片
-> 本地解析与 OCR
-> 默认 Chroni 智能服务、本地规则回退，或用户配置的 OpenAI-compatible 模型
-> 核对 Learning Mission 与必要待确认项
-> 检查并启用 TaskPlan
-> Agent 生成今日时间块
-> 桌宠、气泡、日程抽屉和系统通知提醒
```

## 3. 当前门槛审计

| 项目 | 当前状态 | 普通用户门槛 | 本轮处理 |
| --- | --- | --- | --- |
| Windows 安装 | 已有 NSIS Setup 和 Portable | 未签名版本可能触发 SmartScreen；用户不理解两个版本区别 | 安装 FAQ、校验说明、推荐选择 |
| macOS 安装 | 已有 Universal DMG/ZIP | 未公证版本可能触发 Gatekeeper；用户不清楚安全打开方式 | 安装 FAQ、来源与校验说明 |
| 首次启动 | 直接进入桌宠和控制中心 | 无应用内 onboarding，用户不知道第一步做什么 | 提供 3 分钟指南、可拖入示例材料和隔离 GOAI Demo |
| 无 API Key | 默认托管模型可直接使用完整智能能力 | 公共服务需要成本与滥用边界 | 服务端密钥、来源网络与全局额度、供应商预算保护、本地规则回退 |
| 用户自带 Key | 偏好 -> 高级 -> 大模型 API | 需要理解 Base URL、模型、费用和数据发送范围 | 独立模型模式指南和 DeepSeek 配置步骤 |
| Chroni 智能服务 | 偏好 -> 高级 -> 智能模型服务 | 用户不应接触 DeepSeek 主密钥或配置凭据 | Zeabur 网关、零配置客户端、来源网络与全局限流、脱敏日志 |
| 材料确认 | 支持抽取预览、直接填入、待确认项 | 用户可能混淆预览与保存 | 快速指南中先预览、再填入、再确认 |
| 学习执行入口 | 控制中心默认打开“学习任务” | 需要同时看清来源、完成标准、里程碑、证据与反馈 | 以 Learning Mission 为主入口，并连接今日执行 |
| Demo Mode | 已有隔离式应用内 GOAI Demo | 首次体验不需要准备材料或 API Key | 场景 A/B/C 覆盖主链路、缺失信息和来源冲突；退出后清除合成状态 |
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
| 公开 LLM 网关 | `apps/gateway/`、`zbpack.chroni-api.json` |
| API Key 安全存储 | `apps/desktop/src/main.ts`、`apps/desktop/src/store.ts` |
| 文件解析、OCR 与抽取 | `apps/desktop/src/intake.ts` |
| 桌宠拖入与动作反馈 | `apps/desktop/src/renderer/src/main.tsx`、`apps/desktop/src/shared/pet-actions.ts` |
| 今日计划与时间轴 | `apps/desktop/src/renderer/src/components/DailyPlanner.tsx` |
| 学习执行 Agent | `apps/desktop/src/agent/`、`apps/desktop/src/learning-mission.ts` |
| 版本展示与自动更新 | `apps/desktop/src/updater.ts`、运行状态页 |
| 安装与发布 | `apps/desktop/electron-builder.config.cjs`、`.github/workflows/release-build.yml` |

## 5. 安装包状态

- Windows：提供 x64 Setup 和 Portable。Setup 支持选择安装目录、桌面快捷方式、开始菜单和卸载。
- macOS：提供同时支持 Intel 与 Apple Silicon 的 Universal DMG/ZIP。
- Release：提供 `SHA256SUMS.txt`、更新元数据和 GitHub build provenance attestation。
- 当前公开构建可能没有 Windows 商业代码签名或 macOS Developer ID 公证。系统警告不等于文件损坏，但用户只能从项目官方 Releases 下载并核对校验和。
- 应用内“运行状态”显示版本号、检查更新、下载进度、重启安装和 GitHub 发布页入口。

## 6. 无 Key 与模型模式现状

当前产品实际有三种工作方式：

1. 本地规则：关闭“启用智能模型”，或在托管服务不可用时自动使用。结构明确的标题、日期和时间可以本地处理；复杂跨段语义能力有限。
2. Chroni 智能服务：新安装默认启用，不要求 API Key、访问码或账号；Zeabur 网关固定 DeepSeek 模型并实施来源网络和全局额度。
3. 用户自带 Key：使用 OpenAI-compatible 服务。Key 在支持的系统上通过 Electron `safeStorage` 加密，模型失败时回退本地规则。

公共额度是公平使用保护，不承诺无限调用。推广内容必须说明限流、本地回退和当前未签名/未公证边界，不应声称永久免费或无限额度。

## 7. 三分钟核心闭环验收

不修改功能时，可达到的低门槛验收路径：

1. 用户从 Latest Release 下载对应安装包。
2. 启动 Chroni，不配置 API Key；默认托管模型已可用。
3. 从 `examples/demo/` 选择示例 TXT，拖到桌宠或控制中心。
4. Chroni 使用托管模型识别材料并显示桌宠处理反馈；断网或限流时使用本地规则。
5. 用户核对 Learning Mission，打开规划详情并启用计划。
6. 进入执行 Agent 点击“帮我安排今天”，在“今日执行”查看结果。
7. 用户知道如何清理示例数据、关闭托管模型、配置自定义 API、检查更新或提交反馈。

该路径不要求用户准备模型凭据；示例材料仍使用明确时间，保证服务不可用时也能完成本地回退。

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

- 文档、示例和提交附件不出现真实 API Key、Bearer Token、用户原文、私人路径或虚构额度。
- README、Release Notes、产品下载页、截图和安装包版本保持一致。
- `pnpm run check` 必须通过类型检查、Desktop 测试、Gateway 测试与生产构建。
- `pnpm run eval:goai` 必须输出逐例机器可读结果，并明确区分合成系统评测与真实模型/学习成效。
- 复赛与公开产品构建必须校验 `product/xiaotong` 清单、动态帧、原作许可证、附加条款、回链与 About 入口；商业发行前另行取得书面许可或替换素材。
- 正式复赛 ZIP 必须来自 clean worktree，写入提交 SHA、运行环境、安装包哈希、逐文件哈希和事实边界。
- 安装指南覆盖 Setup、Portable、DMG、SmartScreen、Gatekeeper、SHA-256 与签名/公证状态。

### 2026-08-25 最新验证基线

| 命令或检查 | 结果 |
| --- | --- |
| `pnpm run check` | 通过：typecheck、Desktop tests、Gateway tests、production build |
| Desktop tests | 278 项：277 pass、0 fail、1 skip |
| Gateway tests | 6 pass、0 fail |
| `pnpm run eval:goai` | 60 cases；离线成功率 100.0%；Mission 闭环门槛全部通过 |
| `pnpm run site:check` | 下载链接、DOM 引用和安装包映射通过 |
| `pnpm run package:submission:windows` | product/xiaotong 构建、219 张动态帧、About 与许可资源通过校验 |
| 提交材料扫描 | API Key、Bearer Token、本地用户路径和非清单文件均作为阻断项 |

标题归一化准确率 95.5%、交付物 F1 83.9%，因此项目不把字段抽取描述为“完美”。完整指标、运行环境和未测项见 `docs/goai/07-evaluation-report.md` 与最终附件中的 `PROJECT_VERIFICATION.json`。

## 12. 风险与回滚

- 文档与产品不一致：每次 Release 将用户文档纳入发布检查。
- 示例日期过期：示例使用“明天”“本周日”等相对日期，并在文档中提示测试时间边界。
- 模型名称变化：只引用服务商官方文档，并在指南中提醒以当前模型列表为准。
- 用户误传隐私：反馈模板强制要求移除 Key、原文和真实路径。
- 本轮回滚：所有新增内容均为文档、示例和 GitHub 模板，可单独回退，不涉及用户数据迁移。
