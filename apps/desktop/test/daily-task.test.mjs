import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRuleTaskPlan } from "../dist/agent/task-plan-agent.js";
import { ChroniStore } from "../dist/store.js";

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function runWithBlock(block) {
  const timestamp = new Date().toISOString();
  return {
    id: `run-${timestamp}`,
    startedAt: timestamp,
    completedAt: timestamp,
    observation: { observedAt: timestamp, totalCount: 1, incompleteCount: 1, activeCount: 1, snoozedCount: 0, overdueCount: 0, activeTasks: [] },
    priorities: [],
    plan: { blocks: [block], plannedMinutes: block.allocatedMinutes, overflowMinutes: 0, unplannedTaskIds: [] },
    actions: [],
    verification: { status: "healthy", unresolvedHighRiskTaskIds: [], unplannedPriorityTaskIds: [], capacityOverflowMinutes: 0, summary: "healthy" },
    suggestions: [],
    trace: [],
  };
}

function runWithBlocks(blocks) {
  const result = runWithBlock(blocks[0]);
  result.plan.blocks = blocks;
  result.plan.plannedMinutes = blocks.reduce((sum, block) => sum + block.allocatedMinutes, 0);
  return result;
}

function ddlItem(id, title = id, estimatedMinutes = 90) {
  const timestamp = new Date().toISOString();
  return {
    id,
    title,
    importance: "medium",
    dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    sourceSummary: "daily task test",
    createdAt: timestamp,
    updatedAt: timestamp,
    completed: false,
    estimatedMinutes,
  };
}

