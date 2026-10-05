# Chroni 商店审核说明

## 主要审核路径

1. 启动 Chroni。应用会显示桌面伙伴；macOS 可从“窗口 → 打开控制中心”（⌘1）、伙伴或菜单栏图标打开控制中心。
2. 在“智能整理”中输入 `明天 18:00 提交数据库实验报告`，确认本地规则可完成基础建档；如需测试语义模型，进入“偏好 -> 高级”，开启智能模型并确认数据发送说明。
3. 识别完成后打开“学习任务”，查看来源、目标、交付物、里程碑和完成标准。
4. 打开“今日执行”，选择“智能安排”，确认任务被放入时间轴。
5. 在学习任务中登记文字证据并提交阶段检查点，确认进度与下一步同步更新。
6. 打开“每日回顾”，按日期查看活动轨迹、完成指标和历史记录，编辑并保存当天总结。
7. 打开“运行状态”，可查看本地解析、OCR、模型、本地数据状态、隐私说明和开源许可。

## 无账号体验

- 所有公开功能均不需要账号、API Key 或服务访问码。新安装默认保持本地处理；审核人员明确同意数据发送说明后，即可测试模型抽取、主动追问、TaskPlan 和 Agent 规划。
- 托管服务达到公平使用额度或暂时不可用时会自动回退本地规则；审核人员也可以关闭智能模型，或改用自己的 OpenAI-compatible API。
- 应用不包含购买、订阅、广告、账号注册或隐藏付费入口。

## 平台行为

- 商店安装版由 Microsoft Store 或 Mac App Store 更新，应用内不会连接 GitHub 自动更新服务。
- Windows 后台驻留在系统托盘；macOS 后台驻留在菜单栏。关闭控制中心不会退出；macOS“窗口 → 打开控制中心”（⌘1）始终可重新打开，也可恢复最小化窗口。退出可使用应用菜单或托盘/菜单栏的“完全退出”。
- 本地 HTTP API 只监听 `127.0.0.1`，除健康检查外使用每次启动生成的 Bearer Token。

## 文件与网络权限

- 文件权限只用于用户主动选择或拖入的材料，以及用户主动选择的导出位置。
- 出站网络用于用户明确同意后开启的模型服务、首次语音模型下载，以及用户主动打开的产品、支持和隐私链接。商店版更新由 Mac App Store 管理。
- 入站网络只用于回环地址上的本地 API，不监听局域网接口。

## 隐私与许可入口

- 公开隐私政策：https://getchroni.zeabur.app/privacy.html
- 应用内路径：运行状态 -> 查看隐私说明
- Mac App Store 包使用 XIAOTONG 小童动画，完整保留 Apache-2.0、附加条款和原作者 About 信息（运行状态内可见）；应用本身免费，无付费功能。
- 开源依赖信息：运行状态 -> 开源许可与素材信息

## 2026-09-28：Guideline 2.1 补充材料

状态：2026-09-28 16:21（中国标准时间）已使用构建 `0.2.4 (3)` 重新提交，App Store Connect 确认为“等待审核”。六项英文正文已同时保存至 App Review Information 的 Notes，并于 16:18 发给 App 审核；同一份 4 分钟真机录像 `Chroni-0.2.4-build3-demo.mp4` 已分别上传至版本附件和审核消息附件。设备为 macOS 27.0（26A428）、Mac17,3，安装来源为 TestFlight。已验证小童显示、核心流程与重启数据保留。提交 ID：`a533c206-dc2e-4b72-8881-e3beeb491e03`。尚未获批或上架。

### 后续版本真机 QA 与录像参考清单

使用真实 Mac 上通过 TestFlight 安装的 `0.2.4 (3)`，不要用开发服务器、旧 DMG 或截图拼接代替提交版本。先核对“关于本机”的系统版本、机型以及 TestFlight 的版本/构建号。录屏建议 3–5 分钟（非 Apple 强制时长），开始录制后才启动 Chroni，连续展示典型流程，仅使用虚构材料。

