# Electron macOS：签名与构建

仅在项目确认为 Electron MAS 时读取。以下经验来自 Chroni 2026-09-27 至 2026-10-11 的首次上架及更新；路径、依赖版本与修复方法均须按当前项目核实。

## 发行身份与产物

- 区分 MAS 与站外分发。MAS 使用适当的 Mac App Distribution 应用签名、Mac Installer Distribution 安装器签名及分发 profile；Developer ID、公证、站外 hardened runtime 检查不能直接套用于 MAS。
- 优先复用团队现有有效证书和私钥，检查团队、用途、有效期、私钥匹配及证书链。只有确有缺失才创建；不得为方便撤销现有证书。
- 私钥、P12、密码与签名 profile 放仓库外，限制读取权限；环境变量或系统凭据管理向构建注入，不打印值，不把日志中的认证头公开。
- 使用当前 Apple 官方中间证书核对信任链，不把 WWDR G3 永久写死。应用和安装器均验证完整链。P12 兼容选项（如 OpenSSL legacy）只在工具确有兼容需求时使用。
- 核对主程序与每个 helper 的 sandbox/inherit entitlements、真实所需能力、Bundle ID 与 Team ID；以最终签名中的权限为准。按进程角色配置，不能把主程序全部权限复制给继承沙盒的 helper。读取 profile 可用 `security cms` 解码，再用 `plutil` 提取所需字段；包含日期/二进制的 plist 整体转 JSON 可能失败。
- macOS profile 常见标识键是 `com.apple.application-identifier`，不要硬套 iOS 的 `application-identifier`。以解码后的当前 profile 内容和平台文档为准。

## 构建及验证

沿用项目已有 package/prepare/validate 命令；Chroni 使用过 `package:macos:store`、`store:prepare:macos`、`store:validate:macos`，其他项目不一定存在这些脚本。

验证实际 `.app` 和 `.pkg`，至少包含：

- Info.plist 身份、marketing version、build number、最低系统与实际支持架构。
- 嵌入的 provisioning profile 与签名 entitlements 一致；应用及 helper 签名有效；安装器签名有效。可使用 `codesign` 和 `pkgutil --check-signature`，不要仅凭工具退出 0 或文件存在宣称全部通过。
- 原生依赖架构与发布架构匹配；包内包含最新 PrivacyInfo.xcprivacy、许可、资源与声明。检查商店构建的资源选择规则、清单、帧数或资源摘要；图标、伙伴形象等不同资源角色分别确认，不以文件存在代替实际显示正确。
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
| TestFlight 安装版启动即退出，崩溃位于 `_libsecinit_appsandbox` | 查看对应构建的崩溃日志、每个 helper 的实际签名权限及 profile。Chroni 的继承 helper 多余麦克风权限是已修复案例；不是所有相同栈的唯一原因。主程序所需麦克风权限及用途说明保留，修复后重新签名、上传并真机启动。 |
| 桌宠、图标或其他资源在 MAS 变成兼容占位图 | 检查渠道参数、环境变量、构建默认值和旧输出，统一产品资源选择来源。Chroni 的正式小童被 MAS 强制 original 替换；修复后校验实际包、截图及 TestFlight 显示一致。其他应用使用自身资源方案。 |
| 完成语音后 Quit 只关窗口，进程仍在 | 采集进程、子进程、监听端口和必要调用栈，区分正常驻留与真正退出。等待存储及原生引擎释放，再关闭连接、定时器、快捷键并正常退出；参见 [实机 QA](runtime-qa.md)。不得把 Chroni 的 5 秒兜底原样作为通用修复。 |

签名处理大量 Electron 资源可能耗时较长；有进程和日志进展时等待，不轻率重启。故障修复后执行针对性构建与必要测试，成功后继续发布，不反复无目的运行全套检查。

## 网络权限判定

为每项 entitlement 建立“生产功能 → 代码入口 → 实际签名 → 实机证据 → 审核说明”的对应关系。向 AI、认证或下载服务器发请求属于出站；监听并接受请求属于入站，监听回环地址也不能仅凭“只在本机”判定不需要 server 权限。没有入站功能则移除 `com.apple.security.network.server` 并重建；确有需要则保留并给审核可操作的复现路径，见 [权限质疑分支](rejection-playbook.md#网络-server-权限被质疑)。

检查本机服务绑定范围、鉴权与敏感返回。仅设计为本机的服务不能意外监听 `0.0.0.0` 或 `::`；测试受保护接口未授权/已授权行为时不打印令牌和用户内容。Chroni 的端口、路径和鉴权设计不是其他应用的默认契约。

## 官方依据

- [Electron MAS 指南](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)：MAS 与普通 darwin 构建、签名身份、helper 继承及网络权限。
- [Apple 入站网络权限](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.server)
- [Apple 沙盒权限参考（归档）](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)：继承配置的背景；具体项目仍核验当前平台及 Electron 版本。
