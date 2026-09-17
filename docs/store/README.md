# Chroni 应用商店发布资料

本目录保存 Microsoft Store 与 Mac App Store 的提交文案、审核说明和发布检查表。普通 GitHub Release 仍使用 NSIS、Portable、DMG 与 ZIP；商店包使用独立命令，且由系统应用商店负责后续更新。

当前状态：Mac App Store 的代码、第一方资产、沙盒配置、隐私授权、元数据、截图和自动校验已就绪。公司 Apple Developer 资质通过前，无法完成发行证书、distribution profile、App Store Connect App 记录、Apple 在线验证与上传；提交前还须由公司提供法定版权主体和公开支持联系方式。这些是明确的外部输入，不是代码缺口。

## 一次性准备

```bash
npx pnpm@11.7.0 run store:prepare
```

`pnpm run store:prepare:macos` 会构建 MAS 专用第一方资产版本，使用虚构数据生成六张无 Alpha 的 `2880x1800` JPEG，并检查应用身份、App Store Connect 字段长度、隐私清单、明确模型授权、MAS 沙盒权限、语言声明和必要文档。该准备步骤不需要签名证书。

## 可提交包

- Windows：在 Partner Center 保留产品名并取得 Package/Identity/Name 与 Publisher 后运行 `pnpm run package:windows:store`。命令会使用 Windows SDK 解包，并核对身份、入口程序、载荷、许可文件和包哈希。
- macOS：在 Apple Developer 创建 App ID、Mac App Distribution 证书、Mac Installer Distribution 证书和 provisioning profile 后，于 macOS 运行 `pnpm run package:macos:store`。命令会生成只含第一方沙漏伙伴资产的 MAS 包，并验证应用沙盒、版本号、签名、隐私清单、内嵌 profile 和安装包签名。

每次成功构建会在 `apps/desktop/dist-electron/` 写入带 SHA-256 的 `store-verification-*.json`。详细变量和人工检查见[发布检查表](./release-checklist.md)，机器可校验字段见[App Store Connect 元数据](./app-store-connect.zh-CN.json)，隐私字段见[隐私申报基线](./privacy-declarations.md)，商店文案见[中文产品信息](./listing.zh-CN.md)，审核路径见[审核说明](./review-notes.md)。
