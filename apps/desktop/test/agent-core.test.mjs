import assert from "node:assert/strict";
import test from "node:test";

import { createAgentMemory, updateAgentMemory } from "../dist/agent/agent-memory.js";
import { createTraceRecorder } from "../dist/agent/agent-trace.js";
import { assessTaskRisks, createAgentTools, observeTasks, planWorkBlocks, replanWorkBlocks, serializeTasksToIcs } from "../dist/agent/agent-tools.js";
import { createRuleTaskPlan } from "../dist/agent/task-plan-agent.js";
import { verifyAgentPlan } from "../dist/agent/agent-state.js";

function task(id, title, dueAt, importance = "medium", extra = {}) {
  return {
    id,
    title,
    dueAt,
    importance,
    sourceSummary: "test",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completed: false,
    ...extra,
  };
}

test("agent memory has stable defaults and applies explicit patches", () => {
  assert.deepEqual(createAgentMemory(), {
    maxDailyMinutes: 240,
    workdayStart: "09:00",
    workdayEnd: "18:00",
    reminderFrequency: "important-only",
    automaticInspectionEnabled: true,
    useLlmPlanning: true,
  });
  assert.deepEqual(updateAgentMemory(createAgentMemory(), { maxDailyMinutes: 180, workdayStart: "10:00" }), {
    maxDailyMinutes: 180,
    workdayStart: "10:00",
    workdayEnd: "18:00",
    reminderFrequency: "important-only",
    automaticInspectionEnabled: true,
    useLlmPlanning: true,
  });
});

test("trace recorder emits ordered auditable stages", () => {
  const recorder = createTraceRecorder(() => "2026-07-11T09:00:00.000Z");
  recorder.record("observe", "Read current tasks", { taskCount: 2 });
  recorder.record("plan", "Ranked deadline risks", { highRiskCount: 1 });
  recorder.record("act", "Called replan", { tool: "replan" });
  recorder.record("verify", "Checked remaining gaps", { status: "attention" });

  const entries = recorder.entries();
  assert.deepEqual(entries.map((entry) => entry.stage), ["observe", "plan", "act", "verify"]);
  assert.deepEqual(entries.map((entry) => entry.sequence), [1, 2, 3, 4]);
  assert.equal(entries[2].data.tool, "replan");
});

test("agent observes active work and detects overdue and near high-risk tasks", () => {
  const now = new Date("2026-07-11T09:00:00.000Z");
  const items = [
    task("overdue", "Overdue report", "2026-07-11T08:00:00.000Z", "high"),
    task("near", "Near quiz", "2026-07-11T18:00:00.000Z", "medium"),
    task("later", "Later reading", "2026-07-20T18:00:00.000Z", "low"),
    task("done", "Done", "2026-07-11T10:00:00.000Z", "high", { completed: true }),
    task("snoozed", "Snoozed", "2026-07-11T11:00:00.000Z", "high", { snoozedUntil: "2026-07-11T12:00:00.000Z" }),
  ];

  const observation = observeTasks(items, now);
  const risks = assessTaskRisks(observation.activeTasks, now);

  assert.equal(observation.incompleteCount, 4);
  assert.equal(observation.activeTasks.length, 3);
  assert.equal(observation.snoozedCount, 1);
  assert.equal(risks[0].taskId, "overdue");
  assert.equal(risks[0].riskLevel, "critical");
  assert.equal(risks.find((risk) => risk.taskId === "near")?.riskLevel, "high");
});

test("risk assessment detects capacity pressure before the deadline is near", () => {
  const now = new Date(2026, 6, 13, 9, 0);
  const [risk] = assessTaskRisks([
    task("large", "Large project", new Date(2026, 6, 18, 18, 0).toISOString(), "low", { estimatedMinutes: 1_500 }),
  ], now, { ...createAgentMemory(), maxDailyMinutes: 180 });

  assert.equal(["high", "critical"].includes(risk.riskLevel), true);
  assert.equal(risk.slackMinutes < 0, true);
  assert.equal(risk.reasons.some((reason) => /每日容量/.test(reason)), true);
});

