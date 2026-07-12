import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { analyzeCompleteness } from "../dist/agent/clarification-agent.js";
import { createRuleTaskPlan } from "../dist/agent/task-plan-agent.js";
import { ChroniStore } from "../dist/store.js";

function runResult(index) {
  const timestamp = new Date(Date.UTC(2026, 6, 11, 9, 0, index)).toISOString();
  return {
    id: `run-${index}`,
    startedAt: timestamp,
    completedAt: timestamp,
    observation: { observedAt: timestamp, totalCount: 0, incompleteCount: 0, activeCount: 0, snoozedCount: 0, overdueCount: 0, activeTasks: [] },
    priorities: [],
    plan: { blocks: [], plannedMinutes: 0, overflowMinutes: 0, unplannedTaskIds: [] },
    actions: [],
    verification: { status: "healthy", unresolvedHighRiskTaskIds: [], unplannedPriorityTaskIds: [], capacityOverflowMinutes: 0, summary: "healthy" },
    suggestions: ["No pending work"],
    trace: [{ id: `trace-${index}`, sequence: 1, stage: "observe", timestamp, summary: "Observed", success: true, data: { index } }],
  };
}

test("store persists Agent memory and latest run with bounded trace history", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-agent-store-"));
  try {
    const store = new ChroniStore(dir);
    store.updateAgentMemory({ maxDailyMinutes: 180, workdayStart: "10:00", workdayEnd: "17:00", reminderFrequency: "daily" });
    for (let index = 0; index < 12; index += 1) store.saveAgentRun(runResult(index));

    const reloaded = new ChroniStore(dir);
    assert.deepEqual(reloaded.snapshot().agent.memory, {
      maxDailyMinutes: 180,
      workdayStart: "10:00",
      workdayEnd: "17:00",
      reminderFrequency: "daily",
      automaticInspectionEnabled: true,
      useLlmPlanning: true,
    });
    assert.equal(reloaded.snapshot().agent.latestRun?.id, "run-11");
    assert.equal(reloaded.agentTraceHistory().length, 10);
    assert.equal(reloaded.agentTraceHistory()[0][0].data.index, 11);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store persists the applied Agent plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-agent-plan-store-"));
  try {
    const store = new ChroniStore(dir);
    const plan = {
      blocks: [{ taskId: "ddl-1", title: "Report", startAt: "2026-07-12T09:00:00.000Z", endAt: "2026-07-12T10:00:00.000Z", allocatedMinutes: 60 }],
      requestedMinutes: 90,
      plannedMinutes: 60,
      overflowMinutes: 30,
      unplannedTaskIds: ["ddl-1"],
      plannerSource: "rules",
      coverage: [{ taskId: "ddl-1", requiredMinutes: 90, allocatedMinutes: 60, coveragePercent: 67 }],
    };

    store.saveAppliedAgentPlan(plan);

    assert.deepEqual(new ChroniStore(dir).snapshot().agent.appliedPlan, plan);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store remembers the last automatic Agent run independently", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-agent-auto-store-"));
  try {
    const store = new ChroniStore(dir);
    store.saveAgentRun({ ...runResult(1), trigger: "startup" });
    store.saveAgentRun({ ...runResult(2), trigger: "manual" });

    const agent = new ChroniStore(dir).snapshot().agent;
    assert.equal(agent.latestRun?.trigger, "manual");
    assert.equal(agent.lastAutomaticRunAt, runResult(1).completedAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store accepts UTF-8 BOM state files created by Windows tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-bom-store-"));
  try {
    const timestamp = "2026-07-11T09:00:00.000Z";
    const state = JSON.stringify({
      items: [{ id: "bom-task", title: "BOM task", dueAt: timestamp, importance: "high", sourceSummary: "test", createdAt: timestamp, updatedAt: timestamp, completed: false }],
      sources: [],
      companion: { state: "idle", bubble: "ready" },
    });
    writeFileSync(join(dir, "chroni-state.json"), `\uFEFF${state}`, "utf8");

    const store = new ChroniStore(dir);

    assert.equal(store.snapshot().items[0]?.id, "bom-task");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("old state files migrate Agent planning collections without losing tasks", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-agent-migration-"));
  try {
    const timestamp = "2026-07-11T09:00:00.000Z";
    writeFileSync(join(dir, "chroni-state.json"), JSON.stringify({
      items: [{ id: "legacy-task", title: "Legacy", dueAt: timestamp, importance: "medium", sourceSummary: "test", createdAt: timestamp, updatedAt: timestamp, completed: false }],
      sources: [],
      companion: { state: "idle", bubble: "ready" },
    }), "utf8");

    const snapshot = new ChroniStore(dir).snapshot();
    assert.equal(snapshot.items[0].id, "legacy-task");
    assert.deepEqual(snapshot.intakeDrafts, []);
    assert.deepEqual(snapshot.clarifications, []);
    assert.deepEqual(snapshot.taskPlans, []);
    assert.deepEqual(snapshot.agent.behaviorMemory.preferences, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clarification drafts persist and duplicate answers are idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-clarification-store-"));
  try {
    let store = new ChroniStore(dir);
    const analysis = analyzeCompleteness({ sourceName: "直接文本", sourceType: "text", text: "下周完成机器学习作业。" }, new Date("2026-07-12T10:00:00+08:00"));
    store.saveIntakeDraft(analysis.draft, analysis.clarifications, { sourceName: "直接文本", sourceType: "text", text: "下周完成机器学习作业。" });
    store = new ChroniStore(dir);
    assert.equal(store.snapshot().clarifications[0].status, "pending");

    const id = store.snapshot().clarifications[0].id;
    const first = store.answerClarification(id, { optionId: "next-friday" });
    const second = store.answerClarification(id, { optionId: "next-friday" });
    assert.equal(first.createdTaskId, second.createdTaskId);
    assert.equal(second.snapshot.items.length, 1);
    assert.equal(second.snapshot.intakeDrafts[0].status, "applied");
    assert.deepEqual(store.agentTraceHistory()[0].map((entry) => entry.stage), ["observe", "plan", "act", "verify"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("multi-round clarification blocks task creation until every required field is answered", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-multi-clarification-"));
  try {
    const store = new ChroniStore(dir);
    const analysis = analyzeCompleteness({ sourceName: "直接文本", sourceType: "text", text: "请提醒我处理一下。" }, new Date("2026-07-12T10:00:00+08:00"));
    store.saveIntakeDraft(analysis.draft, analysis.clarifications);
    const titleQuestion = store.snapshot().clarifications.find((item) => item.field === "title");
    const dateQuestion = store.snapshot().clarifications.find((item) => item.field === "dueAt");
    const first = store.answerClarification(titleQuestion.id, { value: "机器学习作业" });
    assert.equal(first.snapshot.items.length, 0);
    assert.equal(first.snapshot.intakeDrafts[0].status, "needs-clarification");
    const second = store.answerClarification(dateQuestion.id, { value: "2026-07-20T18:00:00.000Z" });
    assert.equal(second.snapshot.items.length, 1);
    assert.equal(second.snapshot.intakeDrafts[0].status, "applied");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("task plan edits create revisions, learn preferences, and reject stale versions", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-task-plan-store-"));
  try {
    const store = new ChroniStore(dir);
    const timestamp = "2026-07-20T18:00:00.000Z";
    store.addItems([{ id: "plan-task", title: "课程作业", dueAt: timestamp, importance: "medium", sourceSummary: "test", createdAt: timestamp, updatedAt: timestamp, completed: false, estimatedMinutes: 180 }]);
    const task = store.snapshot().items[0];
    const generated = store.saveGeneratedTaskPlan(createRuleTaskPlan(task, [], new Date("2026-07-12T10:00:00.000Z")));
    store.activateTaskPlan(task.id, generated.plan.id);

    let plan = store.taskPlanByTaskId(task.id);
    const stalePayload = updatePayload(plan, plan.steps[1].estimatedMinutes + 15);
    plan = store.updateTaskPlan(task.id, stalePayload).plan;
    assert.throws(() => store.updateTaskPlan(task.id, stalePayload), /加载最新版本/);
    plan = store.updateTaskPlan(task.id, updatePayload(plan, plan.steps[1].estimatedMinutes + 5)).plan;
    plan = store.updateTaskPlan(task.id, updatePayload(plan, plan.steps[1].estimatedMinutes - 5)).plan;

    const snapshot = new ChroniStore(dir).snapshot();
    assert.equal(snapshot.taskPlanRevisions.length, 3);
    assert.equal(snapshot.agent.behaviorMemory.preferences[0].status, "active");
    assert.equal(snapshot.agent.behaviorMemory.preferences[0].scope.taskType, "coursework");
    assert.equal(snapshot.agent.behaviorMemory.recentFeedbackEvents.length, 0);
    assert.equal(store.agentTraceHistory()[0].some((entry) => JSON.stringify(entry.data).includes("apiKey")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleting a task cleans its plans, revisions, and feedback events", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-task-plan-delete-"));
  try {
    const store = new ChroniStore(dir);
    const timestamp = "2026-07-20T18:00:00.000Z";
    store.addItems([{ id: "delete-plan-task", title: "课程作业", dueAt: timestamp, importance: "medium", sourceSummary: "test", createdAt: timestamp, updatedAt: timestamp, completed: false, estimatedMinutes: 180 }]);
    const task = store.snapshot().items[0];
    const generated = store.saveGeneratedTaskPlan(createRuleTaskPlan(task));
    store.activateTaskPlan(task.id, generated.plan.id);
    const plan = store.taskPlanByTaskId(task.id);
    store.updateTaskPlan(task.id, updatePayload(plan, plan.steps[1].estimatedMinutes + 15));
    store.deleteItem(task.id);
    const snapshot = store.snapshot();
    assert.equal(snapshot.taskPlans.some((item) => item.taskId === task.id), false);
    assert.equal(snapshot.taskPlanRevisions.some((item) => item.taskId === task.id), false);
    assert.equal(snapshot.agent.recentPlanningFeedback.some((item) => item.taskId === task.id), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("regenerated drafts are reviewable without replacing the active plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-plan-regenerate-"));
  try {
    const store = new ChroniStore(dir);
    const timestamp = "2026-07-20T18:00:00.000Z";
    store.addItems([{ id: "regen-task", title: "课程作业", dueAt: timestamp, importance: "medium", sourceSummary: "test", createdAt: timestamp, updatedAt: timestamp, completed: false, estimatedMinutes: 180 }]);
    const task = store.snapshot().items[0];
    const first = store.saveGeneratedTaskPlan(createRuleTaskPlan(task));
    store.activateTaskPlan(task.id, first.plan.id);
    const second = store.saveGeneratedTaskPlan(createRuleTaskPlan(task));
    assert.equal(store.taskPlanByTaskId(task.id).id, second.plan.id);
    assert.equal(store.taskPlanByTaskId(task.id).status, "draft");
    assert.equal(store.snapshot().taskPlans.some((plan) => plan.id === first.plan.id && plan.status === "active"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function updatePayload(plan, coreMinutes) {
  const steps = structuredClone(plan.steps);
  steps[1].estimatedMinutes = coreMinutes;
  return {
    baseVersion: plan.version,
    goal: plan.goal,
    deliverables: plan.deliverables,
    constraints: plan.constraints,
    steps,
    bufferMinutes: plan.bufferMinutes,
    summary: plan.summary,
    uncertainties: plan.uncertainties,
  };
}
