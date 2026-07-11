import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

<<<<<<< HEAD
import { extractDdlItemsFromText, itemFromLlmCandidate, isReliableOcrResult, processIntake, reprocessSource } from "../dist/intake.js";
import { lightweightScheduleItems, scheduleBucket, shouldRemindItem, snoozeUntil, visibleScheduleSummary } from "../dist/shared/schedule.js";
import { companionStateForItems, ChroniStore } from "../dist/store.js";
=======
import { extractDdlItemsFromText, extractPayload, itemFromLlmCandidate, isReliableOcrResult, processIntake, reprocessSource } from "../dist/intake.js";
import { visibleScheduleSummary } from "../dist/shared/schedule.js";
import { ChroniStore } from "../dist/store.js";
>>>>>>> fix/windows-release-readiness

async function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "chroni-test-"));
  const store = new ChroniStore(dir);
  try {
    return await fn(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testSecretCodec() {
  return {
    encrypt(value) {
      return Buffer.from(`chroni:${value}`, "utf8").toString("base64");
    },
    decrypt(value) {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      if (!decoded.startsWith("chroni:")) throw new Error("Invalid test secret");
      return decoded.slice("chroni:".length);
    },
  };
}

test("records failed task-like intake as a local source", async () => {
  await withStore(async (store) => {
    const result = await processIntake({ kind: "text", text: "请提醒我提交课程报告" }, store);

    assert.equal(result.ok, false);
    assert.equal(result.snapshot.sources[0].sourceName, "直接文本");
    assert.equal(result.snapshot.sources[0].extractionStatus, "failed");
    assert.match(result.snapshot.sources[0].lastError ?? "", /截止时间/);
  });
});

test("records duplicate intake without creating another schedule item", async () => {
  await withStore(async (store) => {
    const text = "7月12日 23:59 提交课程报告";
    const first = await processIntake({ kind: "text", text }, store);
    const itemCountAfterFirst = first.snapshot.items.length;
    const second = await processIntake({ kind: "text", text }, store);

    assert.equal(second.snapshot.items.length, itemCountAfterFirst);
    assert.equal(second.snapshot.sources[0].extractionStatus, "duplicate");
    assert.equal(second.snapshot.sources[0].itemIds.length, 1);
  });
});

test("reprocess failure keeps previous source items and records the failure", async () => {
  await withStore(async (store) => {
    const created = await processIntake({ kind: "text", text: "明天 18:00 交实验报告" }, store);
    const source = created.snapshot.sources[0];
    const itemIdsBefore = [...source.itemIds];

    store.updateSourceText(source.id, "请提醒我交实验报告");
    const result = await reprocessSource(source.id, store);

    assert.equal(result.ok, false);
    const updatedSource = result.snapshot.sources.find((candidate) => candidate.id === source.id);
    assert.deepEqual(updatedSource?.itemIds, itemIdsBefore);
    assert.equal(updatedSource?.extractionStatus, "failed");
    assert.match(updatedSource?.lastError ?? "", /截止时间/);
  });
});

test("parses common compact and next-week deadline expressions", () => {
  const compact = extractDdlItemsFromText("7.12 23:59 提交课程报告");
  const nextWeek = extractDdlItemsFromText("下周五 18:00 小组汇报");

  assert.equal(compact.length, 1);
  assert.equal(new Date(compact[0].dueAt).getHours(), 23);
  assert.equal(new Date(compact[0].dueAt).getMinutes(), 59);
  assert.equal(nextWeek.length, 1);
  assert.equal(new Date(nextWeek[0].dueAt).getHours(), 18);
});

test("relative deadlines use the explicit time rather than unrelated numbers", () => {
  const items = extractDdlItemsFromText("阅读第2章，明天 18:00 提交读书笔记");

  assert.equal(items.length, 1);
  assert.equal(new Date(items[0].dueAt).getHours(), 18);
  assert.equal(new Date(items[0].dueAt).getMinutes(), 0);
});

test("invalid calendar dates are not rolled into a different date", () => {
  const items = extractDdlItemsFromText("2月31日 23:59 提交课程报告");

  assert.equal(items.length, 0);
});

test("plain schedule dates without task intent are not converted to DDL", () => {
  const items = extractDdlItemsFromText("课程安排：7月12日 第一讲 导论；7月19日 第二讲 阅读方法");

  assert.equal(items.length, 0);
});

test("coursework dates with task intent are still converted to DDL", () => {
  const items = extractDdlItemsFromText("7月12日 23:59 课程报告");

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "课程报告");
});

test("new stores without existing state do not share mutated default data", async () => {
  const firstDir = mkdtempSync(join(tmpdir(), "chroni-test-"));
  const secondDir = mkdtempSync(join(tmpdir(), "chroni-test-"));
  try {
    const first = new ChroniStore(firstDir);
    await processIntake({ kind: "text", text: "明天 20:00 交第一份报告" }, first);

    const second = new ChroniStore(secondDir);

    assert.equal(second.snapshot().sources.length, 0);
    assert.equal(second.snapshot().items.length, 0);
    assert.match(second.snapshot().companion.bubble, /拖给我/);
  } finally {
    rmSync(firstDir, { recursive: true, force: true });
    rmSync(secondDir, { recursive: true, force: true });
  }
});

test("invalid item due date patches do not corrupt stored items", async () => {
  await withStore(async (store) => {
    const created = await processIntake({ kind: "text", text: "明天 20:00 提交课程报告" }, store);
    const before = created.snapshot.items[0];
    const snapshot = store.updateItem(before.id, { dueAt: "not-a-date" });
    const after = snapshot.items.find((item) => item.id === before.id);

    assert.equal(after?.dueAt, before.dueAt);
    assert.equal(snapshot.companion.state, "confused");
    assert.match(snapshot.companion.bubble, /截止时间/);
  });
});

test("schedule popover summary excludes currently snoozed items", () => {
  const now = new Date("2026-07-09T10:00:00.000Z");
  const base = {
    id: "ddl-1",
    title: "课程报告",
    importance: "medium",
    dueAt: "2026-07-09T12:00:00.000Z",
    sourceSummary: "测试",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completed: false,
  };
  const summary = visibleScheduleSummary([
    { ...base, id: "visible" },
    { ...base, id: "snoozed", snoozedUntil: "2026-07-09T13:00:00.000Z" },
    { ...base, id: "completed", completed: true },
  ], now);

  assert.deepEqual(summary, { active: 1, completed: 1, overdue: 0, today: 1, upcoming: 0 });
});

test("lightweight schedule shows one nearest later item instead of a misleading empty state", () => {
  const now = new Date("2026-07-10T10:00:00.000Z");
  const base = {
    importance: "medium",
    sourceSummary: "测试",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completed: false,
  };
  const items = [
    { ...base, id: "later", title: "两周后的报告", dueAt: "2026-07-24T12:00:00.000Z" },
    { ...base, id: "nearest", title: "下周后的报告", dueAt: "2026-07-19T12:00:00.000Z" },
  ];

  assert.deepEqual(lightweightScheduleItems(items, now).map((item) => item.id), ["nearest"]);
  assert.equal(scheduleBucket(items[1], now), "later");
});

test("snooze presets produce predictable reminder times", () => {
  const now = new Date(2026, 6, 10, 15, 30, 0, 0);
  assert.equal(snoozeUntil("two-hours", now).getTime() - now.getTime(), 2 * 3_600_000);
  assert.equal(snoozeUntil("one-day", now).getDate(), 11);
  const tomorrowMorning = snoozeUntil("tomorrow-morning", now);
  assert.equal(tomorrowMorning.getDate(), 11);
  assert.equal(tomorrowMorning.getHours(), 9);
  assert.equal(tomorrowMorning.getMinutes(), 0);
});

test("an expired snooze triggers once even when the deadline is more than 24 hours away", () => {
  const now = new Date("2026-07-10T10:00:00.000Z");
  const item = {
    completed: false,
    dueAt: "2026-07-15T10:00:00.000Z",
    snoozedUntil: "2026-07-10T09:59:00.000Z",
    lastRemindedAt: "2026-07-10T07:00:00.000Z",
  };

  assert.equal(shouldRemindItem(item, now), true);
  assert.equal(shouldRemindItem({ ...item, lastRemindedAt: now.toISOString() }, now), false);
  assert.equal(shouldRemindItem({ ...item, snoozedUntil: "2026-07-10T11:00:00.000Z" }, now), false);
});

test("schedule summary buckets do not double-count an overdue item from today", () => {
  const now = new Date("2026-07-10T10:00:00.000Z");
  const summary = visibleScheduleSummary([{
    id: "overdue-today",
    title: "今日已逾期",
    importance: "high",
    dueAt: "2026-07-10T09:00:00.000Z",
    sourceSummary: "测试",
    createdAt: "2026-07-09T10:00:00.000Z",
    updatedAt: "2026-07-09T10:00:00.000Z",
    completed: false,
  }], now);

  assert.equal(summary.overdue, 1);
  assert.equal(summary.today, 0);
  assert.equal(summary.upcoming, 0);
});

test("snoozed items do not keep the companion in an urgent state", () => {
  const now = new Date();
  const overdue = {
    id: "overdue",
    title: "已稍后提醒的报告",
    importance: "high",
    dueAt: new Date(now.getTime() - 3_600_000).toISOString(),
    sourceSummary: "测试",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completed: false,
    snoozedUntil: new Date(now.getTime() + 2 * 3_600_000).toISOString(),
  };

  assert.deepEqual(companionStateForItems([overdue]), {
    state: "idle",
    bubble: "稍后提醒的事项会按时回来。",
  });
});

test("item updates preserve completion feedback and immediately refresh after snoozing", async () => {
  await withStore(async (store) => {
    const created = await processIntake({ kind: "text", text: "明天 20:00 提交课程报告" }, store);
    const item = created.snapshot.items[0];

    const completed = store.updateItem(item.id, { completed: true });
    assert.equal(completed.companion.state, "celebrating");
    assert.match(completed.companion.bubble, /完成/);

    store.updateItem(item.id, { completed: false });
    const snoozed = store.updateItem(item.id, { snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(snoozed.companion.state, "idle");
    assert.match(snoozed.companion.bubble, /稍后提醒/);
  });
});


test("empty local text files fail with a specific source record", async () => {
  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [{ name: "empty.txt", contentBase64: Buffer.from("   \n").toString("base64") }],
    }, store);

    assert.equal(result.ok, false);
    assert.match(result.reason, /没有可读取文本/);
    assert.equal(result.snapshot.sources[0].sourceName, "empty.txt");
    assert.equal(result.snapshot.sources[0].extractionStatus, "failed");
    assert.match(result.snapshot.sources[0].lastError ?? "", /没有可读取文本/);
  });
});

