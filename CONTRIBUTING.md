# 参与 Chroni 开发

感谢你愿意改进 Chroni。提交代码前，请先搜索现有 Issue，避免重复工作；较大的功能建议先创建讨论 Issue，确认用户场景和边界后再实现。

## 本地环境

- Node.js 22.13 或更高版本
- pnpm 11.7.0
- Windows 10/11 或 macOS；Linux 可用于核心逻辑和 renderer 开发

```bash
git clone https://github.com/miracle121388-a11y/chroni.git
cd chroni
npx pnpm@11.7.0 install
npx pnpm@11.7.0 run dev
```

## 提交改动

1. 从最新 `main` 创建一个目标明确的分支。
2. 保持改动聚焦，不混入无关格式化或重构。
3. 为行为变化补充测试；UI 改动至少检查 Windows 与 macOS 的窗口尺寸和交互差异。
4. 不要提交 `.env`、API Key、真实日程、用户数据或打包产物。
5. 提交 Pull Request 前运行完整检查。

```bash
npx pnpm@11.7.0 run check
```

推荐使用清晰的提交信息，例如：

```text
feat: add manual update controls
fix: keep schedule window inside the active display
docs: clarify DeepSeek setup
```

## Pull Request 内容

请说明用户问题、实现方式、验证结果和剩余风险。涉及界面时附上修改前后截图；涉及数据迁移、API、Agent 规则或打包时，说明兼容性影响。

发布维护者请同时阅读 [发布指南](./docs/releasing.md)。安全问题不要创建公开 Issue，请按照 [安全策略](./SECURITY.md) 报告。
