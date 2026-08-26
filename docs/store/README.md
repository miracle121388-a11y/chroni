# Chroni 应用商店发布资料

本目录保存 Microsoft Store 与 Mac App Store 的提交文案、审核说明和发布检查表。普通 GitHub Release 仍使用 NSIS、Portable、DMG 与 ZIP；商店包使用独立命令，且由系统应用商店负责后续更新。

## 一次性准备

```bash
npx pnpm@11.7.0 run store:prepare
```

该命令从现有 Chroni 沙漏图标生成 Windows 商店尺寸，使用虚构数据启动真实 Renderer 并生成五张 `1440x900` 截图，然后检查应用身份、隐私清单、MAS 沙盒权限、语言声明和必要文档。它不会修改桌宠素材，也不需要签名证书。

## 可提交包

- Windows：在 Partner Center 保留产品名并取得 Package/Identity/Name 与 Publisher 后运行 `pnpm run package:windows:store`。命令会使用 Windows SDK 解包，并核对身份、入口程序、载荷、许可文件和包哈希。
- macOS：在 Apple Developer 创建 App ID、Mac App Distribution 证书、Mac Installer Distribution 证书和 provisioning profile 后，于 macOS 运行 `pnpm run package:macos:store`。命令会验证应用沙盒、签名、隐私清单、内嵌 profile 和安装包签名。

每次成功构建会在 `apps/desktop/dist-electron/` 写入带 SHA-256 的 `store-verification-*.json`。详细变量和人工检查见[发布检查表](./release-checklist.md)，隐私字段见[隐私申报基线](./privacy-declarations.md)，商店文案见[中文产品信息](./listing.zh-CN.md)，审核路径见[审核说明](./review-notes.md)。
