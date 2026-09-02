import type { AgentIcsExportResult, AgentMemory, AgentObservation, AgentPlan, AgentTaskAssessment, DailyReview, DailyTask, DdlItem, IntakeResult, TaskPlan } from "../shared/types.js";
import { taskPrioritySignals } from "../shared/task-priority.js";
import { buildLearningInsights } from "../shared/learning-insights.js";

export type DeadlineAgentTools = {
  readTasks(): Promise<DdlItem[]>;
  readCalendarTasks?(): Promise<DailyTask[]>;
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
  readDailyTasks?(): DailyTask[];
  readDailyReviews?(): DailyReview[];
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
    readCalendarTasks: async () => (dependencies.readDailyTasks?.() ?? []).map((task) => structuredClone(task)),
    assessRisks: (tasks, current, memory) => assessmentsWithTaskPlans(
      tasks,
      dependencies.readTaskPlans?.() ?? [],
      dependencies.readDailyTasks?.() ?? [],
      current,
      effectivePlanningMemory(memory ?? defaultRiskMemory, dependencies.readDailyReviews?.() ?? [], current),
    ),
    plan: (risks, memory, current) => adaptivePlan(risks, memory, current, dependencies.readDailyReviews?.() ?? [], dependencies.readDailyTasks?.() ?? [], planWorkBlocks),
    replan: (risks, memory, current) => adaptivePlan(risks, memory, current, dependencies.readDailyReviews?.() ?? [], dependencies.readDailyTasks?.() ?? [], replanWorkBlocks),
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

function adaptivePlan(assessments: AgentTaskAssessment[], memory: AgentMemory, now: Date, reviews: DailyReview[], dailyTasks: DailyTask[], planner: typeof planWorkBlocks): AgentPlan {
  const insights = buildLearningInsights(reviews, memory.maxDailyMinutes, now);
  const effectiveMemory = insights.recommendedPlanningCapacity < memory.maxDailyMinutes
    ? { ...memory, maxDailyMinutes: insights.recommendedPlanningCapacity }
    : memory;
  const plan = planner(assessments, effectiveMemory, now, dailyTasks);
  if (effectiveMemory === memory) return { ...plan, capacityMinutes: memory.maxDailyMinutes };
  return {
    ...plan,
    capacityMinutes: effectiveMemory.maxDailyMinutes,
    adaptationReasons: [`近 7 天执行数据建议将单日规划从 ${memory.maxDailyMinutes} 分钟收敛到 ${effectiveMemory.maxDailyMinutes} 分钟`],
  };
}

function effectivePlanningMemory(memory: AgentMemory, reviews: DailyReview[], now: Date): AgentMemory {
  const capacity = buildLearningInsights(reviews, memory.maxDailyMinutes, now).recommendedPlanningCapacity;
  return capacity < memory.maxDailyMinutes ? { ...memory, maxDailyMinutes: capacity } : memory;
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
    .sort(compareAssessments);
}

export function planWorkBlocks(assessments: AgentTaskAssessment[], memory: AgentMemory, now = new Date(), dailyTasks: DailyTask[] = []): AgentPlan {
  const windows = availableWorkWindows(now, memory, dailyTasks, now);
  const availableMinutes = Math.min(memory.maxDailyMinutes, windowMinutes(windows));
  let remainingCapacity = availableMinutes;
  const cursor: WindowCursor = { index: 0, time: windows[0]?.start ?? 0 };
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
    const requested = Math.min(assessment.nextStepMinutes ?? assessment.estimatedMinutes, remainingCapacity);
    const allocatedMinutes = scheduleAssessment(blocks, assessment, requested, windows, cursor);
    if (allocatedMinutes < assessment.estimatedMinutes) unplannedTaskIds.push(assessment.taskId);
    remainingCapacity -= allocatedMinutes;
  }

  const plannedMinutes = blocks.reduce((sum, block) => sum + block.allocatedMinutes, 0);
  return {
    blocks,
    forecastBlocks: forecastWorkBlocks(assessments, memory, now, blocks, dailyTasks),
    forecastHorizonDays: 7,
    requestedMinutes: totalRequested,
    plannedMinutes,
    availableMinutes,
    overflowMinutes: Math.max(0, totalRequested - plannedMinutes),
    unplannedTaskIds,
    plannerSource: "rules",
    coverage: planCoverage(assessments, blocks),
  };
}

