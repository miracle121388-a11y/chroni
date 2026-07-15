<p align="center">
  <img src="./apps/desktop/build/icon-source.svg" width="104" alt="Chroni 应用图标">
</p>

<h1 align="center">Chroni</h1>

<p align="center">
  <strong>把散落在通知、文档、表格和截图里的 DDL，变成今天真正做得完的计划。</strong>
</p>

<p align="center">
  Local-first desktop deadline agent for Windows and macOS.<br>
  文件解析、OCR、DeepSeek 结构化抽取、任务拆解、每日时间块与桌宠提醒，在一个闭环里完成。
</p>

<p align="center">
  <a href="https://github.com/miracle121388-a11y/chroni/actions/workflows/ci.yml"><img src="https://github.com/miracle121388-a11y/chroni/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/miracle121388-a11y/chroni?color=2f6b61" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-31566d" alt="Windows and macOS">
  <img src="https://img.shields.io/badge/Electron-42-47848f" alt="Electron 42">
  <img src="https://img.shields.io/badge/TypeScript-6-3178c6" alt="TypeScript 6">
  <a href="https://github.com/miracle121388-a11y/chroni/releases/latest"><img src="https://img.shields.io/badge/download-latest%20release-2f6b61" alt="Download latest release"></a>
</p>

<p align="center">
  <a href="#为什么选择-chroni">核心能力</a> ·
  <a href="#界面预览">界面预览</a> ·
  <a href="#下载与安装">下载</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#连接-deepseek">DeepSeek</a> ·
  <a href="#本地-http-api">HTTP API</a> ·
  <a href="#参与开发">参与开发</a>
</p>

![Chroni 每日任务时间轴，展示 Agent 自动规划的任务块](./docs/assets/chroni-daily-planner.png)

> [!IMPORTANT]
> Chroni 正在积极开发中。Windows 与 macOS 用户可以直接从 GitHub Releases 安装；正式分发时请优先选择带代码签名和 macOS 公证的版本，并使用发布页附带的 SHA-256 校验和验证文件。

## Chroni 是什么

Chroni 不是把一句话转成一条待办的演示程序，而是一个以 **Deadline Agent** 为核心、以桌宠为轻量入口的桌面执行系统。它会先读取真实材料，保留可核验的原文证据，再把明确事项转换为任务、步骤和今日时间块；只有缺少会改变任务含义的必要信息时，才在已有规划之后请求确认。

```mermaid
flowchart LR
  A["拖入通知、文档或截图"] --> B["本地解析与 OCR"]
  B --> C["DeepSeek 结构化抽取"]
  C --> D["证据校验与任务拆解"]
  D --> E["风险、容量与依赖评估"]
  E --> F["生成每日时间块"]
  F --> G["桌宠提醒、执行与复盘"]
  G --> E
```

从“这份材料里有哪些事”到“我今天几点做什么”，Chroni 负责的是完整链路。

## 为什么选择 Chroni

| 能力 | Chroni 的处理方式 |
| --- | --- |
| 多格式真实输入 | TXT、Markdown、PDF、DOCX、XLSX、ICS、图片等统一进入同一抽取管线；扫描 PDF 会进入 OCR。 |
| 有依据的智能抽取 | LLM 负责理解复杂语义，本地代码负责证据、字段、日期和容量校验；无法可靠确认时不会静默编造日程。 |
| 先完成规划，再主动追问 | 同一材料中明确的任务会直接落地；模糊日期、条件性事项等被单独标记，避免一个疑问阻塞整份文件。 |
| Agent 主导的任务拆解 | 基于截止时间、剩余工时、工作时段、依赖和缓冲计算风险，生成可编辑、可激活、可追踪版本的 TaskPlan。 |
| 可执行的每日规划 | 日、多日、周、月视图与 Inbox；任务按时长占据真实高度，同一时段自动分栏，并支持拖拽重排、缩放和历史回顾。 |
| 个性化 Behavior Memory | 只从用户明确保存的规划修改中学习；达到独立证据与置信度门槛后才应用，并可随时停用、删除或清空。 |
| 桌面原生提醒 | 桌宠、气泡、右侧日程抽屉、系统通知和托盘协同工作，提醒遵守勿扰时间、频率设置与去重策略。 |
| Local-first 与可集成 | 状态保存在本机，API Key 交由系统安全存储；带鉴权的本地 HTTP API 可接入自动化脚本和其他工具。 |