test("agent combines semantic stakes, progress and missed blocks for adaptive intervention", () => {
  const now = new Date(2026, 8, 1, 18, 0);
  const finalTask = task("final", "期末作业", new Date(2026, 8, 2, 9, 30).toISOString(), "medium", { estimatedMinutes: 180, progressPercent: 20 });
  const clubTask = task("club", "社团汇报PPT初稿", new Date(2026, 8, 2, 9, 0).toISOString(), "medium", { estimatedMinutes: 30, progressPercent: 70 });
  const missed = [0, 1].map((offset) => {
    const start = new Date(2026, 7, 30 + offset, 15, 0);
    return {
      id: `missed-${offset}`,
      title: "期末作业推进",
      notes: "",
      color: "coral",
      allDay: false,
      scheduledStartAt: start.toISOString(),
      scheduledEndAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      recurrence: "none",
      subtasks: [],
      completedDates: [],
      origin: "agent",
      linkedTaskId: "final",
      userAdjusted: false,
      dismissed: false,
      createdAt: start.toISOString(),
      updatedAt: start.toISOString(),
    };
  });
  const tools = createAgentTools({
    readTasks: () => [clubTask, finalTask],
    readDailyTasks: () => missed,
    intakeText: async () => { throw new Error("unused"); },
    writeIcs: () => "unused",
    sendReminder: async () => ({ sent: false, reason: "not-needed" }),
  });

  const risks = tools.assessRisks([clubTask, finalTask], now, createAgentMemory());
  assert.equal(risks[0].taskId, "final");
  assert.equal(risks[0].importance, "high");
  assert.equal(risks[0].missedPlanCount, 2);
  assert.equal(risks[0].interventionLevel, "rescue");
  assert.equal(risks[0].recommendedSessionMinutes, 15);
});

test("a completed recovery block clears the consecutive-miss intervention", () => {
  const now = new Date(2026, 8, 1, 18, 0);
  const item = task("recovered", "期末作业", new Date(2026, 8, 2, 9, 30).toISOString(), "high", { estimatedMinutes: 120, progressPercent: 50 });
  const dates = [new Date(2026, 7, 30, 15, 0), new Date(2026, 7, 31, 15, 0), new Date(2026, 8, 1, 16, 0)];
  const history = dates.map((start, index) => {
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    return { id: `history-${index}`, title: "期末作业推进", notes: "", color: "coral", allDay: false, scheduledStartAt: start.toISOString(), scheduledEndAt: new Date(start.getTime() + 30 * 60_000).toISOString(), recurrence: "none", subtasks: [], completedDates: index === 2 ? [key] : [], origin: "agent", linkedTaskId: item.id, userAdjusted: false, dismissed: false, createdAt: start.toISOString(), updatedAt: start.toISOString() };
  });
  const tools = createAgentTools({ readTasks: () => [item], readDailyTasks: () => history, intakeText: async () => { throw new Error("unused"); }, writeIcs: () => "unused", sendReminder: async () => ({ sent: false, reason: "not-needed" }) });

  const [assessment] = tools.assessRisks([item], now, createAgentMemory());
  assert.equal(assessment.missedPlanCount, 0);
  assert.equal(assessment.interventionLevel, "none");
});

