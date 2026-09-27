# Chroni 应用商店发布资料

本目录保存 Microsoft Store 与 Mac App Store 的提交文案、审核说明和发布检查表。普通 GitHub Release 仍使用 NSIS、Portable、DMG 与 ZIP；商店包使用独立命令，且由系统应用商店负责后续更新。

当前状态：公司已确认 Apple Developer Program 会员开通；Chroni 按免费 macOS 应用提交，版权主体为引力回响（苏州）科技有限公司，支持邮箱为 developer@twintalk.cn，公司官网为 https://twintalk.cn。产品支持与隐私 URL 继续使用现有 Chroni 产品站。团队 RJ9LMC47V5、Bundle ID `app.chroni.desktop` 和 App Store Connect App `6816595577` 已建立；本地检查通过不代表已提交审核。

## 最近核验

2026-09-27：已创建应用及安装器发行证书、distribution profile；已保存版本 0.2.4、六张截图、审核联系信息、免费定价、效率/教育类别与 4+ 分级，发布范围为中国大陆、香港、澳门、台湾、新加坡、马来西亚。隐私标签经负责人确认后已发布。版本 `0.2.4 (1)` 的 universal MAS 包已包含最新隐私声明，应用签名、安装器签名及全部本地检查通过；2026-09-27 13:46（中国标准时间）Transporter 确认交付成功，Apple 已完成处理；构建已关联至版本，App Store Connect 资料检查通过并建立审核草稿，状态为“可供审核”。`store:prepare:macos`、`site:check` 通过；支持页 `/support.html` 仍返回 HTTP 404，正在修复部署。等待产品站上传修复支持页后正式提交审核；尚未送审或上架。

## 一次性准备

```bash
npx pnpm@11.7.0 run store:prepare
```

`pnpm run store:prepare:macos` 会构建 MAS 专用第一方资产版本，使用虚构数据生成六张无 Alpha 的 `2880x1800` JPEG，并检查应用身份、App Store Connect 字段长度、隐私清单、明确模型授权、MAS 沙盒权限、语言声明和必要文档。该准备步骤不需要签名证书。

## 可提交包

- Windows：在 Partner Center 保留产品名并取得 Package/Identity/Name 与 Publisher 后运行 `pnpm run package:windows:store`。命令会使用 Windows SDK 解包，并核对身份、入口程序、载荷、许可文件和包哈希。
- macOS：在 Apple Developer 创建 App ID、Mac App Distribution 证书、Mac Installer Distribution 证书和 provisioning profile 后，于 macOS 运行 `pnpm run package:macos:store`。命令会生成只含第一方沙漏伙伴资产的 MAS 包，并验证应用沙盒、版本号、签名、隐私清单、内嵌 profile 和安装包签名。

每次成功构建会在 `apps/desktop/dist-electron/` 写入带 SHA-256 的 `store-verification-*.json`。详细变量和人工检查见[发布检查表](./release-checklist.md)，机器可校验字段见[App Store Connect 元数据](./app-store-connect.zh-CN.json)，隐私字段见[隐私申报基线](./privacy-declarations.md)，商店文案见[中文产品信息](./listing.zh-CN.md)，审核路径见[审核说明](./review-notes.md)。
