# Chroni 内测 LLM 网关

## 目标与链路

内测阶段不能把 DeepSeek 主密钥写入安装包、前端代码或公开仓库。Chroni 使用独立的 Zeabur 服务托管密钥：

```text
桌面端
  -> 本地解析 PDF / DOCX / XLSX / 图片 OCR
  -> 使用内测访问码请求 Chroni Gateway
  -> 网关鉴权、限流、裁剪参数并注入 DeepSeek Key
  -> DeepSeek /chat/completions
  -> 结构化候选返回桌面端
  -> 本地证据、日期、重复项和计划约束校验
```

桌面端从不获得 `DEEPSEEK_API_KEY`。网关不接收任意上游地址，不允许客户端选择任意模型，不记录原始文本。

## Zeabur 服务

仓库中的 `zbpack.chroni-api.json` 专用于名为 `chroni-api` 的 Git 服务：

```json
{
  "app_dir": "/apps/gateway",
  "build_command": "pnpm run build",
  "start_command": "pnpm run start"
}
```

将该服务连接到 GitHub 仓库的 `main` 分支后，每次推送都会与产品下载站一样自动构建和部署。服务必须使用 Zeabur 注入的 `PORT`，代码已监听 `0.0.0.0`。

## 必填环境变量

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | `sk-...` | 只保存在 Zeabur，禁止放入仓库或客户端 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 网关唯一允许的上游模型 |
| `CHRONI_GATEWAY_ACCESS_KEYS_JSON` | `{"tester-a":"...","tester-b":"..."}` | 推荐，每个测试者独立访问码 |

也可以在极小规模测试中设置单个 `CHRONI_GATEWAY_ACCESS_TOKEN`。不要同时依赖共享码做长期内测，因为无法单独撤销某位测试者。

PowerShell 生成 32 字节随机访问码：

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes).Replace("+","-").Replace("/","_").TrimEnd("=")
```

在 Zeabur 中填写 JSON 时，键是只进入脱敏日志的测试者 ID，值是发给测试者的访问码。修改变量并重新部署后，旧码立即失效。

## 可选保护参数

| 变量 | 默认值 | 作用 |
| --- | ---: | --- |
| `CHRONI_GATEWAY_REQUESTS_PER_MINUTE` | `20` | 每访问码每分钟请求数 |
| `CHRONI_GATEWAY_REQUESTS_PER_DAY` | `500` | 每访问码 UTC 自然日请求数 |
| `CHRONI_GATEWAY_CONCURRENT_REQUESTS` | `3` | 每访问码并发请求数 |
| `CHRONI_GATEWAY_TIMEOUT_MS` | `75000` | 单次 DeepSeek 上游超时 |
| `CHRONI_GATEWAY_MAX_BODY_BYTES` | `1048576` | JSON 请求体上限 |
| `CHRONI_GATEWAY_MAX_PROMPT_CHARACTERS` | `350000` | 所有消息内容字符总上限 |
| `CHRONI_GATEWAY_MAX_OUTPUT_TOKENS` | `8192` | 服务端强制输出上限 |

网关会强制 `thinking: {"type":"disabled"}`，并忽略客户端模型名。当前抽取提示词已要求 JSON，网关只允许 `text` 与 `json_object` 两种输出格式。

## 上线检查

未配置密钥时，服务仍会启动，但健康检查返回 `503` 并只列出缺失变量名：

```powershell
Invoke-RestMethod https://api-chroni.zeabur.app/healthz
```

配置完成后应返回 `status: ok`。然后使用一个真实内测访问码验证：

```powershell
$headers = @{ Authorization = "Bearer 你的访问码" }
$body = @{
  model = "chroni-beta"
  messages = @(@{ role = "user"; content = "Reply with OK only." })
  max_tokens = 32
} | ConvertTo-Json -Depth 5
Invoke-RestMethod `
  -Uri https://api-chroni.zeabur.app/v1/chat/completions `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

日志只能包含 `request_id`、`credential_id`、状态、耗时和 token 数。出现原始任务文本、访问码或供应商密钥即视为安全缺陷。

## 本地验证

```powershell
npx pnpm@11.7.0 --filter @chroni/gateway run test
npx pnpm@11.7.0 --filter @chroni/gateway run build
```

本地启动时在终端设置相同变量，然后执行 `pnpm gateway:start`。不要把真实网关环境变量写入 `.env.example`、Issue、截图或 CI 日志。
