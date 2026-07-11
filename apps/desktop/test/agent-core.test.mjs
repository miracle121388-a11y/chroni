import assert from "node:assert/strict";
import test from "node:test";

import { createAgentMemory, updateAgentMemory } from "../dist/agent/agent-memory.js";
import { createTraceRecorder } from "../dist/agent/agent-trace.js";
import { assessTaskRisks, observeTasks, planWorkBlocks, serializeTasksToIcs } from "../dist/agent/agent-tools.js";

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
  });
  assert.deepEqual(updateAgentMemory(createAgentMemory(), { maxDailyMinutes: 180, workdayStart: "10:00" }), {
    maxDailyMinutes: 180,
    workdayStart: "10:00",
    workdayEnd: "18:00",
    reminderFrequency: "important-only",
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
