# Chroni Agent 三项核心能力优化——Codex 开发提示词

> 将本文完整交给 Codex，并要求其在 `miracle121388-a11y/chroni` 仓库中直接执行。  
> 目标是在现有 Electron + TypeScript 架构上实现真实、可测试、可持久化的 Agent 能力，不得只制作静态界面或模拟数据。

---

## 0. 角色与项目背景

你是一名资深 Electron、TypeScript、React 与 LLM Agent 工程师。请在当前 Chroni 仓库中完成设计、实现、测试和文档更新。

Chroni 当前已经具备：

- 文本、文件、图片 OCR 和大模型 DDL 抽取；
- `Observe → Plan → Act → Verify` 的 DeadlineAgent；
- 风险分析、工作块规划、重新规划、提醒、计划持久化和 Trace；
- `AgentMemory` 中的每日容量、工作时段、提醒频率、自动巡检和大模型辅助规划；
- Electron IPC、本地 HTTP API、`ChroniStore` 本地持久化；
- 任务字段 `estimatedMinutes`、`progressPercent`；
- 控制中心中的 Agent 页面和桌宠状态提示。

本次不是重写项目，也不是增加普通聊天机器人，而是在现有 Agent 上实现三个紧密关联的能力：

1. **信息补全与主动追问 Agent**
2. **任务拆解与任务详情规划 Agent**
3. **面向任务规划的个性化行为 Memory**

三项能力必须形成统一闭环：

```text
用户输入任务或文件
  → Agent 判断信息是否足够
  → 信息不足时主动追问
  → 信息完整后生成任务及详细执行规划
  → 用户可修改规划
  → 系统记录修改行为并提炼偏好
  → 后续同类任务规划自动应用高置信度偏好
  → 用户继续修改
  → Memory 持续更新，但不得无依据过拟合
```

---

# 1. 总体目标

完成后，Chroni 应做到：

- 不确定时不盲目生成错误任务，主动向用户询问必要信息；
- 每个任务栏目都可以点击进入，查看任务来源、Agent 理解、拆解步骤、预计时间、阶段安排和规划依据；
- 用户能够修改任务步骤、顺序、预计耗时、检查时间和规划粒度；
- Agent 能从用户反复修改中学习稳定偏好；
- 后续规划明确说明使用了哪些个性化偏好；
- 所有 LLM 输出结构化、本地验证、失败回退；
- Agent 不得自行修改最终 DDL、删除任务或确认任务完成；
- 原有抽取、日程、桌宠、提醒、Agent 巡检、API 与打包能力不得回归。

---

# 2. 强制开发原则

## 2.1 先检查仓库

开始开发前，至少检查：

```text
README.md
apps/desktop/src/shared/types.ts
apps/desktop/src/store.ts
apps/desktop/src/validation.ts
apps/desktop/src/intake.ts
apps/desktop/src/llm-client.ts
apps/desktop/src/main.ts
apps/desktop/src/api-server.ts
apps/desktop/src/preload.ts
apps/desktop/src/agent/deadline-agent.ts
apps/desktop/src/agent/agent-planner.ts
apps/desktop/src/agent/agent-tools.ts
apps/desktop/src/agent/agent-memory.ts
apps/desktop/src/agent/agent-state.ts
apps/desktop/src/agent/agent-trace.ts
apps/desktop/src/agent/agent-scheduler.ts
apps/desktop/src/renderer/src/main.tsx
apps/desktop/src/renderer/src/styles.css
apps/desktop/test/*.test.mjs
```

沿用当前代码风格、类型系统、IPC 设计、HTTP 鉴权、运行时校验和测试模式。

## 2.2 不引入割裂架构

- 不增加 Python sidecar、独立数据库服务或云端账号系统；
- 不引入重量级多 Agent 框架替代当前类型化工具体系；
- 数据继续默认保存在 Electron `userData` 下的 `chroni-state.json`；
- 保持 OpenAI-compatible LLM 接口；
- 无 LLM 或调用失败时，原有任务功能必须正常；
- 不做与本功能无关的全仓库重构。

## 2.3 LLM 只能提议

所有模型输出必须经过：

```text
LLM 结构化提议
→ JSON 解析
→ 运行时字段校验
→ 业务约束校验
→ 权限判断
→ 本地工具执行
→ 重新读取状态
→ Verify
```

严禁：

- 从自然语言直接执行任意工具；
- 让模型生成并运行代码；
- 让模型直接修改 `ChroniStore`；
- 展示隐藏推理或 chain-of-thought；
- 将 API Key、完整原始文档或模型原始响应写入 Trace。

---

# 3. 功能一：信息补全与主动追问 Agent

## 3.1 产品目标

当用户传入的信息不足以安全创建任务或生成有效规划时，不再只返回“无法可靠识别”，而是创建可继续处理的“待补全事项”。

示例输入：

```text
下周完成机器学习作业。
```

Agent 应识别：

```text
已知：
- 标题：机器学习作业
- 任务类型：课程作业

缺失或不确定：
- “下周”具体日期
- 截止时刻
- 作业形式
- 预计工作量
```