test("recent execution data automatically contracts an overloaded next plan", () => {
  const now = new Date(2026, 8, 1, 9, 0);
  const item = task("adaptive", "课程期末项目", new Date(2026, 8, 5, 18, 0).toISOString(), "high", { estimatedMinutes: 300, progressPercent: 10 });
  const reviews = [0, 1].map((offset) => {
    const date = new Date(2026, 8, 1 - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date: key, summary: "执行不足", note: "", totalTasks: 4, completedTasks: 1, plannedMinutes: 240, completedMinutes: 60, unfinishedTaskTitles: ["课程期末项目"], createdAt: now.toISOString(), updatedAt: now.toISOString() };
  });
  const tools = createAgentTools({
    readTasks: () => [item],
    readDailyReviews: () => reviews,
    intakeText: async () => { throw new Error("unused"); },
    writeIcs: () => "unused",
    sendReminder: async () => ({ sent: false, reason: "not-needed" }),
  });
  const risks = tools.assessRisks([item], now, createAgentMemory());
  const plan = tools.plan(risks, createAgentMemory(), now);

  assert.equal(plan.capacityMinutes, 165);
  assert.equal(plan.plannedMinutes, 165);
  assert.match(plan.adaptationReasons[0], /240 分钟.*165 分钟/);
});

test("active plans expose only dependency-ready unblocked steps", () => {
  const now = new Date(2026, 6, 13, 9, 0);
  const item = task("planned", "Planned report", new Date(2026, 6, 15, 18, 0).toISOString(), "medium", { estimatedMinutes: 120 });
  const plan = createRuleTaskPlan(item, [], now);
  plan.status = "active";
  plan.steps[0].status = "blocked";
  const tools = createAgentTools({
    readTasks: () => [item],
    readTaskPlans: () => [plan],
    intakeText: async () => { throw new Error("unused"); },
    writeIcs: () => "unused",
    sendReminder: async () => ({ sent: false, reason: "not-needed" }),
  });

  const [assessment] = tools.assessRisks([item], now, createAgentMemory());
  const work = tools.plan([assessment], createAgentMemory(), now);
  assert.equal(assessment.actionable, false);
  assert.equal(assessment.nextStepId, undefined);
  assert.deepEqual(work.blocks, []);
  assert.deepEqual(work.unplannedTaskIds, [item.id]);
});

test("work planning stays inside preferred hours and daily capacity", () => {
  const now = new Date(2026, 6, 11, 9, 0, 0, 0);
  const memory = { ...createAgentMemory(), maxDailyMinutes: 120, workdayStart: "10:00", workdayEnd: "15:00" };
  const risks = assessTaskRisks([
    task("a", "High report", "2026-07-11T15:00:00.000Z", "high"),
    task("b", "Medium quiz", "2026-07-12T12:00:00.000Z", "medium"),
  ], now);

  const plan = planWorkBlocks(risks, memory, now);

  assert.equal(plan.blocks.length, 2);
  assert.equal(plan.plannedMinutes, 120);
  assert.equal(plan.overflowMinutes, 30);
  assert.equal(plan.blocks[0].startAt, new Date(2026, 6, 11, 10, 0, 0, 0).toISOString());
  assert.equal(plan.blocks[1].endAt, new Date(2026, 6, 11, 12, 0, 0, 0).toISOString());
});

