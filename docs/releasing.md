# Chroni 发布指南

本文面向拥有仓库发布权限的维护者。普通用户只需要从 GitHub Releases 下载对应平台的安装包。

## 发布产物

| 平台 | 产物 | 用途 |
| --- | --- | --- |
| Windows x64 | `Chroni-<version>-win-x64-setup.exe` | 推荐安装版，包含卸载、开始菜单和桌面快捷方式 |
| Windows x64 | `Chroni-<version>-win-x64-portable.exe` | 不安装直接运行 |
| macOS Universal | `Chroni-<version>-mac-universal.dmg` | Intel 与 Apple Silicon 通用安装镜像 |
| macOS Universal | `Chroni-<version>-mac-universal.zip` | 应用内更新和手动解压 |
| 全平台 | `latest*.yml`、`*.blockmap` | `electron-updater` 更新元数据 |
| 全平台 | `SHA256SUMS.txt` | 发布文件完整性校验 |

## 版本准备

1. 同时更新根目录和 `apps/desktop/package.json` 中的版本。
2. 将 `CHANGELOG.md` 的 `Unreleased` 内容移动到新版本标题下。
3. 运行完整检查、版本校验和本机打包。

```bash
npx pnpm@11.7.0 run check
npx pnpm@11.7.0 run release:verify
npx pnpm@11.7.0 run package:windows  # Windows
npx pnpm@11.7.0 run package:macos    # macOS
```

## 签名与公证

在仓库 Settings -> Secrets and variables -> Actions 中配置：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `WINDOWS_CSC_LINK` | Secret | Windows PFX 的 Base64、文件 URL 或证书位置 |
| `WINDOWS_CSC_KEY_PASSWORD` | Secret | Windows 证书密码 |
| `MAC_CSC_LINK` | Secret | Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD` | Secret | macOS 证书密码 |
| `MAC_APPLE_API_KEY` | Secret | App Store Connect API 私钥内容 |
| `MAC_APPLE_API_KEY_ID` | Secret | API Key ID |
| `MAC_APPLE_API_ISSUER` | Secret | API Issuer ID |

也可以用 `MAC_APPLE_ID`、`MAC_APPLE_APP_SPECIFIC_PASSWORD` 和 `MAC_APPLE_TEAM_ID` 完成公证。API Key 方式更适合 CI。

确认凭据稳定后，添加 Repository Variable：

```text
CHRONI_REQUIRE_SIGNING=1
CHRONI_REQUIRE_NOTARIZATION=1
```

开启后，凭据缺失会直接使发布失败，不会悄悄上传未签名产物。没有证书时应保留为 `0`，并将产物明确标记为测试构建。

## 创建发布

```bash
git tag -a v0.1.0 -m "Chroni v0.1.0"
git push origin v0.1.0
```

`Desktop Release` 工作流会：

1. 校验标签与两个 package 版本一致。
2. 在 Windows 和 macOS 上分别运行完整检查。
3. 构建安装器、便携版、Universal DMG/ZIP 和更新元数据。
4. 生成平台校验和与 GitHub build provenance attestation。
5. 汇总产物、生成 `SHA256SUMS.txt` 并创建 GitHub Release。

带连字符的版本，例如 `v0.2.0-beta.1`，会自动创建为 prerelease。手动运行工作流只生成 30 天 artifact，不会创建正式 Release。

## 发布后验证

- 在一台没有开发环境的 Windows 电脑上测试安装、首次启动、卸载和保留数据。
- 在 Intel 与 Apple Silicon macOS 上测试 DMG、Gatekeeper、公证和通知权限。
- 从上一个正式版本检查应用内更新，并验证下载后重启安装。
- 下载全部 Release 产物，核对文件与 `SHA256SUMS.txt`。

```powershell
Get-FileHash .\Chroni-0.1.0-win-x64-setup.exe -Algorithm SHA256
```

```bash
shasum -a 256 -c SHA256SUMS.txt
gh attestation verify Chroni-0.1.0-win-x64-setup.exe --repo miracle121388-a11y/chroni
```