桌宠或控制中心显示：

```text
我还需要确认截止时间：
“下周”是指哪一天？

[下周一] [下周五] [自己选择]
```

用户回答后恢复原处理上下文，不要求重新上传文件或重新输入全文。

## 3.2 追问触发条件

区分“创建任务必需字段”和“规划增强字段”。

### 必需字段

缺失或存在多种高概率解释时必须追问：

- 可识别的任务标题；
- 明确且合法的 `dueAt`；
- 相对日期存在多义性；
- 文档中多个候选 DDL 无法对应任务；
- 日期或时刻无法通过明确默认规则处理；
- 任务语义和普通通知语义无法区分。

### 规划增强字段

可先创建任务，再在详情中提示补全：

- 预计总耗时；
- 当前进度；
- 交付物；
- 是否存在多个阶段；
- 工作块长度；
- 难度或熟悉程度；
- 是否预留检查时间。

### 不应追问

- 可通过稳定默认值安全处理；
- Memory 中已有高置信度明确偏好；
- 用户明确选择“稍后补全”；
- 对规划影响很小；
- 同一问题已回答且来源未变化。

## 3.3 数据模型

在 `shared/types.ts` 中增加可序列化类型，命名可调整但语义需完整：

```ts
export type ClarificationField =
  | "title"
  | "dueAt"
  | "dueTime"
  | "taskType"
  | "deliverables"
  | "estimatedMinutes"
  | "progressPercent"
  | "difficulty"
  | "other";

export type ClarificationOption = {
  id: string;
  label: string;
  value: string | number | string[];
  explanation?: string;
};

export type PendingClarification = {
  id: string;
  sourceId?: string;
  taskId?: string;
  field: ClarificationField;
  question: string;
  reason: string;
  options: ClarificationOption[];
  allowFreeText: boolean;
  required: boolean;
  status: "pending" | "answered" | "dismissed" | "expired";
  createdAt: string;
  answeredAt?: string;
  answer?: string | number | string[];
  resumeToken: string;
};

export type IntakeDraft = {
  id: string;
  sourceId?: string;
  sourceName: string;
  sourceType: string;
  candidate: {
    title?: string;
    dueAt?: string;
    importance?: Importance;
    estimatedMinutes?: number;
    progressPercent?: number;
    deliverables?: string[];
    taskType?: string;
  };
  confidence: Record<string, number>;
  pendingClarificationIds: string[];
  status: "needs-clarification" | "ready" | "applied" | "cancelled";
  createdAt: string;
  updatedAt: string;
};
```

要求：

- 不持久化完整模型原始响应；
- 能通过 `sourceId` 找回来源；
- 支持一个输入产生多个候选任务；
- 支持多轮追问；
- 旧状态文件自动补默认值；
- 草稿转任务时继续使用现有去重逻辑；
- 同一 `resumeToken` 不可重复应用。

## 3.4 模型结构化输出

建立独立模块，例如：

```text
apps/desktop/src/agent/clarification-agent.ts
apps/desktop/src/agent/clarification-schema.ts
```

输出示例：

```json
{
  "status": "needs_clarification",
  "candidate": {
    "title": "机器学习作业",
    "dueAt": null,
    "importance": "medium",
    "estimatedMinutes": null,
    "progressPercent": null,
    "deliverables": [],
    "taskType": "coursework"
  },
  "missingFields": [
    {
      "field": "dueAt",
      "required": true,
      "reason": "“下周”无法映射到唯一日期",
      "question": "这项作业具体在下周哪一天截止？",
      "options": [
        {
          "id": "monday",
          "label": "下周一",
          "value": "2026-07-13T23:59:00+09:00"
        }
      ],
      "allowFreeText": true
    }
  ]
}
```

本地验证：

- 只允许支持字段；
- 问题和 option 数量、长度受限；
- 日期合法；
- 候选日期与上下文不矛盾；
- 不得虚构原文没有的课程名称、提交方式或文件要求；
- required 字段未解决前不得创建正式任务；
- 模型输出非法时回退，不制造空白任务。

## 3.5 流程

```text
extract/intake
→ completeness check
→ 完整：创建任务并触发规划
→ 不完整：保存 IntakeDraft 和 PendingClarification
→ UI 展示问题
→ 用户回答
→ 本地合并答案
→ 再次验证完整性
→ 仍缺字段：问下一个问题
→ 已完整：创建任务
→ 自动触发任务拆解 Agent
```

不要每次回答都重新发送完整原文。优先使用草稿、回答、来源摘要和未解决字段。

## 3.6 UI

### 桌宠

新增状态，例如：

```ts
"needs_clarification"
```

气泡：

```text
我还缺一个信息，确认后就能安排这项任务。
```

点击桌宠打开追问卡片，而不是普通列表。

### 控制中心

增加“待确认”入口或顶部卡片：

- 问题；
- 追问原因；
- 快捷选项；
- 自定义输入；
- “稍后处理”；
- “放弃草稿”。

### 任务详情

非 required 字段显示“还可以补充”，允许稍后填写并重新生成规划。

