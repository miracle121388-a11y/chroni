import assert from "node:assert/strict";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertSafeOfficeArchive, extractDdlItemsFromText, extractPayload, itemFromLlmCandidate, processIntake, reprocessSource } from "../dist/intake.js";
import { deadlineDateFromText, isConditionalDeadlineText } from "../dist/shared/deadline-text.js";
import { ChroniStore } from "../dist/store.js";

const anchor = new Date(2026, 6, 14, 10, 0, 0, 0); // Tuesday in the user's local timezone.

test("Chinese numeric clock suffixes preserve half and quarter hours", () => {
  const half = deadlineDateFromText("今晚8点半提交项目", anchor);
  const quarter = deadlineDateFromText("明天下午3点一刻提交报告", anchor);
  const threeQuarters = deadlineDateFromText("后天9时三刻完成作业", anchor);

  assert.ok(half && quarter && threeQuarters);
  assert.deepEqual(localParts(half), { year: 2026, month: 7, day: 14, hour: 20, minute: 30 });
  assert.deepEqual(localParts(quarter), { year: 2026, month: 7, day: 15, hour: 15, minute: 15 });
  assert.deepEqual(localParts(threeQuarters), { year: 2026, month: 7, day: 16, hour: 9, minute: 45 });
});

test("night midnight rolls forward while noon and early-morning midnight stay exact", () => {
  assert.deepEqual(localParts(deadlineDateFromText("今晚12点提交项目", anchor)), { year: 2026, month: 7, day: 15, hour: 0, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("今晚0点提交项目", anchor)), { year: 2026, month: 7, day: 15, hour: 0, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("今天中午12点提交项目", anchor)), { year: 2026, month: 7, day: 14, hour: 12, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("今天凌晨12点提交项目", anchor)), { year: 2026, month: 7, day: 14, hour: 0, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("2026年7月31日晚上12点提交项目", anchor)), { year: 2026, month: 8, day: 1, hour: 0, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("2026年7月31日24:00提交项目", anchor)), { year: 2026, month: 8, day: 1, hour: 0, minute: 0 });
});

test("weekday expressions distinguish rolling, current, next, and previous weeks", () => {
  assert.deepEqual(localParts(deadlineDateFromText("周二晚上8点提交报告", anchor)), { year: 2026, month: 7, day: 14, hour: 20, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("周二上午8点提交报告", anchor)), { year: 2026, month: 7, day: 21, hour: 8, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("本周一晚上8点提交报告", anchor)), { year: 2026, month: 7, day: 13, hour: 20, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("上周五晚上8点提交报告", anchor)), { year: 2026, month: 7, day: 10, hour: 20, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("下周一晚上8点提交报告", anchor)), { year: 2026, month: 7, day: 20, hour: 20, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("下下周一晚上8点提交报告", anchor)), { year: 2026, month: 7, day: 27, hour: 20, minute: 0 });
  assert.deepEqual(localParts(deadlineDateFromText("大后天晚上8点提交报告", anchor)), { year: 2026, month: 7, day: 17, hour: 20, minute: 0 });
});

