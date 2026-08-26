# Chroni 应用商店发布检查表

## 共同检查

- [ ] 根目录、桌面端和网关版本一致。
- [ ] `pnpm run check`、`pnpm run site:check`、`pnpm run store:prepare` 全部通过。
- [ ] 沙漏应用图标与原桌面伙伴素材没有被替换。
- [ ] 隐私政策网址可公开访问，应用内两次操作内可到达素材许可信息。
- [ ] 商店隐私字段与 `docs/store/privacy-declarations.md` 一致，未少报可选模型传输的数据。
- [ ] 截图使用虚构数据，未包含凭据、真实课程材料或本地用户名路径。
- [ ] 应用以免费价格发布；若要收费、订阅、接受赞助或形成其他收入，必须先取得 XIAOTONG 素材许可方书面同意。

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

1. 在 Apple Developer 创建 Bundle ID `app.chroni.desktop`。
2. 创建 Mac App Distribution 证书、Mac Installer Distribution 证书与 Mac App Store provisioning profile。
3. 在 macOS 设置：

```bash
export CHRONI_MAC_STORE_PROVISIONING_PROFILE="$HOME/Profiles/Chroni.provisionprofile"
export CSC_LINK="$HOME/Certificates/Chroni-App-Distribution.p12"
export CSC_KEY_PASSWORD="应用证书导出密码"
export CSC_INSTALLER_LINK="$HOME/Certificates/Chroni-Installer-Distribution.p12"
export CSC_INSTALLER_KEY_PASSWORD="安装器证书导出密码"
# 仅在自动选择证书不可靠时设置证书主体，不要包含 Apple Distribution 前缀
export CHRONI_MAC_STORE_IDENTITY="Your Name (TEAMID)"
npx pnpm@11.7.0 run package:macos:store
```

4. 保留构建生成的 `store-verification-macos.json`，确认其中的 SHA-256、Bundle ID、应用签名和安装包签名正确。
5. 在干净用户账户测试沙盒文件选择与拖入、OCR、模型连接、本地 API、通知、菜单栏、桌面伙伴拖动和完全退出。
6. 使用 Transporter 上传生成的 `.pkg`，按 `privacy-declarations.md` 填写 App Store Connect 隐私标签并提交审核。

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

配置后在 Actions 中手动运行 `App Store Packages`，分别下载 AppX/PKG 和对应的 `store-verification-*.json`。

## 发布后

- [ ] 从两个商店实际安装公开版本，不使用开发机已有数据。
- [ ] 系统显示名称、任务栏 / Dock 图标和安装目录均为 Chroni，不显示 Electron。
- [ ] 商店更新状态显示“当前版本由系统应用商店负责更新”。
- [ ] 下载站和 GitHub Release 仍指向各自的直接分发安装包，不混用商店包更新元数据。