## 3.7 IPC 与 HTTP API

增加并验证类似接口：

```text
GET    /api/agent/clarifications
POST   /api/agent/clarifications/:id/answer
POST   /api/agent/clarifications/:id/dismiss
GET    /api/intake-drafts/:id
```

要求：

- 保持 Bearer 鉴权；
- payload 运行时校验；
- HTTP snapshot 不暴露完整原文；
- 回答后返回最新 snapshot 与结果；
- 不允许回答已过期、已应用或不存在的问题；
- 操作幂等。

---

# 4. 功能二：任务拆解与任务详情规划 Agent

## 4.1 产品目标

外层日程列表继续展示标题和 DDL，但任务卡片可点击。进入详情后展示 Agent 根据原始输入、DDL、剩余时间、当前进度和个性化 Memory 生成的执行规划。

详情页不是聊天页，而是“这个任务如何完成”的工作空间。

## 4.2 任务详情内容

至少包含：

- 标题、DDL、重要性、来源摘要；
- 预计总耗时、当前进度、当前风险；
- 规划版本、更新时间、规划来源；
- Agent 对目标、任务类型、交付物、完成标准、约束的结构化理解；
- 拆解步骤；
- 规划摘要；
- 使用的个性化偏好；
- 规划依据；
- 仍不确定的信息。

每一步展示：

- 标题、说明；
- 预计耗时；
- 建议完成时间；
- 前置依赖；
- 状态；
- 是否由用户修改；
- 是否使用 Memory 偏好。

## 4.3 数据模型

```ts
export type TaskStepStatus =
  | "pending"
  | "in-progress"
  | "blocked"
  | "completed"
  | "skipped";

export type TaskPlanStep = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  order: number;
  dependsOn: string[];
  suggestedStartAt?: string;
  suggestedEndAt?: string;
  completionCriteria: string[];
  status: TaskStepStatus;
  origin: "agent" | "user";
  userModifiedFields: string[];
  createdAt: string;
  updatedAt: string;
};

export type TaskPlan = {
  id: string;
  taskId: string;
  version: number;
  goal: string;
  taskType?: string;
  deliverables: string[];
  constraints: string[];
  steps: TaskPlanStep[];
  estimatedTotalMinutes: number;
  bufferMinutes: number;
  latestSafeStartAt?: string;
  plannerSource: "rules" | "llm" | "personalized-llm" | "rules-fallback";
  memoryPreferenceIds: string[];
  status: "draft" | "active" | "superseded";
  createdAt: string;
  updatedAt: string;
};

export type TaskPlanRevision = {
  id: string;
  taskId: string;
  planId: string;
  fromVersion: number;
  toVersion: number;
  source: "user" | "agent";
  changes: PlanChange[];
  createdAt: string;
};

export type PlanChange =
  | { type: "step-added"; stepId: string; afterStepId?: string }
  | { type: "step-removed"; stepId: string }
  | { type: "step-reordered"; stepId: string; fromOrder: number; toOrder: number }
  | { type: "duration-changed"; stepId: string; beforeMinutes: number; afterMinutes: number }
  | { type: "title-changed"; stepId: string; before: string; after: string }
  | { type: "buffer-changed"; beforeMinutes: number; afterMinutes: number };
```

要求：

- `DdlItem` 代表最终任务；
- `TaskPlan` 独立保存；
- 每个任务最多一个 active plan；
- 重新生成时创建新版本；
- 删除任务时清理计划、追问和相关学习事件；
- 完成任务后计划可查看但不再自动重排；
- 兼容旧状态文件。


## 4.4 拆解 Agent 输入

只发送完成规划所需信息：

```ts
{
  now,
  task: {
    id,
    title,
    dueAt,
    importance,
    estimatedMinutes,
    progressPercent,
    sourceSummary
  },
  sourceContext: {
    summary,
    relevantExcerpt
  },
  userConstraints: {
    maxDailyMinutes,
    workdayStart,
    workdayEnd
  },
  applicablePreferences: [
    {
      id,
      key,
      value,
      confidence,
      evidenceCount
    }
  ],
  existingPlan?: {
    version,
    steps
  }
}
```

要求：

- 只发送相关来源片段；
- 限制长度；
- 不发送完整 Trace；
- 不发送其他任务原文；
- 不发送 API Key。

## 4.5 拆解 Agent 输出

建议结构：

```json
{
  "goal": "完成并提交机器学习作业",
  "taskType": "coursework",
  "deliverables": ["作业答案或代码"],
  "constraints": ["必须在最终 DDL 前完成检查"],
  "estimatedTotalMinutes": 180,
  "bufferMinutes": 30,
  "steps": [
    {
      "clientId": "step-1",
      "title": "阅读题目并确认要求",
      "description": "通读题目，标记需要推导、编码或查阅资料的部分",
      "estimatedMinutes": 30,
      "dependsOn": [],
      "completionCriteria": [
        "明确所有题目要求",
        "列出待解决问题"
      ]
    },
    {
      "clientId": "step-2",
      "title": "完成核心作答",
      "description": "完成推导、代码或主体内容",
      "estimatedMinutes": 90,
      "dependsOn": ["step-1"],
      "completionCriteria": [
        "所有题目均有初步答案"
      ]
    },
    {
      "clientId": "step-3",
      "title": "检查并整理提交",
      "description": "检查遗漏、格式和提交文件",
      "estimatedMinutes": 60,
      "dependsOn": ["step-2"],
      "completionCriteria": [
        "无明显遗漏",
        "提交文件准备完成"
      ]
    }
  ],
  "appliedPreferenceKeys": [
    "preferredStepMinutes",
    "courseworkBufferRatio"
  ],
  "summary": "根据历史偏好，将核心作答安排为较长步骤，并预留检查时间。"
}
```

