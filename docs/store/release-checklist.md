# Chroni 应用商店发布检查表

## 共同检查

- [ ] 根目录、桌面端和网关版本一致。
- [ ] `pnpm run check`、`pnpm run site:check`、`pnpm run store:prepare:macos` 全部通过。
- [ ] 隐私政策与支持网址可公开访问，且与 App Store Connect 元数据一致。
- [ ] 商店隐私字段与 `docs/store/privacy-declarations.md` 一致，未少报可选模型传输的数据。
- [ ] 截图使用虚构数据，未包含凭据、真实课程材料或本地用户名路径。
- [ ] 新安装默认关闭联网模型；开启前明确披露接收方、数据类别、用途并取得同意。

## Microsoft Store

1. 在 Partner Center 创建产品并复制 Package/Identity/Name 与 Publisher。
2. 设置环境变量：

```powershell
$env:CHRONI_WINDOWS_STORE_IDENTITY_NAME = "Partner Center 中的 Package/Identity/Name"
$env:CHRONI_WINDOWS_STORE_PUBLISHER = "Partner Center 中的 Publisher，例如 CN=..."
$env:CHRONI_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME = "商店显示的发布者名称"
npx pnpm@11.7.0 run package:windows:store
```

3. 保留构建生成的 `store-verification-windows.json`，确认其中的包名、SHA-256、身份和版本与待上传 AppX 一致。
4. 上传 `apps/desktop/dist-electron/Chroni-<version>-win-x64-store.appx`。
5. 在活跃 Windows 用户会话中，以管理员 PowerShell 运行 Windows App Certification Kit，并保存报告：

```powershell
$kit = "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe"
& $kit reset
& $kit test -appxpackagepath "完整路径\Chroni-<version>-win-x64-store.appx" -reportoutputpath "完整路径\Chroni-WACK.xml"
```

6. 在全新 Windows 用户账户中测试安装、任务栏图标、开始菜单名称、托盘、文件拖入、通知、卸载和数据保留。

## Mac App Store

### 资质审核期间已可完成

- [x] 固定 Bundle ID：`app.chroni.desktop`。
- [x] MAS 专用包只使用 Chroni 第一方沙漏伙伴，不包含 XIAOTONG 素材、外部赠与二维码或付费入口。
- [x] App Sandbox、用户选择文件读写、网络客户端/本地回环服务、麦克风权限与隐私清单已配置。
- [x] `CFBundleShortVersionString` 与产品版本一致，`CFBundleVersion` 支持独立递增构建号。
- [x] 已声明仅使用系统 HTTPS/TLS，不使用非豁免加密；提交前仍由公司负责人复核出口合规答案。
- [x] 中文元数据、隐私申报、审核路径、无 Alpha 截图与公开支持页框架已准备。

### 资质通过后必须补齐

1. 在构建 Mac 上运行 `sudo xcodebuild -license` 阅读并接受 Xcode 许可协议；同时接受 Apple Developer 与 App Store Connect 最新协议，在 Certificates, Identifiers & Profiles 创建 Bundle ID `app.chroni.desktop`。
2. 创建 Mac App Distribution 证书、Mac Installer Distribution 证书与匹配 Bundle ID 的 Mac App Store distribution provisioning profile。
3. 在 App Store Connect 新建 macOS App，确认名称可用，并填写 SKU、主语言、类别、隐私政策和支持 URL。按 `app-store-connect.zh-CN.json` 录入，但先将版权字段替换为“年份 + 公司法定版权主体”（Apple 会自动添加版权符号）。
4. 在 `site/support.html` 加入公司的公开支持邮箱，并按适用法律补充电话或地址；同时填写 App Review 联系人姓名、邮箱、电话，以及适用的贸易商身份、税务/银行、地区合规和内容权利信息。这些公司字段不得使用占位值。
5. 在 macOS 设置递增构建号和法定版权主体：

