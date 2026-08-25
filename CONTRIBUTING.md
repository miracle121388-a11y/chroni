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
npx pnpm@11.7.0 run eval:smoke
```

涉及抽取、日期、澄清、TaskPlan、Agent 或安全边界时，还应运行 `npx pnpm@11.7.0 run eval:goai`，并说明指标变化与失败案例。涉及 GOAI 视觉或打包时运行 `pnpm run build:goai` 和 `pnpm run goai:assets:check`。依赖发生变化时运行 `pnpm run notices:generate` 并审查许可证变化。

评测样例必须为合成或明确授权内容，不能包含真实姓名、学号、群号、邮箱、私聊或未脱敏路径。不要为了提高分数修改 gold 以迎合错误输出；标签修订应说明理由并改变 dataset hash。

推荐使用清晰的提交信息，例如：

```text
feat: add manual update controls
fix: keep schedule window inside the active display
docs: clarify DeepSeek setup
```

## Pull Request 内容

请说明用户问题、实现方式、验证结果和剩余风险。涉及界面时附上修改前后截图；涉及数据迁移、API、Agent 规则或打包时，说明兼容性影响。

发布维护者请同时阅读 [发布指南](./docs/releasing.md)。安全问题不要创建公开 Issue，请按照 [安全策略](./SECURITY.md) 报告。

## Good first issue 建议

维护者可把以下独立工作标记为 `good first issue`：补充合成日期/时区 case、改善无障碍标签、校对中英文文档、为已支持格式添加损坏文件测试、扩展 API 示例、复核第三方许可证链接。不要把密钥、真实用户材料、签名证书或高风险解析器漏洞交给公开新手 Issue。

参与项目即表示同意遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。