## 4.6 本地计划验证

建立独立 validator，至少验证：

- 步骤数 1–12；
- 每步标题非空且长度受限；
- 每步预计时间 15–480 分钟；
- 总时间与步骤时间之和一致或在可解释误差内；
- 不允许循环依赖；
- `dependsOn` 只能引用当前计划步骤；
- order 唯一且连续；
- buffer 不得为负；
- 建议时间早于最终 DDL；
- 不覆盖已完成步骤；
- 不改变最终 DDL；
- preference ID 必须来自系统真实提供的 Memory；
- 无法在 DDL 前完成时返回容量冲突，不生成虚假可行计划。

不可行时详情页显示：

```text
当前剩余时间不足以完整安排全部步骤。
缺口：90 分钟。

可选择：
- 增加每日可用时间
- 缩短部分步骤
- 调整低优先级任务
- 仅保留核心交付物
```

第一版只提供调整建议，不自动修改其他任务。

## 4.7 用户编辑能力

任务详情必须允许：

- 修改步骤标题和说明；
- 修改步骤预计耗时；
- 拖动排序；
- 新增、删除步骤；
- 修改 buffer；
- 标记步骤完成；
- 恢复 Agent 建议；
- 重新生成计划；
- 查看上个版本变更摘要。

保存修改时：

1. 计算结构化 diff；
2. 保存 plan revision；
3. 更新任务总预计耗时；
4. 重新验证依赖和 DDL 可行性；
5. 生成 `PlanningFeedbackEvent`；
6. 交给行为 Memory 学习器；
7. 触发现有 DeadlineAgent 重新巡检。

不要把输入框每个字符变化都当作学习事件，只在用户明确保存时记录。

## 4.8 外层栏目

现有任务卡片可点击并支持键盘进入。卡片增加轻量信息：

```text
机器学习作业
7 月 12 日 23:59

3 个步骤 · 预计 180 分钟
下一步：阅读题目并确认要求
```

状态标识：

- 待补全；
- 待生成规划；
- 已规划；
- 用户已修改；
- 规划存在风险；
- 已完成。

不要在外层显示完整步骤。

## 4.9 IPC 与 HTTP API

建议增加：

```text
GET    /api/items/:id/plan
POST   /api/items/:id/plan/generate
PUT    /api/items/:id/plan
POST   /api/items/:id/plan/regenerate
PATCH  /api/items/:id/plan/steps/:stepId
POST   /api/items/:id/plan/steps
DELETE /api/items/:id/plan/steps/:stepId
POST   /api/items/:id/plan/steps/:stepId/complete
GET    /api/items/:id/plan/revisions
```

可按现有 API 风格收敛，但必须：

- 明确工具边界；
- Bearer 鉴权；
- 运行时校验；
- 防止跨 taskId 修改；
- 返回最新 snapshot 或明确结果；
- 幂等；
- 失败时不留下半写入状态。

---

# 5. 功能三：面向规划的个性化行为 Memory

## 5.1 产品目标

Behavior Memory 的目的不是聊天人格，而是提高任务拆解和排程适配度。

Agent 学习：

> 用户如何修改 Agent 规划，以及这些修改在什么任务类型和约束下稳定出现。

示例：

Agent 多次生成 30 分钟课程作业步骤，用户连续 6 次改为 45 分钟，形成：

```text
偏好：课程作业核心步骤通常为 45 分钟
证据：6 次
置信度：0.82
适用范围：taskType = coursework
```

后续课程作业可优先采用 45 分钟，但：

- 不影响无关任务；
- 用户仍可修改；
- 一次反向修改不立即推翻长期偏好；
- 详情页说明使用了该偏好；
- 用户可查看、停用、纠正和删除。

## 5.2 不做在线训练

采用：

```text
结构化编辑事件
→ 本地特征提取
→ 统计聚合
→ 置信度更新
→ 形成可解释偏好
→ 注入后续规划 prompt 和规则 fallback
```

不训练、不微调模型。

## 5.3 学习事件

```ts
export type PlanningFeedbackEvent = {
  id: string;
  taskId: string;
  planId: string;
  planVersion: number;
  taskType?: string;
  source: "plan-edit" | "plan-accept" | "plan-reset";
  changes: PlanChange[];
  context: {
    dueWindowHours: number;
    importance: Importance;
    originalStepCount: number;
    finalStepCount: number;
    originalTotalMinutes: number;
    finalTotalMinutes: number;
    originalBufferMinutes: number;
    finalBufferMinutes: number;
  };
  createdAt: string;
};
```