test("date-only evidence remains pending instead of inventing 23:59", async () => {
  assert.equal(deadlineDateFromText("7月20日提交报告", anchor), undefined);
  const dir = mkdtempSync(join(tmpdir(), "chroni-date-only-"));
  try {
    const store = new ChroniStore(dir);
    const result = await processIntake({ kind: "text", text: "7月20日提交课程报告" }, store);
    assert.equal(result.ok, false);
    assert.equal(result.snapshot.items.length, 0);
    assert.equal(result.snapshot.clarifications.some((item) => item.status === "pending" && item.field === "dueAt"), true);
    assert.equal(result.snapshot.sources[0].extractionStatus, "pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unrelated advisory condition does not make a clear deadline conditional", () => {
  const advisory = "如果有问题请联系老师，今晚8点提交课程项目";
  const actualCondition = "如果老师同意，明天8点提交课程项目";

  assert.equal(isConditionalDeadlineText(advisory), false);
  assert.equal(isConditionalDeadlineText(actualCondition), true);
  assert.equal(isConditionalDeadlineText("明天8点左右提交课程项目"), true);
  assert.equal(isConditionalDeadlineText("明天8点提交课程项目，具体时间可能调整"), true);
  assert.equal(extractDdlItemsFromText(advisory, "notice.txt", anchor).length, 1);
  assert.equal(extractDdlItemsFromText(actualCondition, "notice.txt", anchor).length, 0);
});

test("LLM deadlines must match explicit source time evidence", () => {
  const source = "2026年7月20日20:00提交课程报告";
  const base = { title: "课程报告", importance: "medium", sourceSummary: source };
  const grounded = deadlineDateFromText(source, anchor);
  assert.ok(grounded);
  const equivalentWithUserOffset = isoWithLocalOffset(new Date(grounded));

  assert.ok(itemFromLlmCandidate({ ...base, dueAt: grounded }, source, "notice.txt", anchor));
  assert.ok(itemFromLlmCandidate({ ...base, dueAt: equivalentWithUserOffset }, source, "notice.txt", anchor));
  assert.equal(itemFromLlmCandidate({ ...base, dueAt: new Date(new Date(grounded).getTime() + 24 * 60 * 60_000).toISOString() }, source, "notice.txt", anchor), null);
});

test("an LLM guess for vague source text becomes a clarification", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      items: [{
        title: "机器学习作业",
        dueAt: "2026-07-17T23:59:00+08:00",
        importance: "medium",
        sourceSummary: "下周完成机器学习作业",
      }],
    }) } }],
  }), { status: 200 });
  try {
    const result = await extractPayload({ kind: "text", text: "下周完成机器学习作业" }, {
      llm: { enabled: true, provider: "openai-compatible", baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" },
      referenceNow: anchor,
    });
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 0);
    assert.equal(result.pendingItems.length, 1);
    assert.match(result.pendingItems[0].reason, /无法安全|不能直接采用/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the same reference anchor keeps relative extraction stable", async () => {
  const first = await extractPayload({ kind: "text", text: "明天20:00提交课程报告" }, { referenceNow: anchor });
  const second = await extractPayload({ kind: "text", text: "明天20:00提交课程报告" }, { referenceNow: new Date(anchor) });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.items[0].dueAt, second.items[0].dueAt);
});

test("natural-language handoffs and meetings are recognized without a deadline template", () => {
  const items = extractDdlItemsFromText(
    "社团群说明：明天9：00群里收PPT初稿。期末作业明天9:30前发给老师。周五15:00带上论文框架和导师讨论。",
    "chat.txt",
    anchor,
  );

  assert.equal(items.length, 3);
  assert.equal(items.some((item) => item.title.includes("PPT")), true);
  assert.equal(items.find((item) => item.title.includes("期末作业"))?.importance, "high");
  assert.equal(items.some((item) => item.sourceSummary.includes("带上论文框架")), true);
});

test("ordinary meeting notes and unassigned project discussion do not become pending tasks", async () => {
  const chinese = await extractPayload({ kind: "text", text: "这是一段没有日期的普通会议纪要。" }, { referenceNow: anchor });
  const english = await extractPayload({ kind: "text", text: "We discussed the project and no action was assigned." }, { referenceNow: anchor });
  assert.equal(chinese.ok, false);
  assert.equal(chinese.pendingItems.length, 0);
  assert.equal(english.ok, false);
  assert.equal(english.pendingItems.length, 0);
});

test("grounded semantic importance cannot be downgraded by a model candidate", () => {
  const source = "期末作业明天9:30前发给老师";
  const dueAt = deadlineDateFromText(source, anchor);
  assert.ok(dueAt);
  const item = itemFromLlmCandidate({ title: "期末作业", dueAt, importance: "low", sourceSummary: source }, source, "chat.txt", anchor);
  assert.equal(item?.importance, "high");
});

