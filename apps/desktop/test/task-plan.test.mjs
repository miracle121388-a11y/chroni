import assert from "node:assert/strict";
import test from "node:test";

import { createRuleTaskPlan, generateTaskPlan } from "../dist/agent/task-plan-agent.js";
import { diffTaskPlans } from "../dist/agent/task-plan-diff.js";
import { validateTaskPlan } from "../dist/agent/task-plan-validator.js";

const task = {
  id: "task-1",
  title: "机器学习作业",
  importance: "medium",
  dueAt: "2026-07-20T18:00:00.000Z",
  sourceSummary: "7月20日提交机器学习作业",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
  completed: false,
  estimatedMinutes: 180,
};

test("rule task planning creates a valid editable plan before the deadline", () => {
  const plan = createRuleTaskPlan(task, [], new Date("2026-07-12T10:00:00.000Z"));
  assert.equal(plan.steps.length >= 3, true);
  assert.equal(plan.estimatedTotalMinutes, plan.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0));
  assert.doesNotThrow(() => validateTaskPlan(plan, task));
  assert.equal(plan.plannerSource, "rules");
});

test("task plan validation rejects cycles and inconsistent totals", () => {
  const plan = createRuleTaskPlan(task, [], new Date("2026-07-12T10:00:00.000Z"));
  plan.steps[0].dependsOn = [plan.steps.at(-1).id];
  assert.throws(() => validateTaskPlan(plan, task), /循环依赖/);
  plan.steps[0].dependsOn = [];
  plan.estimatedTotalMinutes += 30;
  assert.throws(() => validateTaskPlan(plan, task), /总耗时/);
});

test("saved plan edits produce structured revisions", () => {
  const before = createRuleTaskPlan(task, [], new Date("2026-07-12T10:00:00.000Z"));
  const after = structuredClone(before);
  after.steps[1].estimatedMinutes += 15;
  after.bufferMinutes += 10;
  const changes = diffTaskPlans(before, after);
  assert.equal(changes.some((change) => change.type === "duration-changed"), true);
  assert.equal(changes.some((change) => change.type === "buffer-changed"), true);
});

test("task planning falls back to validated rules when the model fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const plan = await generateTaskPlan(task, [], { enabled: true, provider: "openai-compatible", baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" }, new Date("2026-07-12T10:00:00.000Z"));
    assert.equal(plan.plannerSource, "rules-fallback");
    assert.doesNotThrow(() => validateTaskPlan(plan, task));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