有效信号：

- 步骤时长反复增加或减少；
- 步骤顺序反复调整；
- Agent 常生成但用户总删除的步骤；
- 用户经常新增的步骤；
- buffer 系统性修改；
- 步骤数量倾向；
- 某类任务总耗时修正比例；
- 用户接受整份计划；
- 用户恢复默认计划。

不记录：

- 未保存编辑；
- 纯文字小改字；
- UI 展开收起；
- 偶发点击；
- 与规划无关的操作。

## 5.4 可学习偏好

```ts
export type PlanningPreferenceKey =
  | "preferredStepMinutes"
  | "preferredStepCount"
  | "bufferRatio"
  | "estimateMultiplier"
  | "preferReviewStep"
  | "preferResearchBeforeExecution"
  | "preferLongCoreWorkStep"
  | "preferEarlyStart"
  | "preferredPlanningGranularity";

export type PreferenceScope = {
  taskType?: string;
  importance?: Importance;
  dueWindowBucket?: "under-24h" | "1-3d" | "4-7d" | "over-7d";
};

export type PlanningPreference = {
  id: string;
  key: PlanningPreferenceKey;
  scope: PreferenceScope;
  value: number | boolean | string;
  confidence: number;
  evidenceCount: number;
  positiveEvidenceCount: number;
  negativeEvidenceCount: number;
  lastObservedAt: string;
  status: "candidate" | "active" | "disabled";
  source: "inferred" | "explicit";
  explanation: string;
};

export type AgentBehaviorMemory = {
  version: number;
  preferences: PlanningPreference[];
  recentFeedbackEvents: PlanningFeedbackEvent[];
  learningEnabled: boolean;
  autoApplyEnabled: boolean;
  lastUpdatedAt?: string;
};
```

`AgentMemory` 继续保存运行偏好，`AgentBehaviorMemory` 独立保存规划学习数据。

## 5.5 学习算法

建立确定性、可测试模块：

```text
apps/desktop/src/agent/behavior-memory.ts
apps/desktop/src/agent/preference-extractor.ts
apps/desktop/src/agent/preference-selector.ts
```

### 候选形成

第一次出现模式时创建 candidate：

```text
课程作业步骤 30 → 45 分钟
→ preferredStepMinutes = 45
→ scope: taskType=coursework
→ evidenceCount=1
```

### 置信度

可使用简单稳定算法，例如：

```ts
confidence = clamp(
  0.2
  + 0.12 * positiveEvidenceCount
  - 0.15 * negativeEvidenceCount,
  0,
  0.95
);
```

也可采用带衰减加权平均，但必须：

- 可解释；
- 确定性；
- 有单元测试；
- 一次事件不能达到高置信度；
- 反向证据降低置信度；
- 不频繁抖动。

建议门槛：

```text
candidate：
- evidenceCount < 3
- 只显示“正在学习”，不自动应用

active：
- evidenceCount >= 3
- confidence >= 0.65

strong：
- evidenceCount >= 6
- confidence >= 0.80
```

### 数值聚合

步骤时长、buffer、估时倍率使用中位数、截尾均值或 EWMA：

- 防止极端值污染；
- 分 taskType 聚合；
- 样本不足回退默认；
- 本地限制合法范围。

建议范围：

```text
preferredStepMinutes: 15–180
preferredStepCount: 1–12
bufferRatio: 0–0.5
estimateMultiplier: 0.5–3.0
```

### 正负证据

- 使用某偏好生成规划且用户接受：增加弱正向证据；
- 用户将其改回：增加强负向证据；
- 同一 plan version 只能计一次；
- “接受”不能无限强化。

## 5.6 偏好应用

生成计划前：

1. 根据 taskType、importance、dueWindow 选择；
2. 按 scope 精确度排序；
3. 只用 active 且 confidence 达标的偏好；
4. 最多注入 8 条；
5. 同时提供给 LLM、规则 fallback 和规划依据 UI；
6. 记录实际使用的 preference IDs。

结构化注入：

```json
{
  "preferences": [
    {
      "id": "pref-123",
      "key": "preferredStepMinutes",
      "value": 45,
      "scope": {
        "taskType": "coursework"
      },
      "confidence": 0.82,
      "evidenceCount": 6,
      "instruction": "课程作业优先使用约 45 分钟的核心步骤"
    }
  ]
}
```

模型输出的 `appliedPreferenceKeys` 不能作为事实来源。最终以本地真实提供、实际应用并通过验证的 ID 为准。

## 5.7 显式偏好

Memory 页面允许用户设置：

- 步骤更细 / 适中 / 更粗；
- 默认步骤时长；
- 默认检查时间比例；
- 是否总增加“最终检查”；
- 是否启用个性化学习；
- 是否自动应用高置信度偏好；
- 是否只给建议。

优先级：

```text
explicit > high-confidence inferred > general default
```

冲突时使用显式偏好，推断偏好保留但标记冲突，不偷偷提高冲突偏好的置信度。

