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

function harness(items, memoryPatch = {}, options = {}) {
  const calls = { read: 0, plan: 0, replan: 0, reminder: 0, persist: 0, save: 0 };
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
      return options.reminderResult ?? { sent: true, reason: "sent" };
    },
    async persistPlan() { calls.persist += 1; },
  };
  const agent = new DeadlineAgent({
    tools,
    planner: options.planner,
    getMemory: () => createAgentMemory(memoryPatch),
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

  assert.deepEqual(calls, { read: 1, plan: 1, replan: 1, reminder: 1, persist: 1, save: 1 });
  assert.equal(result.id, "agent-run-test");
  assert.equal(result.observation.activeCount, 2);
  assert.equal(result.priorities[0].taskId, "overdue");
  assert.equal(result.actions.some((action) => action.tool === "replan"), true);
  assert.deepEqual(result.trace.map((entry) => entry.stage), ["observe", "plan", "act", "act", "verify"]);
  assert.equal(result.verification.status, "healthy");
  assert.equal(result.trigger, "manual");
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

test("daily reminder frequency notifies the highest priority non-high-risk task", async () => {
  const { agent, calls } = harness([
    task("later", new Date(2026, 6, 20, 18, 0, 0, 0).toISOString(), "low"),
  ], { reminderFrequency: "daily" });

  await agent.run();

  assert.equal(calls.replan, 0);
  assert.equal(calls.reminder, 1);
});

test("DeadlineAgent uses a valid model proposal and persists the applied plan", async () => {
  const planner = {
    async propose() {
      return { proposal: { allocations: [{ taskId: "urgent", minutes: 60 }], suggestions: ["先完成紧急报告。"] } };
    },
  };
  const { agent, calls } = harness([
    { ...task("urgent", new Date(2026, 6, 11, 12, 0).toISOString(), "high"), estimatedMinutes: 60 },
  ], {}, { planner });

  const result = await agent.run("startup");

  assert.equal(result.plan.plannerSource, "llm");
  assert.equal(result.plannerSource, "llm");
  assert.equal(result.trigger, "startup");
  assert.equal(calls.persist, 1);
  assert.match(result.suggestions[0], /紧急报告/);
});

test("DeadlineAgent records model fallback and a disabled reminder truthfully", async () => {
  const planner = { async propose() { return { fallbackReason: "request-failed" }; } };
  const { agent } = harness([
    task("urgent", new Date(2026, 6, 11, 12, 0).toISOString(), "high"),
  ], {}, { planner, reminderResult: { sent: false, reason: "disabled" } });

  const result = await agent.run();

  assert.equal(result.plan.plannerSource, "rules-fallback");
  assert.equal(result.actions.find((action) => action.tool === "reminder")?.status, "skipped");
  assert.match(result.actions.find((action) => action.tool === "reminder")?.summary ?? "", /disabled/);
  assert.equal(result.trace.some((entry) => entry.data.fallbackReason === "request-failed"), true);
});

test("DeadlineAgent falls back when an injected planner throws", async () => {
  const planner = { async propose() { throw new Error("secret upstream detail"); } };
  const { agent } = harness([task("urgent", new Date(2026, 6, 11, 12, 0).toISOString(), "high")], {}, { planner });

  const result = await agent.run();

  assert.equal(result.plan.plannerSource, "rules-fallback");
  assert.equal(result.trace.some((entry) => entry.data.fallbackReason === "request-failed"), true);
  assert.equal(JSON.stringify(result).includes("secret upstream detail"), false);
});
