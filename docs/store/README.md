# Chroni 应用商店发布资料

本目录保存 Microsoft Store 与 Mac App Store 的提交文案、审核说明和发布检查表。普通 GitHub Release 仍使用 NSIS、Portable、DMG 与 ZIP；商店包使用独立命令，且由系统应用商店负责后续更新。

## 本地检查

```bash
npx pnpm@11.7.0 run store:check
```

该命令从现有 Chroni 沙漏图标生成 Windows 商店尺寸，并检查应用身份、隐私清单、MAS 沙盒权限和必要文档。它不需要证书，也不会生成可提交包。

## 可提交包

- Windows：在 Partner Center 保留产品名并取得 Package/Identity/Name 与 Publisher 后运行 `pnpm run package:windows:store`。
- macOS：在 Apple Developer 创建 App ID、Mac App Distribution 证书和 provisioning profile 后，于 macOS 运行 `pnpm run package:macos:store`。

详细变量和人工检查见[发布检查表](./release-checklist.md)。商店文案见[中文产品信息](./listing.zh-CN.md)，审核路径见[审核说明](./review-notes.md)。
