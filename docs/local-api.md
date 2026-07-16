# Chroni 本地 HTTP API

Chroni 桌面应用会启动一个仅监听本机回环地址的 HTTP JSON API。它适合连接受信任的本地脚本、快捷指令和自动化工具，用于预览或写入 DDL、管理每日任务、运行 Deadline Agent，以及处理待确认草稿和任务规划。

本 API 不是远程服务接口。调用前必须先启动完整的 Chroni 桌面应用；关闭应用后，API 也会停止。

## 目录

- [连接与安全模型](#连接与安全模型)
- [快速开始](#快速开始)
- [抽取与接收](#抽取与接收)
- [请求与响应约定](#请求与响应约定)
- [端点索引](#端点索引)
- [支持格式与限制](#支持格式与限制)
- [CORS 与启动环境变量](#cors-与启动环境变量)
- [状态码与排错](#状态码与排错)

## 连接与安全模型

### 监听地址与端口

- 只监听 `127.0.0.1`，不监听局域网或公网地址。
- 默认端口为 `8765`。
- 如果默认或指定端口已被占用，Chroni 会改用系统分配的随机可用端口。
- 设置 `CHRONI_API_PORT=0` 可以从一开始就使用随机端口。
- 实际地址始终以 discovery 文件或 `/api/health` 返回的 `baseUrl` 为准，不要假定端口一定是 `8765`。

### Discovery 文件

Chroni 启动 API 后，会在 Electron 的用户数据目录写入 `chroni-api.json`：

```json
{
  "baseUrl": "http://127.0.0.1:8765",
  "pid": 12345,
  "startedAt": "2026-07-16T08:00:00.000Z"
}
```

常见位置如下：

| 平台 | 常见路径 |
| --- | --- |
| Windows | `%APPDATA%\Chroni\chroni-api.json` |
| macOS | `~/Library/Application Support/Chroni/chroni-api.json` |
| Linux | `$XDG_CONFIG_HOME/Chroni/chroni-api.json`；未设置时通常为 `~/.config/Chroni/chroni-api.json` |

实际位置由 Electron 的 `userData` 目录决定。也可以在 Chroni“运行状态”中点击“打开本地数据位置”确认目录。

应用正常退出时会删除属于当前进程的 discovery 文件；异常退出可能留下旧文件。因此读取后仍应请求 `/api/health` 验证地址，而不是仅凭文件存在判断服务可用。

### Bearer 令牌

除 `GET /api/health` 外，所有端点都要求：

```http
Authorization: Bearer <apiToken>
```

`GET /api/health` 会返回本次运行使用的 `apiToken`。未设置固定令牌时，Chroni 每次启动都会生成新的随机令牌；重启后，调用方应重新获取。

这套机制用于降低误调用风险，并与回环监听和 CORS 一起限制普通网页访问。它不是同一系统账户内恶意进程之间的安全边界：本地进程可以访问未鉴权的 `/api/health`，也可能读取 discovery 文件。只应将 API 开放给可信的本机自动化程序。

如需让可信脚本跨 Chroni 重启复用同一个值，可在启动应用前设置 `CHRONI_API_TOKEN`。固定令牌仍会由 `/api/health` 返回，因此它提供的是稳定性，而不是对同账户本地进程的额外隔离。

### 响应脱敏

API 在序列化响应时会递归清空名为 `apiKey` 的字段。任何名为 `snapshot` 的响应对象还会执行以下处理：

- 将 `sources[*].text` 清空；
- 将 `agent.recentPlanningFeedback` 清空。

因此 `GET /api/snapshot` 适合读取状态摘要，但不能用来导出来源全文。`POST /api/extract` 的 `extracted` 字段会返回本次解析得到的文本，调用方应将这类响应视为敏感数据。

本地 API 自身不把内容发送到其他主机，但 `/api/extract`、`/api/intake`、来源重识别、任务规划和 Agent 运行可能按照 Chroni 当前设置调用已配置的大模型服务。

## 快速开始

### Windows PowerShell

以下示例从 discovery 文件获取实际地址，再从健康检查获取会话令牌：

```powershell
$discoveryPath = Join-Path $env:APPDATA "Chroni\chroni-api.json"
$discovery = Get-Content $discoveryPath -Raw | ConvertFrom-Json
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

将路径从 `/api/extract` 改成 `/api/intake`，会在校验后把结果写入 Chroni；预览时应继续使用 `/api/extract`。

### macOS 与 Linux：curl

下面使用 `jq` 读取 JSON。未安装 `jq` 时，也可以手动从 discovery 文件复制 `baseUrl`，再从 `/api/health` 响应复制 `apiToken`。

```bash
# macOS
DISCOVERY="$HOME/Library/Application Support/Chroni/chroni-api.json"

# Linux 请改用：
# DISCOVERY="${XDG_CONFIG_HOME:-$HOME/.config}/Chroni/chroni-api.json"

BASE_URL="$(jq -r '.baseUrl' "$DISCOVERY")"
TOKEN="$(curl -fsS "$BASE_URL/api/health" | jq -r '.apiToken')"

curl -fsS \
  -X POST "$BASE_URL/api/extract" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"kind":"text","text":"7月18日 18:00 前提交实验报告 PDF"}'
```

如果只想使用占位变量，可以先手动执行：

```bash
BASE_URL="http://127.0.0.1:8765" # 替换为 discovery 中的实际值
curl -fsS "$BASE_URL/api/health"
TOKEN="复制上一步响应中的 apiToken"
```

## 抽取与接收

### 输入结构

文本输入：

```json
{
  "kind": "text",
  "text": "明天 20:00 提交项目方案"
}
```

文件输入使用 JSON 和 Base64，不支持 `multipart/form-data`：

```json
{
  "kind": "files",
  "files": [
    {
      "name": "项目安排.pdf",
      "type": "application/pdf",
      "contentBase64": "JVBERi0xLjQK..."
    }
  ]
}
```

`name` 必填，并由它的扩展名决定解析方式；`type` 可选。每个文件必须提供 `contentBase64` 或 `path`。如果两者同时提供且 `contentBase64` 非空，Chroni 优先使用 Base64 内容。

也可以让 Chroni 进程直接读取本机绝对路径：

```json
{
  "kind": "files",
  "files": [
    {
      "name": "项目安排.pdf",
      "path": "/Users/example/Documents/项目安排.pdf"
    }
  ]
}
```

`path` 指向运行 Chroni 的同一台机器，并以 Chroni 进程当前用户的权限读取。它不表示客户端上传，应只允许可信脚本传入；跨机器或浏览器文件对象应使用 `contentBase64`。

### Windows 上传文件

```powershell
$file = Get-Item "D:\资料\项目计划.xlsx"
$payload = @{
  kind = "files"
  files = @(@{
    name = $file.Name
    contentBase64 = [Convert]::ToBase64String(
      [IO.File]::ReadAllBytes($file.FullName)
    )
  })
} | ConvertTo-Json -Depth 4 -Compress

# 先预览
Invoke-RestMethod `
  -Method Post `
  -Uri "$($discovery.baseUrl)/api/extract" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $payload

# 确认后写入：把上面的 /api/extract 改为 /api/intake
```

### macOS/Linux 上传文件

下面的方式用临时文件保存 Base64，避免把大字符串作为命令行参数传给 `jq`：

```bash
FILE="/absolute/path/to/项目计划.xlsx"
B64_FILE="$(mktemp)"
JSON_FILE="$(mktemp)"
trap 'rm -f "$B64_FILE" "$JSON_FILE"' EXIT

base64 < "$FILE" | tr -d '\r\n' > "$B64_FILE"
jq -n \
  --arg name "$(basename "$FILE")" \
  --rawfile contentBase64 "$B64_FILE" \
  '{kind:"files",files:[{name:$name,contentBase64:$contentBase64}]}' \
  > "$JSON_FILE"

curl -fsS \
  -X POST "$BASE_URL/api/extract" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$JSON_FILE"

# 确认后写入：把上面的 /api/extract 改为 /api/intake
```

### `/api/extract` 与 `/api/intake` 的区别

| 端点 | 行为 | 常见成功响应 |
| --- | --- | --- |
| `POST /api/extract` | 解析文件、执行 OCR，并按当前设置进行模型或规则抽取；不把候选写入日程。 | `{ ok, extracted, failures, items, pendingItems, message }` |
| `POST /api/intake` | 执行同一抽取链路，并写入来源、明确 DDL、TaskPlan 草稿或待确认草稿。 | `{ ok, created, message, snapshot }` |

`/api/intake` 在成功时返回 HTTP `200`。如果内容可以读取，但没有明确 DDL、缺少必要字段或需要确认，它返回 HTTP `422` 和 `{ ok: false, reason, snapshot }`。`422` 不保证“完全未写入”：Chroni 可能已经保存来源记录或可恢复的待确认草稿，因此调用方应检查响应中的 `snapshot` 或随后读取待确认列表。

## 请求与响应约定

- 需要请求体的端点接收 JSON；建议始终发送 `Content-Type: application/json`。
- 未知字段会被拒绝，不会静默忽略。
- 标识符放在 URL 时应进行 URL 编码。
- 每日任务的时间字段必须是带时区的 RFC 3339，例如 `2026-07-18T18:00:00+08:00`。
- 大多数写操作返回更新后的脱敏 `snapshot`，便于调用方刷新本地视图。
- 普通错误通常返回 `{ "ok": false, "error": "..." }`；抽取链路的语义失败通常返回 `{ "ok": false, "reason": "...", "snapshot": { ... } }`。

## 端点索引

### 服务与状态

| 方法与路径 | 请求体 | 响应与说明 |
| --- | --- | --- |
| `GET /api/health` | 无 | 无需 Bearer；返回产品版本、实际 `baseUrl`、`apiToken`、支持的输入和端点列表。带浏览器 `Origin` 时仍受 CORS 检查。 |
| `GET /api/snapshot` | 无 | 返回 `{ ok: true, snapshot }`。API Key、来源全文和近期规划反馈已脱敏。 |

### 输入、DDL 与来源

| 方法与路径 | 请求体 | 响应与说明 |
| --- | --- | --- |
| `POST /api/extract` | `IntakePayload` | 只预览抽取结果，不写入 Chroni 状态。 |
| `POST /api/intake` | `IntakePayload` | 写入明确任务；信息不足时可保存待确认草稿并返回 `422`。 |
| `PATCH /api/items/:id` | DDL 字段补丁 | 更新 DDL，返回 `{ ok: true, snapshot }`。 |
| `DELETE /api/items/:id` | 无 | 删除 DDL，并清理相关每日时间块、计划、修订、追问和反馈记录。 |
| `POST /api/sources/:id/reprocess` | 无 | 使用已保存来源重新抽取；成功为 `200`，无法形成结果时为 `422`。 |

`PATCH /api/items/:id` 接受以下字段：

| 字段 | 约束 |
| --- | --- |
| `title` | 非空，最多 120 个字符 |
| `importance` | `high`、`medium` 或 `low` |
| `dueAt` | 可解析的日期时间字符串；建议使用带时区 RFC 3339 |
| `sourceSummary` | 最多 500 个字符 |
| `completed` | 布尔值 |
| `snoozedUntil` | 日期时间字符串；`null` 表示清除 |
| `estimatedMinutes` | `15` 至 `1440` 的整数；`null` 表示清除 |
| `progressPercent` | `0` 至 `100` 的整数；`null` 表示清除 |

至少需要提供一个字段。

### 每日任务

| 方法与路径 | 请求体 | 响应与说明 |
| --- | --- | --- |
| `GET /api/daily-tasks` | 无 | 返回 `{ ok: true, dailyTasks }`，不包含已隐藏的任务。 |
| `POST /api/daily-tasks` | `DailyTaskCreateInput` | 创建手动每日任务，成功返回 HTTP `201` 和更新后的 `snapshot`。 |
| `PATCH /api/daily-tasks/:id` | `DailyTaskPatch` | 更新任务；不存在的 ID 返回 `404`。 |
| `DELETE /api/daily-tasks/:id` | 无 | 收件箱中的未排期手动任务会删除；已排期或 Agent 任务会标记为隐藏，以保留历史。 |

创建时 `title` 必填，可选字段如下：

```json
{
  "title": "整理实验数据",
  "notes": "先完成异常值检查",
  "color": "teal",
  "allDay": false,
  "scheduledStartAt": "2026-07-18T09:00:00+08:00",
  "scheduledEndAt": "2026-07-18T10:30:00+08:00",
  "recurrence": "none",
  "subtasks": [
    { "id": "check", "title": "检查异常值", "completed": false }
  ]
}
```

- `color`：`teal`、`coral`、`gold`、`blue` 或 `plum`。
- `recurrence`：`none`、`daily`、`weekdays` 或 `weekly`。
- `scheduledStartAt` 和 `scheduledEndAt` 必须在 Chroni 所在时区落在同一自然日，且结束晚于开始。
- 只提供开始时间时，Chroni 默认安排 30 分钟。
- 全天或重复任务必须提供开始时间；`recurrenceEndsAt` 只能与非 `none` 的重复规则一起使用。
- `subtasks` 最多 30 项，ID 必须唯一。
- 更新时还可以提交 `completedDates: ["YYYY-MM-DD"]`；日期必须真实有效。排期字段和 `recurrenceEndsAt` 可用 `null` 清除。

### Deadline Agent

| 方法与路径 | 请求体 | 响应与说明 |
| --- | --- | --- |
| `POST /api/agent/run` | 无 | 立即执行一次手动巡检，返回 `{ ok: true, result, snapshot }`。可能按当前设置调用 LLM，并更新每日时间块。 |
| `GET /api/agent/latest` | 无 | 返回最近一次 Agent 结果；尚未运行时可能没有 `latest` 字段。 |
| `PATCH /api/agent/memory` | Agent Memory 补丁 | 更新工作时段、容量、提醒与自动巡检设置。 |
| `POST /api/agent/export-ics` | 无 | 将未完成 DDL 写入本地 `exports` 目录，返回 `{ ok: true, path, itemCount }`。 |

Agent Memory 可更新字段：

```json
{
  "maxDailyMinutes": 240,
  "workdayStart": "09:00",
  "workdayEnd": "18:00",
  "reminderFrequency": "important-only",
  "automaticInspectionEnabled": true,
  "useLlmPlanning": true
}
```

- `maxDailyMinutes` 必须是 `30` 至 `720` 的整数。
- 时间使用 `HH:MM`，且开始必须早于结束。
- `reminderFrequency` 为 `important-only`、`daily` 或 `off`。
- 所有字段均可单独更新。

### 待确认问题与草稿

| 方法与路径 | 请求体 | 响应与说明 |
| --- | --- | --- |
| `GET /api/agent/clarifications` | 无 | 只返回状态为 `pending` 的问题。 |
| `POST /api/agent/clarifications/:id/answer` | `{ "optionId": "..." }` 或 `{ "value": ... }` | 回答问题并恢复工作流；信息补齐后可能创建 DDL 和 TaskPlan 草稿。 |
| `POST /api/agent/clarifications/:id/dismiss` | 无 | 仅可跳过非必要问题；必要问题必须回答或放弃整个草稿。 |
| `GET /api/intake-drafts/:id` | 无 | 返回指定待确认草稿；不存在时返回 `404`。 |
| `DELETE /api/intake-drafts/:id` | 无 | 放弃未应用草稿，并使其仍待处理的问题过期。 |

自由回答 `value` 可以是最长 500 字符的字符串、有限数值，或最多 12 个且每项不超过 200 字符的字符串数组。

### TaskPlan 与修订

| 方法与路径 | 请求体 | 响应与说明 |
| --- | --- | --- |
| `GET /api/items/:id/plan` | 无 | 返回当前未被取代的最新计划；任务尚无计划时可能没有 `plan` 字段。 |
| `POST /api/items/:id/plan` | 无 | 确保任务存在计划；已有计划时复用当前版本，否则生成草稿。 |
| `POST /api/items/:id/plan/regenerate` | 无 | 生成新的规划草稿；如有旧草稿会将其标记为已取代，但不会静默覆盖已激活计划。 |
| `PUT /api/items/:id/plan` | 完整 `TaskPlanUpdatePayload` | 基于 `baseVersion` 保存编辑；版本过期、依赖无效或步骤不满足约束时拒绝。 |
| `POST /api/items/:id/plan/activate` | `{ "planId": "..." }` | 将指定计划设为当前计划，并更新任务估算时长。 |
| `GET /api/items/:id/plan/revisions` | 无 | 返回该任务保存过的结构化修订记录。 |

更新计划不是局部补丁。建议先 `GET` 当前计划，在本地编辑后提交以下完整结构：

```json
{
  "baseVersion": 1,
  "goal": "完成并提交实验报告",
  "deliverables": ["报告 PDF"],
  "constraints": ["截止前完成复核"],
  "steps": [
    {
      "id": "step-1",
      "taskId": "task-id",
      "title": "整理实验结果",
      "description": "汇总数据与图表",
      "estimatedMinutes": 60,
      "dependsOn": [],
      "completionCriteria": ["图表与数据一致"],
      "status": "pending",
      "userModifiedFields": [],
      "memoryPreferenceIds": [],
      "createdAt": "2026-07-16T08:00:00.000Z",
      "updatedAt": "2026-07-16T08:00:00.000Z"
    }
  ],
  "bufferMinutes": 30,
  "summary": "先整理结果，再完成报告。",
  "uncertainties": []
}
```

- 必须包含 `1` 至 `12` 个步骤，步骤 ID 唯一。
- 每步估时为 `15` 至 `480` 分钟。
- `dependsOn` 只能引用同一请求中的其他步骤，不能引用自身；完整计划还会执行依赖环和总时长校验。
- `bufferMinutes` 为 `0` 至 `1440` 的整数。
- `baseVersion` 必须等于服务端当前版本，防止覆盖其他调用方刚保存的编辑。

### Behavior Memory 与显式偏好

| 方法与路径 | 请求体 | 响应与说明 |
| --- | --- | --- |
| `PATCH /api/agent/behavior-memory` | `{ "learningEnabled"?: boolean, "autoApplyEnabled"?: boolean }` | 至少提供一个字段。 |
| `DELETE /api/agent/behavior-memory` | 无 | 清除已学偏好和反馈事件，但保留两个开关当前值。 |
| `POST /api/agent/behavior-memory/preferences` | 显式偏好 | 新增或更新同键、同作用域的显式规划偏好。 |
| `PATCH /api/agent/behavior-memory/preferences/:id` | `{ "status": "active" | "disabled" }` | 启用或停用偏好。 |
| `DELETE /api/agent/behavior-memory/preferences/:id` | 无 | 删除指定偏好。 |

显式偏好请求示例：

```json
{
  "key": "preferredStepMinutes",
  "value": 45,
  "scope": {
    "taskType": "coursework",
    "importance": "high",
    "dueWindowBucket": "1-3d"
  }
}
```

可用键包括：

- `preferredStepMinutes`：`15` 至 `180`；
- `preferredStepCount`：`1` 至 `12` 的整数；
- `bufferRatio`：`0` 至 `0.5`；
- `estimateMultiplier`：`0.5` 至 `3`；
- `preferredPlanningGranularity`：非空字符串；
- `preferReviewStep`、`preferResearchBeforeExecution`、`preferLongCoreWorkStep`、`preferEarlyStart`：布尔值。

`scope` 可省略；其中 `importance` 为 `high`、`medium` 或 `low`，`dueWindowBucket` 为 `under-24h`、`1-3d`、`4-7d` 或 `over-7d`。

### 应用偏好

`PATCH /api/preferences` 接受以下局部字段：

```json
{
  "companionEnabled": true,
  "remindersEnabled": true,
  "quietHoursEnabled": true,
  "quietHoursStart": "22:30",
  "quietHoursEnd": "08:00",
  "hotkey": "Ctrl+Shift+C",
  "llm": {
    "enabled": true,
    "provider": "openai-compatible",
    "baseUrl": "https://api.deepseek.com",
    "apiKey": "...",
    "model": "deepseek-v4-flash"
  }
}
```

所有字段都可单独提交。`quietHoursStart` 和 `quietHoursEnd` 使用 `HH:MM`；`llm.provider` 当前只接受 `openai-compatible`。响应中的 `apiKey` 始终为空。为避免 Key 进入终端历史或脚本日志，通常应在控制中心配置，或通过启动环境变量提供。

## 支持格式与限制

### 文件格式

- 文本：TXT、MD、CSV、TSV、JSON、ICS、LOG、HTML/HTM、XML、YAML/YML、RTF；
- 文档：DOCX、PDF；
- 表格：XLSX；
- 图片 OCR：PNG、JPG/JPEG、WEBP、BMP、TIF/TIFF。

解析器根据 `files[*].name` 的扩展名选择处理方式。可执行文件、压缩包、音视频和无扩展名文件会被拒绝。

### 大小与数量

- 整个 HTTP JSON 请求体最多 `32 MiB`；服务同时检查 `Content-Length` 和实际接收字节数。
- 一个 `files` 数组最多 32 项。
- 直接文本 `text` 最多 2,097,152 个字符。
- 单个纯文本文件最多 `2 MiB`。
- 单个 DOCX、PDF、XLSX 或图片最多 `18 MiB`。
- Base64 通常会比原文件增加约三分之一大小，实际可上传上限还受 `32 MiB` JSON 请求体限制。
- 单次抽取最多返回 12 个明确 DDL 和 12 个待确认候选。

多个文件允许部分成功：无法读取的文件会出现在 `failures` 中，只要仍有文件成功解析，抽取链路会继续。

## CORS 与启动环境变量

默认情况下，带有任意 `Origin` 请求头的请求都会返回 `403`，因此普通网页不能直接调用 API。命令行工具通常不发送 `Origin`，不受这项限制。

若确实需要从一个受信任网页访问，可在启动 Chroni 前设置精确来源：

```dotenv
CHRONI_API_ALLOWED_ORIGIN=http://127.0.0.1:3000
```

只支持一个完全匹配的 Origin，不支持通配符或列表。允许的跨域方法为 `GET`、`POST`、`PUT`、`PATCH`、`DELETE` 和 `OPTIONS`，允许的请求头为 `authorization` 与 `content-type`。

相关变量：

| 变量 | 行为 |
| --- | --- |
| `CHRONI_API_PORT` | `0` 至 `65535` 的整数；`0` 表示随机端口，无效值回退到 `8765`。 |
| `CHRONI_API_TOKEN` | 在该环境变量持续存在的各次启动中使用固定 Bearer 值；未设置时每次随机生成。 |
| `CHRONI_API_ALLOWED_ORIGIN` | 唯一允许的精确浏览器 Origin；未设置时拒绝所有带 Origin 的请求。 |

源码运行时，根目录 `.env` 会由 Chroni 启动脚本读取，已有系统或终端环境变量优先。安装包不会自动读取仓库 `.env`；需要在操作系统环境中设置后再启动应用。

## 状态码与排错

| 状态码 | 常见原因 | 处理方式 |
| --- | --- | --- |
| `200` / `201` | 请求成功 | `POST /api/daily-tasks` 使用 `201`，其余大多数成功操作使用 `200`。 |
| `400` | JSON 无效、请求体为空、字段类型错误、未知字段或时间格式错误 | 检查 `error`；字段校验严格，不会忽略拼写错误。 |
| `401` | 缺少或使用了过期/错误的 Bearer 令牌 | 重新读取 discovery，并从当前 `/api/health` 获取 token。 |
| `403` | 请求带有未获准的 `Origin` | CLI 不要添加 Origin；网页调用需设置完全一致的 `CHRONI_API_ALLOWED_ORIGIN` 并重启。 |
| `404` | 路由或部分资源不存在 | 检查方法、路径和 URL 编码；未知路由响应会同时列出当前端点。 |
| `413` | JSON 请求体超过 32 MiB | 拆分请求；考虑 Base64 的体积膨胀。 |
| `422` | 输入可处理但未形成可直接写入的明确结果，或来源重识别仍需确认 | 查看 `reason`、`snapshot.clarifications` 和 `/api/agent/clarifications`。 |
| `503` | 需要完整桌面 Agent 的能力尚不可用 | 确认启动的是 Chroni 桌面应用，而不是孤立模块或已退出的进程。 |
| `500` | 操作执行失败或状态冲突 | 重新读取最新状态后重试；错误响应会隐藏内部堆栈和敏感配置。 |

### 常见问题

**连接被拒绝或 discovery 中的端口不可用**

Chroni 可能已经退出、异常结束，或因为端口冲突切换到了新端口。确认桌面应用仍在运行，重新读取 `chroni-api.json`，然后调用 `/api/health`。不要长期缓存 `baseUrl`。

**重启后一直返回 401**

默认 token 随进程重建。每次连接都从当前 `/api/health` 获取；不要复用上一次运行的 token。

**浏览器请求连健康检查也返回 403**

CORS 在路由和鉴权之前执行，因此 `/api/health` 也会检查浏览器 Origin。配置精确的 `CHRONI_API_ALLOWED_ORIGIN` 后完全退出并重启 Chroni。

**`/api/intake` 返回 422**

这通常表示缺少明确截止时间、只识别到条件性安排，或需要补充信息。它不是网络错误。读取 `reason` 和待确认端点；必要时回答问题或删除对应草稿。

**在 snapshot 中看不到来源原文或 API Key**

这是预期的响应脱敏行为。来源原文仍保存在本机状态中；如需检查本次解析文本，可使用 `/api/extract` 的 `extracted` 响应，并妥善保护输出。

**文件名正确但解析方式不对**

API 以 `name` 扩展名选择解析器，而不是依赖 MIME `type`。确保 `name` 与真实文件格式一致；仅修改后缀不会把不支持的二进制格式转换成受支持格式。
