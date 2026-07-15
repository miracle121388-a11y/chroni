# Changelog

Chroni 的重要用户可见变化记录在这里。版本号遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

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

[Unreleased]: https://github.com/miracle121388-a11y/chroni/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.1
[0.1.0]: https://github.com/miracle121388-a11y/chroni/releases/tag/v0.1.0