test("oversized path files are rejected from metadata before extraction", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-large-path-"));
  try {
    const path = join(dir, "huge.txt");
    writeFileSync(path, "");
    truncateSync(path, 2 * 1024 * 1024 + 1);

    const result = await extractPayload({ kind: "files", files: [{ name: "huge.txt", path }] });
    assert.equal(result.ok, false);
    assert.match(result.reason, /文本文件过大/);
    assert.equal(result.reason.includes(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Office archive preflight rejects zip bombs and traversal entries", () => {
  assert.doesNotThrow(() => assertSafeOfficeArchive(makeOfficeArchive([
    { name: "word/document.xml", compressedSize: 300, uncompressedSize: 1_200 },
  ]), "safe.docx"));
  assert.throws(() => assertSafeOfficeArchive(makeOfficeArchive([
    { name: "word/document.xml", compressedSize: 1, uncompressedSize: 32 * 1024 * 1024 },
  ]), "bomb.docx"), /展开后过大|压缩比异常/);
  assert.throws(() => assertSafeOfficeArchive(makeOfficeArchive([
    { name: "../outside.xml", compressedSize: 20, uncompressedSize: 100 },
  ]), "traversal.docx"), /不安全路径/);
});

test("renamed plain text cannot enter the DOCX parser", async () => {
  const result = await extractPayload({
    kind: "files",
    files: [{ name: "forged.docx", contentBase64: Buffer.from("not a zip document").toString("base64") }],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /格式与扩展名不匹配/);
});

test("model failures expose an actionable Chinese message without runtime details", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("connect ECONNREFUSED 127.0.0.1 /Users/private/key"); };
  try {
    const result = await extractPayload({ kind: "text", text: "请提醒我提交课程报告" }, {
      llm: { enabled: true, provider: "openai-compatible", baseUrl: "https://example.invalid", apiKey: "sk-test", model: "model" },
      referenceNow: anchor,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /网络连接失败|模型服务暂时不可用/);
    assert.doesNotMatch(result.reason, /ECONNREFUSED|\/Users\/private|127\.0\.0\.1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mixed reprocessing preserves the old task represented by a pending replacement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-mixed-reprocess-"));
  const originalFetch = globalThis.fetch;
  try {
    const store = new ChroniStore(dir);
    const initial = await processIntake({
      kind: "text",
      text: "2026年7月20日20:00提交课程报告。2026年7月21日21:00提交实验报告。",
    }, store);
    assert.equal(initial.snapshot.items.length, 2);
    const sourceId = initial.snapshot.sources[0].id;
    const oldExperiment = initial.snapshot.items.find((item) => item.title === "实验报告");
    assert.ok(oldExperiment);

    store.updateSourceText(sourceId, "2026年7月20日20:00提交课程报告。实验报告改为7月22日下午第二节课提交，具体钟点未说明。");
    store.updateAgentMemory({ useLlmPlanning: false });
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" } });
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        items: [{ title: "课程报告", dueAt: "2026-07-20T20:00:00+08:00", importance: "medium", sourceSummary: "2026年7月20日20:00提交课程报告" }],
        pendingItems: [{
          title: "实验报告",
          importance: "medium",
          sourceSummary: "实验报告改为7月22日下午第二节课提交，具体钟点未说明",
          question: "下午第二节课具体几点？",
          reason: "课次不能安全换算为钟点。",
        }],
      }) } }],
    }), { status: 200 });

    const result = await reprocessSource(sourceId, store);
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.items.length, 2);
    assert.equal(result.snapshot.items.some((item) => item.id === oldExperiment.id), true);
    assert.equal(result.snapshot.intakeDrafts.some((draft) => draft.replacesTaskId === oldExperiment.id), true);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

function localParts(value) {
  assert.ok(value);
  const date = new Date(value);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

function isoWithLocalOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

function makeOfficeArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(entry.compressedSize, 18);
    local.writeUInt32LE(entry.uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(entry.compressedSize, 20);
    central.writeUInt32LE(entry.uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
