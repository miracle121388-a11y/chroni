# Changelog

Chroni 的重要用户可见变化记录在这里。版本号遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

暂无未发布的用户可见变更。

## [0.2.1] - 2026-08-26

### Added

- 新增 Microsoft Store AppX 与 Mac App Store MAS 构建入口、商店尺寸图标、Apple 隐私清单、MAS 沙盒权限和独立审核资料。
- 新增公开隐私政策页面，并从下载站和应用“运行状态”直接提供入口。
- 新增商店准备校验和手动商店构建工作流；缺失 Partner Center 或 Apple 签名身份时明确中止。

### Changed

- 控制中心恢复“今日执行、学习任务、任务来源、执行 Agent、偏好设置、运行状态”六个完整工作区，并优化窄窗口导航和中英文字体层级。
- Microsoft Store 与 Mac App Store 安装版改由系统商店更新，直接分发版继续使用 GitHub Releases 自动更新。
- 公共发布工作流统一使用包含完整桌面伙伴素材的标准产品构建，并在打包前校验动画帧数量和体积。

### Fixed

- 修复 Windows 开发窗口和安装版任务栏沿用 Electron 名称或图标的问题，显式设置 Chroni AppUserModelID、沙漏图标、重启命令和显示名。
- 修复曾经的特殊构建路径只打入图标占位图、导致发布包缺少原桌面伙伴动画的问题。
- macOS 发布包新增构建变体清单和打包后内容核验，缺少完整桌宠帧、Universal 双架构原生模块、隐私清单、ASAR 完整性或正确 Bundle 元数据时直接失败。
- 修复 Intel Mac 缺少 `@napi-rs/canvas` x64 原生模块的问题；菜单栏改用可适配明暗模式的单色模板图标，日程浮层在 macOS 上保持置顶。
- 正式 macOS 标签发布强制 Developer ID 签名与 Apple 公证；清理未使用的摄像头、麦克风、蓝牙权限说明和任意明文网络例外。
- 下载页不再把旧版本安装包写死为离线回退，GitHub API 不可用时安全跳转 Latest Release。
- 修复 600×360 等 Windows 窄窗口下侧栏标签重叠、内容横向溢出的问题。

## [0.2.0] - 2026-08-25

### Added

- 新增 Learning Mission，将来源、目标、交付物、完成标准、里程碑、进度、风险、证据和阶段检查点统一建档。
- 新增本地文件 SHA-256 产出证据、变更检测、阶段检查点、里程碑回写、风险重算和下一步调整。
- 新增无 API Key、无网络依赖的隔离 GOAI Demo，覆盖明确材料、缺失截止时间和来源冲突三种路径。
- 新增 60 条固定时钟合成评测、能力契约、脱敏证据导出、评测 runner/schema 与关键闭环测试。
- 新增普通用户快速开始、安装 FAQ、模型模式、隐私、故障排查、帮助反馈与复赛更新说明。

### Changed

- 产品定位从桌宠 DDL 管理器升级为面向大学项目制学习的本地学习执行 Agent，形成 `Ground → Plan → Act → Verify → Adapt` 闭环。
- 主动追问改为基础计划优先：先提取并规划可确定任务，仅在必需字段缺失或来源冲突时阻断。
- 今日执行时间轴按真实时长布局，支持缩放、重叠分栏、相邻颜色区分、拖动调整和跨日回顾。
- Windows 桌宠、日程抽屉和控制中心交互与 macOS 行为对齐，并加强跨屏移动边界与窗口定位。
- README、产品下载页、安装包、Release Notes、真实截图和复赛材料统一到 `v0.2.0`。

### Security

- 强化压缩文档解析配额、路径穿越防护、密钥安全存储、本地 API 鉴权、日志脱敏和公开证据导出边界。
- 正式复赛 ZIP 在生成前要求干净工作区，并写入提交 SHA、环境信息、安装包校验值和逐文件 SHA-256 清单。

## [0.1.4] - 2026-07-15

### Added