test("garbled text files fail instead of creating schedules from unreliable text", async () => {
  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [{ name: "garbled.txt", contentBase64: Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0xff, 0xfe]).toString("base64") }],
    }, store);

    assert.equal(result.ok, false);
    assert.match(result.reason, /无法可靠解析|没有可读取文本/);
    assert.equal(result.snapshot.sources[0].sourceName, "garbled.txt");
    assert.equal(result.snapshot.sources[0].extractionStatus, "failed");
  });
});

test("ocr text must be readable and confident enough before schedule extraction", () => {
  assert.equal(isReliableOcrResult("明天 18:00 提交课程报告", 82), true);
  assert.equal(isReliableOcrResult("明天 18:00 提交课程报告", 69), false);
  assert.equal(isReliableOcrResult("明天 18:00 提交课程报告", 32), false);
  assert.equal(isReliableOcrResult("����\u0000??", 91), false);
});

test("llm candidates must still look like real deadline tasks", () => {
  assert.equal(itemFromLlmCandidate({
    title: "第一讲导论",
    dueAt: "2026-07-12T23:59:00.000Z",
    importance: "medium",
    sourceSummary: "课程安排：7月12日 第一讲 导论",
  }), null);

  assert.equal(itemFromLlmCandidate({
    title: "课程报告",
    dueAt: "2026-02-31T23:59:00.000Z",
    importance: "medium",
    sourceSummary: "2月31日 23:59 提交课程报告",
  }), null);

  assert.notEqual(itemFromLlmCandidate({
    title: "课程报告",
    dueAt: "2026-07-12T23:59:00.000Z",
    importance: "medium",
    sourceSummary: "7月12日 23:59 提交课程报告",
  }), null);
});

