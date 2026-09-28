# Chroni 商店审核说明

## 主要审核路径

1. 启动 Chroni。应用会显示桌面伙伴，并可从托盘或菜单栏打开控制中心。
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
- Windows 后台驻留在系统托盘；macOS 后台驻留在菜单栏。关闭控制中心不会退出，必须从托盘或菜单栏选择“完全退出”。
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

状态：构建 3 已在 macOS 27.0（26A428）、Mac17,3 真机通过核心流程与重启数据保留验证，2026-09-28 已完成 4 分钟连续录像，文件名 `Chroni-0.2.4-build3-demo.mp4`，保存在仓库外。下方正文已补齐六项要求。App Store Connect 界面操作暂时返回 noWindowsAvailable／键盘超时，已请负责人解锁并将 Safari 置于前台；线上 Notes、构建关联、审核消息与再次提交仍未完成。

### 真机 QA 与录像清单

使用真实 Mac 上通过 TestFlight 安装的 `0.2.4 (3)`，不要用开发服务器、旧 DMG 或截图拼接代替提交版本。先核对“关于本机”的系统版本、机型以及 TestFlight 的版本/构建号。录屏建议 3–5 分钟（非 Apple 强制时长），开始录制后才启动 Chroni，连续展示典型流程，仅使用虚构材料。

1. 启动应用，展示小童伙伴，从菜单栏打开控制中心。
2. 在“智能整理”输入 `明天 18:00 提交数据库实验报告，预计需要 60 分钟。`，确认提取结果并保存。
3. 在“学习任务”打开新任务，查看截止时间、来源、目标与交付物；按实际界面补充并保存完成标准。
4. 在“今日执行”执行智能安排，展示任务时间块；登记一条虚构进度或成果证据。
5. 在“每日回顾”查看活动，编辑并保存总结。
6. 在“偏好 → 高级”展示智能模型默认关闭、接收方及同意说明。使用虚构数据同意后演示一次托管模型请求，再关闭模型。无法成功时记录实际错误，不宣称通过。
7. 展示“运行状态”的隐私和开源许可入口。关闭窗口后从菜单栏重新打开，确认数据保留；完全退出再启动，检查保存结果。

另外测试文件导入、离线本地整理、文件/麦克风权限拒绝后的可用性；如在视频中演示语音，先核验模型下载与真实本地转写。按实际执行记录设备、系统、安装来源、版本、测试日期、结果与已知问题。Apple 未要求本应用提供不存在的注册/登录/账号删除、公开社区举报/屏蔽、付费购买流程。

录像保存到仓库外，发送前检查没有个人课程材料、私人通知、账号信息或凭据。优先作为审核消息附件；如使用链接，应无需登录且审核人员可访问。补齐实际附件名或 URL，并在 Notes 中引用相同录像。不要提交下方的未完成占位内容。

### 英文回复与 Notes 共用正文（材料齐备，待线上提交）

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