## 5.8 Memory UI

### 已生效

```text
课程作业更适合 45 分钟步骤
置信度 82% · 来自 6 次修改
[停用] [改为 30 分钟] [删除]
```

### 正在学习

```text
你可能更喜欢保留最终检查步骤
证据 2 次，尚未自动应用
```

### 最近学习

```text
机器学习作业：
将“核心作答”从 30 分钟改为 45 分钟
已更新“课程作业步骤时长”候选偏好
```

控制项：

- 启用学习；
- 自动应用；
- 仅建议；
- 清除行为记录；
- 重置推断偏好；
- 导出 Memory 摘要。

## 5.9 隐私

- Memory 默认仅本地保存；
- 模型只接收选中的结构化偏好，不上传完整反馈历史；
- 用户可清除；
- 清除后立即停止影响规划；
- HTTP snapshot 不默认返回完整反馈历史；
- Trace 只记录 preference ID、key、confidence 摘要；
- 不记录 API Key、完整原文或隐藏推理。


---

# 6. 三项能力的统一 Agent 闭环

不要实现成三个互不相干的页面功能。建议增加事件类型：

```ts
export type AgentEvent =
  | { type: "intake.received"; draftId: string }
  | { type: "clarification.answered"; clarificationId: string }
  | { type: "task.created"; taskId: string }
  | { type: "task.plan-requested"; taskId: string }
  | { type: "task.plan-edited"; taskId: string; revisionId: string }
  | { type: "memory.updated"; preferenceIds: string[] };
```

流程：

```text
intake.received
  Observe：读取候选与来源
  Plan：判断完整性
  Act：创建追问或正式任务
  Verify：确认状态持久化且无重复任务

clarification.answered
  Observe：读取草稿、问题和回答
  Plan：合并答案并判断是否仍缺字段
  Act：生成下一问题或创建任务
  Verify：防止重复回答和重复任务

task.created
  Observe：读取任务、来源和 Memory
  Plan：生成任务拆解提议
  Act：保存 draft plan
  Verify：校验依赖、时间和 DDL

task.plan-edited
  Observe：读取前后 plan version
  Plan：提取结构化修改模式
  Act：写入 feedback event、更新偏好
  Verify：偏好变化与证据一致

memory.updated
  Observe：读取高置信度偏好
  Plan：判断是否建议重新生成当前计划
  Act：只提示用户，不强制覆盖用户已编辑计划
  Verify：旧计划未被静默替换
```

---

# 7. Agent 权限边界

| 动作 | 是否可自动执行 |
|---|---|
| 判断信息完整性 | 是 |
| 创建待追问事项 | 是 |
| 将明确答案写入草稿 | 是 |
| 根据明确答案创建任务 | 是 |
| 生成拆解草案 | 是 |
| 首次将草案设为 active plan | 必须用户确认，或由明确偏好开关授权 |
| 应用高置信度偏好 | 用户开启自动应用后可以 |
| 修改最终 DDL | 否 |
| 删除任务 | 否 |
| 删除用户创建的步骤 | 否，只能建议 |
| 覆盖用户手工编辑的 active plan | 否 |
| 标记整个任务完成 | 否 |
| 清除 Memory | 必须确认 |

---

# 8. 文件结构建议

```text
apps/desktop/src/agent/
├── deadline-agent.ts
├── agent-planner.ts
├── agent-tools.ts
├── agent-memory.ts
├── agent-trace.ts
├── clarification-agent.ts
├── clarification-schema.ts
├── task-plan-agent.ts
├── task-plan-validator.ts
├── task-plan-diff.ts
├── behavior-memory.ts
├── preference-extractor.ts
├── preference-selector.ts
└── preference-explanation.ts
```

必要时提取 renderer 组件：

```text
apps/desktop/src/renderer/src/components/
├── ClarificationCard.tsx
├── TaskDetailPane.tsx
├── TaskPlanEditor.tsx
├── TaskPlanStepRow.tsx
├── PlanRevisionSummary.tsx
├── BehaviorMemoryPane.tsx
└── PreferenceCard.tsx
```

不要做无关重构；如果 `main.tsx` 已过大，只提取本次相关组件。

---

# 9. Store 与状态迁移

扩展 `StoredState`：

```ts
type StoredState = {
  // existing fields...
  intakeDrafts: IntakeDraft[];
  clarifications: PendingClarification[];
  taskPlans: TaskPlan[];
  taskPlanRevisions: TaskPlanRevision[];
  agent: {
    // existing fields...
    behaviorMemory: AgentBehaviorMemory;
  };
};
```

要求：

- `snapshot()` 只暴露 UI 必需字段；
- recent feedback events 最多保留 100 条；
- 每个任务 plan revision 最多保留 20 版；
- 使用现有 atomic save；
- 编写 `normalize...` 兼容旧状态；
- 单条非法数据尽量丢弃该条，不要导致整个状态清空；
- 删除任务时清理关联数据；
- 增加 Store 单元测试。

---

# 10. Validation

扩展 `validation.ts`，严格校验：

