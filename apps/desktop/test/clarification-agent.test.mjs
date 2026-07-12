import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCompleteness } from "../dist/agent/clarification-agent.js";

test("ambiguous next-week tasks create a required resumable clarification", () => {
  const result = analyzeCompleteness({
    sourceName: "直接文本",
    sourceType: "text",
    text: "下周完成机器学习作业。",
  }, new Date("2026-07-12T10:00:00+08:00"));

  assert.equal(result.status, "needs-clarification");
  assert.equal(result.draft.candidate.title, "机器学习作业");
  assert.equal(result.draft.candidate.taskType, "coursework");
  assert.equal(result.clarifications.length, 1);
  assert.equal(result.clarifications[0].field, "dueAt");
  assert.equal(result.clarifications[0].required, true);
  assert.equal(result.clarifications[0].options.length >= 2, true);
  assert.equal(result.clarifications[0].resumeToken.length > 10, true);
});

test("explicit deadlines do not create blocking clarification", () => {
  const result = analyzeCompleteness({
    sourceName: "直接文本",
    sourceType: "text",
    text: "2026年7月20日 18:00 提交机器学习作业。",
  }, new Date("2026-07-12T10:00:00+08:00"));

  assert.equal(result.status, "complete");
  assert.equal(result.clarifications.length, 0);
  assert.match(result.draft.candidate.dueAt, /^2026-07-20T/);
});

test("multiple missing required fields remain independently resumable", () => {
  const result = analyzeCompleteness({ sourceName: "直接文本", sourceType: "text", text: "请提醒我处理一下。" }, new Date("2026-07-12T10:00:00+08:00"));
  assert.equal(result.status, "needs-clarification");
  assert.deepEqual(result.clarifications.map((item) => item.field), ["title", "dueAt"]);
  assert.equal(new Set(result.clarifications.map((item) => item.id)).size, 2);
});
