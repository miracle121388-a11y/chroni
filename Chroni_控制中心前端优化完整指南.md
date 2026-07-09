# Chroni 控制中心前端优化执行指南

> 用途：将本文件上传给 Codex，并要求其在现有 Chroni 项目中完成控制中心 UI/UX 审计、设计系统建立、前端重构、运行验证和截图复查。  
> 适用范围：Chroni 控制中心的「日程」「偏好」「运行状态」三个模块。  
> 核心原则：不重写业务逻辑，不扩展成复杂后台，只优化现有前端体验。

---

# 1. 项目背景

Chroni 是一款以桌宠为核心入口的本地 DDL 日程助手。

用户可以将：

- 文件
- 图片
- 截图
- 文本

拖给桌宠，系统自动识别任务信息和截止时间，生成或更新日程。

Chroni 的整体产品结构是：

```text
桌宠负责交互入口
日程表负责轻量展示
控制中心负责必要设置和少量修正
```

控制中心不是产品主体，也不是长期使用的任务管理后台。

控制中心只承担三个职责：

1. 轻量修正
2. 基础偏好
3. 服务状态

---

# 2. 本次优化目标

本次任务不是重新开发 Chroni，也不是制作一个独立 UI Demo。

Codex 需要在当前真实项目代码基础上完成：

```text
读取产品文档
→ 审计现有控制中心
→ 建立轻量设计系统
→ 重构控制中心 UI
→ 保留现有业务链路
→ 启动项目
→ 检查各类状态
→ 截图审查
→ 再次修正
→ 执行 lint / typecheck / test / build
```

最终控制中心应具备以下特征：

- 桌面原生感
- 安静、精确、可信
- 中文信息层级清楚
- 窄窗口下仍然稳定
- 少卡片、少装饰、少视觉噪音
- 不像通用 SaaS 后台
- 不像课程项目模板
- 与桌宠产品有联系，但不过度儿童化
- 不破坏现有 DDL、OCR、LLM 和本地存储链路

---

# 3. 开始前的人工准备

在将本文件交给 Codex 前，先完成以下准备。

## 3.1 创建 Git 备份分支

在项目根目录执行：

```bash
git status
git add .
git commit -m "chore: backup before control center redesign"
git switch -c feat/control-center-redesign
```

如果当前代码暂时无法提交，至少完整复制一份项目目录。

不要让 Codex 直接在唯一版本上大范围修改。

---

## 3.2 确认项目能够正常启动

根据项目实际包管理器执行，例如：

```bash
npm install
npm run dev
```

或：

```bash
pnpm install
pnpm dev
```

或：

```bash
yarn
yarn dev
```

确认以下内容：

- 项目依赖可以安装
- 控制中心可以打开
- 日程页面可以访问
- 偏好页面可以访问
- 运行状态页面可以访问
- 当前业务逻辑能够基本工作
- 已知项目的 build、lint、typecheck、test 命令

如果项目当前无法启动，应先要求 Codex 修复启动问题，再进行 UI 优化。

---

## 3.3 放置产品文档

将 Chroni 产品要求文档放到项目根目录，并命名为：

```text
product_requirements.md
```

建议目录：

```text
Chroni/
├─ product_requirements.md
├─ package.json
├─ src/
└─ ...
```

该文档是 Codex 判断产品边界的最高依据。

---

## 3.4 准备当前界面截图

建议创建：

```text
docs/ui-current/
```

放入当前控制中心截图：

```text
docs/ui-current/
├─ tasks.png
├─ preferences.png
├─ status.png
├─ empty-state.png
├─ loading-state.png
└─ narrow-window.png
```

至少应包含：

- 日程页面
- 偏好页面
- 运行状态页面
- 空状态
- 有任务状态
- 窄窗口状态

截图能够帮助 Codex 判断现有 UI 的真实问题，而不是只根据代码猜测。

---

# 4. 建议加载的设计参考

本次不要求 Codex 机械复制任何现有产品，而是使用成熟开源设计资源建立稳定的设计约束。

## 4.1 awesome-design-md

项目地址：

