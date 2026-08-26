# Chroni 应用商店发布检查表

## 共同检查

- [ ] 根目录、桌面端和网关版本一致。
- [ ] `pnpm run check`、`pnpm run site:check`、`pnpm run store:check` 全部通过。
- [ ] 沙漏应用图标与原桌面伙伴素材没有被替换。
- [ ] 隐私政策网址可公开访问，应用内两次操作内可到达素材许可信息。
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

3. 上传 `apps/desktop/dist-electron/Chroni-<version>-win-x64-store.appx`。
4. 使用 Windows App Certification Kit 检查包，并在全新 Windows 用户账户中测试安装、任务栏图标、开始菜单名称、托盘、卸载和数据保留。

## Mac App Store

1. 在 Apple Developer 创建 Bundle ID `app.chroni.desktop`。
2. 创建 Mac App Distribution 证书、Mac Installer Distribution 证书与 Mac App Store provisioning profile。
3. 在 macOS 设置：

```bash
export CHRONI_MAC_STORE_PROVISIONING_PROFILE="$HOME/Profiles/Chroni.provisionprofile"
# 仅在自动选择证书不可靠时设置完整证书名称
export CHRONI_MAC_STORE_IDENTITY="Apple Distribution: Your Name (TEAMID)"
npx pnpm@11.7.0 run package:macos:store
```

4. 确认 `.app/Contents/Resources/PrivacyInfo.xcprivacy` 存在，使用 `codesign --verify --deep --strict` 验证签名。
5. 在干净用户账户测试沙盒文件选择、OCR、模型连接、本地 API、通知、菜单栏、桌面伙伴拖动和完全退出。
6. 使用 Transporter 上传生成的 `.pkg`，在 App Store Connect 填写隐私标签并提交审核。

## 发布后

- [ ] 从两个商店实际安装公开版本，不使用开发机已有数据。
- [ ] 系统显示名称、任务栏 / Dock 图标和安装目录均为 Chroni，不显示 Electron。
- [ ] 商店更新状态显示“当前版本由系统应用商店负责更新”。
- [ ] 下载站和 GitHub Release 仍指向各自的直接分发安装包，不混用商店包更新元数据。
