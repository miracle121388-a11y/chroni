import type { AgentBehaviorMemory, ExplicitPreferenceInput, PlanningFeedbackEvent, PlanningPreference, PlanningPreferenceKey } from "../shared/types.js";

export function createBehaviorMemory(value?: Partial<AgentBehaviorMemory>): AgentBehaviorMemory {
  return {
    version: 1,
    preferences: Array.isArray(value?.preferences) ? structuredClone(value.preferences).slice(0, 100) : [],
    recentFeedbackEvents: Array.isArray(value?.recentFeedbackEvents) ? structuredClone(value.recentFeedbackEvents).slice(0, 100) : [],
    learningEnabled: value?.learningEnabled ?? true,
    autoApplyEnabled: value?.autoApplyEnabled ?? false,
    lastUpdatedAt: value?.lastUpdatedAt,
  };
}

export function applyFeedbackEvent(memory: AgentBehaviorMemory, event: PlanningFeedbackEvent): AgentBehaviorMemory {
  if (!memory.learningEnabled) return structuredClone(memory);
  if (memory.recentFeedbackEvents.some((existing) => existing.id === event.id || (existing.planId === event.planId && existing.planVersion === event.planVersion && existing.source === event.source))) {
    return structuredClone(memory);
  }
  let preferences = structuredClone(memory.preferences);
  for (const signal of signalsFromEvent(event)) preferences = applySignal(preferences, signal, event);
  return {
    ...structuredClone(memory),
    preferences,
    recentFeedbackEvents: [structuredClone(event), ...memory.recentFeedbackEvents].slice(0, 100),
    lastUpdatedAt: event.createdAt,
  };
}

export function upsertExplicitPreference(memory: AgentBehaviorMemory, input: ExplicitPreferenceInput, now = new Date()): AgentBehaviorMemory {
  const id = preferenceIdentity(input.key, input.scope ?? {});
  const existing = memory.preferences.find((preference) => preference.id === id);
  const preference: PlanningPreference = {
    id,
    key: input.key,
    scope: { ...(input.scope ?? {}) },
    value: input.value,
    confidence: 1,
    evidenceCount: existing?.evidenceCount ?? 1,
    positiveEvidenceCount: existing?.positiveEvidenceCount ?? 1,
    negativeEvidenceCount: existing?.negativeEvidenceCount ?? 0,
    lastObservedAt: now.toISOString(),
    status: "active",
    source: "explicit",
    explanation: explanationFor(input.key, input.value, input.scope?.taskType),
  };
  return {
    ...structuredClone(memory),
    preferences: [preference, ...memory.preferences.filter((item) => item.id !== id)],
    lastUpdatedAt: now.toISOString(),
  };
}

export function setPreferenceStatus(memory: AgentBehaviorMemory, id: string, status: "active" | "disabled"): AgentBehaviorMemory {
  return { ...structuredClone(memory), preferences: memory.preferences.map((item) => item.id === id ? { ...item, status } : { ...item }) };
}

type PreferenceSignal = { key: PlanningPreferenceKey; value: number | boolean | string; taskType?: string };

function signalsFromEvent(event: PlanningFeedbackEvent): PreferenceSignal[] {
  const signals: PreferenceSignal[] = [];
  const durationChanges = event.changes.filter((change) => change.type === "duration-changed");
  if (durationChanges.length) {
    const average = durationChanges.reduce((sum, change) => sum + change.afterMinutes, 0) / durationChanges.length;
    signals.push({ key: "preferredStepMinutes", value: clamp(roundToFive(average), 15, 180), taskType: event.taskType });
  }
  const bufferChange = event.changes.find((change) => change.type === "buffer-changed");
  if (bufferChange?.type === "buffer-changed" && event.context.finalTotalMinutes > 0) {
    signals.push({ key: "bufferRatio", value: clamp(bufferChange.afterMinutes / event.context.finalTotalMinutes, 0, 0.5), taskType: event.taskType });
  }
  if (event.changes.some((change) => change.type === "step-added" || change.type === "step-removed")) {
    signals.push({ key: "preferredStepCount", value: clamp(event.context.finalStepCount, 1, 12), taskType: event.taskType });
  }
  return signals;
}

function applySignal(preferences: PlanningPreference[], signal: PreferenceSignal, event: PlanningFeedbackEvent): PlanningPreference[] {
  const id = preferenceIdentity(signal.key, signal.taskType ? { taskType: signal.taskType } : {});
  const existing = preferences.find((preference) => preference.id === id);
  if (!existing) {
    const created: PlanningPreference = {
      id,
      key: signal.key,
      scope: signal.taskType ? { taskType: signal.taskType } : {},
      value: signal.value,
      confidence: 0.42,
      evidenceCount: 1,
      positiveEvidenceCount: 1,
      negativeEvidenceCount: 0,
      lastObservedAt: event.createdAt,
      status: "candidate",
      source: "inferred",
      explanation: explanationFor(signal.key, signal.value, signal.taskType),
    };
    return [created, ...preferences];
  }
  if (existing.source === "explicit") return preferences;
  const consistent = valuesConsistent(existing.value, signal.value);
  const positive = existing.positiveEvidenceCount + (consistent ? 1 : 0);
  const negative = existing.negativeEvidenceCount + (consistent ? 0 : 1);
  const evidence = positive + negative;
  const confidence = clamp(0.3 + 0.12 * positive - 0.15 * negative, 0, 0.95);
  const value = consistent ? aggregateValue(existing.value, signal.value, positive) : existing.value;
  const status = existing.status === "disabled" ? "disabled" : evidence >= 3 && confidence >= 0.65 ? "active" : "candidate";
  const updated: PlanningPreference = {
    ...existing,
    value,
    confidence,
    evidenceCount: evidence,
    positiveEvidenceCount: positive,
    negativeEvidenceCount: negative,
    lastObservedAt: event.createdAt,
    status,
    explanation: explanationFor(existing.key, value, existing.scope.taskType),
  };
  return preferences.map((preference) => preference.id === id ? updated : preference);
}

function preferenceIdentity(key: PlanningPreferenceKey, scope: { taskType?: string; importance?: string; dueWindowBucket?: string }): string {
  const stable = `${key}:${scope.taskType ?? "all"}:${scope.importance ?? "all"}:${scope.dueWindowBucket ?? "all"}`.replace(/[^a-zA-Z0-9:_-]/g, "-");
  return `preference-${stable}`;
}

function valuesConsistent(left: number | boolean | string, right: number | boolean | string): boolean {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= Math.max(5, Math.abs(left) * 0.2);
  return left === right;
}

function aggregateValue(previous: number | boolean | string, next: number | boolean | string, count: number): number | boolean | string {
  if (typeof previous === "number" && typeof next === "number") return roundForPreference((previous * (count - 1) + next) / count);
  return next;
}

function explanationFor(key: PlanningPreferenceKey, value: number | boolean | string, taskType?: string): string {
  const scope = taskType ? `${taskType} 类型任务` : "任务规划";
  if (key === "preferredStepMinutes") return `${scope}偏好约 ${value} 分钟的步骤。`;
  if (key === "preferredStepCount") return `${scope}偏好约 ${value} 个步骤。`;
  if (key === "bufferRatio") return `${scope}偏好预留约 ${Math.round(Number(value) * 100)}% 检查时间。`;
  return `${scope}使用 ${key} = ${String(value)}。`;
}

function roundToFive(value: number): number {
  return Math.round(value / 5) * 5;
}

function roundForPreference(value: number): number {
  return Math.abs(value) < 1 ? Math.round(value * 100) / 100 : roundToFive(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