```text
https://github.com/VoltAgent/awesome-design-md
```

作用：

- 提供成熟产品的 DESIGN.md
- 帮助 Agent 理解视觉语言
- 提供颜色、字体、间距、布局、组件和设计禁区
- 避免每次仅凭主观描述生成 UI

建议从中提取或下载：

- Linear
- Raycast
- Notion

放入项目：

```text
docs/design-references/
├─ linear-design.md
├─ raycast-design.md
└─ notion-design.md
```

使用原则：

- Linear：任务列表、状态层级、信息密度
- Raycast：桌面工具结构、设置、快捷键交互
- Notion：暖灰背景、轻量分组、柔和表面

不要完整复制任何品牌。

---

## 4.2 UI UX Pro Max Skill

项目地址：

```text
https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
```

可尝试执行：

```bash
npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max
```

安装完成后，确认项目中存在类似目录：

```text
.codex/skills/ui-ux-pro-max/SKILL.md
```

或：

```text
.skills/ui-ux-pro-max/SKILL.md
```

实际位置以安装结果为准。

该 Skill 用于：

- UI 风格检索
- 配色建议
- 字体建议
- UX 规则
- 页面设计系统
- 技术栈实现约束

如果安装失败，不应阻塞任务。Codex 仍需继续使用产品文档和本文件完成优化。

---

## 4.3 可选设计审查参考

可选参考：

```text
https://github.com/anthropics/skills/tree/main/skills/frontend-design
```

```text
https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
```

```text
https://github.com/jezweb/claude-skills/tree/main/plugins/frontend/skills/design-review
```

这些项目主要用于：

- 防止 AI 模板化 UI
- 检查可访问性
- 检查交互一致性
- 根据截图进行二次视觉审查

不需要将所有项目完整复制进 Chroni。

---

# 5. 推荐项目目录

完成准备后，项目目录建议如下：

```text
Chroni/
├─ product_requirements.md
├─ AGENTS.md
├─ package.json
├─ docs/
│  ├─ ui-current/
│  │  ├─ tasks.png
│  │  ├─ preferences.png
│  │  ├─ status.png
│  │  ├─ empty-state.png
│  │  └─ narrow-window.png
│  └─ design-references/
│     ├─ linear-design.md
│     ├─ raycast-design.md
│     └─ notion-design.md
├─ design-system/
│  ├─ MASTER.md
│  └─ pages/
│     ├─ control-center-tasks.md
│     ├─ control-center-preferences.md
│     └─ control-center-status.md
├─ src/
└─ ...
```

其中：

- `product_requirements.md`：产品边界
- `AGENTS.md`：Codex 项目级规则
- `docs/ui-current/`：当前界面截图
- `docs/design-references/`：外部设计参考
- `design-system/`：Codex 可在任务过程中创建或完善

---

# 6. 根目录 AGENTS.md

在项目根目录创建 `AGENTS.md`，内容如下：

