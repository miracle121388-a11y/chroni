import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { VoiceAssistant } from "../dist/voice-assistant.js";
import { validateVoiceAudio } from "../dist/voice-transcriber.js";
import { ChroniStore } from "../dist/store.js";

function createHarness() {
  const directory = mkdtempSync(join(tmpdir(), "chroni-voice-"));
  const store = new ChroniStore(directory);
  const published = [];
  let planningRuns = 0;
  let focusMinutes = 0;
  const assistant = new VoiceAssistant(() => store, {
    publish: (snapshot) => published.push(snapshot),
    runPlanning: async () => {
      planningRuns += 1;
      return store.snapshot();
    },
    runIntake: async () => ({ ok: false, reason: "test intake unavailable", snapshot: store.snapshot() }),
    startFocus: (minutes) => { focusMinutes = minutes; },
    stopFocus: () => focusMinutes > 0,
  });
  return {
    assistant,
    store,
    published,
    planningRuns: () => planningRuns,
    focusMinutes: () => focusMinutes,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("voice task creation waits for confirmation and resolves Chinese relative time", async (t) => {
  const harness = createHarness();
  t.after(harness.cleanup);
  const now = new Date(2026, 8, 16, 10, 0, 0);

  const preview = await harness.assistant.preview("明天下午三点提醒我开会一个小时", now);
  assert.equal(preview.state, "confirmation");
  assert.equal(preview.kind, "create-task");
  assert.equal(harness.store.snapshot().dailyTasks.length, 0);

  const result = await harness.assistant.confirm(preview.id);
  assert.equal(result.ok, true);
  const task = harness.store.snapshot().dailyTasks[0];
  assert.equal(task.title, "开会");
  assert.equal(new Date(task.scheduledStartAt).getFullYear(), 2026);
  assert.equal(new Date(task.scheduledStartAt).getMonth(), 8);
  assert.equal(new Date(task.scheduledStartAt).getDate(), 17);
  assert.equal(new Date(task.scheduledStartAt).getHours(), 15);
  assert.equal(new Date(task.scheduledEndAt).getHours(), 16);
  assert.equal(harness.store.snapshot().voiceHistory[0].status, "confirmed");
});

test("voice completion targets an existing daily task and records the occurrence", async (t) => {
  const harness = createHarness();
  t.after(harness.cleanup);
  const now = new Date(2026, 8, 16, 10, 0, 0);
  harness.store.createDailyTask({
    title: "实验报告初稿",
    scheduledStartAt: new Date(2026, 8, 16, 14, 0).toISOString(),
    scheduledEndAt: new Date(2026, 8, 16, 15, 0).toISOString(),
  });

  const preview = await harness.assistant.preview("实验报告初稿完成了", now);
  assert.equal(preview.kind, "complete-task");
  assert.equal(preview.state, "confirmation");
  await harness.assistant.confirm(preview.id);
  assert.deepEqual(harness.store.snapshot().dailyTasks[0].completedDates, ["2026-09-16"]);
});

test("read-only voice commands answer immediately and navigation stays bounded", async (t) => {
  const harness = createHarness();
  t.after(harness.cleanup);
  const now = new Date(2026, 8, 16, 10, 0, 0);
  harness.store.createDailyTask({
    title: "设计评审",
    scheduledStartAt: new Date(2026, 8, 16, 11, 0).toISOString(),
    scheduledEndAt: new Date(2026, 8, 16, 11, 45).toISOString(),
  });

  const schedule = await harness.assistant.preview("今天有什么安排", now);
  assert.equal(schedule.state, "answer");
  assert.match(schedule.spokenText, /设计评审/);

  const navigation = await harness.assistant.preview("打开每日回顾", now);
  assert.equal(navigation.state, "navigation");
  assert.equal(navigation.navigateTo, "review");
});

test("planning and focus commands are allowlisted and require confirmation", async (t) => {
  const harness = createHarness();
  t.after(harness.cleanup);

  const planning = await harness.assistant.preview("帮我重新安排今天");
  assert.equal(planning.state, "confirmation");
  assert.equal(harness.planningRuns(), 0);
  await harness.assistant.confirm(planning.id);
  assert.equal(harness.planningRuns(), 1);

  const focus = await harness.assistant.preview("开始专注四十五分钟");
  await harness.assistant.confirm(focus.id);
  assert.equal(harness.focusMinutes(), 45);
});

test("cancelled previews cannot execute later", async (t) => {
  const harness = createHarness();
  t.after(harness.cleanup);
  const preview = await harness.assistant.preview("添加整理桌面");
  harness.assistant.cancel(preview.id);
  await assert.rejects(() => harness.assistant.confirm(preview.id), /过期/);
  assert.equal(harness.store.snapshot().dailyTasks.length, 0);
  assert.equal(harness.store.snapshot().voiceHistory[0].status, "cancelled");
});

test("voice audio validation enforces local Whisper input bounds", () => {
  const valid = new Float32Array(16_000);
  assert.equal(validateVoiceAudio(valid, 16_000).samples.length, 16_000);
  assert.throws(() => validateVoiceAudio([0, 1], 16_000), /录音格式/);
  assert.throws(() => validateVoiceAudio(valid, 48_000), /采样率/);
  assert.throws(() => validateVoiceAudio(new Float32Array(16_000 * 36), 16_000), /35 秒/);
});
