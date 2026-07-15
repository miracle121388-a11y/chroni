import assert from "node:assert/strict";
import test from "node:test";

import { validateAgentMemoryPatch, validateBehaviorMemoryPatch, validateClarificationAnswer, validateDailyTaskCreate, validateDailyTaskPatch, validateExplicitPreference, validateIntakePayload, validateItemPatch, validatePreferencesPatch, validateTaskPlanUpdate } from "../dist/validation.js";

test("validateIntakePayload accepts supported text and file shapes", () => {
  assert.deepEqual(validateIntakePayload({ kind: "text", text: "tomorrow 18:00 submit report" }), {
    kind: "text",
    text: "tomorrow 18:00 submit report",
  });
  assert.deepEqual(validateIntakePayload({ kind: "files", files: [{ name: "ddl.txt", contentBase64: "YWJj" }] }), {
    kind: "files",
    files: [{ name: "ddl.txt", contentBase64: "YWJj" }],
  });
});

test("validateIntakePayload rejects malformed and excessive input", () => {
  assert.throws(() => validateIntakePayload({ kind: "text", text: 42 }), /text/);
  assert.throws(() => validateIntakePayload({ kind: "files", files: Array.from({ length: 33 }, (_, index) => ({ name: `${index}.txt` })) }), /32/);
  assert.throws(() => validateIntakePayload({ kind: "files", files: [{ name: "" }] }), /name/);
});

test("validateItemPatch enforces field types, enums, dates, and known keys", () => {
  assert.deepEqual(validateItemPatch({ title: "Report", importance: "high", completed: false, estimatedMinutes: 120, progressPercent: 25 }), {
    title: "Report",
    importance: "high",
    completed: false,
    estimatedMinutes: 120,
    progressPercent: 25,
  });
  assert.throws(() => validateItemPatch({ completed: "yes" }), /completed/);
  assert.throws(() => validateItemPatch({ importance: "urgent" }), /importance/);
  assert.throws(() => validateItemPatch({ dueAt: "not-a-date" }), /dueAt/);
  assert.throws(() => validateItemPatch({ injected: true }), /injected/);
  assert.throws(() => validateItemPatch({ estimatedMinutes: 5 }), /estimatedMinutes/);
  assert.throws(() => validateItemPatch({ progressPercent: 101 }), /progressPercent/);
});

test("daily task validation requires coherent local date-time schedules", () => {
  assert.deepEqual(validateDailyTaskCreate({
    title: "复习",
    scheduledStartAt: "2026-07-15T09:00:00+08:00",
    scheduledEndAt: "2026-07-15T10:00:00+08:00",
    recurrence: "weekly",
    recurrenceEndsAt: "2026-08-15T23:59:00+08:00",
  }), {
    title: "复习",
    scheduledStartAt: "2026-07-15T01:00:00.000Z",
    scheduledEndAt: "2026-07-15T02:00:00.000Z",
    recurrence: "weekly",
    recurrenceEndsAt: "2026-08-15T15:59:00.000Z",
  });
  assert.throws(() => validateDailyTaskCreate({ title: "日期不完整", scheduledStartAt: "2026-07-15" }), /RFC 3339/);
  assert.throws(() => validateDailyTaskCreate({ title: "没有排期", recurrence: "daily" }), /scheduledStartAt/);
  assert.throws(() => validateDailyTaskCreate({ title: "跨日", scheduledStartAt: "2026-07-15T09:00:00Z", scheduledEndAt: "2026-07-16T10:00:00Z" }), /same local date/);
  assert.throws(() => validateDailyTaskCreate({ title: "重复结束过早", scheduledStartAt: "2026-07-15T09:00:00Z", recurrence: "daily", recurrenceEndsAt: "2026-07-13T23:00:00Z" }), /must not be before/);
  assert.throws(() => validateDailyTaskPatch({ completedDates: ["2026-02-30"] }), /valid YYYY-MM-DD/);
});

test("validatePreferencesPatch rejects invalid nested settings", () => {
  assert.deepEqual(validatePreferencesPatch({ llm: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" } }), {
    llm: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  });
  assert.throws(() => validatePreferencesPatch({ companionEnabled: "yes" }), /companionEnabled/);
  assert.throws(() => validatePreferencesPatch({ companionStyle: "purple" }), /companionStyle/);
  assert.throws(() => validatePreferencesPatch({ llm: { provider: "unknown" } }), /provider/);
});

test("validateAgentMemoryPatch enforces capacity, work hours, reminder frequency, and automation flags", () => {
  assert.deepEqual(validateAgentMemoryPatch({ maxDailyMinutes: 180, workdayStart: "10:00", workdayEnd: "17:00", reminderFrequency: "daily", automaticInspectionEnabled: false, useLlmPlanning: false }), {
    maxDailyMinutes: 180,
    workdayStart: "10:00",
    workdayEnd: "17:00",
    reminderFrequency: "daily",
    automaticInspectionEnabled: false,
    useLlmPlanning: false,
  });
  assert.throws(() => validateAgentMemoryPatch({ maxDailyMinutes: 10 }), /maxDailyMinutes/);
  assert.throws(() => validateAgentMemoryPatch({ workdayStart: "18:00", workdayEnd: "09:00" }), /before/);
  assert.throws(() => validateAgentMemoryPatch({ reminderFrequency: "always" }), /reminderFrequency/);
  assert.throws(() => validateAgentMemoryPatch({ unknown: true }), /unknown/);
  assert.throws(() => validateAgentMemoryPatch({ workdayEnd: "14:00" }, {
    maxDailyMinutes: 180,
    workdayStart: "15:00",
    workdayEnd: "18:00",
    reminderFrequency: "daily",
    automaticInspectionEnabled: true,
    useLlmPlanning: true,
  }), /before/);
});

test("Agent planning payloads reject unknown keys and privilege escalation", () => {
  assert.deepEqual(validateClarificationAnswer({ optionId: "next-friday" }), { optionId: "next-friday" });
  assert.throws(() => validateClarificationAnswer({ optionId: "next-friday", confidence: 1 }), /confidence/);
  assert.deepEqual(validateBehaviorMemoryPatch({ learningEnabled: false }), { learningEnabled: false });
  assert.throws(() => validateBehaviorMemoryPatch({ preferences: [] }), /preferences/);
  assert.deepEqual(validateExplicitPreference({ key: "preferredStepMinutes", value: 45 }), { key: "preferredStepMinutes", value: 45 });
  assert.throws(() => validateExplicitPreference({ key: "preferredStepMinutes", value: 500 }), /preferredStepMinutes/);

  const now = "2026-07-12T00:00:00.000Z";
  const update = validateTaskPlanUpdate({
    baseVersion: 1,
    goal: "Complete report",
    deliverables: [],
    constraints: [],
    bufferMinutes: 15,
    summary: "Plan",
    uncertainties: [],
    steps: [{ id: "step-1", taskId: "task-1", title: "Draft", description: "", estimatedMinutes: 30, order: 99, dependsOn: [], completionCriteria: [], status: "pending", origin: "agent", userModifiedFields: [], memoryPreferenceIds: [], createdAt: now, updatedAt: now }],
  });
  assert.equal(update.steps[0].origin, "user");
  assert.equal(update.steps[0].order, 1);
  assert.throws(() => validateTaskPlanUpdate({ ...update, confidence: 1 }), /confidence/);
});
