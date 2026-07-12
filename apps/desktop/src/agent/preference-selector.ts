import type { AgentBehaviorMemory, Importance, PlanningPreference } from "../shared/types.js";

export function selectPlanningPreferences(
  memory: AgentBehaviorMemory,
  task: { taskType?: string; importance: Importance; dueAt: string },
  now = new Date(),
): PlanningPreference[] {
  const bucket = dueWindowBucket(task.dueAt, now);
  return memory.preferences
    .filter((preference) => preference.status === "active")
    .filter((preference) => !preference.scope.taskType || preference.scope.taskType === task.taskType)
    .filter((preference) => !preference.scope.importance || preference.scope.importance === task.importance)
    .filter((preference) => !preference.scope.dueWindowBucket || preference.scope.dueWindowBucket === bucket)
    .sort((left, right) => (left.source === right.source ? 0 : left.source === "explicit" ? -1 : 1) || scopeSpecificity(right) - scopeSpecificity(left) || right.confidence - left.confidence)
    .slice(0, 8);
}

function dueWindowBucket(dueAt: string, now: Date): NonNullable<PlanningPreference["scope"]["dueWindowBucket"]> {
  const hours = (new Date(dueAt).getTime() - now.getTime()) / 3_600_000;
  if (hours < 24) return "under-24h";
  if (hours <= 72) return "1-3d";
  if (hours <= 168) return "4-7d";
  return "over-7d";
}

function scopeSpecificity(preference: PlanningPreference): number {
  return Object.values(preference.scope).filter(Boolean).length;
}
