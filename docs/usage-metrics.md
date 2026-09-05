# Chroni 运营数据与下载统计

Chroni 当前坚持无账号、本地优先和默认无桌面遥测，因此不存在一个能够显示“全部用户”的后台。下载、访问、模型调用和真实活跃用户是四种不同指标，不能互相替代。

## GitHub 安装包下载量

打开仓库的 **Releases** 页面可查看发布资产；精确的每个资产下载次数来自 GitHub Releases API 的 `download_count`：

```powershell
$headers = @{ "User-Agent" = "Chroni-operator" }
$releases = Invoke-RestMethod `
  -Headers $headers `
  -Uri "https://api.github.com/repos/miracle121388-a11y/chroni/releases?per_page=100"

$releases | ForEach-Object {
  $tag = $_.tag_name
  $_.assets | Where-Object { $_.name -match '\.(exe|dmg|zip)$' } | ForEach-Object {
    [pscustomobject]@{
      Version = $tag
      File = $_.name
      Downloads = $_.download_count
    }
  }
} | Format-Table -AutoSize
```

这些数字是资产请求次数，不是唯一用户数或成功安装数。稳定别名与带版本文件可能被同一用户分别下载；`latest.yml`、`blockmap` 和校验和属于更新或验证文件，不能计入安装包下载量。

## GitHub 仓库访问

有仓库写入权限的成员可打开：

```text
GitHub 仓库 -> Insights -> Traffic
```

这里可以查看最近 14 天的页面浏览、唯一访客、完整克隆、来源网站和热门页面。该窗口只有 14 天，如需长期趋势，应定期导出 GitHub Traffic API 数据。

## Zeabur 网站与网关

在 Zeabur 项目中分别选择下载站服务和 `chroni-api` 服务：

- **Metrics**：CPU、内存和网络流量，适合判断访问波动与资源成本，不等于页面访问人数。
- **Logs**：实时运行日志。筛选 `"event":"gateway_request"` 可查看匿名来源、成功率、延迟和 token 用量。
- **Deployments**：构建与部署状态，用于确认 `main` 更新是否已经上线。

网关日志中的公共 `credential_id` 是来源网络经过 HMAC 后的摘要，只能用于限流和粗略去重，不代表一个真实用户；私有访问码模式下才可按测试者 ID 区分额度。日志不包含原始 IP、材料文本或 API Key。

Zeabur 当前日志会随服务重启或重新部署结束保留期。需要长期成功率和 token 趋势时，应接入支持结构化日志的外部存储，并继续只保留现有脱敏字段。

## DeepSeek 用量与费用

DeepSeek 开放平台控制台用于查看 API Key 的 token 消耗、费用和模型分布。它能回答“Flash 或 Pro 花了多少”，不能回答“有多少 Chroni 用户”。模型切换后，旧的 Pro 历史记录仍会保留。

线上实际模型以网关健康接口为准：

```powershell
Invoke-RestMethod https://api-getchroni.zeabur.app/healthz
```

返回的 `model` 必须是 `deepseek-v4-flash`。

## 当前无法看到的数据

桌面应用没有隐藏分析 SDK，也不会上报启动、安装、日程、文件或功能点击，因此目前无法准确统计安装成功数、日活、留存或功能使用率。GitHub 下载量只能作为下载兴趣的参考。

如果以后需要产品分析，应采用明确的自愿加入设置、随机安装标识、最小事件集合、可见的删除与退出控制，并在隐私说明和商店数据声明中同步披露；在这些条件完成前，不应把遥测悄悄加入正式版本。

## 官方参考

- [GitHub 仓库流量说明](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)
- [GitHub Traffic REST API](https://docs.github.com/en/rest/metrics/traffic)
- [Zeabur Metrics](https://zeabur.com/docs/en-US/operations/monitoring/metrics)
- [Zeabur Logging](https://zeabur.com/docs/en-US/operations/monitoring/logging)
- [DeepSeek 模型与计费](https://api-docs.deepseek.com/quick_start/pricing)