1. 启动应用，展示小童伙伴，从菜单栏打开控制中心。
2. 在“智能整理”输入 `明天 18:00 提交数据库实验报告，预计需要 60 分钟。`，确认提取结果并保存。
3. 在“学习任务”打开新任务，查看截止时间、来源、目标与交付物；按实际界面补充并保存完成标准。
4. 在“今日执行”执行智能安排，展示任务时间块；登记一条虚构进度或成果证据。
5. 在“每日回顾”查看活动，编辑并保存总结。
6. 在“偏好 → 高级”展示智能模型默认关闭、接收方及同意说明。使用虚构数据同意后演示一次托管模型请求，再关闭模型。无法成功时记录实际错误，不宣称通过。
7. 展示“运行状态”的隐私和开源许可入口。关闭窗口后从菜单栏重新打开，确认数据保留；完全退出再启动，检查保存结果。

另外测试文件导入、离线本地整理、文件/麦克风权限拒绝后的可用性；如在视频中演示语音，先核验模型下载与真实本地转写。按实际执行记录设备、系统、安装来源、版本、测试日期、结果与已知问题。Apple 未要求本应用提供不存在的注册/登录/账号删除、公开社区举报/屏蔽、付费购买流程。

录像保存到仓库外，发送前检查没有个人课程材料、私人通知、账号信息或凭据。优先作为审核消息附件；如使用链接，应无需登录且审核人员可访问。后续版本须更新实际附件名或 URL，并在 Notes 中引用相同录像。下方为本次已提交正文。

### 2026-09-28 已提交英文回复与原 Notes 正文（历史记录）

Thank you for reviewing Chroni 0.2.4 (build 3).

1. Physical-device recording and testing
Attached: Chroni-0.2.4-build3-demo.mp4 (4 minutes). Recorded on a physical Mac (Mac17,3), macOS 27.0 (26A428), on September 28, 2026, using TestFlight build 3. It starts with launching the app and shows the XIAOTONG companion, task creation, progress evidence, scheduling, daily review, optional AI consent/use, licenses and restart. We verified these flows and saved-data persistence without a crash.

2. Purpose and audience
Chroni is a free, local-first macOS productivity app for students and independent learners, available to the general public. It turns course requirements and personal project materials into learning tasks, deadlines, schedules and progress records. Users control their plans; Chroni does not complete or submit assignments for them. It is not restricted to an institution or employer.

3. Setup and main features
No account, credentials, purchase, subscription, API key or access code is required, including for the optional managed AI service. Launch Chroni and open the control center from the companion or menu-bar icon.
In Smart Organize (智能整理), enter: 明天 18:00 提交数据库实验报告，预计需要 60 分钟。
Run organization, then open Learning Tasks (学习任务) to inspect the saved task, deadline, source and deliverables. Record a progress note. In Today (今日执行), choose Smart Schedule (智能安排) to create time blocks. In Daily Review (每日回顾), edit and save a summary. No sample file is required.
New installations use local rules. For optional AI, open Preferences > Advanced (偏好 > 高级), read the data-sharing disclosure and explicitly enable the managed service. You can disable it at any time. Closing the control center leaves the menu-bar app running; use Quit Completely (完全退出) to exit.
There is no registration, login or account-deletion flow. Tasks and notes are private productivity data; there is no public feed, publishing, messaging or interaction between users. Social reporting/blocking flows are not applicable. There are no paid features.

4. External services and tools
Electron provides the desktop runtime. Local storage, file parsing, OCR, scheduling and progress tracking run on the Mac. After explicit consent, optional managed AI sends necessary text through our Chroni gateway on Zeabur to DeepSeek. No DeepSeek key is shipped in the app. Users may optionally configure another OpenAI-compatible provider, with renewed consent. Service failures or usage limits fall back to local rules.
Optional speech transcription downloads onnx-community/whisper-tiny model files from Hugging Face on first use, then runs locally. Raw microphone audio is not uploaded to our gateway or DeepSeek. Zeabur hosts our support/privacy website. Updates come from the Mac App Store. There are no authentication, payment or advertising services.

5. Regional behavior
Functionality and content are consistent across mainland China, Hong Kong, Macao, Taiwan, Singapore and Malaysia. We do not enable different features by region. Optional network services depend on connectivity and provider availability; local features remain usable without AI.