```markdown
# Chroni Development Instructions

## Product

Chroni is a lightweight local DDL assistant centered around an interactive desktop pet.

The desktop pet is the primary interaction entry. The control center exists only for correction, preferences, and basic diagnostics.

Always read `product_requirements.md` before making product or UI changes.

## Control Center Scope

The control center contains only three top-level sections:

1. Tasks
   - Lightweight task correction
   - Quick text input
   - File drop input
   - Pending, completed, and all filters
   - Edit title, importance, and deadline
   - Complete, restore, delete, or retry recognition

2. Preferences
   - Desktop pet visibility
   - Appearance entry
   - Reminder settings
   - Do-not-disturb period
   - Keyboard shortcuts
   - Low-frequency model configuration must remain collapsed

3. Service Status
   - LLM status
   - OCR status
   - Local data and privacy summary
   - Basic troubleshooting
   - Detailed diagnostics remain collapsed

Do not add additional primary sections without explicit instruction.

## Design Character

Chroni combines:

- A lively and expressive desktop pet
- A calm, precise, trustworthy control center
- Compact desktop-native interaction
- Warm neutral surfaces
- Clear Chinese typography
- Low visual noise

The pet carries personality. The control center carries clarity.

## Required Design References

When available, inspect:

- `docs/design-references/linear-design.md`
- `docs/design-references/raycast-design.md`
- `docs/design-references/notion-design.md`
- Installed `ui-ux-pro-max` skill

Use these as design references, not as brands to clone.

## Forbidden UI Patterns

Do not introduce:

- A dashboard home page
- KPI card grids
- Completion-rate charts
- Decorative analytics
- Large gradient banners
- Excessive glassmorphism
- Oversized rounded cards
- A separate card for every setting
- Excessive icons
- Generic SaaS admin templates
- Mobile layouts stretched into a desktop window
- Decorative AI labels without functional meaning

## Layout Rules

- Design for desktop windows between 760 and 960 pixels wide.
- The interface must remain usable at 760 pixels.
- Prefer one persistent compact sidebar and one content region.
- Use list rows instead of large task cards.
- Use grouped setting rows instead of individual setting cards.
- Keep primary actions visible.
- Collapse advanced and low-frequency content.
- Do not change the underlying business logic unless required to fix an existing UI issue.

## Character Usage

The desktop pet or its avatar may appear only in:

- Empty states
- File-processing feedback
- Success and error feedback
- A compact sidebar status area

Do not use character illustrations as decoration throughout every page.

## Implementation Rules

- Reuse the existing framework and dependencies where practical.
- Reuse existing accessible components before adding new libraries.
- Do not replace the entire application architecture for a visual redesign.
- Preserve API contracts, storage logic, task parsing, OCR, and LLM behavior.
- Avoid unnecessary dependencies.
- Use design tokens instead of scattered hard-coded values.
- Support both light and dark themes if the project already supports them.
- Respect reduced-motion preferences.
- Preserve keyboard interaction and visible focus states.

## Validation

Before completing UI work:

1. Run the project.
2. Test all three sections.
3. Test empty, loading, success, error, and populated states.
4. Test at approximately 760, 860, and 960 pixels width.
5. Test long Chinese task titles.
6. Run lint, typecheck, tests, and build commands available in the repository.
7. Review screenshots after implementation.
8. Fix layout, spacing, contrast, overflow, and interaction problems found during review.
9. Report changed files and any remaining limitations.
```

---

# 7. 给 Codex 的主任务提示词

将以下完整内容发送给 Codex。

