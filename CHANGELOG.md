# Changelog

Chroni 的重要用户可见变化记录在这里。版本号遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

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

[Unreleased]: https://github.com/miracle121388-a11y/chroni/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/miracle121388-a11y/chroni/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.3
[0.1.2]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.2
[0.1.1]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.1
[0.1.0]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.0
