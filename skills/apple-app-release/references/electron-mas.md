# Electron macOS：签名与构建

仅在项目确认为 Electron MAS 时读取。以下经验来自 Chroni 2026-09-27 的实际送审；路径、依赖版本与修复方法均须按当前项目核实。

## 发行身份与产物

- 区分 MAS 与站外分发。MAS 使用适当的 Mac App Distribution 应用签名、Mac Installer Distribution 安装器签名及分发 profile；Developer ID、公证、站外 hardened runtime 检查不能直接套用于 MAS。
- 优先复用团队现有有效证书和私钥，检查团队、用途、有效期、私钥匹配及证书链。只有确有缺失才创建；不得为方便撤销现有证书。
- 私钥、P12、密码与签名 profile 放仓库外，限制读取权限；环境变量或系统凭据管理向构建注入，不打印值，不把日志中的认证头公开。
- 使用当前 Apple 官方中间证书核对信任链，不把 WWDR G3 永久写死。应用和安装器均验证完整链。P12 兼容选项（如 OpenSSL legacy）只在工具确有兼容需求时使用。
- 核对主程序与 helper 的 sandbox/inherit entitlements、真实所需能力、Bundle ID 与 Team ID。读取 profile 可用 `security cms` 解码，再用 `plutil` 提取所需字段；包含日期/二进制的 plist 整体转 JSON 可能失败。
- macOS profile 常见标识键是 `com.apple.application-identifier`，不要硬套 iOS 的 `application-identifier`。以解码后的当前 profile 内容和平台文档为准。

## 构建及验证

沿用项目已有 package/prepare/validate 命令；Chroni 使用过 `package:macos:store`、`store:prepare:macos`、`store:validate:macos`，其他项目不一定存在这些脚本。

验证实际 `.app` 和 `.pkg`，至少包含：

- Info.plist 身份、marketing version、build number、最低系统与实际支持架构。
- 嵌入的 provisioning profile 与签名 entitlements 一致；应用及 helper 签名有效；安装器签名有效。可使用 `codesign` 和 `pkgutil --check-signature`，不要仅凭工具退出 0 或文件存在宣称全部通过。
- 原生依赖架构与发布架构匹配；包内包含最新 PrivacyInfo.xcprivacy、许可、资源与声明。
- 记录最终包路径、大小、SHA-256 和验证结果。包内容变化后重建并重新核验；不要把后来修改的源码当作已经上传的二进制内容。

Electron MAS 与站外版本可能有不同更新机制、资源或能力，必须检查商店版本的真实行为。MAS 按应用商店更新机制发布，不照搬站外自动更新方案。

## 已见故障：有证据才使用修复

| 现象 | 检查与处理 |
|---|---|
| universal 合并 native dependency 失败 | 检查 canvas、sharp/libvips、onnx 等模块是否有 x64/arm64 专用文件。按实际路径配置 x64ArchFiles 等合并规则；不能宽泛排除整个 node_modules。验证两种架构和误匹配范围。 |
| 导入 P12 成功，key partition list 密码错误 | Chroni 的 app-builder-lib 26.15.3 把 P12 密码用于临时 keychain。核对当前源码、调用和上游修复，只有同一问题复现才持久化最小依赖 patch，并通过包管理器锁定；不要直接修改缓存 node_modules 当作完成。 |
| 检查脚本找不到已生成 pkg | 搜索真实构建输出；electron-builder 可能放在 `mas-universal/`，不能只扫输出根目录。 |
| 检查器要求 Developer ID 或 hardened runtime | 将规则按 MAS 与站外构建分支处理，保留正确的签名与沙盒核验；不能简单关闭所有检查。 |
| Transporter 已交付，版本页没有构建 | 先查处理状态及详细错误；处理完成后刷新版本页并关联，不默认上传失败。 |

签名处理大量 Electron 资源可能耗时较长；有进程和日志进展时等待，不轻率重启。故障修复后执行针对性构建与必要测试，成功后继续发布，不反复无目的运行全套检查。
