import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractDdlItemsFromText, processIntake, reprocessSource } from "../dist/intake.js";
import { ChroniStore } from "../dist/store.js";

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "chroni-test-"));
  const store = new ChroniStore(dir);
  try {
    return fn(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("invalid quiet hour preference patches are rejected", () => {
  withStore((store) => {
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
