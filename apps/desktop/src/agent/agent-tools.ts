import type { AgentIcsExportResult, AgentMemory, AgentObservation, AgentPlan, AgentTaskAssessment, DdlItem, IntakeResult, TaskPlan } from "../shared/types.js";

export type DeadlineAgentTools = {
  readTasks(): Promise<DdlItem[]>;
  assessRisks(tasks: DdlItem[], now: Date): AgentTaskAssessment[];
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
    assessRisks: (tasks, current) => assessmentsWithTaskPlans(assessTaskRisks(tasks, current), dependencies.readTaskPlans?.() ?? []),
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

export function assessTaskRisks(items: DdlItem[], now = new Date()): AgentTaskAssessment[] {
  return items
    .map((item) => assessTaskRisk(item, now))
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
    if (remainingCapacity <= 0) {
      unplannedTaskIds.push(assessment.taskId);
      continue;
    }
    const allocatedMinutes = Math.min(assessment.estimatedMinutes, remainingCapacity);
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
  const urgent = assessments.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical");

  for (const item of urgent) {
    if (capacity < 15) break;
    const minutes = Math.min(item.estimatedMinutes, 15, capacity);
    allocations.set(item.taskId, minutes);
    capacity -= minutes;
  }
  for (const item of assessments) {
    if (capacity <= 0) break;
    const allocated = allocations.get(item.taskId) ?? 0;
    const minutes = Math.min(item.estimatedMinutes - allocated, capacity);
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

function assessTaskRisk(item: DdlItem, now: Date): AgentTaskAssessment {
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
  if (!reasons.length) reasons.push("当前时间余量充足");
  return {
    taskId: item.id,
    title: item.title,
    dueAt: item.dueAt,
    importance: item.importance,
    riskLevel: score >= 90 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low",
    score,
    estimatedMinutes: remainingEffort(item),
    reasons,
  };
}

function remainingEffort(item: DdlItem): number {
  const estimate = item.estimatedMinutes ?? (item.importance === "high" ? 90 : item.importance === "medium" ? 60 : 30);
  const progress = item.progressPercent ?? 0;
  return Math.max(0, Math.ceil(estimate * (100 - progress) / 100));
}

function assessmentsWithTaskPlans(assessments: AgentTaskAssessment[], plans: TaskPlan[]): AgentTaskAssessment[] {
  return assessments.map((assessment) => {
    const plan = plans.find((candidate) => candidate.taskId === assessment.taskId && candidate.status === "active");
    if (!plan) return assessment;
    const incomplete = plan.steps.filter((step) => step.status !== "completed" && step.status !== "skipped").sort((left, right) => left.order - right.order);
    const next = incomplete[0];
    return {
      ...assessment,
      estimatedMinutes: incomplete.reduce((sum, step) => sum + step.estimatedMinutes, 0),
      nextStepId: next?.id,
      nextStepTitle: next?.title,
    };
  });
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
