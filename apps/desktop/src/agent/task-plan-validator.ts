import type { DdlItem, TaskPlan } from "../shared/types.js";

export function validateTaskPlan(plan: TaskPlan, task: DdlItem): TaskPlan {
  if (plan.taskId !== task.id) throw new Error("计划与任务不匹配。");
  if (!plan.goal.trim() || plan.goal.length > 200) throw new Error("计划目标无效。");
  if (plan.steps.length < 1 || plan.steps.length > 12) throw new Error("计划步骤数必须为 1 到 12。 ");
  const ids = new Set(plan.steps.map((step) => step.id));
  if (ids.size !== plan.steps.length) throw new Error("计划步骤 ID 必须唯一。");
  const orders = [...plan.steps.map((step) => step.order)].sort((a, b) => a - b);
  if (orders.some((order, index) => order !== index + 1)) throw new Error("计划步骤顺序必须连续且唯一。");
  for (const step of plan.steps) {
    if (!step.title.trim() || step.title.length > 80) throw new Error("计划步骤标题无效。");
    if (!Number.isInteger(step.estimatedMinutes) || step.estimatedMinutes < 15 || step.estimatedMinutes > 480) throw new Error("步骤预计耗时必须为 15 到 480 分钟。");
    if (step.taskId !== task.id) throw new Error("计划步骤不能跨任务。");
    if (step.dependsOn.some((id) => !ids.has(id) || id === step.id)) throw new Error("计划步骤依赖无效。");
    if (step.suggestedEndAt && new Date(step.suggestedEndAt).getTime() > new Date(task.dueAt).getTime()) throw new Error("建议完成时间不能晚于最终 DDL。");
  }
  assertAcyclic(plan);
  const total = plan.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
  if (total !== plan.estimatedTotalMinutes) throw new Error("计划总耗时与步骤耗时之和不一致。");
  if (!Number.isInteger(plan.bufferMinutes) || plan.bufferMinutes < 0 || plan.bufferMinutes > 1_440) throw new Error("计划缓冲时间无效。");
  assertGroundedContext(plan, task);
  return plan;
}

function assertGroundedContext(plan: TaskPlan, task: DdlItem): void {
  const extraction = task.extraction;
  if (!extraction) return;
  for (const deliverable of extraction.deliverables) {
    if (!containsGroundedValue(plan.deliverables, deliverable)) throw new Error(`计划遗漏原文提交物：${deliverable}`);
  }
  for (const constraint of extraction.constraints) {
    if (!containsGroundedValue(plan.constraints, constraint)) throw new Error(`计划遗漏原文限制：${constraint}`);
  }
  if (extraction.submissionMethod && !containsGroundedValue(plan.constraints, extraction.submissionMethod)) throw new Error("计划遗漏原文提交方式。");
  for (const uncertainty of extraction.uncertainties) {
    if (!containsGroundedValue(plan.uncertainties, uncertainty)) throw new Error(`计划遗漏待确认事项：${uncertainty}`);
  }
}

function containsGroundedValue(values: string[], required: string): boolean {
  const normalized = normalize(required);
  return values.some((value) => {
    const candidate = normalize(value);
    return candidate.includes(normalized) || normalized.includes(candidate);
  });
}

function normalize(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，。！？、；：,.!?:;()[\]【】《》"'“”‘’*_`#>~\-]/g, "").toLowerCase();
}

function assertAcyclic(plan: TaskPlan): void {
  const dependencies = new Map(plan.steps.map((step) => [step.id, step.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("计划步骤存在循环依赖。");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of plan.steps) visit(step.id);
}
