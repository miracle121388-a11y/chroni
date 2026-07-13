import { randomUUID } from "node:crypto";
import type { ChroniLlmSettings, DdlItem, PlanningPreference, TaskPlan, TaskPlanStep } from "../shared/types.js";
import { requestChatCompletion } from "../llm-client.js";
import { validateTaskPlan } from "./task-plan-validator.js";

type PlanCandidate = {
  goal?: unknown;
  taskType?: unknown;
  deliverables?: unknown;
  constraints?: unknown;
  estimatedTotalMinutes?: unknown;
  bufferMinutes?: unknown;
  summary?: unknown;
  uncertainties?: unknown;
  steps?: unknown;
};

export async function generateTaskPlan(
  task: DdlItem,
  preferences: PlanningPreference[],
  settings?: ChroniLlmSettings,
  now = new Date(),
): Promise<TaskPlan> {
  if (!settings?.enabled || !settings.apiKey || !settings.model) return createRuleTaskPlan(task, preferences, now);
  try {
    const content = await requestChatCompletion(settings, [
      {
        role: "system",
        content: [
          "你是 Chroni 的单任务拆解 Agent，只输出 JSON。",
          "不得修改任务标题或最终截止时间，不得声称任务已完成。",
          "输出 goal、taskType、deliverables、constraints、estimatedTotalMinutes、bufferMinutes、summary、uncertainties、steps。",
          "必须覆盖输入中已经抽取的提交物、提交方式、限制、风险、不确定性和提醒建议，不得用泛化步骤替代明确要求。",
          "uncertainties 只保留尚未确认的事实；不得把不确定事项当作已确认结论。",
          "steps 为 1 到 12 项；每项包含 clientId、title、description、estimatedMinutes、dependsOn、completionCriteria。",
          "每步 15 到 480 分钟，dependsOn 只能引用当前 steps 的 clientId，禁止循环依赖。",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          now: now.toISOString(),
          task: {
            id: task.id,
            title: task.title,
            dueAt: task.dueAt,
            importance: task.importance,
            estimatedMinutes: task.estimatedMinutes,
            progressPercent: task.progressPercent,
            sourceSummary: task.sourceSummary.slice(0, 500),
            extraction: task.extraction,
          },
          preferences: preferences.map((item) => ({ id: item.id, key: item.key, value: item.value, scope: item.scope, confidence: item.confidence })),
        }),
      },
    ], { body: { temperature: 0.2, max_tokens: 4_096, response_format: { type: "json_object" } } });
    const candidate = JSON.parse(content) as PlanCandidate;
    const plan = planFromCandidate(candidate, task, preferences, now);
    return validateTaskPlan(plan, task);
  } catch {
    return { ...createRuleTaskPlan(task, preferences, now), plannerSource: "rules-fallback", summary: "模型规划不可用，已生成可编辑的本地规则计划。" };
  }
}

export function createRuleTaskPlan(task: DdlItem, preferences: PlanningPreference[] = [], now = new Date()): TaskPlan {
  const createdAt = now.toISOString();
  const totalTarget = clamp(task.estimatedMinutes ?? defaultEstimate(task), 45, 1_440);
  const preferredMinutes = numericPreference(preferences, "preferredStepMinutes");
  const bufferRatio = numericPreference(preferences, "bufferRatio") ?? 0.15;
  const bufferMinutes = roundToFive(clamp(totalTarget * bufferRatio, 0, 240));
  const reviewMinutes = clamp(roundToFive(totalTarget * 0.2), 15, 120);
  const understandMinutes = clamp(roundToFive(totalTarget * 0.2), 15, 120);
  const coreMinutes = clamp(preferredMinutes ?? totalTarget - understandMinutes - reviewMinutes, 15, 480);
  const durations = normalizeDurations([understandMinutes, coreMinutes, reviewMinutes], totalTarget);
  const definitions = [
    ["理解要求", "确认目标、交付物和限制，列出仍需补充的信息。", ["已明确任务要求", "已列出交付物"]],
    ["完成核心工作", "完成任务主体内容，并保存可检查的阶段成果。", ["主体内容已完成", "关键问题已有结果"]],
    ["最终检查并提交", "检查遗漏、格式和提交要求，准备最终交付。", ["无明显遗漏", "交付物已准备完成"]],
  ] as const;
  const steps: TaskPlanStep[] = definitions.map(([title, description, criteria], index) => ({
    id: `step-${randomUUID()}`,
    taskId: task.id,
    title,
    description,
    estimatedMinutes: durations[index],
    order: index + 1,
    dependsOn: [],
    completionCriteria: [...criteria],
    status: "pending",
    origin: "agent",
    userModifiedFields: [],
    memoryPreferenceIds: preferences.map((item) => item.id),
    createdAt,
    updatedAt: createdAt,
  }));
  steps[1].dependsOn = [steps[0].id];
  steps[2].dependsOn = [steps[1].id];
  const estimatedTotalMinutes = steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
  const latestSafeStartAt = new Date(new Date(task.dueAt).getTime() - (estimatedTotalMinutes + bufferMinutes) * 60_000).toISOString();
  const insufficient = new Date(latestSafeStartAt).getTime() < now.getTime();
  return {
    id: `task-plan-${randomUUID()}`,
    taskId: task.id,
    version: 1,
    goal: `完成并交付${task.title}`,
    taskType: inferTaskType(task),
    deliverables: task.extraction?.deliverables.length ? [...task.extraction.deliverables] : [task.title],
    constraints: [
      "不得晚于最终 DDL",
      "最终完成状态由用户确认",
      ...(task.extraction?.submissionMethod ? [`提交方式：${task.extraction.submissionMethod}`] : []),
      ...(task.extraction?.constraints ?? []),
    ],
    steps,
    estimatedTotalMinutes,
    bufferMinutes,
    latestSafeStartAt,
    plannerSource: "rules",
    memoryPreferenceIds: preferences.map((item) => item.id),
    summary: preferences.length ? `已应用 ${preferences.length} 条个性化偏好生成可编辑计划。` : "按理解、执行、检查三个阶段生成可编辑计划。",
    uncertainties: [
      ...(task.extraction?.uncertainties ?? []),
      ...(insufficient ? [`当前剩余时间不足，至少缺少 ${Math.ceil((now.getTime() - new Date(latestSafeStartAt).getTime()) / 60_000)} 分钟。`] : []),
    ],
    status: "draft",
    createdAt,
    updatedAt: createdAt,
  };
}

