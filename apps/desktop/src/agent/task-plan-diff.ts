import type { PlanChange, TaskPlan } from "../shared/types.js";

export function diffTaskPlans(before: TaskPlan, after: TaskPlan): PlanChange[] {
  const changes: PlanChange[] = [];
  const beforeById = new Map(before.steps.map((step) => [step.id, step]));
  const afterById = new Map(after.steps.map((step) => [step.id, step]));
  for (const step of before.steps) {
    const next = afterById.get(step.id);
    if (!next) {
      changes.push({ type: "step-removed", stepId: step.id });
      continue;
    }
    if (step.order !== next.order) changes.push({ type: "step-reordered", stepId: step.id, fromOrder: step.order, toOrder: next.order });
    if (step.estimatedMinutes !== next.estimatedMinutes) changes.push({ type: "duration-changed", stepId: step.id, beforeMinutes: step.estimatedMinutes, afterMinutes: next.estimatedMinutes });
    if (step.title !== next.title) changes.push({ type: "title-changed", stepId: step.id, before: step.title, after: next.title });
  }
  for (const step of after.steps) {
    if (!beforeById.has(step.id)) changes.push({ type: "step-added", stepId: step.id, afterStepId: after.steps[step.order - 2]?.id });
  }
  if (before.bufferMinutes !== after.bufferMinutes) changes.push({ type: "buffer-changed", beforeMinutes: before.bufferMinutes, afterMinutes: after.bufferMinutes });
  return changes;
}
