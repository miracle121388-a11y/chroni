import assert from "node:assert/strict";
import test from "node:test";

import { validateAgentMemoryPatch, validateIntakePayload, validateItemPatch, validatePreferencesPatch } from "../dist/validation.js";

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
  assert.deepEqual(validateItemPatch({ title: "Report", importance: "high", completed: false }), {
    title: "Report",
    importance: "high",
    completed: false,
  });
  assert.throws(() => validateItemPatch({ completed: "yes" }), /completed/);
  assert.throws(() => validateItemPatch({ importance: "urgent" }), /importance/);
  assert.throws(() => validateItemPatch({ dueAt: "not-a-date" }), /dueAt/);
  assert.throws(() => validateItemPatch({ injected: true }), /injected/);
});

test("validatePreferencesPatch rejects invalid nested settings", () => {
  assert.deepEqual(validatePreferencesPatch({ llm: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" } }), {
    llm: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  });
  assert.throws(() => validatePreferencesPatch({ companionEnabled: "yes" }), /companionEnabled/);
  assert.throws(() => validatePreferencesPatch({ companionStyle: "purple" }), /companionStyle/);
  assert.throws(() => validatePreferencesPatch({ llm: { provider: "unknown" } }), /provider/);
});

test("validateAgentMemoryPatch enforces capacity, work hours, and reminder frequency", () => {
  assert.deepEqual(validateAgentMemoryPatch({ maxDailyMinutes: 180, workdayStart: "10:00", workdayEnd: "17:00", reminderFrequency: "daily" }), {
    maxDailyMinutes: 180,
    workdayStart: "10:00",
    workdayEnd: "17:00",
    reminderFrequency: "daily",
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
  }), /before/);
});
