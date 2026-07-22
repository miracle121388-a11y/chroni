# Chroni 安装 FAQ

## 我应该下载哪个文件？

| 文件 | 适用场景 | 数据位置 |
| --- | --- | --- |
| Windows Setup | 推荐大多数 Windows 用户使用，带快捷方式和卸载入口 | 用户应用数据目录 |
| Windows Portable | 临时体验或无权安装时使用 | 程序无需安装，用户数据仍保存在系统用户目录 |
| macOS Universal DMG | 推荐所有受支持 Mac 使用，同时兼容 Intel 和 Apple Silicon | macOS Application Support |
| macOS ZIP | 主要供应用更新或手动解压 | 与 DMG 安装后的应用一致 |

Portable 不是“完全不写入数据”。它只是不安装程序，Chroni 的日程、偏好和缓存仍会保存在当前系统用户的数据目录。

## Windows SmartScreen 为什么提示？

当前公开构建可能没有商业代码签名证书。Windows 因发布者信誉不足显示“Windows 已保护你的电脑”，不代表文件一定恶意，也不代表可以忽略来源验证。

安全处理顺序：

1. 确认文件来自项目的 [GitHub Releases](https://github.com/miracle121388-a11y/chroni/releases/latest)。
2. 核对文件名、版本和 `SHA256SUMS.txt`。
3. 右键文件查看属性，确认没有从聊天群或网盘二次转发。
4. 只有校验一致时，再在 SmartScreen 中选择“更多信息 -> 仍要运行”。

不要关闭 Windows Defender 或系统全局 SmartScreen。

## macOS Gatekeeper 为什么提示？

当前公开构建可能没有 Developer ID 签名和 Apple 公证。macOS 因无法确认开发者身份而阻止首次打开。

安全处理顺序：

1. 只从官方 Release 下载 DMG。
2. 核对 SHA-256。
3. 将 Chroni 拖入 Applications。
4. 在 Finder 中按住 Control 点击 Chroni，选择“打开”。
5. 或前往“系统设置 -> 隐私与安全性”，只允许这一次打开已核对的 Chroni。

不要使用命令全局关闭 Gatekeeper。

## 如何校验 SHA-256？

Windows PowerShell：

```powershell
Get-FileHash ".\Chroni-0.1.4-win-x64-setup.exe" -Algorithm SHA256
Get-Content ".\SHA256SUMS.txt"
```

macOS Terminal：

```bash
shasum -a 256 Chroni-0.1.4-mac-universal.dmg
grep "Chroni-0.1.4-mac-universal.dmg" SHA256SUMS.txt
```

计算结果必须与发布页同名文件对应的值完全一致。版本升级后请替换命令中的版本号。

## 安装后没有出现主窗口？

Chroni 是桌宠与托盘常驻应用：

- 先检查屏幕边缘是否有蓝色桌宠。
- 检查 Windows 托盘隐藏图标或 macOS 菜单栏。
- 左键桌宠打开日程，右键桌宠打开菜单。
- 通过托盘菜单选择“打开控制中心”。
- 多显示器刚移除时，重新启动会把窗口校正到可见工作区。

## Setup 与 Portable 可以同时使用吗？

不建议同时运行。两者可能读取同一用户数据目录，并争用托盘、快捷键和本地 API 端口。测试 Portable 前先从托盘完全退出 Setup 版本。

## 卸载会删除日程吗？

Windows 安装器默认不会在卸载时删除用户数据，避免误删日程。需要彻底删除时：

1. 先从托盘退出 Chroni。
2. 在“运行状态”点击“打开本地数据位置”。
3. 备份需要保留的 `chroni-state.json` 和 `exports`。
4. 卸载应用。
5. 手动删除 Chroni 用户数据目录。

## 不填 API Key 能用吗？

可以。本地规则能处理标题、日期和时间表达明确的 DDL，也能使用本地文件解析、OCR、日程、TaskPlan、每日任务和桌宠。复杂跨段语义和模糊要求的理解能力会降低。

当前没有官方免费模型额度。需要增强理解时，用户可配置自己的 OpenAI-compatible API Key，并承担对应服务商费用。

## 应用提示端口被占用怎么办？

默认本地 API 使用 `127.0.0.1:8765`。先确认没有另一个 Chroni、Portable 或旧开发进程仍在运行。完全退出后重新启动。开发者可以通过 `CHRONI_API_PORT` 指定其他端口，普通安装用户通常不需要修改。

## 如何检查新版本？

打开“控制中心 -> 运行状态”，查看当前版本并点击“检查更新”。也可以点击“查看 GitHub 发布页”。应用下载完成后会显示“重启并安装”，不会在工作过程中突然重启。
