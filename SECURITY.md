# 安全策略

## 支持范围

Chroni 目前处于早期公开版本阶段，只为 GitHub Releases 中的最新版本提供安全修复。发现问题后，请先升级到最新版本并确认问题仍然存在。

## 私密报告安全问题

请不要为 API Key 泄露、任意代码执行、鉴权绕过、恶意文件解析、更新链路劫持或用户数据泄露创建公开 Issue。

优先使用 GitHub 的 [Private vulnerability reporting](https://github.com/miracle121388-a11y/chroni/security/advisories/new) 提交报告，并包含：

- 受影响的 Chroni 版本与操作系统
- 可复现的最小步骤或示例文件
- 实际影响和预期行为
- 已知缓解方式

维护者会先确认报告是否可复现，再决定修复、公告与版本发布方式。问题公开前，请给项目留出合理的修复和发布窗口。

## 用户安全建议

- 仅从本仓库的 GitHub Releases 下载 Chroni，并核对 `SHA256SUMS.txt`。
- 正式分发应使用 Windows 代码签名与 macOS Developer ID 签名、公证。
- 不要把 DeepSeek 或其他模型 API Key 写入仓库、截图或 Issue。
- 启用 LLM 后，抽取文本会发送到你配置的模型服务；敏感材料应遵循对应服务的隐私要求。
- 本地 HTTP API 默认只监听 `127.0.0.1`，不要把会话令牌暴露给不可信进程。
