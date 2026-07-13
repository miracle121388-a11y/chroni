# Chroni

Chroni 是一个以桌宠为入口的本地 DDL 日程助手。用户可以拖入文字、文档、表格或图片，Chroni 会进行本地解析/OCR，并可调用 DeepSeek 等 OpenAI 兼容模型抽取明确的截止事项。

## 环境要求

- Windows 10/11、macOS 或 Linux
- Node.js 22.13 或更高版本（pnpm 11 需要该版本）
- pnpm 11.7.0（也可以直接使用下方的 `npx pnpm@11.7.0`）

## Windows 开发运行

在 PowerShell 中执行：

```powershell
cd D:\Users\Lenovo\Desktop\Chroni
npx pnpm@11.7.0 install
npx pnpm@11.7.0 run dev
```

`dev` 会同时启动 Vite renderer 和 Electron。看到以下信息表示启动完成：

```text
VITE ready
Chroni desktop shell ready.
Chroni API listening at http://127.0.0.1:8765
```

Chroni 主要通过桌宠、屏幕右侧 DDL 抽屉和系统托盘运行。关闭控制中心不会退出应用；需要退出时请在托盘图标菜单中选择“退出 Chroni”。开发终端可按 `Ctrl+C` 停止。

生产构建后本机启动：

```powershell
npx pnpm@11.7.0 run start
```

分开排查 renderer 和 Electron：

```powershell
# 终端 1
npx pnpm@11.7.0 --filter @chroni/desktop run dev:renderer

# 终端 2
npx pnpm@11.7.0 --filter @chroni/desktop run dev:electron
```

项目启动器会主动删除父终端中的 `ELECTRON_RUN_AS_NODE`，避免 Electron 被误当作普通 Node.js 执行。

如果从 PowerShell 直接运行打包后的 `.exe`，且当前终端曾设置过 `ELECTRON_RUN_AS_NODE=1`，请先执行：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

从资源管理器或开始菜单正常启动时通常不受该终端变量影响。

## DeepSeek 配置

### 使用项目根目录 `.env`（本地开发推荐）

复制示例文件，并填写你自己的 Key：

```powershell
Copy-Item .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

`.env` 内容如下：

```dotenv
CHRONI_LLM_ENABLED=1
CHRONI_LLM_BASE_URL=https://api.deepseek.com
CHRONI_LLM_MODEL=deepseek-v4-flash
CHRONI_LLM_API_KEY=你的_DeepSeek_API_Key
```

然后重新启动 `pnpm run dev` 或 `pnpm run start`。Chroni 启动器会读取仓库根目录的 `.env`；系统/终端中已经存在的同名环境变量优先级更高。`.env` 已被 Git 忽略，`.env.example` 只保留无密钥模板。

`.env` 中的 LLM 配置优先于控制中心已保存的同名配置。使用环境变量时，API Key 不会回填到界面；控制中心的“测试连接”会使用当前进程最终解析出的有效配置。可在“运行状态”中确认当前模型是否就绪。将 `CHRONI_LLM_ENABLED` 设为 `0` 可显式关闭环境变量启用的模型。

### 使用控制中心

推荐在 Chroni 控制中心填写：

1. 从托盘菜单打开“控制中心”。
2. 进入“偏好”并展开“高级 -> 大模型 API”。
3. `Base URL` 填写 `https://api.deepseek.com`。
4. `模型`填写 `deepseek-v4-flash`；需要更强模型时可填写 `deepseek-v4-pro`。
5. `API Key` 填写 DeepSeek 控制台生成的 Key。
6. 点击“保存并测试”，等待界面显示模型连接成功。
7. 开启“启用 LLM 抽取”。

API Key 使用 Electron `safeStorage` 交给操作系统安全存储加密，不会以明文写入 `chroni-state.json`。如果系统安全存储不可用，界面填写的 Key 只在当前运行期间有效。

也可以不创建 `.env`，直接在启动 Chroni 的同一个 PowerShell 窗口中使用环境变量：

```powershell
$env:CHRONI_LLM_ENABLED="1"
$env:CHRONI_LLM_BASE_URL="https://api.deepseek.com"
$env:CHRONI_LLM_MODEL="deepseek-v4-flash"
$env:CHRONI_LLM_API_KEY="你的 DeepSeek API Key"
npx pnpm@11.7.0 run dev
```

大模型字段在编辑期间只保留为界面草稿，点击“保存并测试”后才会写入本机。连接测试会真实发送一个最小请求，并区分 API Key、模型名称、限流和超时问题。模型请求默认在 25 秒后终止。