test("work planning uses free calendar gaps instead of overlapping fixed activities", () => {
  const now = new Date(2026, 6, 13, 9, 0);
  const memory = { ...createAgentMemory(), maxDailyMinutes: 120, workdayStart: "09:00", workdayEnd: "18:00" };
  const risks = assessTaskRisks([task("course", "期末课程项目", new Date(2026, 6, 15, 18, 0).toISOString(), "high", { estimatedMinutes: 120 })], now, memory);
  const fixedStart = new Date(2026, 6, 13, 10, 0);
  const fixed = {
    id: "fixed-class",
    title: "专业课",
    notes: "",
    color: "blue",
    allDay: false,
    scheduledStartAt: fixedStart.toISOString(),
    scheduledEndAt: new Date(2026, 6, 13, 11, 0).toISOString(),
    recurrence: "none",
    subtasks: [],
    completedDates: [],
    origin: "manual",
    userAdjusted: true,
    dismissed: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const plan = planWorkBlocks(risks, memory, now, [fixed]);
  assert.deepEqual(plan.blocks.map((block) => [new Date(block.startAt).getHours(), new Date(block.endAt).getHours()]), [[9, 10], [11, 12]]);
  assert.equal(plan.availableMinutes, 120);
});

test("work planning previews unfinished effort across the next week without crossing the deadline", () => {
  const now = new Date(2026, 6, 13, 9, 0);
  const dueAt = new Date(2026, 6, 16, 12, 0);
  const memory = { ...createAgentMemory(), maxDailyMinutes: 60, workdayStart: "09:00", workdayEnd: "18:00" };
  const risks = assessTaskRisks([task("forecast", "Forecast project", dueAt.toISOString(), "medium", { estimatedMinutes: 180 })], now, memory);
  const plan = planWorkBlocks(risks, memory, now);

  assert.equal(plan.blocks[0].allocatedMinutes, 60);
  assert.equal(plan.forecastBlocks.reduce((sum, block) => sum + block.allocatedMinutes, 0), 120);
  assert.equal(plan.forecastBlocks.every((block) => new Date(block.endAt).getTime() <= dueAt.getTime()), true);
});

test("risk-first replanning gives every high-risk task useful coverage", () => {
  const now = new Date(2026, 6, 11, 9, 0, 0, 0);
  const memory = { ...createAgentMemory(), maxDailyMinutes: 90 };
  const risks = assessTaskRisks([
    task("a", "Critical report", new Date(2026, 6, 11, 10, 0).toISOString(), "high", { estimatedMinutes: 90 }),
    task("b", "Critical demo", new Date(2026, 6, 11, 11, 0).toISOString(), "high", { estimatedMinutes: 90 }),
  ], now);

  const initial = planWorkBlocks(risks, memory, now);
  const replanned = replanWorkBlocks(risks, memory, now);

  assert.equal(initial.coverage.filter((item) => item.allocatedMinutes === 0).length, 1);
  assert.equal(replanned.coverage.filter((item) => item.allocatedMinutes === 0).length, 0);
  assert.equal(replanned.plannerSource, "rules");
});

test("verification treats fully covered high-risk tasks as mitigated", () => {
  const now = new Date(2026, 6, 11, 9, 0, 0, 0);
  const risks = assessTaskRisks([
    task("a", "Urgent report", new Date(2026, 6, 11, 12, 0).toISOString(), "high", { estimatedMinutes: 60 }),
  ], now);
  const plan = planWorkBlocks(risks, { ...createAgentMemory(), maxDailyMinutes: 120 }, now);

  const verification = verifyAgentPlan(risks, plan);

  assert.deepEqual(verification.mitigatedHighRiskTaskIds, ["a"]);
  assert.deepEqual(verification.unresolvedHighRiskTaskIds, []);
  assert.equal(verification.status, "healthy");
  assert.equal(verification.coveragePercent, 100);
});

test("planning does not create zero-minute blocks for fully progressed tasks", () => {
  const now = new Date(2026, 6, 11, 9, 0, 0, 0);
  const risks = assessTaskRisks([
    task("done-work", "Awaiting confirmation", new Date(2026, 6, 11, 12, 0).toISOString(), "high", { estimatedMinutes: 60, progressPercent: 100 }),
  ], now);

  const plan = planWorkBlocks(risks, createAgentMemory(), now);

  assert.deepEqual(plan.blocks, []);
  assert.equal(plan.coverage[0].coveragePercent, 100);
});

test("ICS serialization exports active tasks without source text", () => {
  const ics = serializeTasksToIcs([
    task("ddl-1", "Course report", "2026-07-12T23:59:00.000Z", "high"),
  ], new Date("2026-07-11T09:00:00.000Z"));

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /UID:ddl-1@chroni/);
  assert.match(ics, /SUMMARY:Course report/);
  assert.match(ics, /DTEND:20260712T235900Z/);
  assert.doesNotMatch(ics, /sourceSummary/);
});