```text
你现在需要对 Chroni 项目的“控制中心”进行一次完整但克制的 UI/UX 重构。

这不是新建一个演示页面，而是在当前真实代码基础上进行审计、设计、实现、运行和复查。

## 一、开始前必须阅读

开始修改代码前，依次阅读：

1. `product_requirements.md`
2. 根目录下的 `AGENTS.md`
3. 当前控制中心相关的全部页面、组件、样式和路由
4. `docs/ui-current/` 中的现有界面截图
5. `docs/design-references/linear-design.md`
6. `docs/design-references/raycast-design.md`
7. `docs/design-references/notion-design.md`
8. 已安装的 `ui-ux-pro-max` Skill

如果某个参考文件不存在，不要中断任务，继续使用其余资料。

必须使用 `ui-ux-pro-max` Skill 对当前界面进行设计分析，但不要机械套用某一种现成风格。

## 二、产品定位

Chroni 是一款以桌宠为核心入口的本地 DDL 日程助手。

桌宠负责：

- 接收文件、截图、图片和文字
- 表达处理中、成功、失败、临期、逾期等状态
- 提供短反馈
- 唤起轻量日程

控制中心只负责：

1. 轻量修正
2. 基础偏好
3. 服务状态

控制中心不是：

- 项目管理后台
- 数据看板
- 完整日历软件
- 复杂任务管理工具
- 开发者诊断平台

设计目标是：

- 桌宠生动活泼
- 控制中心安静、精确、可信
- 视觉轻量但不能简陋
- 桌面原生感强
- 中文信息层级清晰
- 窄窗口下仍然稳定
- 避免普通课程项目和通用 SaaS 模板感

## 三、首先审计，不要立即修改

第一阶段只分析，不修改代码。

请完成以下工作：

1. 找到控制中心入口、路由、页面组件和样式文件。
2. 确认项目使用的框架、UI 库、状态管理方式和样式方案。
3. 确认项目的启动、lint、typecheck、test 和 build 命令。
4. 运行当前项目并查看控制中心。
5. 对照产品文档和截图，审计当前 UI。

输出一份简洁的审计报告，至少包含：

- 当前信息架构
- 当前主要视觉问题
- 当前主要交互问题
- 哪些组件应该保留
- 哪些组件应该删除
- 哪些组件需要重构
- 哪些业务逻辑不能改动
- 计划修改的文件
- 可能存在的技术风险

重点检查是否存在：

- Dashboard 首页
- KPI 数据卡片
- 无意义统计
- 大面积渐变
- 大量悬浮卡片
- 过大的圆角
- 过多阴影
- 每个设置项独立成卡
- 图标使用过多
- 字体层级混乱
- 间距不统一
- 任务列表过于松散
- 窄窗口文字重叠
- 控件样式不统一
- 桌宠元素被滥用
- Generic SaaS admin template 风格

完成审计后，继续执行，不需要等待我确认。

## 四、建立轻量设计系统

在正式重构页面前，建立或整理统一设计 Token。

根据当前技术栈，在合适的位置创建或整理：

- 背景色
- 表面色
- 主文字
- 次级文字
- 弱文字
- 边框
- 品牌强调色
- 成功色
- 警告色
- 逾期色
- 焦点环
- 圆角
- 阴影
- 间距
- 字号
- 行高
- 动画时长

设计方向：

- 以暖灰、柔和中性色为主要表面
- 品牌色只用于选中、焦点和关键操作
- 红色和橙色只表达逾期、临期或错误
- 弱边框替代大面积阴影
- 内容层级主要通过字体、间距和对齐表达
- 不使用大面积紫色渐变
- 不使用夸张玻璃拟态
- 不使用每个模块一张悬浮大卡片的布局

不要硬编码散乱颜色。优先建立 CSS Variables、主题 Token 或项目当前采用的等价机制。

## 五、重构整体结构

控制中心只保留三个一级入口：

1. 日程
2. 偏好
3. 运行状态

采用适合桌面工具的结构：

- 左侧紧凑导航
- 右侧内容区域
- 导航宽度约 150 至 176 像素
- 窗口在 760 像素宽时仍然可用
- 内容区域不能被过度卡片化
- 页面标题、说明、操作区域和内容列表层级清楚

左侧底部可以放：

- 小型桌宠头像
- 一行运行状态
- 简短状态圆点

不要放大型插画。

## 六、日程页面

日程页面是默认页面，也是最常用页面。

顶部应包含：

- 页面标题
- 一句简短说明
- 快速文本输入和文件拖入入口

快速输入区域必须：

- 可回车识别
- 支持拖入文件
- 有加载状态
- 加载时禁用重复提交
- 成功或失败后显示一行短反馈
- 不进入复杂结果页面

任务筛选只保留：

- 待处理
- 已完成
- 全部

任务使用紧凑列表行，不使用一任务一卡片。

每行优先显示：

- 完成状态
- 任务名称
- 重要性
- 截止时间
- 剩余时间或当前状态
- 精简的更多操作入口

任务标题过长时必须正确截断或换行，不能挤压时间和操作区。

状态色只表达：

- 24 小时内或逾期：红色
- 3 天内：橙色
- 普通：中性灰
- 已完成：降低视觉权重

点击任务时：

- 使用行内展开、轻量侧面板或现有合适交互
- 不新建复杂详情页
- 允许修改标题、重要性和截止时间
- 允许完成、恢复、删除和重新识别
- 可以查看来源摘要
- 原始抽取文本等低频内容默认折叠

删除：

- 总任务数卡片
- 今日任务卡片
- 完成率卡片
- 趋势图
- 环形图
- 完整月历
- 无意义的数据统计

空状态可以使用一次桌宠形象，并显示：

“把课程通知、截图或文件拖给我，我会帮你找到截止时间。”

## 七、偏好页面

采用紧凑设置分组和设置行，不为每个设置项创建独立卡片。

建议分组：

### 桌宠

- 显示桌宠
- 开机启动
- 吸附屏幕边缘
- 桌宠大小或轻量外观入口

### 提醒

- 启用提醒
- 勿扰时间
- 临期提醒
- 通知方式

### 快捷键

- 打开轻量日程
- 快速输入
- 显示或隐藏桌宠

### 高级

- 模型配置
- OCR 配置
- 低频服务参数

“高级”默认折叠。

每个设置行必须：

- 标签清晰
- 必要时有一行弱化说明
- 控件靠右对齐
- 点击区域足够
- 具有 hover、focus、disabled 状态

## 八、运行状态页面

运行状态页面不是开发者面板。

默认只展示：

- 大模型服务
- OCR 服务
- 本地数据
- 隐私状态

每项采用简洁状态行：

- 正常
- 暂不可用
- 需要配置
- 检测中

异常时才显示：

- 简短原因
- 重新检测
- 查看解决方法

详细日志、端口、原始响应和诊断数据必须默认折叠。

保留必要操作：

- 重新检测服务
- 查看本地数据位置
- 导出数据
- 清理本地数据

危险操作需要清晰区分，并保留二次确认。

## 九、桌宠元素使用约束

控制中心需要与桌宠产品有关联，但不能儿童化。

桌宠只允许出现在：

- 空状态
- 文件处理中
- 操作成功或失败反馈
- 左侧底部的小型状态区

不要：

- 每个卡片放桌宠
- 每个标题放桌宠
- 使用大量卡通贴纸装饰
- 用角色取代正常的状态文本
- 让活泼形象损害工具可信度

## 十、交互与可访问性

确保：

- 所有可点击元素有明确 hover 和 focus 状态
- 支持键盘导航
- 输入控件有标签或可访问名称
- 按钮不能只靠图标表达关键含义
- 禁用态可辨认
- 加载操作不能重复提交
- 错误信息说明下一步操作
- 颜色不是唯一状态表达方式
- 支持 prefers-reduced-motion
- 动画主要使用 transform 和 opacity
- 不引入持续干扰用户的动画

## 十一、实现约束

- 不重写业务逻辑
- 不修改 API 合同
- 不修改 DDL 解析流程
- 不修改 OCR 和 LLM 的核心实现
- 不修改本地存储结构，除非现有 UI 明确依赖错误
- 优先复用现有组件
- 不为了视觉效果引入大型依赖
- 不把当前框架替换成另一个框架
- 不删除已有有效功能
- 不伪造任务或服务状态
- 不在首次启动注入示例数据
- 不使用在线图片作为控制中心的关键依赖
- 所有中文文案必须自然、短且明确

如果当前代码和产品文档冲突，以 `product_requirements.md` 为准，但不要破坏已经可工作的业务链路。

## 十二、完成后必须运行和复查

实现后完成以下步骤：

1. 启动项目。
2. 打开日程、偏好和运行状态三个页面。
3. 检查以下状态：
   - 空状态
   - 正常任务列表
   - 长中文标题
   - 加载状态
   - 成功反馈
   - 失败反馈
   - 服务异常状态
   - 已完成任务
   - 逾期任务
4. 分别检查约 760、860 和 960 像素窗口宽度。
5. 检查有无：
   - 文字重叠
   - 控件错位
   - 横向滚动
   - 截断错误
   - 颜色对比不足
   - 样式不一致
   - 不必要卡片
   - 不合理留白
6. 截取修改后的三个页面截图。
7. 根据截图再次进行视觉审查。
8. 发现问题后直接修复，不要只写建议。
9. 执行项目已有的：
   - lint
   - typecheck
   - test
   - build
10. 修复由此次修改引起的错误。

## 十三、最终输出

最终报告只需要包含：

1. 本次设计方向
2. 删除了哪些庸俗或后台化元素
3. 保留了哪些原有功能
4. 修改的文件列表
5. 新增或调整的设计 Token
6. 三个页面分别发生了什么变化
7. 执行过的验证命令及结果
8. 截图位置
9. 仍然存在的限制

不要只输出设计方案。必须实际修改代码、运行项目并完成截图复查。
```