启用 LLM 后，文件仍先在本机解析，但抽取出的文本会发送到所配置的模型服务。模型不可用时，如果本地规则仍能可靠识别，Chroni 会保留结果并明确提示已回退；无法可靠识别时不会生成可疑日程。

## DeadlineAgent

控制中心的 `Agent` 标签页提供一个混合式今日巡检闭环：本地规则可以独立运行；配置模型后，大模型会生成受约束的结构化时间分配和建议，再由本地代码验证、执行和复查。

```text
Observe 读取真实任务和当前时间
  -> Plan 计算风险、今日优先级和工作块
  -> Act 在高风险或容量不足时调用重新规划，并按设置发送提醒
  -> Verify 复查高风险、未安排任务和时间缺口
```

点击“运行巡检”后，页面会显示规划来源、今日建议、高风险 DDL、工作块、覆盖率、真实工具结果以及 Observe / Plan / Act / Verify Trace。模型不能虚构任务或直接修改截止时间、完成状态和来源内容；输出非法、超容量或调用失败时自动回退到本地规则。

Agent Memory 包含每日最大工作分钟、工作开始/结束时间、提醒频率、自动巡检开关和大模型辅助规划开关。默认每日容量为 240 分钟，工作时段为 09:00–18:00。每天首次启动会自动巡检，DDL 变化后会防抖重跑，均可关闭。Memory、应用计划、最新巡检和最多十份 Trace 历史保存在 `chroni-state.json`，Trace 只记录结构化摘要、规划来源和工具结果，不包含 API Key、原始文档、模型原始响应或隐藏推理。

### 主动追问、任务规划与 Behavior Memory

信息不完整时，Chroni 不会猜测最终 DDL。它会保存可恢复的 `IntakeDraft`，并在日程页和 Agent 页显示待确认问题；回答后从原草稿继续处理，重复回答不会重复创建任务。必要字段未解决前不能创建正式任务，放弃草稿会使关联问题失效。

文件抽取与任务拆解是两次独立的模型调用。第一阶段从原文提取截止时间、固定活动、提交物、提交方式、限制、风险和不确定性，并用规范化后的原文证据逐项校验；Markdown 标记差异不会导致有效结果被拒绝。课次、模糊时段和条件性候选截止会进入待确认任务，不会擅自换算成钟点或覆盖正式 DDL。第二阶段只针对已经确认的单个任务生成计划，并接收第一阶段校验过的上下文，因此步骤会覆盖真实提交物和提交方式。任务详情中的“原文要求”可用于人工核对，规划来源中的 `llm`、`personalized-llm` 或 `rules-fallback` 会明确说明实际使用的路径。

每个任务可从“规划详情”进入结构化工作区。任务创建后会生成规则或 LLM 规划草案，但只有点击“确认并启用”才成为 active plan。步骤支持修改标题、说明、耗时和状态，支持拖动/按钮排序、新增、删除与版本记录；保存时使用 `baseVersion` 防止静默覆盖。DeadlineAgent 使用 active plan 中未完成步骤的剩余时间，并将下一步骤关联到今日工作块。

Behavior Memory 只从用户明确保存的结构化规划 Diff 学习，不读取输入框过程，也不进行训练。首次一致修改只形成 candidate；至少三次一致证据且置信度达到门槛后才成为 active。偏好按任务类型等范围隔离，显式偏好优先；用户可停用、删除、关闭学习、关闭自动应用或清除全部行为记录。模型只接收当前任务相关摘要和最多 8 条已选择的结构化偏好，不接收完整反馈历史。

“导出 ICS”会把当前未完成 DDL 写入 Electron 用户数据目录下的 `exports/`。任务抽取、风险检查、本地规划、风险优先重排、计划持久化、提醒和日历导出均通过明确工具边界提供。提醒遵守系统开关、勿扰时间和去重策略；Trace 会区分已发送、跳过和失败。

## 支持的输入

- 文本与结构化文本：TXT、MD、CSV、TSV、JSON、ICS、LOG、HTML、XML、YAML、RTF
- 文档与表格：DOCX、PDF、XLSX
- 图片 OCR：PNG、JPG/JPEG、WEBP、BMP、TIF/TIFF
- 直接文本：桌宠拖放、控制中心快速添加、本地 HTTP API

单个文档最大 18 MiB，纯文本最大 2 MiB。图片 OCR 的可靠性阈值为 55；没有文本层的扫描 PDF 会先渲染页面再进行 OCR。TXT 支持 UTF-8、UTF-16 和 GBK/GB18030。空文件、乱码、非法日期和没有明确任务语义的内容会返回具体失败原因。

