import type { AgentIcsExportResult, AgentMemory, AgentObservation, AgentPlan, AgentTaskAssessment, DdlItem, IntakeResult, TaskPlan } from "../shared/types.js";

export type DeadlineAgentTools = {
  readTasks(): Promise<DdlItem[]>;
  assessRisks(tasks: DdlItem[], now: Date, memory?: AgentMemory): AgentTaskAssessment[];
  plan(risks: AgentTaskAssessment[], memory: AgentMemory, now: Date): AgentPlan;
  replan(risks: AgentTaskAssessment[], memory: AgentMemory, now: Date): AgentPlan | Promise<AgentPlan>;
  sendReminder(task: AgentTaskAssessment): Promise<AgentReminderResult | void>;
  persistPlan?(plan: AgentPlan): Promise<void> | void;
  intakeText?(text: string): Promise<IntakeResult>;
  exportIcs?(): Promise<AgentIcsExportResult>;
};

export type AgentToolDependencies = {
  readTasks(): DdlItem[];
  readTaskPlans?(): TaskPlan[];
  intakeText(text: string): Promise<IntakeResult>;
  writeIcs(content: string, fileName: string): string | Promise<string>;
  sendReminder(task: AgentTaskAssessment): Promise<AgentReminderResult | void>;
  persistPlan?(plan: AgentPlan): Promise<void> | void;
  now?: () => Date;
};

export function createAgentTools(dependencies: AgentToolDependencies): DeadlineAgentTools {
  const now = dependencies.now ?? (() => new Date());
  return {
    readTasks: async () => dependencies.readTasks().map((item) => ({ ...item })),
    assessRisks: (tasks, current, memory) => assessmentsWithTaskPlans(tasks, dependencies.readTaskPlans?.() ?? [], current, memory ?? defaultRiskMemory),
    plan: planWorkBlocks,
    replan: replanWorkBlocks,
    sendReminder: dependencies.sendReminder,
    persistPlan: dependencies.persistPlan,
    intakeText: dependencies.intakeText,
    async exportIcs() {
      const tasks = dependencies.readTasks().filter((item) => !item.completed);
      const generatedAt = now();
      const path = await dependencies.writeIcs(serializeTasksToIcs(tasks, generatedAt), `chroni-deadlines-${localDateKey(generatedAt)}.ics`);
      return { path, itemCount: tasks.length };
    },
  };
}

export type AgentReminderResult = {
  sent: boolean;
  reason: "sent" | "disabled" | "unsupported" | "quiet-hours" | "duplicate" | "not-needed";
};

export function observeTasks(items: DdlItem[], now = new Date()): AgentObservation {
  const incomplete = items.filter((item) => !item.completed);
  const activeTasks = incomplete.filter((item) => !item.snoozedUntil || new Date(item.snoozedUntil).getTime() <= now.getTime());
  return {
    observedAt: now.toISOString(),
    totalCount: items.length,
    incompleteCount: incomplete.length,
    activeCount: activeTasks.length,
    snoozedCount: incomplete.length - activeTasks.length,
    overdueCount: activeTasks.filter((item) => new Date(item.dueAt).getTime() < now.getTime()).length,
    activeTasks: activeTasks.map((item) => ({ ...item })),
  };
}

export function assessTaskRisks(items: DdlItem[], now = new Date(), memory: AgentMemory = defaultRiskMemory): AgentTaskAssessment[] {
  return items
    .map((item) => assessTaskRisk(item, now, memory))
    .sort((a, b) => b.score - a.score || new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime() || a.taskId.localeCompare(b.taskId));
}