test("llm candidates must be grounded in the extracted source text", () => {
  const sourceText = "课程通知：7月12日 23:59 提交课程报告。";
  assert.equal(itemFromLlmCandidate({
    title: "课程报告",
    dueAt: "2026-07-12T23:59:00.000Z",
    importance: "medium",
    sourceSummary: "老师提醒月底还有一个课程展示",
  }, sourceText), null);

  assert.notEqual(itemFromLlmCandidate({
    title: "课程报告",
    dueAt: "2026-07-12T23:59:00.000Z",
    importance: "medium",
    sourceSummary: "7月12日 23:59 提交课程报告",
  }, sourceText), null);
});

test("invalid quiet hour preference patches are rejected", async () => {
  await withStore((store) => {
    const before = store.snapshot().preferences;
    const snapshot = store.updatePreferences({ quietHoursStart: "25:99" });

    assert.equal(snapshot.preferences.quietHoursStart, before.quietHoursStart);
    assert.equal(snapshot.companion.state, "confused");
    assert.match(snapshot.companion.bubble, /勿扰时间/);
  });
});

test("mixed file intake keeps valid schedules and records failed files", async () => {
  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [
        { name: "course.txt", contentBase64: Buffer.from("明天 20:00 提交课程报告").toString("base64") },
        { name: "archive.zip", contentBase64: Buffer.from("ignored").toString("base64") },
      ],
    }, store);

    assert.equal(result.ok, true);
    assert.equal(result.created.length, 1);
    const sources = result.snapshot.sources;
    assert.equal(sources.some((source) => source.sourceName === "course.txt" && source.extractionStatus === "success"), true);
    assert.equal(sources.some((source) => source.sourceName === "archive.zip" && source.extractionStatus === "failed" && /文件类型不支持/.test(source.lastError ?? "")), true);
  });
});