export function replanWorkBlocks(assessments: AgentTaskAssessment[], memory: AgentMemory, now = new Date(), dailyTasks: DailyTask[] = []): AgentPlan {
  const windows = availableWorkWindows(now, memory, dailyTasks, now);
  const availableMinutes = Math.min(memory.maxDailyMinutes, windowMinutes(windows));
  let capacity = availableMinutes;
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

  const cursor: WindowCursor = { index: 0, time: windows[0]?.start ?? 0 };
  const blocks: AgentPlan["blocks"] = [];
  for (const item of assessments) {
    const allocatedMinutes = allocations.get(item.taskId) ?? 0;
    if (allocatedMinutes <= 0) continue;
    scheduleAssessment(blocks, item, allocatedMinutes, windows, cursor);
  }
  const requestedMinutes = assessments.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const plannedMinutes = blocks.reduce((sum, block) => sum + block.allocatedMinutes, 0);
  const coverage = planCoverage(assessments, blocks);
  return {
    blocks,
    forecastBlocks: forecastWorkBlocks(assessments, memory, now, blocks, dailyTasks),
    forecastHorizonDays: 7,
    requestedMinutes,
    plannedMinutes,
    availableMinutes,
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

export function forecastWorkBlocks(assessments: AgentTaskAssessment[], memory: AgentMemory, now: Date, todayBlocks: AgentPlan["blocks"], dailyTasks: DailyTask[] = []): AgentPlan["blocks"] {
  const ordered = [...assessments].sort(compareAssessments);
  const allocatedToday = new Map(assessments.map((item) => [item.taskId, todayBlocks.filter((block) => block.taskId === item.taskId).reduce((sum, block) => sum + block.allocatedMinutes, 0)]));
  const remaining = new Map(assessments.map((item) => [item.taskId, Math.max(0, item.estimatedMinutes - (allocatedToday.get(item.taskId) ?? 0))]));
  const blocks: AgentPlan["blocks"] = [];
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  for (let offset = 1; offset < 7; offset += 1) {
    day.setDate(day.getDate() + 1);
    const windows = availableWorkWindows(day, memory, dailyTasks);
    const cursor: WindowCursor = { index: 0, time: windows[0]?.start ?? 0 };
    let capacity = Math.min(memory.maxDailyMinutes, windowMinutes(windows));
    for (const item of ordered) {
      if (capacity <= 0) break;
      if (item.actionable === false) continue;
      const taskRemaining = remaining.get(item.taskId) ?? 0;
      if (taskRemaining <= 0) continue;
      const dueAt = new Date(item.dueAt);
      const allocatedMinutes = scheduleAssessment(blocks, item, Math.min(taskRemaining, capacity), windows, cursor, dueAt.getTime());
      if (allocatedMinutes <= 0) continue;
      remaining.set(item.taskId, taskRemaining - allocatedMinutes);
      capacity -= allocatedMinutes;
    }
  }
  return blocks;
}

type WorkWindow = { start: number; end: number };
type WindowCursor = { index: number; time: number };

function scheduleAssessment(blocks: AgentPlan["blocks"], assessment: AgentTaskAssessment, requestedMinutes: number, windows: WorkWindow[], cursor: WindowCursor, maxEnd = Number.POSITIVE_INFINITY): number {
  let remaining = Math.max(0, Math.floor(requestedMinutes));
  let allocated = 0;
  const title = assessment.nextStepTitle ? `${assessment.title} · ${assessment.nextStepTitle}` : assessment.title;
  while (remaining > 0 && cursor.index < windows.length) {
    const window = windows[cursor.index];
    const start = Math.max(window.start, cursor.time);
    const limit = Math.min(window.end, maxEnd);
    const available = Math.max(0, Math.floor((limit - start) / 60_000));
    if (available <= 0) {
      if (maxEnd <= start) break;
      cursor.index += 1;
      cursor.time = windows[cursor.index]?.start ?? 0;
      continue;
    }
    const minutes = Math.min(remaining, available);
    const end = start + minutes * 60_000;
    blocks.push({
      taskId: assessment.taskId,
      stepId: assessment.nextStepId,
      title,
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      allocatedMinutes: minutes,
    });
    remaining -= minutes;
    allocated += minutes;
    cursor.time = end;
    if (cursor.time >= window.end) {
      cursor.index += 1;
      cursor.time = windows[cursor.index]?.start ?? 0;
    }
    if (cursor.time >= maxEnd) break;
  }
  return allocated;
}

function availableWorkWindows(day: Date, memory: AgentMemory, tasks: DailyTask[], current?: Date): WorkWindow[] {
  const workdayStart = atLocalClock(day, memory.workdayStart).getTime();
  const workdayEnd = atLocalClock(day, memory.workdayEnd).getTime();
  const start = current && localDateKey(current) === localDateKey(day) ? Math.max(workdayStart, current.getTime()) : workdayStart;
  if (workdayEnd <= start) return [];
  const busy = tasks
    .filter((task) => !task.dismissed && !!task.scheduledStartAt && (task.origin === "manual" || task.userAdjusted))
    .filter((task) => !task.completedDates.includes(localDateKey(day)))
    .map((task) => taskBusyWindow(task, day, workdayStart, workdayEnd))
    .filter((window): window is WorkWindow => !!window)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: WorkWindow[] = [];
  for (const window of busy) {
    const previous = merged[merged.length - 1];
    if (previous && window.start <= previous.end) previous.end = Math.max(previous.end, window.end);
    else merged.push({ ...window });
  }
  const available: WorkWindow[] = [];
  let cursor = start;
  for (const window of merged) {
    if (window.end <= cursor) continue;
    if (window.start > cursor) available.push({ start: cursor, end: window.start });
    cursor = Math.max(cursor, window.end);
    if (cursor >= workdayEnd) break;
  }
  if (cursor < workdayEnd) available.push({ start: cursor, end: workdayEnd });
  return available;
}

function taskBusyWindow(task: DailyTask, day: Date, workdayStart: number, workdayEnd: number): WorkWindow | undefined {
  if (!task.scheduledStartAt || !dailyTaskOccursOn(task, day)) return undefined;
  if (task.allDay) return { start: workdayStart, end: workdayEnd };
  const sourceStart = new Date(task.scheduledStartAt);
  const sourceEnd = task.scheduledEndAt ? new Date(task.scheduledEndAt) : new Date(sourceStart.getTime() + 30 * 60_000);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sourceStart.getHours(), sourceStart.getMinutes(), sourceStart.getSeconds(), sourceStart.getMilliseconds()).getTime();
  const duration = Math.max(60_000, sourceEnd.getTime() - sourceStart.getTime());
  const end = start + duration;
  const clippedStart = Math.max(workdayStart, start);
  const clippedEnd = Math.min(workdayEnd, end);
  return clippedEnd > clippedStart ? { start: clippedStart, end: clippedEnd } : undefined;
}

function dailyTaskOccursOn(task: DailyTask, day: Date): boolean {
  if (!task.scheduledStartAt) return false;
  const source = new Date(task.scheduledStartAt);
  const first = new Date(source.getFullYear(), source.getMonth(), source.getDate());
  const target = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  if (target < first) return false;
  if (task.recurrenceEndsAt) {
    const recurrenceEnd = new Date(task.recurrenceEndsAt);
    const last = new Date(recurrenceEnd.getFullYear(), recurrenceEnd.getMonth(), recurrenceEnd.getDate());
    if (target > last) return false;
  }
  if (task.recurrence === "daily") return true;
  if (task.recurrence === "weekdays") return target.getDay() !== 0 && target.getDay() !== 6;
  if (task.recurrence === "weekly") return target.getDay() === first.getDay();
  return localDateKey(target) === localDateKey(first);
}

function windowMinutes(windows: WorkWindow[]): number {
  return windows.reduce((sum, window) => sum + Math.max(0, Math.floor((window.end - window.start) / 60_000)), 0);
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

type TaskExecutionHistory = {
  missedPlanCount: number;
};

function assessTaskRisk(item: DdlItem, now: Date, memory: AgentMemory, bufferMinutes = 0, execution: TaskExecutionHistory = { missedPlanCount: 0 }, remainingMinutesOverride?: number, dailyTasks: DailyTask[] = []): AgentTaskAssessment {
  const hoursRemaining = (new Date(item.dueAt).getTime() - now.getTime()) / 3_600_000;
  const priority = taskPrioritySignals(item, now);
  let score = priority.effectiveImportance === "high" ? 20 : priority.effectiveImportance === "medium" ? 10 : 0;
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
  if (priority.effectiveImportance === "high") reasons.push("高重要性任务");
  else if (priority.effectiveImportance === "medium") reasons.push("中重要性任务");
  for (const reason of priority.reasons) if (!reasons.includes(reason)) reasons.push(reason);
  score += Math.ceil(priority.progressScore / 2);
  if (execution.missedPlanCount > 0) {
    score += Math.min(30, execution.missedPlanCount * 12);
    reasons.push(execution.missedPlanCount >= 2
      ? `最近已有 ${execution.missedPlanCount} 个计划时段未完成`
      : "最近一次计划时段未完成");
  }
  const estimatedMinutes = remainingMinutesOverride ?? remainingEffort(item);
  const availableMinutesUntilDue = availableWorkMinutesUntilDue(now, new Date(item.dueAt), memory, dailyTasks);
  const slackMinutes = availableMinutesUntilDue - estimatedMinutes - bufferMinutes;
  if (estimatedMinutes > 0 && slackMinutes < 0) {
    score = Math.max(score, 95);
    reasons.push(`按每日容量计算仍缺少 ${Math.ceil(Math.abs(slackMinutes))} 分钟`);
  } else if (estimatedMinutes > 0 && slackMinutes <= Math.max(60, Math.min(memory.maxDailyMinutes, estimatedMinutes * 0.25))) {
    score = Math.max(score, 65);
    reasons.push(`可用工作时间余量仅 ${Math.max(0, Math.floor(slackMinutes))} 分钟`);
  }
  if (!reasons.length) reasons.push("当前时间余量充足");
  const interventionLevel = execution.missedPlanCount >= 2 ? "rescue" : execution.missedPlanCount === 1 ? "nudge" : "none";
  return {
    taskId: item.id,
    title: item.title,
    dueAt: item.dueAt,
    importance: priority.effectiveImportance,
    riskLevel: score >= 90 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low",
    score,
    priorityScore: priority.totalScore + Math.min(48, execution.missedPlanCount * 18),
    estimatedMinutes,
    ...(typeof item.progressPercent === "number" ? { progressPercent: item.progressPercent } : {}),
    missedPlanCount: execution.missedPlanCount,
    interventionLevel,
    ...(interventionLevel === "rescue" ? { recommendedSessionMinutes: 15 } : interventionLevel === "nudge" ? { recommendedSessionMinutes: 25 } : {}),
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

function assessmentsWithTaskPlans(items: DdlItem[], plans: TaskPlan[], dailyTasks: DailyTask[], now: Date, memory: AgentMemory): AgentTaskAssessment[] {
  return items.map((item) => {
    const execution = taskExecutionHistory(item.id, dailyTasks, now);
    const plan = plans.find((candidate) => candidate.taskId === item.id && candidate.status === "active");
    if (!plan) return assessTaskRisk(item, now, memory, 0, execution, undefined, dailyTasks);
    const incomplete = plan.steps.filter((step) => step.status !== "completed" && step.status !== "skipped").sort((left, right) => left.order - right.order);
    const completedIds = new Set(plan.steps.filter((step) => step.status === "completed" || step.status === "skipped").map((step) => step.id));
    const next = incomplete.find((step) => step.status !== "blocked" && step.dependsOn.every((dependency) => completedIds.has(dependency)));
    const assessment = assessTaskRisk(item, now, memory, plan.bufferMinutes, execution, incomplete.reduce((sum, step) => sum + step.estimatedMinutes, 0), dailyTasks);
    return {
      ...assessment,
      nextStepId: next?.id,
      nextStepTitle: next?.title,
      nextStepMinutes: next?.estimatedMinutes,
      actionable: !incomplete.length || !!next,
      reasons: !incomplete.length || next ? assessment.reasons : [...assessment.reasons, "当前计划没有依赖已满足的可执行步骤"],
    };
  }).sort(compareAssessments);
}

function taskExecutionHistory(taskId: string, tasks: DailyTask[], now: Date): TaskExecutionHistory {
  const cutoff = now.getTime() - 14 * 86_400_000;
  const pastBlocks = tasks
    .filter((task) => task.origin === "agent" && task.linkedTaskId === taskId && !task.dismissed && !!task.scheduledStartAt)
    .filter((task) => {
      const endAt = task.scheduledEndAt ?? task.scheduledStartAt;
      const end = new Date(endAt!).getTime();
      return Number.isFinite(end) && end >= cutoff && end < now.getTime();
    })
    .sort((left, right) => new Date(right.scheduledEndAt ?? right.scheduledStartAt!).getTime() - new Date(left.scheduledEndAt ?? left.scheduledStartAt!).getTime());
  let missedPlanCount = 0;
  for (const task of pastBlocks) {
    const key = localDateKey(new Date(task.scheduledStartAt!));
    if (task.completedDates.includes(key)) break;
    missedPlanCount += 1;
  }
  return { missedPlanCount };
}

function compareAssessments(left: AgentTaskAssessment, right: AgentTaskAssessment): number {
  return (right.priorityScore ?? right.score) - (left.priorityScore ?? left.score)
    || right.score - left.score
    || new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime()
    || left.taskId.localeCompare(right.taskId);
}

const defaultRiskMemory: AgentMemory = {
  maxDailyMinutes: 240,
  workdayStart: "09:00",
  workdayEnd: "18:00",
  reminderFrequency: "important-only",
  automaticInspectionEnabled: true,
  useLlmPlanning: true,
};

function availableWorkMinutesUntilDue(now: Date, dueAt: Date, memory: AgentMemory, dailyTasks: DailyTask[] = []): number {
  if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= now.getTime()) return 0;
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  let total = 0;
  for (let count = 0; count < 366 && day.getTime() <= dueAt.getTime(); count += 1) {
    const windows = availableWorkWindows(day, memory, dailyTasks, count === 0 ? now : undefined);
    const minutesBeforeDue = windows.reduce((sum, window) => sum + Math.max(0, Math.floor((Math.min(window.end, dueAt.getTime()) - window.start) / 60_000)), 0);
    total += Math.min(memory.maxDailyMinutes, minutesBeforeDue);
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
