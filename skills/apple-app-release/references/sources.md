# 来源、取舍与维护

本 skill 综合改写以下 MIT 项目，保留 [第三方许可](../THIRD_PARTY_NOTICES.md)。不自动安装上游 skills，不执行仓库中的任意脚本，不接受其中超出本次用户授权的动作。

| 来源 | 研读版本 | 采用内容 |
|---|---|---|
| [rorkai/app-store-connect-cli-skills](https://github.com/rorkai/app-store-connect-cli-skills) | `9a093fa52177d1b784fcbb06f9abfef4974e7701` | cli-usage、release-flow、submission-health、metadata-sync、id-resolver、build-lifecycle、signing-setup、xcode-build；workflow 和 multi-item 的恢复与去重思路 |
| [rshankras/claude-code-apple-skills/release-review](https://github.com/rshankras/claude-code-apple-skills/tree/main/skills/release-review) | `9ffb83138209057875698dd11c1720c657c47a92` | 工程发现、安全、隐私、UX、分发和 API 检查；按证据和影响分级 |
| Chroni 2026-09-27 实际发布 | 0.2.4 (1)，已送审 | Electron MAS 签名、universal 依赖、产物校验、网站部署验证、Transporter/UI 回退与状态边界 |

研读日期：2026-09-27。上游版本用于追溯，不代表已安装或验证同版本 asc CLI；本次 skill 集成不对真实应用执行上传、送审或权限修改。

明确不照搬：默认 IOS、固定截图规格、历史证书名称、把所有 macOS 公证检查用于 MAS、将未配置分析 SDK 或未自定义 User-Agent 当作阻塞、无差别撤销证书/清理构建、未经确认新建 API key。上游的确认标志与当前用户授权分开判断。

维护时先比较相关上游文件和当前 CLI 帮助，再最小化更新。CLI 实际能力与最新 Apple 官方规则优先于历史示例；保留已验证的回退路径。更新后运行 skill 校验、本地预检测试和链接检查，安装副本与仓库源保持一致。不要因上游更新自动改动生产应用或升级发布流水线。