---

# 8. 第二轮视觉审查提示词

当 Codex 完成第一轮重构后，再发送以下提示词：

```text
请不要新增功能。现在只对刚才完成的 Chroni 控制中心进行第二轮视觉质量审查。

重新运行项目并查看日程、偏好、运行状态三个页面。

重点检查：

- 是否仍然像通用 SaaS 后台
- 是否仍有不必要的卡片和边框
- 字体层级是否清楚
- 中文文字是否拥挤
- 任务行的信息密度是否合理
- 设置行是否对齐
- 页面之间是否使用统一 Token
- 760px 窄窗口是否稳定
- 长任务标题是否影响截止时间和操作按钮
- loading、empty、error、success 状态是否完整
- hover、focus、disabled 状态是否一致
- 桌宠元素是否使用过度
- 品牌色是否使用过度
- 控制中心是否足够安静、可信、轻量

请对每个问题直接修改代码并重新检查。

不要通过增加装饰解决问题。优先通过删除、对齐、间距、字号、边框和信息层级优化。

完成后运行 lint、typecheck 和 build，并输出最终变更摘要。
```

---

# 9. Codex 执行过程要求

Codex 应按以下顺序工作。

## 阶段 1：读取和定位

- 阅读产品文档
- 阅读 AGENTS.md
- 阅读设计参考
- 加载可用 Skill
- 定位控制中心路由
- 定位页面组件
- 定位全局样式
- 定位主题配置
- 定位状态管理
- 定位 API 调用