- clarification answer/dismiss；
- plan generate options；
- plan update；
- step create/update/delete/reorder；
- explicit preference update；
- inferred preference disable/delete；
- clear behavior memory。

要求：

- unknown key 拒绝；
- ID 非空并限长；
- 字符串和数字限幅；
- 枚举、日期合法；
- step dependency 合法；
- 不允许跨任务操作；
- renderer 不可冒充 `origin=agent`；
- 用户 payload 不可直接提交 confidence、evidenceCount、source=inferred；
- 不允许用任意对象覆盖整个 Memory。

---

# 11. UI 与交互

## 11.1 原则

沿用 Chroni 简洁、轻量风格。不要：

- 做成复杂项目管理系统；
- 加入无意义炫技动画；
- 用聊天消息堆叠替代结构化操作；
- 在外层 DDL 抽屉塞入全部步骤；
- 展示模型隐藏推理。

## 11.2 异步反馈

所有操作必须有：

- loading；
- 成功或失败原因；
- LLM 回退提示；
- 可重试；
- `aria-live`；
- 键盘操作；
- 防重复提交。

## 11.3 详情导航

可使用内部 view state，不强制引入路由库：

```text
日程列表
→ 点击任务
→ 任务详情
→ 编辑规划
→ 保存
→ 返回列表
```

## 11.4 编辑冲突

若 Agent 自动巡检时用户正在编辑：

- 不覆盖编辑草稿；
- 检查 base version；
- 冲突时提示“保留我的编辑”或“加载最新版本”；
- 禁止静默 last-write-wins。

---

# 12. LLM 调用策略

至少拆分：

1. `analyzeCompleteness`
2. `generateTaskPlan`

不要用一个巨大 prompt 同时完成抽取、追问、拆解、规划和学习。

Behavior Memory 优先由本地规则提炼，不应每次编辑都调用模型。

请求要求：

- temperature 0.1–0.3；
- `response_format: { type: "json_object" }`；
- 合理超时、token 限制与 AbortSignal；
- 限制步骤数和来源片段；
- 沿用现有 LLM client 错误分类。

回退：

- 补全模型不可用：不确定信息由用户手动补充；
- 拆解模型不可用：规则生成“理解要求 → 执行主体 → 检查提交”；
- Behavior Memory 不依赖模型；
- 回退标记 `rules-fallback`；
- UI 显示规划来源。

---

# 13. 与现有 DeadlineAgent 集成

职责划分：

```text
TaskPlan Agent：
负责单个任务内部如何完成

DeadlineAgent：
负责多个任务之间今天如何分配时间
```

DeadlineAgent 应使用 TaskPlan：

- 任务剩余时间 = 未完成步骤预计时间；
- 工作块可关联 `stepId`；
- 已完成步骤不占时间；
- 修改步骤耗时后风险和 overflow 更新；
- 没有 TaskPlan 的旧任务继续使用 `DdlItem.estimatedMinutes`；
- TaskPlan 总时间变化时同步任务估时，但保持单一可信来源，避免双向循环。

扩展：

```ts
export type AgentWorkBlock = {
  taskId: string;
  stepId?: string;
  title: string;
  startAt: string;
  endAt: string;
  allocatedMinutes: number;
};
```

显示：

```text
机器学习作业 · 完成核心作答
```

---

# 14. Trace

只记录可审计摘要。

主动追问：

```text
Observe：发现“机器学习作业”缺少唯一截止日期
Plan：决定确认 dueAt，暂不创建任务
Act：创建 1 个待确认问题
Verify：草稿已保存，未生成重复任务
```

规划生成：

```text
Observe：读取任务、来源摘要和 3 条可用偏好
Plan：生成 4 步规划，总计 180 分钟
Act：保存规划草案 v1
Verify：依赖无环，所有建议早于 DDL
```

学习：

```text
Observe：用户将核心步骤从 30 分钟调整为 45 分钟
Plan：匹配“课程作业步骤时长”偏好
Act：证据 5→6，置信度 0.76→0.82
Verify：偏好达到 active 门槛
```

禁止存储完整 prompt、source text、模型原始 JSON、隐藏推理和 API Key。

---

# 15. 测试要求

必须新增自动化测试。

## 15.1 信息补全

- 明确任务不追问；
- 相对日期多义产生 required 追问；
- 非必需字段不阻塞创建；
- 回答后恢复草稿；
- 多轮追问；
- 重复回答幂等；
- dismiss optional；
- required 未解决不可应用；
- 非法 JSON 回退；
- 重启后追问存在；
- API 鉴权与 validation。

## 15.2 任务拆解

- 合法计划；
- 非法、循环依赖；
- 总耗时不一致；
- 计划晚于 DDL；
- active plan 创建；
- 用户修改产生 revision；
- 排序、新增、删除；
- 删除步骤后的依赖处理；
- 耗时修改同步风险；
- 旧任务无 plan 仍正常；
- LLM 不可用规则回退；
- 删除任务清理关联计划。

## 15.3 Behavior Memory

