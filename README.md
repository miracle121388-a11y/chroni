# Chroni

Chroni 是一个以桌宠为入口的本地 DDL 日程助手。当前阶段以本机开发运行和体验验证为主，暂不优先打包成正式应用。

## 本机运行

前置环境：

- Node.js 20 或更高版本
- pnpm

如果本机还没有 pnpm，可用 Homebrew 安装：

```bash
brew install node pnpm
```

安装依赖：

```bash
pnpm install
```

启动应用：

```bash
pnpm run dev
```

开发调试时也可以启动带 Vite renderer 的模式：

```bash
pnpm --filter @chroni/desktop run dev:desktop
```

## 常用命令

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check
```

macOS 上如果需要从命令行关闭已打开的 Chroni：

```bash
pnpm run stop:mac
```

## 当前产品形态

- 桌宠是主入口，负责拖拽输入、短反馈和唤起日程。
- Windows 日程表以侧边抽屉形式展示。
- macOS 日程表以可隐藏轻量浮层展示。
- 控制中心只做轻量修正、基础偏好和服务状态。
- 文件、图片和文本输入会自动识别 DDL，不设置人工确认步骤；识别不可靠时会失败并保留来源记录。