- 新增面向首次上手的三分钟体验路径、混合式 Agent 职责边界、完整架构图、质量证据与已知边界说明。
- 在应用内完整保留 XIAOTONG Desktop Pet 原作版本、作者、联系方式、捐赠二维码、仓库与许可证入口。

### Changed

- 恢复具有编辑感的标题字体层级，并统一控制中心、Agent、每日任务与日程弹窗的暖白浅绿设计语言。
- 以 Source Serif 4 / Noto Serif SC 搭配展示标题和重点数字，以 Source Sans 3 / Noto Sans SC 搭配正文与操作数字，并按字体度量校准中英文的字号、字重和基线节奏。
- 四套可变字体均作为本地资源内置，离线安装后仍能稳定呈现完整字体层级。
- 将辅助文字统一提升到 13px、操作文字统一为 14px，并为按钮、表单、状态行与折叠栏建立一致的高度和视觉居中规则。
- Windows 与 macOS 共用同一套下拉框、日期时间、复选框、数字输入和进度条外观；日期与时间固定按 `YYYY-MM-DD`、`HH:mm` 显示。
- 安装版 API 配置说明统一指向控制中心，并明确源码 `.env`、模型数据发送范围和本地 API 的安全边界。

### Fixed

- macOS 恢复适合桌面界面的字体抗锯齿与字距设置，新增操作按钮不再回退为系统默认样式。
- 字体分片全部作为本地资源输出，避免生产环境 CSP 拦截 Vite 内联字体。
- 修正 Agent 总览指标未命中数字排版规则，以及展示型三级标题误继承正文行高的问题。
- 修正每日任务时间轴刻度和当前时间线偏移、任务编辑字段基线错位、周视图过宽，以及文本符号图标随字体变化而偏心的问题。
- 消除 Windows 原生控件度量、历史页面缩放和字体冷启动造成的字号、换行与控件居中差异。
- 安装包现在外置附带 Chroni MIT、XIAOTONG Apache-2.0 与附加条款、字体 SIL OFL 1.1 及对应 Notice，避免二进制分发缺少可读许可证副本。

## [0.1.3] - 2026-07-15

### Fixed

- 无代码签名证书时，CI 不再把空的 `CSC_LINK` 当成证书文件路径；macOS 测试发布正确使用 ad-hoc 签名。

## [0.1.2] - 2026-07-15

### Fixed

- macOS Universal 构建正确保留 `@napi-rs/canvas` 的 Intel 与 Apple Silicon 原生二进制。

## [0.1.1] - 2026-07-15

### Added

- 内置 Inter 与 Noto Sans SC 可变字体，离线安装后仍能稳定呈现中英文界面。
- Windows 桌宠、日程抽屉与控制中心窗口的跨屏定位和交互回归测试。

### Changed

- 优化控制中心、每日任务和时间轴的字重、行高、间距与中文排版。
- 对齐 Windows 与 macOS 的桌宠点击、拖动、置顶和日程窗口交互。

### Fixed

- 打包命令不再于标签环境中提前上传产物，GitHub Release 由专用发布任务统一创建。

## [0.1.0] - 2026-07-15

### Added

- Chroni 桌宠、日程抽屉与桌面控制中心。
- 多格式文件解析、图片与扫描 PDF OCR、DeepSeek 结构化抽取。
- Deadline Agent、主动追问、TaskPlan、Behavior Memory 和每日时间轴。
- 带 Bearer 鉴权的本地 HTTP API。
- Windows NSIS 安装器、便携版与 macOS Universal DMG/ZIP 发布配置。
- GitHub Release 自动发布、SHA-256 校验和与构建来源证明。
- 应用内自动更新检查、下载进度和重启安装入口。
- 安全策略、贡献指南、发布手册以及结构化 Issue/PR 模板。

### Changed

- 发布标签现在必须与根工作区和桌面应用版本一致。
- 生产包启用 Electron Fuses 和 ASAR 完整性校验。

[Unreleased]: https://github.com/miracle121388-a11y/chroni/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/miracle121388-a11y/chroni/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/miracle121388-a11y/chroni/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/miracle121388-a11y/chroni/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.3
[0.1.2]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.2
[0.1.1]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.1
[0.1.0]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.0
