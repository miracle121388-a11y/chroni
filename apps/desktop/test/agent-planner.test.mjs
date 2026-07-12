import assert from "node:assert/strict";
import test from "node:test";

import { createLlmAgentPlanner, planFromProposal } from "../dist/agent/agent-planner.js";
import { createAgentMemory } from "../dist/agent/agent-memory.js";

const settings = { enabled: true, provider: "openai-compatible", baseUrl: "https://example.test", apiKey: "secret", model: "planner" };
const assessments = [
  { taskId: "a", title: "Report", dueAt: "2026-07-12T12:00:00.000Z", importance: "high", riskLevel: "high", score: 90, estimatedMinutes: 90, reasons: ["soon"] },
  { taskId: "b", title: "Reading", dueAt: "2026-07-20T12:00:00.000Z", importance: "low", riskLevel: "low", score: 0, estimatedMinutes: 30, reasons: ["later"] },
];
const memory = { ...createAgentMemory(), maxDailyMinutes: 120 };
const initialPlan = { blocks: [], requestedMinutes: 120, plannedMinutes: 0, overflowMinutes: 120, unplannedTaskIds: ["a", "b"], plannerSource: "rules", coverage: [] };
const context = { assessments, memory, initialPlan, now: new Date(2026, 6, 12, 9, 0, 0, 0) };

function response(content, ok = true) {
  return async () => new Response(JSON.stringify(ok ? { choices: [{ message: { content } }] } : { error: { message: "failed" } }), { status: ok ? 200 : 500, headers: { "content-type": "application/json" } });
}

test("LLM planner accepts grounded structured allocations", async () => {
  const planner = createLlmAgentPlanner(settings, response(JSON.stringify({ allocations: [{ taskId: "a", minutes: 90 }, { taskId: "b", minutes: 30 }], suggestions: ["先完成报告。"] })));

  const result = await planner.propose(context);

  assert.equal(result.fallbackReason, undefined);
  assert.deepEqual(result.proposal?.allocations, [{ taskId: "a", minutes: 90 }, { taskId: "b", minutes: 30 }]);
  const plan = planFromProposal(result.proposal, context);
  assert.equal(plan.plannerSource, "llm");
  assert.equal(plan.plannedMinutes, 120);
});

test("LLM planner rejects invented tasks and excessive capacity", async () => {
  const invented = createLlmAgentPlanner(settings, response(JSON.stringify({ allocations: [{ taskId: "invented", minutes: 60 }], suggestions: [] })));
  const excessive = createLlmAgentPlanner(settings, response(JSON.stringify({ allocations: [{ taskId: "a", minutes: 150 }], suggestions: [] })));

  assert.equal((await invented.propose(context)).fallbackReason, "invalid-response");
  assert.equal((await excessive.propose(context)).fallbackReason, "invalid-response");
});

test("LLM planner classifies malformed and request failures without retaining raw output", async () => {
  const malformed = createLlmAgentPlanner(settings, response("not json"));
  const failed = createLlmAgentPlanner(settings, response("", false));

  assert.deepEqual(await malformed.propose(context), { fallbackReason: "invalid-response" });
  assert.deepEqual(await failed.propose(context), { fallbackReason: "request-failed" });
});