## 阶段 2：运行现有项目

- 安装依赖
- 启动项目
- 打开控制中心
- 查看三类页面
- 查看窄窗口
- 检查控制台错误
- 记录当前问题

## 阶段 3：输出 UI 审计

审计至少包括：

- 信息架构问题
- 视觉层级问题
- 组件重复问题
- 样式不一致问题
- 可访问性问题
- 响应式问题
- 需要保留的代码
- 需要删除的代码
- 需要修改的文件

## 阶段 4：建立设计 Token

应统一：

- 色彩
- 字号
- 行高
- 间距
- 圆角
- 边框
- 阴影
- 动画
- 状态色
- 焦点样式

## 阶段 5：重构三个页面

按顺序：

1. 整体框架与侧栏
2. 日程页面
3. 偏好页面
4. 运行状态页面
5. 空状态和反馈状态
6. 窄窗口适配

## 阶段 6：运行与截图

必须查看：

- 760px
- 860px
- 960px

必须测试：

- 无任务
- 有任务
- 长标题
- 加载中
- 成功
- 失败
- 服务异常
- 已完成
- 逾期

## 阶段 7：第二次修正

根据截图检查：

- 视觉噪音
- 对齐
- 留白
- 溢出
- 颜色
- 对比度
- 控件状态
- 中文排版

发现问题后直接修改。

## 阶段 8：工程验证

执行项目已有命令：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

如果命令名称不同，以 `package.json` 为准。

---

# 10. 控制中心信息架构要求

控制中心只允许三个一级导航。

```text
日程
偏好
运行状态
```

不要增加：

- 首页
- 仪表盘
- 文件中心
- 数据分析
- 周报
- 月报
- 历史记录
- 插件市场
- 系统管理
- 开发者工具

---

# 11. 页面设计标准

## 11.1 整体布局

建议窗口范围：

```text
宽度：760–960px
高度：560–700px
侧栏：150–176px
```

结构：

```text
┌──────────────────────────────────────────────┐
│ Chroni                              —  □  ×  │
├────────────┬─────────────────────────────────┤
│ 日程       │ 页面标题                        │
│ 偏好       │ 页面说明                        │
│ 运行状态   │                                 │
│            │ 页面主要内容                    │
│            │                                 │
│ 宠物状态   │                                 │
└────────────┴─────────────────────────────────┘
```

