# Chroni 低门槛推广与官网发布指南

## 目标

普通用户的路径应当是：

```text
社交平台内容 / 二维码 / 搜索结果
  -> Chroni 产品主页
  -> 自动匹配 Windows 或 macOS
  -> 直接下载安装包
  -> 3 分钟完成首次任务
```

GitHub 继续承担源代码、版本、校验文件和问题追踪，但不再作为普通用户的第一入口。

## 已实现的入口

- 产品主页源码位于 `site/`。
- `pnpm run site:build` 会把官网与真实产品截图、桌宠素材构建到 `dist/site/`。
- `.github/workflows/pages.yml` 会在 `main` 的官网相关内容变化后自动部署 GitHub Pages。
- 页面通过 GitHub 公开 Release API 获取最新版，自动识别 Windows/macOS，并把主按钮指向对应安装包。
- API 不可用时，按钮安全回退到 Latest Release，不会失效。
- 页面包含 Open Graph 分享图、搜索描述、站点地图、隐私入口和安装问题入口。

## 首次启用 GitHub Pages

仓库管理员只需设置一次：

1. 打开仓库的 `Settings -> Pages`。
2. 在 `Build and deployment` 的 `Source` 中选择 `GitHub Actions`。
3. 打开 `Actions`，运行 `Product Site` 工作流，或向 `main` 推送一次官网相关改动。
4. 部署完成后访问 `https://miracle121388-a11y.github.io/chroni/`。

之后每次更新 `site/` 或展示素材都会自动发布，无需手工上传网页。

## 本地预览

```powershell
cd D:\Users\Lenovo\Desktop\Chroni
npx pnpm@11.7.0 run site:build
npx pnpm@11.7.0 exec vite dist/site --host 127.0.0.1 --port 4173
```

浏览器打开 `http://127.0.0.1:4173/`。修改后重新执行 `site:build` 即可查看新版本。

## 推广时只发什么

对普通用户只发送产品主页，不发送仓库首页或 Release 列表：

```text
https://miracle121388-a11y.github.io/chroni/
```

建议把它制作成固定二维码，放在小红书、B 站视频简介、公众号文章和演示海报中。GitHub Pages 地址不会随版本变化，因此二维码无需每次重做。

## 推荐传播内容

每条内容只展示一个完整闭环：

1. 原始通知或截图。
2. 拖入 Chroni 桌宠。
3. Agent 提取出的截止事项与步骤。
4. 自动生成的今日时间轴。
5. 产品主页二维码或短链接。

不要在推广首屏解释 Node.js、pnpm、Release Assets 或 API 配置。它们分别属于开发文档和进阶设置，不是用户第一次接触 Chroni 时必须理解的内容。

## 下一阶段

正式推广前建议完成以下运营基础设施：

- 绑定简短独立域名，例如 `chroni.app` 或 `getchroni.cn`，再将 Pages 地址设为跳转备份。
- Windows 与 macOS 安装包完成代码签名，减少 SmartScreen 和 Gatekeeper 提示。
- 在尊重隐私的前提下接入轻量匿名访问统计，只记录页面访问、平台和下载按钮点击，不记录文件、任务或 API Key。
- 为每个渠道使用带来源参数的官网链接，例如 `?utm_source=xiaohongshu`，评估内容带来的有效下载。
- 发布时固定提供 15 秒操作视频、产品截图、版本亮点和已知问题，避免用户必须阅读长篇文档。

## 更新版本时

安装包由 Release 工作流发布后，官网无需修改版本号。前端会自动读取最新公开 Release 并匹配：

- `Chroni-<version>-win-x64-setup.exe`
- `Chroni-<version>-win-x64-portable.exe`
- `Chroni-<version>-mac-universal.dmg`

如果未来调整文件命名，需要同步修改 `site/app.js` 中的三个匹配规则。