export function planWorkBlocks(assessments: AgentTaskAssessment[], memory: AgentMemory, now = new Date()): AgentPlan {
  const workdayStart = atLocalClock(now, memory.workdayStart);
  const workdayEnd = atLocalClock(now, memory.workdayEnd);
  let cursor = new Date(Math.max(now.getTime(), workdayStart.getTime()));
  const availableByWindow = Math.max(0, Math.floor((workdayEnd.getTime() - cursor.getTime()) / 60_000));
  let remainingCapacity = Math.min(memory.maxDailyMinutes, availableByWindow);
  const totalRequested = assessments.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const blocks: AgentPlan["blocks"] = [];
  const unplannedTaskIds: string[] = [];

  for (const assessment of assessments) {
    if (assessment.estimatedMinutes <= 0) continue;
    if (assessment.actionable === false) {
      unplannedTaskIds.push(assessment.taskId);
      continue;
    }
    if (remainingCapacity <= 0) {
      unplannedTaskIds.push(assessment.taskId);
      continue;
    }
    const allocatedMinutes = Math.min(assessment.nextStepMinutes ?? assessment.estimatedMinutes, remainingCapacity);
    const end = new Date(cursor.getTime() + allocatedMinutes * 60_000);
    blocks.push({
      taskId: assessment.taskId,
      stepId: assessment.nextStepId,
      title: assessment.nextStepTitle ? `${assessment.title} · ${assessment.nextStepTitle}` : assessment.title,
      startAt: cursor.toISOString(),
      endAt: end.toISOString(),
      allocatedMinutes,
    });
    if (allocatedMinutes < assessment.estimatedMinutes) unplannedTaskIds.push(assessment.taskId);
    remainingCapacity -= allocatedMinutes;
    cursor = end;
  }

  const plannedMinutes = blocks.reduce((sum, block) => sum + block.allocatedMinutes, 0);
  return {
    blocks,
    forecastBlocks: forecastWorkBlocks(assessments, memory, now, blocks),
    forecastHorizonDays: 7,
    requestedMinutes: totalRequested,
    plannedMinutes,
    overflowMinutes: Math.max(0, totalRequested - plannedMinutes),
    unplannedTaskIds,
    plannerSource: "rules",
    coverage: planCoverage(assessments, blocks),
  };
}

export function replanWorkBlocks(assessments: AgentTaskAssessment[], memory: AgentMemory, now = new Date()): AgentPlan {
  const workdayStart = atLocalClock(now, memory.workdayStart);
  const workdayEnd = atLocalClock(now, memory.workdayEnd);
  const cursor = new Date(Math.max(now.getTime(), workdayStart.getTime()));
  let capacity = Math.min(memory.maxDailyMinutes, Math.max(0, Math.floor((workdayEnd.getTime() - cursor.getTime()) / 60_000)));
  const allocations = new Map(assessments.map((item) => [item.taskId, 0]));
  const actionable = assessments.filter((item) => item.actionable !== false);
  const urgent = actionable.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical");

  for (const item of urgent) {
    if (capacity < 15) break;
    const minutes = Math.min(item.nextStepMinutes ?? item.estimatedMinutes, 15, capacity);
    allocations.set(item.taskId, minutes);
    capacity -= minutes;
  }
  for (const item of actionable) {
    if (capacity <= 0) break;
    const allocated = allocations.get(item.taskId) ?? 0;
    const minutes = Math.min((item.nextStepMinutes ?? item.estimatedMinutes) - allocated, capacity);
    allocations.set(item.taskId, allocated + minutes);
    capacity -= minutes;
  }

  let blockCursor = cursor;
  const blocks: AgentPlan["blocks"] = [];
  for (const item of assessments) {
    const allocatedMinutes = allocations.get(item.taskId) ?? 0;
    if (allocatedMinutes <= 0) continue;
    const end = new Date(blockCursor.getTime() + allocatedMinutes * 60_000);
    blocks.push({ taskId: item.taskId, stepId: item.nextStepId, title: item.nextStepTitle ? `${item.title} · ${item.nextStepTitle}` : item.title, startAt: blockCursor.toISOString(), endAt: end.toISOString(), allocatedMinutes });
    blockCursor = end;
  }
  const requestedMinutes = assessments.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const plannedMinutes = blocks.reduce((sum, block) => sum + block.allocatedMinutes, 0);
  const coverage = planCoverage(assessments, blocks);
  return {
    blocks,
    forecastBlocks: forecastWorkBlocks(assessments, memory, now, blocks),
    forecastHorizonDays: 7,
    requestedMinutes,
    plannedMinutes,
    overflowMinutes: Math.max(0, requestedMinutes - plannedMinutes),
    unplannedTaskIds: coverage.filter((item) => item.allocatedMinutes < item.requiredMinutes).map((item) => item.taskId),
    plannerSource: "rules",
    coverage,
  };
}