test("daily tasks persist inbox, schedule, recurrence, subtasks, and completion", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-daily-task-"));
  try {
    const store = new ChroniStore(dir);
    store.createDailyTask({ title: "整理实验数据", notes: "先检查缺失值", color: "gold" });
    let task = store.snapshot().dailyTasks[0];
    assert.equal(task.scheduledStartAt, undefined);

    const startAt = new Date(2026, 6, 15, 14, 0).toISOString();
    const endAt = new Date(2026, 6, 15, 15, 30).toISOString();
    store.updateDailyTask(task.id, {
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      recurrence: "weekdays",
      subtasks: [{ id: "sub-1", title: "导出数据", completed: true }],
      completedDates: [dateKey(startAt)],
    });

    task = new ChroniStore(dir).snapshot().dailyTasks[0];
    assert.equal(task.recurrence, "weekdays");
    assert.equal(task.subtasks[0].completed, true);
    assert.deepEqual(task.completedDates, [dateKey(startAt)]);

    store.updateDailyTask(task.id, { scheduledStartAt: null, scheduledEndAt: null });
    assert.equal(store.snapshot().dailyTasks[0].scheduledStartAt, undefined);
    store.deleteDailyTask(task.id);
    assert.equal(store.snapshot().dailyTasks.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Agent work blocks populate daily tasks while preserving user adjustments", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-agent-daily-task-"));
  try {
    const store = new ChroniStore(dir);
    const now = new Date().toISOString();
    store.addItems([{
      id: "ddl-report",
      title: "提交实验报告",
      importance: "high",
      dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      sourceSummary: "测试任务",
      createdAt: now,
      updatedAt: now,
      completed: false,
      estimatedMinutes: 90,
    }]);
    const startAt = new Date(2026, 6, 15, 9, 0).toISOString();
    const block = {
      taskId: "ddl-report",
      stepId: "step-outline",
      title: "完成报告提纲",
      startAt,
      endAt: new Date(new Date(startAt).getTime() + 60 * 60_000).toISOString(),
      allocatedMinutes: 60,
    };
    store.saveAgentRun(runWithBlock(block));

    let task = store.snapshot().dailyTasks[0];
    assert.equal(task.origin, "agent");
    assert.equal(task.linkedTaskId, "ddl-report");
    assert.equal(task.color, "coral");

    store.updateDailyTask(task.id, { completedDates: [dateKey(startAt)] });
    assert.equal(store.snapshot().dailyTasks[0].userAdjusted, false);
    store.updateDailyTask(task.id, { completedDates: [] });

    const adjustedStart = new Date(new Date(startAt).getTime() + 2 * 60 * 60_000).toISOString();
    const adjustedEnd = new Date(new Date(adjustedStart).getTime() + 45 * 60_000).toISOString();
    store.updateDailyTask(task.id, { title: "先完成报告提纲", scheduledStartAt: adjustedStart, scheduledEndAt: adjustedEnd });
    store.saveAgentRun(runWithBlock(block));
    task = store.snapshot().dailyTasks.find((candidate) => candidate.id === task.id);
    assert.equal(task.title, "先完成报告提纲");
    assert.equal(task.scheduledStartAt, adjustedStart);

    store.deleteDailyTask(task.id);
    store.saveAgentRun(runWithBlock(block));
    assert.equal(store.snapshot().dailyTasks.find((candidate) => candidate.id === task.id).dismissed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("same-day Agent work blocks persist with alternating colors", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-agent-colors-"));
  try {
    const store = new ChroniStore(dir);
    const base = new Date(2026, 6, 18, 9, 0);
    const blocks = [0, 60, 120].map((offset, index) => ({
      taskId: `task-${index}`,
      stepId: `step-${index}`,
      title: `Block ${index + 1}`,
      startAt: new Date(base.getTime() + offset * 60_000).toISOString(),
      endAt: new Date(base.getTime() + (offset + 45) * 60_000).toISOString(),
      allocatedMinutes: 45,
    }));
    store.addItems(blocks.map((block) => ddlItem(block.taskId)));

    store.saveAgentRun(runWithBlocks(blocks));
    const colors = store.snapshot().dailyTasks.map((task) => task.color);
    assert.deepEqual(colors, ["coral", "teal", "blue"]);
    assert.deepEqual(new ChroniStore(dir).snapshot().dailyTasks.map((task) => task.color), colors);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Agent block identities survive same-step duplicates, cross-day moves, and dismissal", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-agent-block-identity-"));
  try {
    const store = new ChroniStore(dir);
    store.addItems([ddlItem("ddl-report", "提交报告", 90)]);
    const base = new Date(2026, 6, 18, 9, 0);
    const blocks = [0, 60].map((offset, index) => ({
      taskId: "ddl-report",
      stepId: "step-draft",
      title: `撰写报告 ${index + 1}`,
      startAt: new Date(base.getTime() + offset * 60_000).toISOString(),
      endAt: new Date(base.getTime() + (offset + 45) * 60_000).toISOString(),
      allocatedMinutes: 45,
    }));
    store.saveAgentRun(runWithBlocks(blocks));
    let tasks = store.snapshot().dailyTasks;
    assert.equal(tasks.length, 2);
    assert.equal(new Set(tasks.map((task) => task.agentBlockKey)).size, 2);
    assert.deepEqual(tasks.map((task) => task.allocatedMinutes), [45, 45]);

    const moved = tasks[0];
    const dismissedId = tasks[1].id;
    const movedStart = new Date(2026, 6, 19, 13, 0).toISOString();
    const movedEnd = new Date(2026, 6, 19, 13, 45).toISOString();
    store.updateDailyTask(moved.id, { scheduledStartAt: movedStart, scheduledEndAt: movedEnd });
    store.deleteDailyTask(dismissedId);
    store.saveAgentRun(runWithBlocks(blocks));

    tasks = store.snapshot().dailyTasks;
    assert.equal(tasks.length, 2);
    assert.equal(tasks.find((task) => task.id === moved.id).scheduledStartAt, movedStart);
    assert.equal(tasks.find((task) => task.id === dismissedId).dismissed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("linked plan steps complete only after all allocated work is done", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-agent-step-progress-"));
  try {
    const store = new ChroniStore(dir);
    store.addItems([ddlItem("ddl-project", "课程项目", 120)]);
    const task = store.snapshot().items.find((item) => item.id === "ddl-project");
    const generated = store.saveGeneratedTaskPlan(createRuleTaskPlan(task, [], new Date("2026-07-15T08:00:00.000Z")));
    store.activateTaskPlan(task.id, generated.plan.id);
    const step = generated.plan.steps[0];
    const firstMinutes = Math.max(1, Math.floor(step.estimatedMinutes / 2));
    const secondMinutes = step.estimatedMinutes - firstMinutes;
    const base = new Date(2026, 6, 18, 9, 0);
    const blocks = [firstMinutes, secondMinutes].map((minutes, index) => {
      const startAt = new Date(base.getTime() + index * 120 * 60_000);
      return {
        taskId: task.id,
        stepId: step.id,
        title: `${step.title} ${index + 1}`,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + minutes * 60_000).toISOString(),
        allocatedMinutes: minutes,
      };
    });
    store.saveAgentRun(runWithBlocks(blocks));
    let dailyTasks = store.snapshot().dailyTasks;
    store.updateDailyTask(dailyTasks[0].id, { completedDates: [dateKey(dailyTasks[0].scheduledStartAt)] });
    assert.equal(store.taskPlanByTaskId(task.id).steps.find((candidate) => candidate.id === step.id).status, "in-progress");
    store.updateDailyTask(dailyTasks[1].id, { completedDates: [dateKey(dailyTasks[1].scheduledStartAt)] });
    assert.equal(store.taskPlanByTaskId(task.id).steps.find((candidate) => candidate.id === step.id).status, "completed");
    store.updateDailyTask(dailyTasks[0].id, { completedDates: [] });
    assert.equal(store.taskPlanByTaskId(task.id).steps.find((candidate) => candidate.id === step.id).status, "in-progress");

    const currentPlan = store.taskPlanByTaskId(task.id);
    const manuallyCompletedSteps = structuredClone(currentPlan.steps);
    manuallyCompletedSteps.find((candidate) => candidate.id === step.id).status = "completed";
    store.updateTaskPlan(task.id, {
      baseVersion: currentPlan.version,
      goal: currentPlan.goal,
      deliverables: currentPlan.deliverables,
      constraints: currentPlan.constraints,
      steps: manuallyCompletedSteps,
      bufferMinutes: currentPlan.bufferMinutes,
      summary: currentPlan.summary,
      uncertainties: currentPlan.uncertainties,
    });
    let manuallyCompleted = store.taskPlanByTaskId(task.id).steps.find((candidate) => candidate.id === step.id);
    assert.equal(manuallyCompleted.userModifiedFields.includes("status"), true);
    store.updateDailyTask(dailyTasks[1].id, { completedDates: [] });
    manuallyCompleted = store.taskPlanByTaskId(task.id).steps.find((candidate) => candidate.id === step.id);
    assert.equal(manuallyCompleted.status, "completed");
    const reloadedTasks = new ChroniStore(dir).snapshot().dailyTasks;
    assert.equal(reloadedTasks.every((candidate) => !!candidate.agentBlockKey), true);
    assert.deepEqual(reloadedTasks.map((candidate) => candidate.allocatedMinutes), [firstMinutes, secondMinutes]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("notes, colors, and subtasks do not freeze Agent scheduling", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-agent-cosmetic-edit-"));
  try {
    const store = new ChroniStore(dir);
    store.addItems([ddlItem("ddl-cosmetic")]);
    const startAt = new Date(2026, 6, 18, 9, 0).toISOString();
    const block = { taskId: "ddl-cosmetic", stepId: "step-1", title: "初始安排", startAt, endAt: new Date(new Date(startAt).getTime() + 45 * 60_000).toISOString(), allocatedMinutes: 45 };
    store.saveAgentRun(runWithBlock(block));
    const dailyTask = store.snapshot().dailyTasks[0];
    store.updateDailyTask(dailyTask.id, { notes: "我的上下文", color: "plum", subtasks: [{ id: "check", title: "检查", completed: false }] });
    const shifted = { ...block, title: "更新安排", startAt: new Date(2026, 6, 18, 11, 0).toISOString(), endAt: new Date(2026, 6, 18, 11, 45).toISOString() };
    store.saveAgentRun(runWithBlock(shifted));
    const updated = store.snapshot().dailyTasks[0];
    assert.equal(updated.userAdjusted, false);
    assert.equal(updated.scheduledStartAt, shifted.startAt);
    assert.equal(updated.title, shifted.title);
    assert.equal(updated.notes, "我的上下文");
    assert.equal(updated.subtasks[0].title, "检查");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replacing a source removes Agent daily tasks whose DDL no longer exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-daily-source-cleanup-"));
  try {
    const store = new ChroniStore(dir);
    const extracted = { sourceName: "course.txt", sourceType: "txt", text: "7月20日提交报告" };
    const ddl = ddlItem("source-report", "提交报告");
    const snapshot = store.addItems([ddl], "", [extracted]);
    const sourceId = snapshot.sources[0].id;
    const persisted = snapshot.items[0];
    const startAt = new Date(2026, 6, 18, 9, 0).toISOString();
    store.saveAgentRun(runWithBlock({ taskId: persisted.id, stepId: "draft", title: "撰写报告", startAt, endAt: new Date(new Date(startAt).getTime() + 45 * 60_000).toISOString(), allocatedMinutes: 45 }));
    assert.equal(store.snapshot().dailyTasks.length, 1);
    store.replaceSourceItems(sourceId, []);
    assert.equal(store.snapshot().dailyTasks.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleting a scheduled task archives its record while deleting an inbox task removes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-daily-history-"));
  try {
    const store = new ChroniStore(dir);
    store.createDailyTask({
      title: "Past scheduled work",
      scheduledStartAt: new Date(2026, 6, 14, 9, 0).toISOString(),
      scheduledEndAt: new Date(2026, 6, 14, 10, 0).toISOString(),
    });
    const scheduled = store.snapshot().dailyTasks[0];
    store.deleteDailyTask(scheduled.id);

    let tasks = new ChroniStore(dir).snapshot().dailyTasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].dismissed, true);

    store.createDailyTask({ title: "Temporary inbox thought" });
    const inbox = store.snapshot().dailyTasks.find((task) => !task.scheduledStartAt);
    store.deleteDailyTask(inbox.id);
    tasks = store.snapshot().dailyTasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, scheduled.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
