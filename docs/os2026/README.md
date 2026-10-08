# Chroni · 2026 上海开源软件应用创新大赛

参赛方向：**开源 AI 工具赛道，自主选题**。作品版本：`v0.2.4`。

## 提交材料

- [作品介绍 PDF（8 页）](https://github.com/miracle121388-a11y/chroni/releases/download/os2026-submission-20261008/Chroni_OS2026_Introduction.pdf)：项目背景、技术架构、应用场景、创新点、验证依据、开源治理与持续维护。
- [作品演示视频 MP4](https://github.com/miracle121388-a11y/chroni/releases/download/os2026-submission-20261008/Chroni_OS2026_Demo.mp4)：真实界面操作，1920×1080，中文配音与画面字幕。
- [参赛材料发布页](https://github.com/miracle121388-a11y/chroni/releases/tag/os2026-submission-20261008)：PDF、视频与 SHA-256 校验和。
- [代码仓库](https://github.com/miracle121388-a11y/chroni)；[应用安装包](https://github.com/miracle121388-a11y/chroni/releases/latest)。

链接对应独立的参赛材料发布，不表示发布了新的软件版本。提交时直接复制视频链接；GitHub 链接无需登录，下载后即可播放。

## 官方要求

来源：[大赛官网](https://www.oschina.net/os2026/)，2026-10-08 核对。官网当前列明：

- PDF 推荐包含项目背景、技术架构、应用场景与创新点；视频展示核心功能和使用流程，通用提交说明未指定时长。
- 评审权重：技术创新 30%、场景落地 30%、开源治理 20%、长期发展 20%。
- 收到报名确认邮件后按指引提交；材料截止时间为 **2026-10-16 24:00**，接收邮箱 `oscc@oschina.cn`。
- 个人或团队可参赛，每项目选择一个赛道。报名表与参赛成员信息由实际报名记录确定。

本目录只准备与发布作品材料，不代表完成官网报名或向组委会发送邮件。

## 视频内容与真实性

演示路径：智能整理输入课程要求 → 检查并编辑标题 → 查看和确认执行计划 → 智能安排 → 登记产出说明 → 阶段检查点 → 完成日程块并保存回顾 → 缺少截止时间的必要追问 → 刷新后读取已保存状态。

- 使用生产 `dist/main.js`、实际 React 界面及正常 preload IPC，抽取、规划、存储和用户动作均未模拟。
- 使用全新临时用户目录与合成课程要求；不读取已有 Chroni 学习数据。录制脚本退出时删除临时目录。
- 显式关闭模型和自动巡检；核心链路运行本地规则。为了在晚间录制今日安排，演示配置的可工作时段为 `08:00–23:59`。这些是演示准备条件，不是算法预写结果。
- 手动修改抽取后的任务短标题与目标，演示用户检查、编辑并确认的正常能力。
- 配音为 macOS Tingting 中文系统语音，非真人录音；界面上全程标注合成示例与本地规则。
- 基线评测数字来自 2026-09-02 的 60 案例历史报告，不作为当前版本全量回归、模型表现或真实学习成效。
- 演示操作验证记录：[demo-verification.json](./demo-verification.json)。

## 修改与复现

作品介绍的唯一内容源为 [project-introduction.json](./project-introduction.json)；分镜和配音源为 [demo-scenes.json](./demo-scenes.json)。Python 统一通过 Conda 运行。

```bash
pnpm install --frozen-lockfile
pnpm run build

# 先快速验证真实操作链路，再正式录制。
node apps/desktop/scripts/run-electron.cjs apps/desktop/scripts/capture-os2026-demo.cjs --probe
node apps/desktop/scripts/run-electron.cjs apps/desktop/scripts/capture-os2026-demo.cjs

# Conda 环境需有 reportlab、pypdf、Pillow 与 imageio-ffmpeg。
conda run -n dueflow python scripts/submission/build_os2026_pdf.py
conda run -n dueflow python scripts/submission/build_os2026_video.py
```

视频录制和配音脚本当前面向 macOS，需要可用的 Electron 图形会话、系统中文字体和 `say`。PDF 可通过 `CHRONI_PDF_FONT` 与 `CHRONI_PDF_BOLD_FONT` 指定中文 TrueType 字体。输出位于 `output/pdf/` 与 `output/os2026/`；帧、配音与排版预览位于 Git 忽略的 `tmp/`。

桌宠视觉资产、字体和依赖遵守各自许可，详见 [第三方声明](../../THIRD_PARTY_NOTICES.md)。