export function planCoverage(assessments: AgentTaskAssessment[], blocks: AgentPlan["blocks"]): NonNullable<AgentPlan["coverage"]> {
  return assessments.map((item) => {
    const allocatedMinutes = blocks.filter((block) => block.taskId === item.taskId).reduce((sum, block) => sum + block.allocatedMinutes, 0);
    return {
      taskId: item.taskId,
      requiredMinutes: item.estimatedMinutes,
      allocatedMinutes,
      coveragePercent: item.estimatedMinutes ? Math.min(100, Math.round(allocatedMinutes / item.estimatedMinutes * 100)) : 100,
    };
  });
}

export function forecastWorkBlocks(assessments: AgentTaskAssessment[], memory: AgentMemory, now: Date, todayBlocks: AgentPlan["blocks"]): AgentPlan["blocks"] {
  const ordered = [...assessments].sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() || right.score - left.score);
  const allocatedToday = new Map(assessments.map((item) => [item.taskId, todayBlocks.filter((block) => block.taskId === item.taskId).reduce((sum, block) => sum + block.allocatedMinutes, 0)]));
  const remaining = new Map(assessments.map((item) => [item.taskId, Math.max(0, item.estimatedMinutes - (allocatedToday.get(item.taskId) ?? 0))]));
  const blocks: AgentPlan["blocks"] = [];
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  for (let offset = 1; offset < 7; offset += 1) {
    day.setDate(day.getDate() + 1);
    let cursor = atLocalClock(day, memory.workdayStart);
    const workdayEnd = atLocalClock(day, memory.workdayEnd);
    let capacity = Math.min(memory.maxDailyMinutes, Math.max(0, Math.floor((workdayEnd.getTime() - cursor.getTime()) / 60_000)));
    for (const item of ordered) {
      if (capacity <= 0) break;
      if (item.actionable === false) continue;
      const taskRemaining = remaining.get(item.taskId) ?? 0;
      if (taskRemaining <= 0) continue;
      const dueAt = new Date(item.dueAt);
      if (dueAt.getTime() <= cursor.getTime()) continue;
      const availableBeforeDue = Math.max(0, Math.floor((Math.min(workdayEnd.getTime(), dueAt.getTime()) - cursor.getTime()) / 60_000));
      const allocatedMinutes = Math.min(taskRemaining, capacity, availableBeforeDue);
      if (allocatedMinutes <= 0) continue;
      const end = new Date(cursor.getTime() + allocatedMinutes * 60_000);
      blocks.push({
        taskId: item.taskId,
        stepId: item.nextStepId,
        title: item.title,
        startAt: cursor.toISOString(),
        endAt: end.toISOString(),
        allocatedMinutes,
      });
      remaining.set(item.taskId, taskRemaining - allocatedMinutes);
      capacity -= allocatedMinutes;
      cursor = end;
    }
  }
  return blocks;
}