- 第一次修改只产生 candidate；
- 三次一致修改激活；
- 反向修改降低置信度；
- 极端值拒绝或截断；
- taskType scope 不串扰；
- explicit 优先；
- disabled 不应用；
- 同一版本 accept 不重复计数；
- 清除后不影响规划；
- 重启后仍存在；
- selector 只返回匹配高置信度偏好；
- plan 记录真实 preference IDs。

## 15.4 回归命令

```powershell
npx pnpm@11.7.0 run typecheck
npx pnpm@11.7.0 run test
npx pnpm@11.7.0 run build
npx pnpm@11.7.0 run check
```

环境支持时：

```powershell
npx pnpm@11.7.0 run package:desktop
```

不得删除原测试或降低校验强度。

---

# 16. 推荐实施顺序

## Phase 1：领域模型与 Store

- 类型；
- Store 字段；
- normalize/migration；
- CRUD；
- validation；
- 单元测试。

## Phase 2：主动追问

- completeness 调用；
- schema；
- draft/resume；
- IPC/API；
- UI；
- 测试。

## Phase 3：任务详情与拆解

- plan generator；
- validator；
- plan version；
- detail UI；
- editor；
- IPC/API；
- 测试。

## Phase 4：Behavior Memory

- feedback diff；
- preference extractor；
- confidence aggregator；
- selector；
- Memory UI；
- planner 注入；
- 测试。

## Phase 5：统一集成

- TaskPlan 与 DeadlineAgent；
- Trace；
- 自动巡检；
- 桌宠状态；
- README；
- 全量回归。

每个阶段完成后先运行相关测试。

---

# 17. 端到端验收场景

## 场景 A：主动追问

输入：

```text
下周完成机器学习作业。
```

验收：

1. 不猜测日期直接建任务；
2. 桌宠显示待确认；
3. 用户选择日期；
4. 草稿恢复；
5. 创建正式任务；
6. 自动生成规划草案；
7. Trace 完整；
8. 重复点击不重复创建。

## 场景 B：任务详情

外层：

```text
机器学习作业
DDL：7 月 12 日 23:59
```

验收：

1. 点击进入详情；
2. 显示来源、目标、交付物、预计耗时；
3. 显示 3–6 个步骤；
4. 步骤总时间正确；
5. 计划早于 DDL；
6. 可编辑保存；
7. 外层更新步骤数和预计时间。

## 场景 C：学习步骤时长

连续多个课程作业中，将 Agent 的 30 分钟核心步骤改为 45 分钟。

验收：

1. 首次只 candidate；
2. 证据不足不应用；
3. 达门槛后 active；
4. 新课程作业优先 45 分钟；
5. 详情说明使用该偏好；
6. 可停用；
7. 停用后不应用。

## 场景 D：学习检查步骤

用户反复新增“最终检查并提交”。

验收：

1. 识别稳定模式；
2. 高置信度后新任务自动包含；
3. 位于末尾；
4. 预留时间早于 DDL；
5. 用户删除形成负向证据；
6. 置信度下降。

## 场景 E：无模型回退

关闭 LLM：

1. 原日程正常；
2. 明确信息仍建任务；
3. 不确定信息手动补充；
4. 任务详情生成最小规则规划；
5. Memory 继续工作；
6. UI 标记规则回退。

---

# 18. 非目标

本次不要实现：

- 通用聊天机器人；
- 自动发邮件或提交作业；
- 浏览器自动操作；
- 多用户同步；
- 云端账号；
- 向量数据库；
- 模型训练或微调；
- 任意代码执行；
- 自动修改最终 DDL；
- 自动删除用户步骤；
- 无关全仓库重构。

---

# 19. 文档

更新 `README.md`，说明：

- 主动追问；
- 任务详情与规划；
- Behavior Memory 学习内容；
- 查看、停用和清除偏好；
- 数据位置；
- LLM 开启时发送的信息；
- 无 LLM 回退；
- 新 IPC/HTTP API；
- 隐私和权限。

可新增：

```text
docs/agent-clarification-task-planning-memory.md
```

记录架构、模型、状态流、权限、Memory 算法、测试和限制。

---

# 20. 最终交付

完成后输出：

1. 实现摘要；
2. 修改与新增文件；
3. 三项功能数据流；
4. Memory 算法；
5. 安全边界；
6. 测试命令和真实结果；
7. 未完成或环境受限内容；
8. 手动验收步骤。

不得：

- 用伪代码代替核心实现；
- 留关键 `TODO`；
- 未运行测试却声称通过；
- 只改 README；
- 只做静态 UI；
- 使用模拟任务替代 `ChroniStore`；
- 删除原 DeadlineAgent；
- 绕过 runtime validation；
- 暴露 API Key、原文或隐藏推理。

---

# 21. 开始执行方式

1. 检查仓库状态和现有文件；
2. 简短列出现有架构；
3. 给出分阶段计划；
4. 先完成类型、Store、迁移和测试；
5. 再实现三个模块；
6. 每阶段运行测试；
7. 最后运行全量 `check`；
8. 根据真实结果汇报，不跳过失败。

在不破坏现有功能的前提下，完成可运行、可持久化、可审计、可测试的实现。
