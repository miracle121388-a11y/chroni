import assert from "node:assert/strict";
import test from "node:test";

import { AgentScheduler } from "../dist/agent/agent-scheduler.js";

const enabledMemory = { automaticInspectionEnabled: true };

test("Agent scheduler runs startup once per local day", async () => {
  const calls = [];
  let latest;
  let lastAutomaticRunAt;
  const scheduler = new AgentScheduler({
    run: async (trigger) => { calls.push(trigger); latest = { trigger, completedAt: "2026-07-12T02:00:00.000Z" }; lastAutomaticRunAt = latest.completedAt; },
    getMemory: () => enabledMemory,
    getLatestRun: () => latest,
    getLastAutomaticRunAt: () => lastAutomaticRunAt,
    now: () => new Date(2026, 6, 12, 10, 0),
  });

  await scheduler.runStartupIfNeeded();
  await scheduler.runStartupIfNeeded();

  assert.deepEqual(calls, ["startup"]);
});

test("Agent scheduler does not repeat startup after a later manual run", async () => {
  const calls = [];
  const scheduler = new AgentScheduler({
    run: async (trigger) => calls.push(trigger),
    getMemory: () => enabledMemory,
    getLatestRun: () => ({ trigger: "manual", completedAt: "2026-07-12T03:00:00.000Z" }),
    getLastAutomaticRunAt: () => "2026-07-12T02:00:00.000Z",
    now: () => new Date(2026, 6, 12, 12, 0),
  });

  await scheduler.runStartupIfNeeded();

  assert.deepEqual(calls, []);
});

test("Agent scheduler runs a daily inspection after the local date changes", async () => {
  const calls = [];
  let current = new Date(2026, 6, 12, 23, 59);
  let lastAutomaticRunAt = current.toISOString();
  const scheduler = new AgentScheduler({
    run: async (trigger) => { calls.push(trigger); lastAutomaticRunAt = current.toISOString(); },
    getMemory: () => enabledMemory,
    getLatestRun: () => undefined,
    getLastAutomaticRunAt: () => lastAutomaticRunAt,
    now: () => current,
  });

  await scheduler.runDailyIfNeeded();
  current = new Date(2026, 6, 13, 0, 1);
  await scheduler.runDailyIfNeeded();
  await scheduler.runDailyIfNeeded();

  assert.deepEqual(calls, ["daily"]);
  scheduler.dispose();
});

test("Agent scheduler coalesces task changes and one in-flight follow-up", async () => {
  const calls = [];
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const scheduler = new AgentScheduler({
    run: async (trigger) => { calls.push(trigger); if (calls.length === 1) await wait; },
    getMemory: () => enabledMemory,
    getLatestRun: () => undefined,
  });

  scheduler.scheduleTaskChange();
  scheduler.scheduleTaskChange();
  const first = scheduler.flushTaskChanges();
  scheduler.scheduleTaskChange();
  await scheduler.flushTaskChanges();
  release();
  await first;

  assert.deepEqual(calls, ["task-change", "task-change"]);
});

test("Agent scheduler does nothing when automatic inspection is disabled", async () => {
  const calls = [];
  const scheduler = new AgentScheduler({ run: async (trigger) => calls.push(trigger), getMemory: () => ({ automaticInspectionEnabled: false }), getLatestRun: () => undefined });

  await scheduler.runStartupIfNeeded();
  scheduler.scheduleTaskChange();
  await scheduler.flushTaskChanges();

  assert.deepEqual(calls, []);
});
