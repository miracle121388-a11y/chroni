# Chroni 应用商店发布资料

本目录保存 Microsoft Store 与 Mac App Store 的提交文案、审核说明和发布检查表。普通 GitHub Release 仍使用 NSIS、Portable、DMG 与 ZIP；商店包使用独立命令，且由系统应用商店负责后续更新。

当前状态：Chroni 为免费 macOS 应用，团队 `RJ9LMC47V5`、Bundle ID `app.chroni.desktop`、App Store Connect App `6816595577`。2026-10-03 构建 `0.2.4 (3)` 因 Guideline 4 缺少关闭主窗口后的应用菜单恢复入口被拒。已加入原生“窗口 → 打开控制中心”（⌘1），修复提交 `e971852` 已推送；构建 `0.2.4 (4)` 于 2026-10-05 21:23（中国标准时间）经 Transporter 交付成功，已完成处理及 TestFlight 真机复验；21:48 回复 Apple，21:49 重新提交同一审核，后台确认为“等待审核”，尚未获批或上架。版权主体为引力回响（苏州）科技有限公司，支持邮箱 developer@twintalk.cn；公司官网 https://twintalk.cn，产品支持与隐私页沿用 Chroni 产品站。

## 最近核验

2026-10-05 窗口菜单修复：Apple 于 10 月 3 日通知构建 `0.2.4 (3)` 因 Guideline 4 被拒，原因是关闭主窗口后没有应用菜单入口重新打开。macOS 原生“窗口”菜单现固定提供“打开控制中心”（⌘1），调用既有窗口恢复逻辑。实际 Electron 原生窗口回归检查已验证首次打开、关闭后重建、最小化后恢复且不重复创建窗口；类型检查及正式小童素材构建通过。构建 4 已完成 universal MAS 签名、沙盒、243 帧小童动画与授权文件及安装包检查，SHA-256 为 `b7c56980a7d86be3c1e0292cc400cefadfca2f648b282baaff990c924e17d245`；21:23 交付 Apple，21:26 Apple 处理完成，已加入现有 Chroni Release QA 群组并通过 TestFlight 安装。Mac17,3、macOS 27.0.1（26A434）真机确认菜单首次打开、红色关闭按钮关闭后菜单重开、⌘1 重开、最小化后恢复、既有 6 项任务与旧排程保留；已核对安装版 CFBundleVersion 为 4、Bundle ID 与 Team ID 正确。本机 API 再次验证健康检查 200、无令牌任务接口 401、有令牌 200，不记录令牌或任务内容。18 项打包测试通过。审核 Notes 已保存 3,950 字符正文，包含修复、真机 QA、六项材料及权限用途，原构建 3 功能录像附件保留；本次补录捕获到其他工作画面，未采用或上传。21:48 回复 Apple，21:49 更新审核并重新提交构建 4，页面确认为“等待审核”，提交 ID 沿用 `a533c206-dc2e-4b72-8881-e3beeb491e03`。支持及隐私页重新验证 HTTP 200、公司名与邮箱完整。回归命令：`pnpm --filter @chroni/desktop run verify:macos-window-menu`。

2026-09-29 权限说明补充：实际 TestFlight build 3 的签名包含 `com.apple.security.network.server`，主进程确实使用 Node HTTP server 提供本机自动化 API。源码 `startLocalApiServer` 在启动时运行；真机 `lsof` 确认 Chroni 仅监听 `127.0.0.1:8765`，`/api/health` 返回 200，`/api/daily-tasks` 无令牌返回 401、使用当前会话令牌返回 200。未输出或提交会话令牌及任务内容。此权限用于接受本机脚本的入站请求，不是模型服务出站权限。已在 Notes 中保留原六项材料并置顶权限说明，在 App 沙盒信息中新增对应权限用途，20:19 向审核回复复现命令，20:22 正式重新提交；提交 ID 不变。支持及隐私页再次核验 HTTP 200。本次无代码、二进制或权限变更，沿用构建 3 及既有录像。

2026-09-28 外观纠正：负责人明确要求所有正式发行保留 XIAOTONG 小童。构建 1、2 的沙漏由 MAS 配置强制选择 `original` 导致，不能再用于录屏或送审。已统一渲染器、清单和打包的素材规则：product/store 必须 xiaotong，original 仅用于显式兼容构建；MAS 复用正式版素材摘要与动画检查，截图和最终包都须一致。构建 3 已完成签名、243 帧小童动画与授权文件、沙盒及安装包签名检查，SHA-256 为 `5521bd6af06af2adf177e1de3aa4600524746c25699ca55ee1e2ab7a01b92b04`；Transporter 于 2026-09-28 15:11（中国标准时间）交付 Apple，已处理完成并加入内部 QA 群组，TestFlight 构建 3 已安装；macOS 27.0（26A428）、Mac17,3 真机已确认启动成功、蓝色小童正常显示、此前任务和排程保留。构建 3 另已通过本地建档、证据说明保存、排程、回顾保存、模型显式同意与托管提取、关闭模型的真机验证。负责人确认录屏权限后，已用 macOS 自带 screencapture 完成构建 3 的 4 分钟真机操作录像，并导出 `Chroni-0.2.4-build3-demo.mp4`；抽查启动、任务、模型同意、操作过程与重启帧，已确认小童正常、虚构材料与保存结果。录像保存在仓库外；早期 5 秒测试片含工作界面，不得上传。负责人恢复 Safari 前台后，录像已上传至版本审核附件及审核回复附件，六项说明已同步 Notes 并发送给 Apple，构建 3 已关联并重新提交，16:21 后台确认为“等待审核”。线上六张截图已替换为小童版，负责人确认后内容版权已保存为拥有第三方内容必要权利；Notes 已保存录像引用与已执行的 QA 结果；不得继续声称小童为自有第一方素材。