---

## 11.2 日程页面

保留：

- 快速输入
- 文件拖入
- 待处理 / 已完成 / 全部
- 紧凑任务列表
- 行内或轻量编辑
- 完成
- 恢复
- 删除
- 重新识别
- 来源摘要

删除：

- KPI 卡片
- 总任务数统计
- 完成率
- 趋势图
- 环形图
- 大型日历
- 数据看板
- 一任务一卡片

任务行应突出：

```text
完成状态
任务标题
重要性
截止时间
剩余时间
操作
```

---

## 11.3 偏好页面

使用设置分组：

```text
桌宠
提醒
快捷键
高级
```

每个设置项采用一行布局。

```text
显示桌宠                              [开关]
勿扰时间                         23:00–08:00
打开日程                        Ctrl + Space
```

高级配置默认折叠。

---

## 11.4 运行状态页面

默认展示：

- 大模型服务
- OCR
- 本地数据
- 隐私状态

使用状态行：

```text
大模型服务                     ● 正常
图片文字识别                   ● 可用
本地数据                       ● 已保存
```

异常时才展开原因和操作。

不要默认展示：

- 端口
- 原始响应
- 完整日志
- 大量模型参数
- 开发者调试数据

---

# 12. 视觉规范

## 12.1 视觉关键词

```text
calm utility
warm precision
desktop native
compact
low-noise
playful companion
```

## 12.2 风格比例

```text
Linear：60%
Raycast：25%
Notion：15%
```

具体含义：

- Linear：任务列表和信息密度
- Raycast：桌面工具交互
- Notion：暖灰表面和轻量分组

## 12.3 色彩

- 暖灰或低饱和中性色作为背景
- 品牌色仅用于关键操作和选中
- 红色仅用于逾期和错误
- 橙色仅用于临期和警告
- 成功色仅用于完成和服务正常
- 不使用大面积紫色渐变

## 12.4 边框与阴影

- 优先弱边框
- 少用阴影
- 不使用所有模块悬浮
- 不使用夸张玻璃拟态

## 12.5 圆角

建议：

```text
窗口：12–16px
输入框：8–10px
按钮：6–8px
列表行：不需要大型圆角卡片
```

## 12.6 字体层级

至少区分：

- 页面标题
- 分组标题
- 主要内容
- 辅助说明
- 状态信息
- 弱提示

主要依靠：

- 字号
- 字重
- 行高
- 明暗
- 间距

而不是大量色块。

---

# 13. 桌宠元素使用规则

桌宠负责活泼和情绪。

控制中心负责可靠和效率。

桌宠形象只允许出现在：

- 空状态
- 文件处理反馈
- 成功反馈
- 失败反馈
- 侧栏底部的小状态区

不要：

- 每个页面标题放桌宠
- 每个设置卡片放桌宠
- 大量卡通贴纸
- 用桌宠代替文字状态
- 让控制中心变成儿童软件

---

# 14. 禁止出现的 UI 模式

必须避免：

- Generic SaaS Dashboard
- KPI 卡片网格
- 欢迎横幅
- 完成率环形图
- 无意义趋势图
- 大面积渐变背景
- 巨大玻璃拟态卡片
- 每个模块一个悬浮容器
- 图标过度使用
- 大圆角移动端布局
- 炫技动画
- 大量 AI 标签
- 伪造数据
- 伪造示例任务
- 过量插画

---

# 15. 工程边界

Codex 不得：

- 重写 DDL 抽取逻辑
- 更改 OCR 逻辑
- 更改 LLM 逻辑
- 更改 API 合同
- 更改本地数据结构
- 替换现有前端框架
- 为美化引入大型依赖
- 删除有效功能
- 注入虚假任务数据
- 把控制中心改造成复杂任务管理系统

Codex 可以：

- 重组前端组件
- 优化页面结构
- 整理设计 Token
- 调整样式
- 优化交互反馈
- 修复窄窗口适配
- 改善可访问性
- 删除纯装饰和无意义统计
- 修复现有 UI Bug

---