## 界面预览

### Deadline Agent 工作台

Agent 会说明当前计划覆盖率、风险、今日优先级和下一步，而不是只返回一段无法执行的建议。所有模型输出都必须经过本地工具和约束校验。

![Chroni Deadline Agent 工作台，展示覆盖率、风险和今日工作块](./docs/assets/chroni-agent-workspace.png)

### 桌宠与控制中心

- **左键桌宠**：打开或切换日程抽屉；控制中心和日程窗口都可独立拖动。
- **拖入材料**：进入解析、OCR、抽取与规划流程，桌宠会用动作和气泡反馈当前状态。
- **完成任务**：同步更新日程、每日时间块与 TaskPlan 步骤，并触发完成反馈。
- **后台常驻**：关闭窗口不会退出 Chroni；可从系统托盘重新打开控制中心或完全退出。

## Agent 如何工作

Deadline Agent 使用可审计的 `Observe -> Plan -> Act -> Verify` 循环：

1. **Observe**：读取真实任务、当前时间、已激活步骤、用户工作时段和每日容量。
2. **Plan**：计算剩余工时、截止前可用容量、依赖、缓冲和 slack，生成优先级与工作块。
3. **Act**：在容量不足或高风险时重新规划，写入每日任务，并按偏好发送提醒。
4. **Verify**：复查高风险、未安排任务、时间冲突和覆盖缺口，记录结构化 Trace。

模型不能虚构任务，也不能直接修改截止时间、完成状态或来源证据。模型输出非法、超出容量、超时或不可用时，Chroni 会回退到本地规则并明确标识来源。

每个 DDL 都可以进入“规划详情”工作区：修改步骤、耗时、依赖与状态，查看历史版本，然后显式“确认并启用”。Deadline Agent 只把依赖已满足且未受阻的下一步排进今天，避免把风险任务伪装成已经可执行。

更完整的设计说明见 [主动追问、任务规划与 Behavior Memory](./docs/agent-clarification-task-planning-memory.md)。

## 下载与安装