export function serializeTasksToIcs(items: DdlItem[], generatedAt = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Chroni//DeadlineAgent//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const item of items.filter((candidate) => !candidate.completed)) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(item.id)}@chroni`,
      `DTSTAMP:${icsDate(generatedAt)}`,
      `DTSTART:${icsDate(new Date(item.dueAt))}`,
      `DTEND:${icsDate(new Date(item.dueAt))}`,
      `SUMMARY:${escapeIcs(item.title)}`,
      `DESCRIPTION:Chroni ${item.importance} priority deadline`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function assessTaskRisk(item: DdlItem, now: Date, memory: AgentMemory, bufferMinutes = 0): AgentTaskAssessment {
  const hoursRemaining = (new Date(item.dueAt).getTime() - now.getTime()) / 3_600_000;
  let score = item.importance === "high" ? 20 : item.importance === "medium" ? 10 : 0;
  const reasons: string[] = [];
  if (hoursRemaining < 0) {
    score += 100;
    reasons.push("已超过截止时间");
  } else if (hoursRemaining <= 12) {
    score += 70;
    reasons.push("距离截止不足 12 小时");
  } else if (hoursRemaining <= 24) {
    score += 55;
    reasons.push("距离截止不足 24 小时");
  } else if (hoursRemaining <= 72) {
    score += 35;
    reasons.push("距离截止不足 3 天");
  } else if (hoursRemaining <= 168) {
    score += 15;
    reasons.push("本周内截止");
  }
  if (item.importance === "high") reasons.push("高重要性任务");
  else if (item.importance === "medium") reasons.push("中重要性任务");
  const estimatedMinutes = remainingEffort(item);
  const availableMinutesUntilDue = availableWorkMinutesUntilDue(now, new Date(item.dueAt), memory);
  const slackMinutes = availableMinutesUntilDue - estimatedMinutes - bufferMinutes;
  if (estimatedMinutes > 0 && slackMinutes < 0) {
    score = Math.max(score, 95);
    reasons.push(`按每日容量计算仍缺少 ${Math.ceil(Math.abs(slackMinutes))} 分钟`);
  } else if (estimatedMinutes > 0 && slackMinutes <= Math.max(60, Math.min(memory.maxDailyMinutes, estimatedMinutes * 0.25))) {
    score = Math.max(score, 65);
    reasons.push(`可用工作时间余量仅 ${Math.max(0, Math.floor(slackMinutes))} 分钟`);
  }
  if (!reasons.length) reasons.push("当前时间余量充足");
  return {
    taskId: item.id,
    title: item.title,
    dueAt: item.dueAt,
    importance: item.importance,
    riskLevel: score >= 90 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low",
    score,
    estimatedMinutes,
    availableMinutesUntilDue,
    slackMinutes,
    actionable: true,
    reasons,
  };
}

function remainingEffort(item: DdlItem): number {
  const estimate = item.estimatedMinutes ?? (item.importance === "high" ? 90 : item.importance === "medium" ? 60 : 30);
  const progress = item.progressPercent ?? 0;
  return Math.max(0, Math.ceil(estimate * (100 - progress) / 100));
}

function assessmentsWithTaskPlans(items: DdlItem[], plans: TaskPlan[], now: Date, memory: AgentMemory): AgentTaskAssessment[] {
  return items.map((item) => {
    const plan = plans.find((candidate) => candidate.taskId === item.id && candidate.status === "active");
    if (!plan) return assessTaskRisk(item, now, memory);
    const incomplete = plan.steps.filter((step) => step.status !== "completed" && step.status !== "skipped").sort((left, right) => left.order - right.order);
    const completedIds = new Set(plan.steps.filter((step) => step.status === "completed" || step.status === "skipped").map((step) => step.id));
    const next = incomplete.find((step) => step.status !== "blocked" && step.dependsOn.every((dependency) => completedIds.has(dependency)));
    const assessment = assessTaskRisk({ ...item, estimatedMinutes: incomplete.reduce((sum, step) => sum + step.estimatedMinutes, 0), progressPercent: 0 }, now, memory, plan.bufferMinutes);
    return {
      ...assessment,
      nextStepId: next?.id,
      nextStepTitle: next?.title,
      nextStepMinutes: next?.estimatedMinutes,
      actionable: !incomplete.length || !!next,
      reasons: !incomplete.length || next ? assessment.reasons : [...assessment.reasons, "当前计划没有依赖已满足的可执行步骤"],
    };
  }).sort((left, right) => right.score - left.score || new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() || left.taskId.localeCompare(right.taskId));
}

const defaultRiskMemory: AgentMemory = {
  maxDailyMinutes: 240,
  workdayStart: "09:00",
  workdayEnd: "18:00",
  reminderFrequency: "important-only",
  automaticInspectionEnabled: true,
  useLlmPlanning: true,
};

function availableWorkMinutesUntilDue(now: Date, dueAt: Date, memory: AgentMemory): number {
  if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= now.getTime()) return 0;
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  let total = 0;
  for (let count = 0; count < 366 && day.getTime() <= dueAt.getTime(); count += 1) {
    const start = atLocalClock(day, memory.workdayStart);
    const end = atLocalClock(day, memory.workdayEnd);
    const availableStart = Math.max(start.getTime(), now.getTime());
    const availableEnd = Math.min(end.getTime(), dueAt.getTime());
    total += Math.min(memory.maxDailyMinutes, Math.max(0, Math.floor((availableEnd - availableStart) / 60_000)));
    day.setDate(day.getDate() + 1);
  }
  return total;
}

function atLocalClock(date: Date, value: string): Date {
  const [hour, minute] = value.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

function icsDate(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
