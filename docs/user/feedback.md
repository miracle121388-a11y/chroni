# Chroni 帮助与反馈

## 先选择反馈类型

| 情况 | 入口 |
| --- | --- |
| 安装、识别、日程或界面 Bug | [问题报告](https://github.com/miracle121388-a11y/chroni/issues/new?template=bug_report.yml) |
| 使用体验、上手门槛与建议 | [体验反馈](https://github.com/miracle121388-a11y/chroni/issues/new?template=experience_feedback.yml) |
| 新功能建议 | [功能建议](https://github.com/miracle121388-a11y/chroni/issues/new?template=feature_request.yml) |
| API Key、数据泄露、鉴权或代码执行 | [私密安全报告](https://github.com/miracle121388-a11y/chroni/security/advisories/new) |

提交前先搜索已有 Issue，避免重复。

## 推荐诊断信息

可以安全提供：

```text
Chroni 版本：
操作系统：
安装方式：Setup / Portable / DMG / 源码
是否启用 LLM：是 / 否
模型服务：DeepSeek / 其他 / 未配置
问题阶段：启动 / 文件读取 / OCR / 抽取 / 规划 / 日程 / 桌宠 / 更新
实际结果：
预期结果：
最小复现步骤：
```

版本号位于“控制中心 -> 运行状态”或“关于”。运行状态还会显示解析、OCR、模型和本地数据是否可用。

## 不要公开提供

- API Key、`.env`、Bearer Token 或 `chroni-api.json`。
- 未脱敏的 `chroni-state.json`。
- 真实课程通知、聊天记录、邮件、简历或公司文件。
- 姓名、学号、手机号、邮箱和群号。
- 包含 Windows 用户名或 macOS 主目录名的完整路径。

需要展示输入内容时，请用 `examples/demo/` 的虚构材料复现。

## 日志和本地数据

“运行状态 -> 打开本地数据位置”可以定位状态、备份和导出目录。除非维护者在私密渠道明确要求，否则不要上传整个目录。公开 Issue 只粘贴与错误直接相关且已脱敏的少量信息。

## 反馈写法

好的反馈能回答四件事：

1. 你想完成什么。
2. 你按什么顺序操作。
3. 实际发生了什么。
4. 你期望发生什么。

“识别不了”很难定位；“Windows 11，v0.1.4，不启用 LLM，把 demo 课程 TXT 拖到桌宠后显示文件为空，但控制中心预览能读到 86 字”则可以直接复现。
