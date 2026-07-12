import assert from "node:assert/strict";
import test from "node:test";

import { applyFeedbackEvent, createBehaviorMemory } from "../dist/agent/behavior-memory.js";
import { selectPlanningPreferences } from "../dist/agent/preference-selector.js";

function event(version, taskType = "coursework", before = 30, after = 45) {
  return {
    id: `event-${version}`,
    taskId: `task-${version}`,
    planId: `plan-${version}`,
    planVersion: version,
    taskType,
    source: "plan-edit",
    changes: [{ type: "duration-changed", stepId: "core", beforeMinutes: before, afterMinutes: after }],
    context: {
      dueWindowHours: 72,
      importance: "medium",
      originalStepCount: 3,
      finalStepCount: 3,
      originalTotalMinutes: 90,
      finalTotalMinutes: 105,
      originalBufferMinutes: 15,
      finalBufferMinutes: 15,
    },
    createdAt: `2026-07-${String(10 + version).padStart(2, "0")}T00:00:00.000Z`,
  };
}

test("behavior memory activates only after repeated consistent evidence", () => {
  let memory = createBehaviorMemory();
  memory = applyFeedbackEvent(memory, event(1));
  assert.equal(memory.preferences[0].status, "candidate");
  memory = applyFeedbackEvent(memory, event(2));
  memory = applyFeedbackEvent(memory, event(3));
  assert.equal(memory.preferences[0].status, "active");
  assert.equal(memory.preferences[0].value, 45);
  assert.equal(memory.preferences[0].evidenceCount, 3);
});

test("preference selection is scoped and ignores disabled preferences", () => {
  let memory = createBehaviorMemory();
  memory = applyFeedbackEvent(applyFeedbackEvent(applyFeedbackEvent(memory, event(1)), event(2)), event(3));
  assert.equal(selectPlanningPreferences(memory, { taskType: "coursework", importance: "medium", dueAt: "2026-07-20T00:00:00.000Z" }, new Date("2026-07-12T00:00:00.000Z")).length, 1);
  assert.equal(selectPlanningPreferences(memory, { taskType: "meeting", importance: "medium", dueAt: "2026-07-20T00:00:00.000Z" }, new Date("2026-07-12T00:00:00.000Z")).length, 0);
  memory.preferences[0].status = "disabled";
  assert.equal(selectPlanningPreferences(memory, { taskType: "coursework", importance: "medium", dueAt: "2026-07-20T00:00:00.000Z" }, new Date("2026-07-12T00:00:00.000Z")).length, 0);
});

test("reverse evidence lowers confidence without immediately erasing history", () => {
  let memory = createBehaviorMemory();
  memory = applyFeedbackEvent(applyFeedbackEvent(applyFeedbackEvent(memory, event(1)), event(2)), event(3));
  const before = memory.preferences[0];
  memory = applyFeedbackEvent(memory, event(4, "coursework", 45, 20));
  assert.equal(memory.preferences[0].confidence < before.confidence, true);
  assert.equal(memory.preferences[0].negativeEvidenceCount, 1);
  assert.equal(memory.preferences[0].value, before.value);
});