function planFromCandidate(candidate: PlanCandidate, task: DdlItem, preferences: PlanningPreference[], now: Date): TaskPlan {
  if (!Array.isArray(candidate.steps)) throw new Error("模型计划缺少 steps。");
  const createdAt = now.toISOString();
  const rawSteps = candidate.steps as Array<Record<string, unknown>>;
  const idByClientId = new Map(rawSteps.map((step, index) => [String(step.clientId ?? `step-${index + 1}`), `step-${randomUUID()}`]));
  const steps: TaskPlanStep[] = rawSteps.map((step, index) => ({
    id: idByClientId.get(String(step.clientId ?? `step-${index + 1}`))!,
    taskId: task.id,
    title: String(step.title ?? "").slice(0, 80),
    description: String(step.description ?? "").slice(0, 500),
    estimatedMinutes: Number(step.estimatedMinutes),
    order: index + 1,
    dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map((id) => idByClientId.get(String(id))).filter((id): id is string => !!id) : [],
    completionCriteria: Array.isArray(step.completionCriteria) ? step.completionCriteria.map(String).slice(0, 8) : [],
    status: "pending",
    origin: "agent",
    userModifiedFields: [],
    memoryPreferenceIds: preferences.map((item) => item.id),
    createdAt,
    updatedAt: createdAt,
  }));
  const total = steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
  const bufferMinutes = Number(candidate.bufferMinutes ?? 0);
  return {
    id: `task-plan-${randomUUID()}`,
    taskId: task.id,
    version: 1,
    goal: String(candidate.goal ?? `完成并交付${task.title}`).slice(0, 200),
    taskType: typeof candidate.taskType === "string" ? candidate.taskType.slice(0, 80) : inferTaskType(task),
    deliverables: Array.isArray(candidate.deliverables) ? candidate.deliverables.map(String).slice(0, 12) : [],
    constraints: Array.isArray(candidate.constraints) ? candidate.constraints.map(String).slice(0, 12) : [],
    steps,
    estimatedTotalMinutes: total,
    bufferMinutes,
    latestSafeStartAt: new Date(new Date(task.dueAt).getTime() - (total + bufferMinutes) * 60_000).toISOString(),
    plannerSource: preferences.length ? "personalized-llm" : "llm",
    memoryPreferenceIds: preferences.map((item) => item.id),
    summary: String(candidate.summary ?? "大模型已生成结构化任务计划。").slice(0, 500),
    uncertainties: Array.isArray(candidate.uncertainties) ? candidate.uncertainties.map(String).slice(0, 12) : [...(task.extraction?.uncertainties ?? [])],
    status: "draft",
    createdAt,
    updatedAt: createdAt,
  };
}

function normalizeDurations(values: number[], target: number): number[] {
  const result = values.map((value) => clamp(value, 15, 480));
  let difference = target - result.reduce((sum, value) => sum + value, 0);
  const order = [1, 0, 2];
  for (const index of order) {
    if (!difference) break;
    const capacity = difference > 0 ? 480 - result[index] : result[index] - 15;
    const change = Math.sign(difference) * Math.min(Math.abs(difference), capacity);
    result[index] += change;
    difference -= change;
  }
  return result;
}

function numericPreference(preferences: PlanningPreference[], key: PlanningPreference["key"]): number | undefined {
  const value = preferences.find((preference) => preference.key === key)?.value;
  return typeof value === "number" ? value : undefined;
}

function inferTaskType(task: DdlItem): string {
  return /(作业|课程|实验|论文|考试|答辩)/.test(`${task.title} ${task.sourceSummary}`) ? "coursework" : "general";
}

function defaultEstimate(task: DdlItem): number {
  return task.importance === "high" ? 180 : task.importance === "medium" ? 120 : 60;
}

function roundToFive(value: number): number {
  return Math.round(value / 5) * 5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