2026-09-28 早期构建排障记录（下述待办已由上方构建 3 记录完成）：已整理[六项英文补充材料与真机录屏清单](./review-notes.md#2026-09-28guideline-21-补充材料)。已在 App Store Connect 核实原提交为“问题未解决”，版本状态“已拒绝”，原因 2.1.0；登录已恢复。已建立手动分发的内部群组 `Chroni Release QA`（`32d00693-b853-4525-9ce2-7eb78298cf5d`），添加 `0.2.4 (1)`，状态“准备测试”；经负责人授权，已邀请其现有账户持有人账号，群组现为 1 名测试员、1 个构建，测试员状态“已邀请”。TestFlight 已安装 `0.2.4 (1)`，真机启动后退出；辅助进程崩溃于 `_libsecinit_appsandbox`。已发现并移除继承沙盒辅助进程多余的麦克风 entitlement（主进程保留），新增源码及签名产物检查，17 项打包测试与商店准备检查通过。修复提交 `5ea9213`，`0.2.4 (2)` 已完成签名与最终产物检查，SHA-256 为 `7d103ece2cb2260bcfb6e20c8583ac0657df77a81a65fa63f5fcefa0c4f3e83d`，于 2026-09-28 13:10（中国标准时间）由 Transporter 交付 Apple，已完成处理并加入内部 QA 群组（2 个构建、1 名测试员），构建 2 状态“正在测试”。TestFlight 构建 2 已安装；在 macOS 27.0（26A428）、Mac17,3 真机上验证启动、伙伴与控制中心、本地文本建档、任务详情、成果说明保存、智能排程、每日回顾保存，以及模型默认关闭/显式同意/DeepSeek 提取成功/再次关闭均通过。应用已完全退出，尚待录屏中的重启持久化检查；负责人确认 QuickTime 可正常录屏，先前因发现伙伴形象错误而手动终止；待构建 3 真机确认小童后重新录制；未更新线上 Notes、未回复审核消息或重新提交。网关健康检查返回 `ok`，不能据此认定全部模型功能真机测试通过。

2026-09-27：已创建应用及安装器发行证书、distribution profile；已保存版本 0.2.4、六张截图、审核联系信息、免费定价、效率/教育类别与 4+ 分级，发布范围为中国大陆、香港、澳门、台湾、新加坡、马来西亚。隐私标签经负责人确认后已发布。版本 `0.2.4 (1)` 的 universal MAS 包已包含最新隐私声明，应用签名、安装器签名及全部本地检查通过；2026-09-27 13:46（中国标准时间）Transporter 确认交付成功，Apple 已完成处理；构建已关联至版本，App Store Connect 资料检查通过并完成提交，状态为“正在等待审核”。`store:prepare:macos`、`site:check` 通过；产品站经 Zeabur 本地上传部署后，`/support.html` 与 `/privacy.html` 均返回 HTTP 200，已确认包含公司名称和支持邮箱。审核提交 ID：`a533c206-dc2e-4b72-8881-e3beeb491e03`；设置为审核通过后自动发布。Zeabur 服务仍显示旧 GitHub 来源，后续网站更新应核对实际部署来源，不能假定当前仓库推送会自动部署。

## 一次性准备

```bash
npx pnpm@11.7.0 run store:prepare
```

`pnpm run store:prepare:macos` 会构建 MAS 小童动画版本，使用虚构数据生成六张无 Alpha 的 `2880x1800` JPEG，并检查应用身份、App Store Connect 字段长度、隐私清单、明确模型授权、MAS 沙盒权限、语言声明和必要文档。该准备步骤不需要签名证书。

## 可提交包

- Windows：在 Partner Center 保留产品名并取得 Package/Identity/Name 与 Publisher 后运行 `pnpm run package:windows:store`。命令会使用 Windows SDK 解包，并核对身份、入口程序、载荷、许可文件和包哈希。
- macOS：在 Apple Developer 创建 App ID、Mac App Distribution 证书、Mac Installer Distribution 证书和 provisioning profile 后，于 macOS 运行 `pnpm run package:macos:store`。命令会生成包含小童动画及完整素材许可的 MAS 包，并验证应用沙盒、版本号、签名、隐私清单、内嵌 profile 和安装包签名。

每次成功构建会在 `apps/desktop/dist-electron/` 写入带 SHA-256 的 `store-verification-*.json`。详细变量和人工检查见[发布检查表](./release-checklist.md)，机器可校验字段见[App Store Connect 元数据](./app-store-connect.zh-CN.json)，隐私字段见[隐私申报基线](./privacy-declarations.md)，商店文案见[中文产品信息](./listing.zh-CN.md)，审核路径见[审核说明](./review-notes.md)。
