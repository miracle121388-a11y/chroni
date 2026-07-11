import assert from "node:assert/strict";
import test from "node:test";

import { DeadlineAgent } from "../dist/agent/deadline-agent.js";
import { createAgentMemory } from "../dist/agent/agent-memory.js";
import { assessTaskRisks, planWorkBlocks } from "../dist/agent/agent-tools.js";

function task(id, dueAt, importance = "medium") {
  return {
    id,
    title: `Task ${id}`,
    dueAt,
    importance,
    sourceSummary: "test",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completed: false,
  };
}

function harness(items) {
  const calls = { read: 0, plan: 0, replan: 0, reminder: 0, save: 0 };
  let saved;
  const tools = {
    async readTasks() {
      calls.read += 1;
      return items;
    },
    assessRisks: assessTaskRisks,
    plan: (risks, memory, now) => {
      calls.plan += 1;
      return planWorkBlocks(risks, memory, now);
    },
    replan: (risks, memory, now) => {
      calls.replan += 1;
      return planWorkBlocks(risks, memory, now);
    },
    async sendReminder() {
      calls.reminder += 1;
    },
  };
  const agent = new DeadlineAgent({
    tools,
    getMemory: () => createAgentMemory(),
    saveRun: async (result) => {
      calls.save += 1;
      saved = result;
    },
    now: () => new Date(2026, 6, 11, 9, 0, 0, 0),
    createId: () => "agent-run-test",
  });
  return { agent, calls, saved: () => saved };
}

test("DeadlineAgent performs a high-risk observe-plan-act-verify loop", async () => {
  const { agent, calls, saved } = harness([
    task("overdue", new Date(2026, 6, 11, 8, 0, 0, 0).toISOString(), "high"),
    task("soon", new Date(2026, 6, 11, 18, 0, 0, 0).toISOString(), "medium"),
  ]);

  const result = await agent.run();

  assert.deepEqual(calls, { read: 1, plan: 1, replan: 1, reminder: 1, save: 1 });
  assert.equal(result.id, "agent-run-test");
  assert.equal(result.observation.activeCount, 2);
  assert.equal(result.priorities[0].taskId, "overdue");
  assert.equal(result.actions.some((action) => action.tool === "replan" && action.status === "success"), true);
  assert.deepEqual(result.trace.map((entry) => entry.stage), ["observe", "plan", "act", "act", "verify"]);
  assert.equal(result.verification.status, "attention");
  assert.equal(saved()?.id, result.id);
});

test("DeadlineAgent produces a healthy complete trace for an empty task list", async () => {
  const { agent, calls } = harness([]);

  const result = await agent.run();

  assert.equal(calls.replan, 0);
  assert.equal(calls.reminder, 0);
  assert.equal(result.verification.status, "healthy");
  assert.deepEqual(result.trace.map((entry) => entry.stage), ["observe", "plan", "act", "verify"]);
  assert.match(result.suggestions[0], /没有待处理/);
});

test("DeadlineAgent shares one in-flight inspection between duplicate requests", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const harnessResult = harness([]);
  harnessResult.agent.tools.readTasks = async () => {
    harnessResult.calls.read += 1;
    await waiting;
    return [];
  };

  const first = harnessResult.agent.run();
  const second = harnessResult.agent.run();
  assert.equal(first, second);
  release();
  await first;
  assert.equal(harnessResult.calls.read, 1);
});
