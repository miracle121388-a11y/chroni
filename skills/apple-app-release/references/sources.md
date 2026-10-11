# 来源、取舍与维护

本 skill 综合改写以下 MIT 项目，保留 [第三方许可](../THIRD_PARTY_NOTICES.md)。不自动安装上游 skills，不执行仓库中的任意脚本，不接受其中超出本次用户授权的动作。

| 来源 | 研读版本 | 采用内容 |
|---|---|---|
| [rorkai/app-store-connect-cli-skills](https://github.com/rorkai/app-store-connect-cli-skills) | `9a093fa52177d1b784fcbb06f9abfef4974e7701` | cli-usage、release-flow、submission-health、metadata-sync、id-resolver、build-lifecycle、signing-setup、xcode-build；workflow 和 multi-item 的恢复与去重思路 |
| [rshankras/claude-code-apple-skills/release-review](https://github.com/rshankras/claude-code-apple-skills/tree/main/skills/release-review) | `9ffb83138209057875698dd11c1720c657c47a92` | 工程发现、安全、隐私、UX、分发和 API 检查；按证据和影响分级 |
| Chroni 2026-09-27 至 2026-10-11 实际发行 | 0.2.4 (4) 获批上线；0.2.5 (6) 等待审核 | 2.1 六项材料与录像、继承 helper 沙盒崩溃、必要入站权限解释、原生窗口重开、商店资源选择、网站部署、实机语音/退出/持久化及上传状态恢复 |

上游研读日期：2026-09-27；发行经验与相关官方文档核验更新：2026-10-11。上游版本用于追溯，不代表已安装或验证同版本 asc CLI；本次 skill 更新不对真实应用执行上传、送审或权限修改。案例证据来自 Chroni 项目的 `docs/store/README.md` 发行记录及实际审核消息；该项目路径只作来源说明，skill 在其他应用不依赖它。

## 规则与经验的边界

- [当前审核指南](https://developer.apple.com/app-store/review/guidelines/) 是完整性、macOS 沙盒/退出、隐私和内容要求的官方依据；六项具体补充材料来自本次 2.1 消息，不声称每个新应用都必需相同录像。
- [Apple 入站权限](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.server) 与 [Electron MAS 指南](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide) 支持网络权限及构建/继承配置判断；最终按生产功能、当前工具链和签名产物核验。
- [Apple 沙盒权限参考（归档）](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html) 提供继承背景，不能把归档文档当作最新构建工具要求。
- 小童许可、243 帧、端口 8765、⌘1、5 秒退出兜底、版本号及六个销售地区均属 Chroni 个案。其他 app 采用自己的素材、权限、用户决定和验证证据。
- helper 权限错误与窗口重开是已验证问题；语音后残留进程的确切原生根因未证明，不把推测写成已确定原因。构建 5 退出问题为送审前发现，不改写为 Apple 拒审。

明确不照搬：默认 IOS、固定截图规格、历史证书名称、把所有 macOS 公证检查用于 MAS、将未配置分析 SDK 或未自定义 User-Agent 当作阻塞、无差别撤销证书/清理构建、未经确认新建 API key。上游的确认标志与当前用户授权分开判断。

维护时先比较相关上游文件和当前 CLI 帮助，再最小化更新。CLI 实际能力与最新 Apple 官方规则优先于历史示例；保留已验证的回退路径。更新后运行 skill 校验、本地预检测试和链接检查，安装副本与仓库源保持一致。不要因上游更新自动改动生产应用或升级发布流水线。
