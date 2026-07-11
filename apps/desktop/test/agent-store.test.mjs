import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
    });
    assert.equal(reloaded.snapshot().agent.latestRun?.id, "run-11");
    assert.equal(reloaded.agentTraceHistory().length, 10);
    assert.equal(reloaded.agentTraceHistory()[0][0].data.index, 11);
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
