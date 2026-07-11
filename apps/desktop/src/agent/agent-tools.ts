import type { AgentMemory, AgentObservation, AgentPlan, AgentTaskAssessment, DdlItem } from "../shared/types.js";

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
    if (remainingCapacity <= 0) {
      unplannedTaskIds.push(assessment.taskId);
      continue;
    }
    const allocatedMinutes = Math.min(assessment.estimatedMinutes, remainingCapacity);
    const end = new Date(cursor.getTime() + allocatedMinutes * 60_000);
    blocks.push({
      taskId: assessment.taskId,
      title: assessment.title,
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
    plannedMinutes,
    overflowMinutes: Math.max(0, totalRequested - plannedMinutes),
    unplannedTaskIds,
  };
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
    estimatedMinutes: item.importance === "high" ? 90 : item.importance === "medium" ? 60 : 30,
    reasons,
  };
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