```bash
export CHRONI_MAC_STORE_PROVISIONING_PROFILE="$HOME/Profiles/Chroni.provisionprofile"
export CSC_LINK="$HOME/Certificates/Chroni-App-Distribution.p12"
export CSC_KEY_PASSWORD="应用证书导出密码"
export CSC_INSTALLER_LINK="$HOME/Certificates/Chroni-Installer-Distribution.p12"
export CSC_INSTALLER_KEY_PASSWORD="安装器证书导出密码"
export CHRONI_MAC_BUILD_NUMBER="1"
export CHRONI_MAC_STORE_COPYRIGHT="2026 公司法定名称"
export CHRONI_APP_STORE_SUPPORT_EMAIL="support@example.com"
# 仅在自动选择证书不可靠时设置证书主体，不要包含 Apple Distribution 前缀
export CHRONI_MAC_STORE_IDENTITY="Your Name (TEAMID)"
npx pnpm@11.7.0 run package:macos:store
```

6. 保留构建生成的 `store-verification-macos.json`，确认 SHA-256、Bundle ID、营销版本、构建号、Team ID、profile 名称、应用签名和安装包签名正确。
7. 在干净用户账户测试首次启动、本地默认模式、联网模型授权/撤回、沙盒文件选择与拖入、OCR、语音权限、通知、菜单栏、沙漏伙伴拖动和完全退出。
8. 创建 App Store Connect API Key 后，将私钥保存为 `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`，设置 `APP_STORE_CONNECT_API_KEY_ID` 与 `APP_STORE_CONNECT_API_ISSUER_ID`，运行 `pnpm run store:validate:macos`。
9. 先上传到 TestFlight 内部测试，处理 Apple 自动验证结果；再按 `privacy-declarations.md` 填写隐私标签并提交审核。

## GitHub Actions 配置

仓库 `Settings -> Secrets and variables -> Actions` 需要以下内容：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `CHRONI_WINDOWS_STORE_IDENTITY_NAME` | Partner Center Package/Identity/Name |
| Variable | `CHRONI_WINDOWS_STORE_PUBLISHER` | Partner Center Publisher 的完整 `CN=...` 值 |
| Variable | `CHRONI_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME` | 商店发布者显示名 |
| Secret | `MAC_STORE_CSC_LINK` | Mac App Distribution `.p12` 的 Base64 内容 |
| Secret | `MAC_STORE_CSC_KEY_PASSWORD` | 应用证书导出密码 |
| Secret | `MAC_STORE_INSTALLER_CSC_LINK` | Mac Installer Distribution `.p12` 的 Base64 内容 |
| Secret | `MAC_STORE_INSTALLER_CSC_KEY_PASSWORD` | 安装器证书导出密码 |
| Secret | `MAC_STORE_PROVISIONING_PROFILE` | Mac App Store provisioning profile 的 Base64 内容 |
| Variable | `CHRONI_MAC_STORE_IDENTITY` | 可选，仅填证书主体 `Name (TEAMID)` |
| Variable | `CHRONI_MAC_STORE_COPYRIGHT` | `年份 + 公司法定版权主体`，例如 `2026 Example, Inc.` |
| Variable | `CHRONI_APP_STORE_SUPPORT_EMAIL` | 已公开写入支持页的公司支持邮箱 |
| Secret | `APP_STORE_CONNECT_API_KEY_ID` | App Store Connect API Key ID |
| Secret | `APP_STORE_CONNECT_API_ISSUER_ID` | App Store Connect Issuer ID |
| Secret | `APP_STORE_CONNECT_API_PRIVATE_KEY` | `.p8` 私钥原文；配置后三项会自动执行 Apple 验证 |

配置后在 Actions 中手动运行 `App Store Packages`，分别下载 AppX/PKG 和对应的 `store-verification-*.json`。

## 发布后

- [ ] 从两个商店实际安装公开版本，不使用开发机已有数据。
- [ ] 系统显示名称、任务栏 / Dock 图标和安装目录均为 Chroni，不显示 Electron。
- [ ] 商店更新状态显示“当前版本由系统应用商店负责更新”。
- [ ] 下载站和 GitHub Release 仍指向各自的直接分发安装包，不混用商店包更新元数据。