6. Regulated services and third-party materials
Chroni does not provide regulated medical, financial, gambling or similar services. XIAOTONG Desktop Pet artwork is included under its Apache-2.0 license and additional terms. The complete licenses and original author attribution, repository link, contact and donation information are retained. Chroni is free with no paid features or advertising. It distributes no third-party course/media catalog; users import their own materials for private organization. Licenses and asset information are accessible in Runtime Status (运行状态).

Support: https://getchroni.zeabur.app/support.html
Privacy: https://getchroni.zeabur.app/privacy.html

## 2026-09-29：network.server 用途说明与复审

Apple 后台对应 2.4.5，自动分析未识别权限用途。已采用其要求的“解释必要权限”路径：在 Notes 置顶说明、App 沙盒信息中新增 `com.apple.security.network.server` 用途，并于 20:19 发送回复。20:22 重新提交 `0.2.4 (3)`，已读回“等待审核”。旧六项说明已精简保留，原录像附件仍在。

实测证据：安装版 build 3 主进程仅监听 TCP `127.0.0.1:8765`；健康检查 HTTP 200，任务接口无令牌 HTTP 401、有会话令牌 HTTP 200。用途是让本机脚本和自动化工具读取任务、导入文本、记录进度及访问排程，不向局域网或公网监听。健康检查有意提供本机会话令牌，不是云端账号认证。默认端口占用时，实际地址由沙盒 Application Support 目录中的 `chroni-api.json` 提供。完全退出后服务停止。

审核人员复现：启动 Chroni，在同一 Mac 执行 `curl http://127.0.0.1:8765/api/health`，取得本次 `apiToken` 后，以 `Authorization: Bearer <apiToken>` 请求 `/api/daily-tasks`。回复不含真实令牌和任务数据。本次保留必要权限与同一构建，无需重新打包。


## 2026-10-05：Guideline 4 窗口恢复修复与复审

Apple 10 月 3 日通知构建 3 缺少主窗口关闭后的应用菜单恢复入口。已在原生 macOS“窗口”菜单固定加入“打开控制中心”（⌘1），与既有 `showControlCenter` 共用恢复逻辑，不依赖伙伴或托盘菜单。关闭后重建、最小化后恢复且不重复创建窗口的原生 Electron 回归检查通过；命令为 `pnpm --filter @chroni/desktop run verify:macos-window-menu`。类型检查、正式小童构建、18 项打包测试及 MAS 最终产物检查通过。修复提交 `e971852` 已推送。

构建 `0.2.4 (4)` 已于 21:23（中国标准时间）由 Transporter 交付，21:26 完成处理，加入现有内部群组并从 TestFlight 安装。Mac17,3、macOS 27.0.1（26A434）真机复验启动、红色关闭按钮关闭后菜单重开、⌘1 重开、最小化恢复通过，原有 6 项任务及排程仍在；安装版构建号为 4。健康检查 200，任务接口无令牌 401、有令牌 200，未提交真实令牌或任务数据。

线上 Notes 已精简保存为 3,950 字符，保留先前六项说明、权限用途和原构建 3 功能录像，并明确新增构建 4 真机 QA。补录因捕获到其他工作画面而未采用、未上传；不能将它当作合格新录像。21:48 已回复 App Review 说明修复和复现步骤；21:49 更新提交并重新送审构建 4，后台确认为“等待审核”。提交 ID 仍为 `a533c206-dc2e-4b72-8881-e3beeb491e03`，审核通过后自动发布，尚未获批或上架。

### 本次发送的核心复现步骤

1. Launch Chroni and choose Window (窗口) > Open Control Center (打开控制中心).
2. Close the main window using its red close button.
3. Choose Window > Open Control Center again; the main window reopens.
4. Close it again and press Command+1; it reopens. Minimize it, then use the same command to restore it.

The menu command remains enabled after closing the control center. Chroni intentionally continues running for reminders and the desktop companion. Users can quit from the application menu or the menu-bar icon. Physical-device checks used TestFlight build 4 on October 5, 2026; the prior functionality recording is explicitly identified as build 3.