test("multi-file intake links each created item to the matching source text", async () => {
  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [
        { name: "course-a.txt", contentBase64: Buffer.from("7月12日 23:59 提交课程报告").toString("base64") },
        { name: "course-b.txt", contentBase64: Buffer.from("7月15日 18:00 提交实验报告").toString("base64") },
      ],
    }, store);

    assert.equal(result.ok, true);
    const sourceA = result.snapshot.sources.find((source) => source.sourceName === "course-a.txt");
    const sourceB = result.snapshot.sources.find((source) => source.sourceName === "course-b.txt");
    assert.equal(sourceA?.itemIds.length, 1);
    assert.equal(sourceB?.itemIds.length, 1);
    assert.notEqual(sourceA?.itemIds[0], sourceB?.itemIds[0]);
  });
});

test("source linking can match llm evidence snippets without source-name prefixes", async () => {
  await withStore((store) => {
    const now = new Date().toISOString();
    const snapshot = store.addItems([
      {
        id: "ddl-a",
        title: "课程报告",
        importance: "medium",
        dueAt: "2026-07-12T23:59:00.000Z",
        sourceSummary: "7月12日 23:59 提交课程报告",
        createdAt: now,
        updatedAt: now,
        completed: false,
      },
      {
        id: "ddl-b",
        title: "实验报告",
        importance: "medium",
        dueAt: "2026-07-15T18:00:00.000Z",
        sourceSummary: "7月15日 18:00 提交实验报告",
        createdAt: now,
        updatedAt: now,
        completed: false,
      },
    ], "已加入 2 条日程。", [
      { sourceName: "course-a.txt", sourceType: "txt", text: "7月12日 23:59 提交课程报告" },
      { sourceName: "course-b.txt", sourceType: "txt", text: "7月15日 18:00 提交实验报告" },
    ]);

    const sourceA = snapshot.sources.find((source) => source.sourceName === "course-a.txt");
    const sourceB = snapshot.sources.find((source) => source.sourceName === "course-b.txt");
    assert.deepEqual(sourceA?.itemIds, ["ddl-a"]);
    assert.deepEqual(sourceB?.itemIds, ["ddl-b"]);
  });
});

test("LLM keys are encrypted at rest and reload through the secret codec", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-secret-test-"));
  try {
    const store = new ChroniStore(dir, testSecretCodec());
    store.updatePreferences({ llm: { apiKey: "sk-deepseek-private" } });

    const raw = readFileSync(store.filePath, "utf8");
    assert.equal(raw.includes("sk-deepseek-private"), false);
    assert.match(raw, /apiKeyProtected/);

    const reloaded = new ChroniStore(dir, testSecretCodec());
    assert.equal(reloaded.snapshot().preferences.llm.apiKey, "sk-deepseek-private");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("enabled model failures are reported when local rules provide a fallback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  try {
    const result = await extractPayload(
      { kind: "text", text: "明天 18:00 提交课程报告" },
      {
        llm: {
          enabled: true,
          provider: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKey: "sk-test-only",
          model: "deepseek-v4-flash",
        },
      },
    );

    assert.equal(result.ok, true);
    assert.match(result.message, /模型.*不可用/);
    assert.match(result.message, /本地规则/);
    assert.equal(result.items.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy plaintext LLM keys migrate to protected storage", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-secret-migration-test-"));
  try {
    const statePath = join(dir, "chroni-state.json");
    writeFileSync(statePath, JSON.stringify({
      items: [],
      sources: [],
      preferences: {
        llm: {
          enabled: true,
          provider: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKey: "sk-legacy-private",
          model: "deepseek-v4-flash",
        },
      },
      companion: { state: "idle", bubble: "ready" },
    }), "utf8");

    const store = new ChroniStore(dir, testSecretCodec());
    const migrated = readFileSync(store.filePath, "utf8");

    assert.equal(store.snapshot().preferences.llm.apiKey, "sk-legacy-private");
    assert.equal(migrated.includes("sk-legacy-private"), false);
    assert.match(migrated, /apiKeyProtected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