## 本地 HTTP API

API 默认只监听 `127.0.0.1:8765`。每次启动会生成会话令牌；除健康检查外的所有接口都要求 Bearer 鉴权。实际监听地址会写入 Electron 用户数据目录的 `chroni-api.json`，其中包含 `baseUrl`、进程 ID 和启动时间；应用退出后该文件会自动删除。

PowerShell 示例：

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
    text = "7月12日 23:59 提交课程报告"
  } | ConvertTo-Json)
```

文件可以通过 `contentBase64` 直接交给 API，不需要让调用方访问 Electron 的文件选择器。下面示例会解析并保存文件中的任务；将 `/api/intake` 改为 `/api/extract` 可只预览抽取结果而不写入日程：

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

主要接口：

```text
GET    /api/health
GET    /api/snapshot
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

如果系统用户数据目录不是 `%APPDATA%\Chroni`，可在“运行状态”中点击“打开本地数据位置”确认 `chroni-api.json`。需要固定 API 令牌时，在启动前设置 `CHRONI_API_TOKEN`。浏览器跨域默认关闭；只有设置精确的 `CHRONI_API_ALLOWED_ORIGIN` 后，该 Origin 才能访问。HTTP JSON 请求体上限为 32 MiB，所有请求会进行运行时字段校验；HTTP snapshot 会移除 LLM API Key、来源全文和近期反馈事件。

## 检查与打包

```powershell
npx pnpm@11.7.0 run check
npx pnpm@11.7.0 run package:desktop
```

`check` 依次执行 TypeScript 检查、自动化测试和 renderer/main 构建。Windows 安装包和便携版输出到 `apps/desktop/dist-electron/`。

仓库的 `Windows Release Build` 工作流可手动运行，也会在推送 `v*` 标签时构建安装包和便携版并上传 Actions artifact。正式签名时，在 GitHub 仓库 Secrets 中配置 `WINDOWS_CSC_LINK`（PFX 的 Base64 或安全下载地址）和 `WINDOWS_CSC_KEY_PASSWORD`；没有证书时仍可生成未签名的测试构建。

## 常见问题

### `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`

该行只是 pnpm 的汇总，真实原因在它上方。当前开发脚本会以 Electron 子进程的退出码为准，正常关闭应用不会因为 Vite 被联动停止而误报失败。如果仍有错误，请从第一条 `[electron]` 或 `[renderer]` 错误开始检查。

### 文件显示为空或没有识别结果

- 确认文件扩展名在支持列表中且文件不是 0 字节。
- TXT 支持 UTF-8、UTF-16、GBK 和 GB18030；仍失败时确认文件不是二进制内容伪装成 TXT。
- 扫描 PDF 会自动进入页面 OCR；页数较多时处理时间会明显增加。
- XLSX 会读取全部工作表；图片 OCR 首次运行需要初始化中英文识别数据，耗时通常高于纯文本文件。
- 控制中心会显示“文件无法读取”“文本无法可靠解析”“OCR 置信度不足”或“没有明确截止时间”等具体原因。
- 同一个文件修正后可以直接再次选择，文件输入会在每次处理后重置。

### DeepSeek 显示“模型返回内容为空”

先确认使用最新代码并重新启动 Chroni。`deepseek-v4-flash` 默认可进入思考模式，Chroni 的结构化抽取、规划和连接探测会统一关闭该模式，避免较小输出预算只产生推理内容而没有最终答案。仍然失败时，在“偏好 -> 高级 -> 大模型 API”点击“保存并测试”，根据界面显示的鉴权、模型、限流或网络分类继续排查；`.env` 和系统环境变量会覆盖界面保存值。

### 端口 8765 被占用

Chroni 会自动改用一个随机空闲端口，并同时更新 `chroni-api.json` 与启动终端中的实际地址。也可以在启动前设置 `CHRONI_API_PORT`，例如 `$env:CHRONI_API_PORT="8877"`。

## 数据与许可证

日程、来源、偏好和桌宠的显示器相对位置保存在 Electron 用户数据目录。重新启动、分辨率变化或移除显示器后，Chroni 会恢复并校正桌宠位置，保证窗口仍在可见工作区内。可在“运行状态”中点击“打开本地数据位置”。项目采用 MIT License。桌宠视觉资产来自 XIAOTONG Desktop Pet，相关许可证与附加条款保存在 `apps/desktop/third_party/xiaotong/`。
