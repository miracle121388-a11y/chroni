# iOS / iPadOS：从开发验证到发行

适用于原生 Swift/SwiftUI/UIKit，以及最终生成 iOS 工程的跨平台应用。遵循项目技术栈和现有 CI，不为了发布改写实现。开发阶段使用本参考识别发行约束；用户只要求开发/检查时不得顺带上传或送审。

## 产品平台与商店平台

iPhone 和 iPad 是不同设备支持目标，但 App Store Connect 中通常共用 `IOS` 平台版本。iPadOS 不是可随意传给 ASC 的 `IPADOS` 平台枚举。明确项目属于 iPhone-only、iPad-only 或 iPhone+iPad，核对实际 target 的 supported destinations、TARGETED_DEVICE_FAMILY、部署版本与归档后的 UIDeviceFamily。

同一 iOS 通用构建可同时服务 iPhone/iPad，不应为 iPad 自动重复创建 App 记录、Bundle ID 或审核提交。若本来是独立产品/独立标识则保留现有设计，不自动合并。Mac Catalyst、原生 macOS，以及 Apple silicon Mac 上运行的 iOS/iPadOS 应用是不同发行路径，不要混同。

记录兼容应用在 Apple silicon Mac/Apple Vision Pro 的可用性设置，并按用户选择和实际兼容性处理；不因系统默认就声称原生支持，也不未经授权扩大产品覆盖。tvOS/watchOS/visionOS 独立项目需另核验对应流程，本参考不宣称已覆盖其专用发行要求。

## 开发阶段发行约束

- 明确支持设备、最低 OS、方向、窗口适配、键盘/指针及多任务需求；检查当前 SDK 的要求。iPad 布局不能仅把 iPhone 画面拉大。
- 配置稳定的 Bundle ID、团队与 capability；扩展、Widget、App Clip 等独立 target 核验自己的身份、版本关系、签名和共享组。
- 按实际功能设计权限拒绝路径、隐私同意、账号删除、登录、StoreKit 购买和恢复；有云服务时准备审核环境和必要测试账号。
- 发布构建使用正式或审核可用后台，避免测试开关、内置秘密、占位内容；API keys 不因打入 IPA 就变安全。
- 上架准备不等于从零设计应用。若核心功能未实现，先按用户范围完成开发或明确开发阻塞，不用生成文案掩盖缺失。

## 测试矩阵

用最少但覆盖风险的矩阵记录机型/OS/版本/结果：

| 目标 | 必需关注 |
|---|---|
| iPhone | 小屏与代表性大屏布局、安全区、键盘遮挡、支持方向、权限及核心流程 |
| iPad | iPad 原生布局、支持的窗口尺寸和方向、多任务适配、popover/菜单、键盘与指针相关流程 |
| 两者共用 | 干净安装、升级与数据迁移、启动/后台恢复、离线/慢网、拒绝权限、登录过期、本地化和可访问性 |
| 功能相关真机 | 相机、推送、蓝牙、生物识别、后台任务、购买、硬件或设备特定能力 |

先做本地/模拟器检查，硬件或服务链路依赖真机时需实际设备证据。无设备就明确未验证项，不把模拟器结果写成真机通过。只检查声明支持的方向/能力，不强加所有方向或多任务模式。

## Archive、签名与导出

1. 读取实际 scheme、project/workspace、configuration 与依赖安装方式；检查当前 Apple 接受的 Xcode/SDK 要求，不能永久固定版本号。
2. 读取远端现有版本、build 和进行中的上传，选择未占用构建号。主应用及相关 extension 的版本关系按 Apple 规则检查。
3. 归档面向真实设备分发（generic iOS destination），不能把模拟器 `.app` 当作 App Store 产物。使用项目 CI、Xcode 或已核验帮助的 `asc xcode archive/export`。
4. 自动签名或手动签名遵循项目约定。核验 distribution 身份、profile、团队、capabilities 和所有嵌入 targets；新增 capability 可能需要更新 profile。
5. 导出 App Store Connect 可用产物并验证 IPA 中 Info.plist、签名、profile、架构、图标、隐私清单、设备家族和真实版本。记录 archive/IPA 的可追溯位置、哈希和必要符号文件。
6. 希望最终进入 App Store 时，不能选择仅限内部测试的导出方式；“TestFlight Internal Only”构建不能用于正式 App Review。已有此类构建应重新按正确方式归档/导出，使用适当的新构建号。

不要将 MAS 的 PKG、Mac Installer Distribution、沙盒 inherit 或 Developer ID 公证步骤套用到 IPA。

## TestFlight 路径

用户只要求 TestFlight 时，以构建分配到指定测试组并验证可测试状态为目标，不提交正式 App Store 审核。TestFlight 不是所有应用上架的强制先决步骤。

- 读取现有 groups/builds，解析精确 App/Build/Group ID；构建有效且对应版本后才分配。只添加缺失关系。
- 区分内部和外部测试；外部测试可能需要 Beta App Review，并需对应测试描述、What to Test、审核信息。
- 添加测试者、发送邀请、开启公开测试链接会扩大分发范围，必须符合用户明确指定的对象/范围；不能为省审核把外部人员加入公司后台团队。
- App Store 审核、TestFlight Beta App Review 和测试者可安装状态分别记录。Beta 审核通过不能写成正式审核通过。
- 按用户要求分析反馈和崩溃；不擅自创建长期监控或把私人测试反馈提交公开仓库。

## 截图和正式提交

支持 iPad 时核对 iPad 截图要求，不仅上传 iPhone 图。按当前 Apple 尺寸表、实际支持设备和语言生成截图；必要的 iPhone/iPad screenshot sets 分别验证，不复用截图拉伸冒充另一设备界面。原生 app 与必要扩展在截图/文案中展示真实功能。

最终将已验证构建关联到 IOS 平台的正确版本。依次执行工程审核、ASC 验证、隐私发布确认、产品/内购审核项目检查、支持网站和审核路径检查，再按授权提交。一个通用 iPhone/iPad 版本不重复提交两次。

## 官方依据

执行前核对相关当前要求：
- [增加平台与 iPhone/iPad 支持](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms)
- [截图规格](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [分发测试版及正式版](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
- [TestFlight 概览](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
- [仅内部测试导出的限制](https://developer.apple.com/tutorials/develop-in-swift/test-your-beta-app)
