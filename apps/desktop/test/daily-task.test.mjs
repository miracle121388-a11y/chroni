import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

    store.saveAgentRun(runWithBlocks(blocks));
    const colors = store.snapshot().dailyTasks.map((task) => task.color);
    assert.deepEqual(colors, ["coral", "teal", "blue"]);
    assert.deepEqual(new ChroniStore(dir).snapshot().dailyTasks.map((task) => task.color), colors);
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