# 16. 最终验收清单

## 产品边界

- [ ] 只有日程、偏好、运行状态三个一级模块
- [ ] 没有新增 Dashboard
- [ ] 没有新增统计分析
- [ ] 没有复杂日历
- [ ] 没有复杂项目管理功能

## 日程页面

- [ ] 快速输入可用
- [ ] 文件拖入可用
- [ ] 待处理 / 已完成 / 全部筛选可用
- [ ] 任务列表紧凑
- [ ] 长标题不挤压截止时间
- [ ] 状态色使用克制
- [ ] 可完成、恢复、删除、重新识别
- [ ] 来源摘要可查看
- [ ] 低频信息默认折叠

## 偏好页面

- [ ] 使用设置行而不是大量卡片
- [ ] 桌宠设置清楚
- [ ] 提醒设置清楚
- [ ] 勿扰时间清楚
- [ ] 快捷键清楚
- [ ] 高级配置默认折叠
- [ ] 控件对齐一致

## 运行状态页面

- [ ] 服务状态清晰
- [ ] 异常原因简短
- [ ] 可重新检测
- [ ] 详细日志默认折叠
- [ ] 危险操作有确认
- [ ] 隐私和本地数据说明清楚

## 视觉质量

- [ ] 不像通用 SaaS 后台
- [ ] 没有 KPI 卡片
- [ ] 没有无意义图表
- [ ] 没有过量渐变
- [ ] 没有过量阴影
- [ ] 没有过量圆角
- [ ] 没有图标滥用
- [ ] 字体层级清楚
- [ ] 间距统一
- [ ] 品牌色使用克制
- [ ] 桌宠元素没有滥用

## 交互和可访问性

- [ ] hover 状态清楚
- [ ] focus 状态清楚
- [ ] disabled 状态清楚
- [ ] loading 时不能重复提交
- [ ] 错误提示包含下一步
- [ ] 支持键盘导航
- [ ] 颜色不是唯一状态表达方式
- [ ] 支持 reduced motion

## 响应式

- [ ] 760px 可用
- [ ] 860px 可用
- [ ] 960px 可用
- [ ] 无横向滚动
- [ ] 无文字重叠
- [ ] 无控件错位
- [ ] 无异常截断

## 工程验证

- [ ] 项目可启动
- [ ] lint 通过
- [ ] typecheck 通过
- [ ] test 通过或说明现有问题
- [ ] build 通过
- [ ] 截图已生成
- [ ] 截图经过二次复查
- [ ] 修改文件清单已输出

---

# 17. 推荐最终执行方式

## 第一步

完成本文件第 3 至第 6 节中的准备工作。

## 第二步

将本文件放在项目根目录，例如：

```text
CHRONI_UI_REDESIGN_GUIDE.md
```

## 第三步

将下面这句话发送给 Codex：

```text
请完整阅读 `CHRONI_UI_REDESIGN_GUIDE.md`、`product_requirements.md` 和 `AGENTS.md`，按照指南完成 Chroni 控制中心的前端审计、设计系统建立、UI 重构、运行验证、截图复查和第二轮修正。不要只给建议，必须实际修改代码并完成工程验证。
```

## 第四步

Codex 完成第一轮后，发送第 8 节中的“第二轮视觉审查提示词”。

## 第五步

检查最终截图和 Git diff。

重点确认：

- 没有业务逻辑被意外修改
- 没有新增不需要的依赖
- 没有把控制中心改成复杂后台
- 三个页面在窄窗口下正常
- 产品功能仍能使用

---

# 18. 最终原则

Chroni 的视觉不是“控制中心也要非常可爱”。

正确的设计关系是：

```text
桌宠负责生动、活泼和情绪
控制中心负责安静、精确和可信
```

控制中心的高级感主要来自：

- 删除无意义内容
- 减少卡片
- 统一对齐
- 控制间距
- 建立字体层级
- 使用稳定的设计 Token
- 提供完整交互状态
- 在真实窗口尺寸中反复检查

不要通过增加装饰、渐变、图表和插画来掩盖结构问题。