前往 [Latest Release](https://github.com/miracle121388-a11y/chroni/releases/latest) 下载，无需安装 Node.js、pnpm 或开发工具。

| 平台 | 推荐文件 | 使用方式 |
| --- | --- | --- |
| Windows 10/11 x64 | `Chroni-<version>-win-x64-setup.exe` | 双击安装，可选择目录，并创建开始菜单与桌面快捷方式 |
| Windows 10/11 x64 | `Chroni-<version>-win-x64-portable.exe` | 不安装，直接放到任意目录运行 |
| macOS 12+ | `Chroni-<version>-mac-universal.dmg` | 同时兼容 Intel 与 Apple Silicon，拖入 Applications 即可 |

安装后的 Chroni 会常驻系统托盘。第一次启动可以直接使用本地规则；需要理解复杂通知、图片和跨段落材料时，再在“偏好 -> 高级 -> 大模型 API”中填写 DeepSeek Key。

Chroni 会在后台检查 GitHub Releases。新版本下载完成后，“运行状态”页面会出现“重启并安装”，也可以通过托盘菜单手动检查。应用不会在工作过程中突然重启。

<details>
<summary><strong>验证下载文件</strong></summary>

每个 Release 都包含 `SHA256SUMS.txt`。Windows PowerShell：

```powershell
Get-FileHash .\Chroni-0.1.0-win-x64-setup.exe -Algorithm SHA256
```

macOS：

```bash
shasum -a 256 Chroni-0.1.0-mac-universal.dmg
grep 'Chroni-0.1.0-mac-universal.dmg' SHA256SUMS.txt
```

计算结果应与发布页完全一致。Release 还附带 GitHub build provenance attestation，可使用 GitHub CLI 验证构建来源。

</details>

## 快速开始

以下内容面向希望修改代码或从源码运行的开发者。普通用户请直接使用上方安装包。

### 开发环境要求

- Windows 10/11、macOS 12+ 或 Linux 开发环境
- Node.js `22.13+`
- pnpm `11.7.0`，也可以直接使用下方固定版本的 `npx` 命令

### 1. 获取源码与依赖

```bash
git clone https://github.com/miracle121388-a11y/chroni.git
cd chroni
npx pnpm@11.7.0 install
```

### 2. 启动开发环境

Windows PowerShell：

```powershell
npx pnpm@11.7.0 run dev
```

macOS Terminal：

```bash
npx pnpm@11.7.0 run dev
```

启动完成后，终端会看到：

```text
VITE ready
Chroni desktop shell ready.
Chroni API listening at http://127.0.0.1:8765
```

Chroni 会显示桌宠并常驻系统托盘。关闭控制中心不会退出应用；需要完全退出时，请在托盘菜单选择“退出 Chroni”。开发终端中可使用 `Ctrl+C` 停止。

### 3. 运行本地生产构建

```bash
npx pnpm@11.7.0 run start
```

<details>
<summary><strong>Windows 启动失败或需要分开排查</strong></summary>

`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` 是 pnpm 的汇总行，真正原因通常在它上方第一条 `[electron]` 或 `[renderer]` 错误。

可以使用两个 PowerShell 窗口分别运行：

```powershell
# 窗口 1
npx pnpm@11.7.0 --filter @chroni/desktop run dev:renderer

# 窗口 2
npx pnpm@11.7.0 --filter @chroni/desktop run dev:electron
```

项目启动器会清理父终端中的 `ELECTRON_RUN_AS_NODE`。如果直接运行打包后的 `.exe` 仍受该变量影响，可先执行：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

</details>

## 连接 DeepSeek

Chroni 支持 OpenAI 兼容接口，项目默认配置示例使用 DeepSeek。你可以选择控制中心或 `.env`，无需修改源代码。

### 方式一：控制中心

1. 从托盘打开“控制中心”。
2. 进入“偏好”，展开“高级 -> 大模型 API”。
3. `Base URL` 填写 `https://api.deepseek.com`。
4. `模型`填写 `deepseek-v4-flash`；需要更强模型时可填写 `deepseek-v4-pro`。
5. 填写 DeepSeek API Key，点击“保存并测试”。
6. 测试成功后开启“启用 LLM 抽取”。

API Key 使用 Electron `safeStorage` 交由操作系统安全存储加密，不会明文写入 `chroni-state.json`。连接测试会发送一个最小真实请求，并区分鉴权、模型、限流、网络和超时错误。

### 方式二：项目根目录 `.env`

```powershell
# Windows
Copy-Item .env.example .env
```

```bash
# macOS
cp .env.example .env
```

编辑 `.env`：

```dotenv
CHRONI_LLM_ENABLED=1
CHRONI_LLM_BASE_URL=https://api.deepseek.com
CHRONI_LLM_MODEL=deepseek-v4-flash
CHRONI_LLM_API_KEY=你的_DeepSeek_API_Key
```

重新启动 Chroni 后生效。系统或终端环境变量优先于 `.env`，`.env` 又优先于控制中心保存的同名字段。可在“运行状态”确认当前模型是否就绪。模型名称和接口变化请以 [DeepSeek API 文档](https://api-docs.deepseek.com/) 为准。

> [!NOTE]
> 文件解析和 OCR 先在本机完成；启用 LLM 后，抽取出的文本会发送到你配置的模型服务。关闭 LLM 时本地规则仍可处理结构明确的内容，但复杂语义、跨段落关联和图片文本理解能力会受到限制。

## 支持的输入

| 类型 | 格式 |
| --- | --- |
| 文本与结构化文本 | TXT、MD、CSV、TSV、JSON、ICS、LOG、HTML、XML、YAML、RTF |
| 文档与表格 | DOCX、PDF、XLSX |
| 图片 OCR | PNG、JPG/JPEG、WEBP、BMP、TIF/TIFF |
| 直接输入 | 桌宠拖放、控制中心快速添加、本地 HTTP API |

- 单个文档最大 `18 MiB`，纯文本最大 `2 MiB`。
- TXT 支持 UTF-8、UTF-16、GBK 与 GB18030。
- 没有文本层的扫描 PDF 会先渲染页面，再进行 OCR。
- OCR 可靠性阈值为 `55`；空文件、乱码、非法日期和缺少任务语义时会返回具体原因。
- `/api/extract` 只预览结果，`/api/intake` 会在校验后写入日程。

## 本地 HTTP API

Chroni 默认只监听 `127.0.0.1:8765`。每次启动会生成会话令牌；除健康检查外的接口都要求 Bearer 鉴权。实际地址和进程信息写入 Electron 用户数据目录下的 `chroni-api.json`，退出后自动删除。

PowerShell 文本抽取示例：

```powershell
$discovery = Get-Content "$env:APPDATA\Chroni\chroni-api.json" | ConvertFrom-Json
$health = Invoke-RestMethod "$($discovery.baseUrl)/api/health"
$headers = @{ Authorization = "Bearer $($health.apiToken)" }

Invoke-RestMethod `
  -Method Post `
  -Uri "$($discovery.baseUrl)/api/extract" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    kind = "text"
    text = "7月18日 18:00 前提交实验报告 PDF"
  } | ConvertTo-Json)
```

<details>
<summary><strong>通过 API 上传文件并直接填入</strong></summary>

```powershell
$file = Get-Item "D:\资料\课程安排.xlsx"
$body = @{
  kind = "files"
  files = @(@{
    name = $file.Name
    contentBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))
  })
} | ConvertTo-Json -Depth 4

Invoke-RestMethod `
  -Method Post `
  -Uri "$($discovery.baseUrl)/api/intake" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

</details>

<details>
<summary><strong>主要 API</strong></summary>

```text
GET    /api/health
GET    /api/snapshot
GET    /api/daily-tasks
POST   /api/daily-tasks
PATCH  /api/daily-tasks/:id
DELETE /api/daily-tasks/:id
POST   /api/agent/run
GET    /api/agent/latest
PATCH  /api/agent/memory
POST   /api/agent/export-ics
GET    /api/agent/clarifications
POST   /api/agent/clarifications/:id/answer
POST   /api/agent/clarifications/:id/dismiss
GET    /api/intake-drafts/:id
DELETE /api/intake-drafts/:id
GET    /api/items/:id/plan
POST   /api/items/:id/plan
PUT    /api/items/:id/plan
POST   /api/items/:id/plan/regenerate
POST   /api/items/:id/plan/activate
GET    /api/items/:id/plan/revisions
PATCH  /api/agent/behavior-memory
DELETE /api/agent/behavior-memory
POST   /api/agent/behavior-memory/preferences
PATCH  /api/agent/behavior-memory/preferences/:id
DELETE /api/agent/behavior-memory/preferences/:id
POST   /api/extract
POST   /api/intake
PATCH  /api/items/:id
DELETE /api/items/:id
PATCH  /api/preferences
POST   /api/sources/:id/reprocess
```

如需固定令牌，可在启动前设置 `CHRONI_API_TOKEN`。浏览器跨域默认关闭，只有设置精确的 `CHRONI_API_ALLOWED_ORIGIN` 后对应 Origin 才能访问。HTTP JSON 请求体上限为 `32 MiB`；HTTP snapshot 会移除 LLM API Key、来源全文和近期反馈事件。

</details>

## 本地数据与隐私

- 日程、来源、偏好、Agent Memory、计划版本和窗口位置保存在 Electron 用户数据目录。
- 可在“运行状态”中点击“打开本地数据位置”；Windows 默认位于 `%APPDATA%\Chroni`。
- Trace 只记录结构化摘要、规划来源和工具结果，不保存 API Key、模型隐藏推理或完整原始文档。
- Behavior Memory 不读取输入框过程，只使用用户明确保存的结构化规划差异。
- 桌宠位置按显示器工作区保存；分辨率变化或移除显示器后会自动校正到可见区域。
- 开启模型后，解析文本会发送到配置的第三方服务；敏感材料请根据自己的隐私要求决定是否启用。

## 技术架构

```text
Chroni
├─ apps/desktop
│  ├─ src/main.ts       Electron 生命周期、托盘与 IPC 入口
│  ├─ src/windows.ts    桌宠、日程与控制中心窗口管理
│  ├─ src/api-server.ts 带鉴权的本地 HTTP API
│  ├─ src/renderer      React 控制中心、每日任务、日程和桌宠界面
│  ├─ src/agent         抽取、规划、调度、Memory 与 Deadline Agent
│  ├─ src/shared        类型、时间轴布局和跨进程契约
│  └─ test              Node 测试与跨模块行为验证
├─ docs                 Agent 设计与项目视觉
└─ .github/workflows    Windows、macOS、Linux CI 与双端构建
```

核心技术：Electron 42、React 19、TypeScript 6、Vite 8、Tesseract.js、pdf-parse、Mammoth 与 read-excel-file。

## 开发与打包

```bash
# 类型检查、测试、main/renderer 构建
npx pnpm@11.7.0 run check

# 生成当前平台的桌面产物
npx pnpm@11.7.0 run package:desktop

# 显式生成 Windows 或 macOS 安装包
npx pnpm@11.7.0 run package:windows
npx pnpm@11.7.0 run package:macos
```

构建产物位于 `apps/desktop/dist-electron/`。CI 在 Windows、macOS 和 Linux 上执行完整检查；`Desktop Release` 工作流可以手动生成 30 天 artifact，也会在推送 `v*` 标签时创建正式 GitHub Release、更新元数据、SHA-256 校验和与构建来源证明。

Windows 公开分发需要代码签名；macOS 公开分发需要 Developer ID 签名与公证。完整的版本、Secrets、强制签名、标签和发布后验证步骤见 [发布指南](./docs/releasing.md)。

<details>
<summary><strong>常见文件识别问题</strong></summary>

- 确认扩展名在支持列表中，且文件不是 `0` 字节。
- 二进制内容即使改名为 `.txt` 也不会被当作文本解析。
- 扫描 PDF 和图片首次 OCR 需要初始化中英文识别数据，通常比纯文本慢。
- XLSX 会读取全部工作表；同一个文件修正后可以再次选择，输入控件会自动重置。
- 控制中心会区分“文件无法读取”“文本无法可靠解析”“OCR 置信度不足”和“没有明确截止时间”。
- DeepSeek 返回空内容时，先在“偏好 -> 高级 -> 大模型 API”执行“保存并测试”，再根据鉴权、模型、限流或网络分类排查。

</details>

## 参与开发

Chroni 仍处于快速迭代阶段，欢迎通过 [Issues](https://github.com/miracle121388-a11y/chroni/issues) 报告问题或讨论新能力，也欢迎提交 Pull Request。开始前请阅读 [贡献指南](./CONTRIBUTING.md)；安全漏洞请按照 [安全策略](./SECURITY.md) 私密报告。

提交前请运行：

```bash
npx pnpm@11.7.0 run check
```

为了让改动更容易审查，请尽量保持单一目标，并在 PR 中写明用户场景、行为变化、验证方式，以及涉及 UI 时的 Windows/macOS 截图。用户可见变化记录在 [CHANGELOG](./CHANGELOG.md)。

## 致谢与许可证

Chroni 使用 [MIT License](./LICENSE) 开源。

桌宠视觉资产来自 XIAOTONG Desktop Pet，其许可证和附加条款保存在 [`apps/desktop/third_party/xiaotong/`](./apps/desktop/third_party/xiaotong/)。感谢所有参与测试、反馈和贡献的人。

<p align="center">
  <strong>让截止日期不再只是一条提醒，而是一份今天可以开始执行的计划。</strong>
</p>
