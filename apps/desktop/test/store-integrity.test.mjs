import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRuleTaskPlan } from "../dist/agent/task-plan-agent.js";
import { buildAgentDashboard } from "../dist/shared/agent-dashboard.js";
import { ChroniStore } from "../dist/store.js";
import { validateItemPatch } from "../dist/validation.js";

async function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), "chroni-store-integrity-"));
  try {
    return await run(new ChroniStore(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function item(id, title, dueAt, sourceSummary, extra = {}) {
  return {
    id,
    title,
    dueAt,
    importance: "medium",
    sourceSummary,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    completed: false,
    ...extra,
  };
}

function pendingDraft(id, title, sourceSummary) {
  const clarificationId = `clarification-${id}`;
  const createdAt = "2026-07-14T00:00:00.000Z";
  return {
    draft: {
      id,
      sourceName: "schedule.txt",
      sourceType: "txt",
      candidate: { title, sourceSummary, importance: "medium" },
      confidence: { title: 0.9, dueAt: 0 },
      pendingClarificationIds: [clarificationId],
      status: "needs-clarification",
      createdAt,
      updatedAt: createdAt,
    },
    clarification: {
      id: clarificationId,
      draftId: id,
      field: "dueAt",
      question: `「${title}」具体何时截止？`,
      reason: "原文没有明确时间。",
      options: [],
      allowFreeText: true,
      required: true,
      status: "pending",
      createdAt,
      resumeToken: `resume-${id}`,
    },
  };
}

test("optional item fields can be explicitly cleared without a false success", async () => {
  await withStore((store) => {
    const dueAt = "2026-07-20T12:00:00.000Z";
    store.addItems([item("clearable", "课程项目", dueAt, "manual", {
      snoozedUntil: "2026-07-19T12:00:00.000Z",
      estimatedMinutes: 180,
      progressPercent: 40,
    })]);

    const fromUndefined = validateItemPatch({ snoozedUntil: undefined, estimatedMinutes: undefined });
    assert.deepEqual(fromUndefined, { snoozedUntil: null, estimatedMinutes: null });
    const cleared = store.updateItem("clearable", validateItemPatch({
      snoozedUntil: null,
      estimatedMinutes: null,
      progressPercent: null,
    })).items.find((candidate) => candidate.id === "clearable");

    assert.equal(Object.hasOwn(cleared, "snoozedUntil"), false);
    assert.equal(Object.hasOwn(cleared, "estimatedMinutes"), false);
    assert.equal(Object.hasOwn(cleared, "progressPercent"), false);
    assert.equal(readFileSync(store.filePath, "utf8").includes("snoozedUntil"), false);
  });
});

test("pending draft dedupe uses evidence and a duplicate save restores clarification state", async () => {
  await withStore((store) => {
    const extracted = {
      sourceName: "schedule.txt",
      sourceType: "txt",
      text: "实验报告 A 等老师通知。\n实验报告 B 等助教通知。",
    };
    const first = pendingDraft("draft-a", "实验报告", "schedule.txt: 实验报告 A 等老师通知");
    const second = pendingDraft("draft-b", "实验报告", "schedule.txt: 实验报告 B 等助教通知");
    store.saveIntakeDraft(first.draft, [first.clarification], extracted);
    store.saveIntakeDraft(second.draft, [second.clarification], extracted);

    assert.equal(store.snapshot().sources[0].extractionStatus, "pending");
    assert.equal(store.snapshot().intakeDrafts.filter((draft) => draft.status === "needs-clarification").length, 2);
    store.setCompanion("processing", "处理中");
    const duplicate = store.saveIntakeDraft(first.draft, [first.clarification], extracted);
    assert.equal(duplicate.intakeDrafts.filter((draft) => draft.status === "needs-clarification").length, 2);
    assert.equal(duplicate.companion.state, "needs_clarification");

    const afterCancel = store.cancelIntakeDraft("draft-a");
    assert.equal(afterCancel.companion.state, "needs_clarification");
    assert.match(afterCancel.companion.bubble, /实验报告/);
  });
});

test("a successful store mutation cannot hide another global pending clarification", async () => {
  await withStore((store) => {
    const pending = pendingDraft("draft-pending", "待确认项目", "schedule.txt: 待确认项目等通知");
    store.saveIntakeDraft(pending.draft, [pending.clarification], {
      sourceName: "schedule.txt",
      sourceType: "txt",
      text: "待确认项目等通知",
    });
    const snapshot = store.addItems([item("known", "已知任务", "2026-07-20T12:00:00.000Z", "manual")], "添加成功");
    assert.equal(snapshot.companion.state, "needs_clarification");
    assert.equal(store.updateItem("known", { completed: true }).companion.state, "needs_clarification");
    assert.equal(store.deleteItem("known").companion.state, "needs_clarification");
  });
});

test("source pruning protects sources referenced by tasks and active drafts", async () => {
  await withStore((store) => {
    const protectedInput = { sourceName: "protected.txt", sourceType: "txt", text: "7月20日提交保护任务" };
    store.addItems([item("protected-task", "保护任务", "2026-07-20T12:00:00.000Z", "protected.txt: 7月20日提交保护任务")], "", [protectedInput]);
    const pending = pendingDraft("protected-draft", "待确认任务", "pending.txt: 待确认任务等通知");
    store.saveIntakeDraft(pending.draft, [pending.clarification], { sourceName: "pending.txt", sourceType: "txt", text: "待确认任务等通知" });
    const protectedIds = new Set([
      store.snapshot().items.find((candidate) => candidate.id === "protected-task").sourceId,
      store.snapshot().intakeDrafts.find((candidate) => candidate.id === "protected-draft").sourceId,
    ]);
    store.recordSourceFailure(Array.from({ length: 90 }, (_, index) => ({
      sourceName: `failure-${index}.txt`,
      sourceType: "txt",
      text: `无法识别的内容 ${index}`,
    })), "没有识别到日程");

    const remaining = new Set(store.snapshot().sources.map((source) => source.id));
    for (const sourceId of protectedIds) assert.equal(remaining.has(sourceId), true);
    assert.equal(store.snapshot().sources.length, 80);
  });
});

test("mixed reprocessing preserves pending tasks and their plans while reusing stable identities", async () => {
  await withStore((store) => {
    const input = {
      sourceName: "course.txt",
      sourceType: "txt",
      text: "7月20日提交项目初稿。7月25日提交项目终稿。",
    };
    const first = item("first", "项目初稿", "2026-07-20T12:00:00.000Z", "course.txt: 7月20日提交项目初稿");
    const second = item("second", "项目终稿", "2026-07-25T12:00:00.000Z", "course.txt: 7月25日提交项目终稿", { estimatedMinutes: 180 });
    let snapshot = store.addItems([first, second], "", [input]);
    const sourceId = snapshot.sources[0].id;
    const persistedFirst = snapshot.items.find((candidate) => candidate.title === "项目初稿");
    const persistedSecond = snapshot.items.find((candidate) => candidate.title === "项目终稿");
    store.saveGeneratedTaskPlan(createRuleTaskPlan(persistedSecond, [], new Date("2026-07-14T08:00:00.000Z")));

    snapshot = store.replaceSourceItems(sourceId, [{
      ...persistedFirst,
      id: "model-new-id",
      title: "课程项目初稿",
      dueAt: "2026-07-20T13:00:00.000Z",
      sourceSummary: "course.txt: 7月20日提交项目初稿",
    }], "已重新识别", { preserveTaskIds: [persistedSecond.id] });

    assert.equal(snapshot.items.some((candidate) => candidate.id === persistedFirst.id && candidate.title === "课程项目初稿"), true);
    assert.equal(snapshot.items.some((candidate) => candidate.id === persistedSecond.id), true);
    assert.ok(store.taskPlanByTaskId(persistedSecond.id));
    const source = snapshot.sources.find((candidate) => candidate.id === sourceId);
    assert.deepEqual(new Set(source.itemIds), new Set(snapshot.items.filter((candidate) => candidate.sourceId === sourceId).map((candidate) => candidate.id)));
  });
});

test("reimport keeps source itemIds bidirectionally consistent and separate sources keep legitimate same-named tasks", async () => {
  await withStore((store) => {
    const input = { sourceName: "same.txt", sourceType: "txt", text: "20日提交 A。21日提交 B。" };
    const a = item("a", "作业 A", "2026-07-20T12:00:00.000Z", "same.txt: 20日提交 A");
    const b = item("b", "作业 B", "2026-07-21T12:00:00.000Z", "same.txt: 21日提交 B");
    store.addItems([a, b], "", [input]);
    const reimported = store.addItems([a], "", [input]);
    const source = reimported.sources.find((candidate) => candidate.sourceName === "same.txt");
    assert.deepEqual(new Set(source.itemIds), new Set(reimported.items.filter((candidate) => candidate.sourceId === source.id).map((candidate) => candidate.id)));
    assert.equal(source.itemIds.length, 2);

    const dueAt = "2026-07-30T12:00:00.000Z";
    store.addItems([item("course-one", "实验报告", dueAt, "course-one.txt: 实验报告")], "", [{ sourceName: "course-one.txt", sourceType: "txt", text: "实验报告" }]);
    const separate = store.addItems([item("course-two", "实验报告", dueAt, "course-two.txt: 实验报告")], "", [{ sourceName: "course-two.txt", sourceType: "txt", text: "实验报告" }]);
    assert.equal(separate.items.filter((candidate) => candidate.title === "实验报告" && candidate.dueAt === dueAt).length, 2);
  });
});

test("corrupt state is preserved and a valid automatic backup is recovered with diagnostics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-store-corruption-"));
  try {
    const store = new ChroniStore(dir);
    store.addItems([item("recover-me", "可恢复任务", "2026-07-20T12:00:00.000Z", "manual")]);
    store.updateItem("recover-me", { progressPercent: 10 });
    writeFileSync(store.filePath, "{ truncated", "utf8");

    const recovered = new ChroniStore(dir);
    const snapshot = recovered.snapshot();
    assert.equal(snapshot.items.some((candidate) => candidate.id === "recover-me"), true);
    assert.equal(snapshot.services.storage, "recovered");
    assert.match(snapshot.services.storageDiagnostic, /自动备份恢复/);
    assert.equal(snapshot.services.storageDiagnostic.includes(dir), false);
    assert.equal(readdirSync(dir).some((name) => name.includes(".corrupt-")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed individual items are skipped without making the whole state unreadable", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-store-malformed-item-"));
  try {
    writeFileSync(join(dir, "chroni-state.json"), JSON.stringify({
      items: [
        item("valid", "有效任务", "2026-07-20T12:00:00.000Z", "历史来源"),
        { id: "bad-date", title: "错误任务", dueAt: "not-a-date" },
        null,
      ],
      sources: [],
      companion: { state: "idle", bubble: "ready" },
    }), "utf8");

    const snapshot = new ChroniStore(dir).snapshot();
    assert.deepEqual(snapshot.items.map((candidate) => candidate.id), ["valid"]);
    assert.equal(snapshot.services.storage, "recovered");
    assert.match(snapshot.services.storageDiagnostic, /跳过 2 条/);
    assert.equal(snapshot.services.storageDiagnostic.includes(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy failed sources with active clarification migrate to pending", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-store-pending-source-"));
  try {
    const pending = pendingDraft("legacy-draft", "课程报告", "legacy.txt: 7月20日提交课程报告");
    const timestamp = "2026-07-14T00:00:00.000Z";
    writeFileSync(join(dir, "chroni-state.json"), JSON.stringify({
      items: [],
      sources: [{
        id: "legacy-source",
        sourceName: "legacy.txt",
        sourceType: "txt",
        text: "7月20日提交课程报告",
        summary: "旧版本识别失败",
        extractionStatus: "failed",
        lastError: "缺少明确截止时间",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastExtractedAt: timestamp,
        itemIds: [],
      }],
      intakeDrafts: [{ ...pending.draft, sourceId: "legacy-source" }],
      clarifications: [{ ...pending.clarification, sourceId: "legacy-source" }],
      companion: { state: "needs_clarification", bubble: "请补充截止时间" },
    }), "utf8");

    const source = new ChroniStore(dir).snapshot().sources[0];
    assert.equal(source.extractionStatus, "pending");
    assert.match(source.summary, /等待确认/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("source pruning keeps every referenced source id even when source contents are identical", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-store-protected-duplicate-source-"));
  try {
    const timestamp = "2026-07-14T00:00:00.000Z";
    writeFileSync(join(dir, "chroni-state.json"), JSON.stringify({
      items: [
        item("left", "左侧任务", "2026-07-20T12:00:00.000Z", "same.txt: 相同原文", { sourceId: "source-left" }),
        item("right", "右侧任务", "2026-07-21T12:00:00.000Z", "same.txt: 相同原文", { sourceId: "source-right" }),
      ],
      sources: ["source-left", "source-right"].map((id) => ({
        id,
        sourceName: "same.txt",
        sourceType: "txt",
        text: "相同原文",
        summary: "历史来源",
        extractionStatus: "success",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastExtractedAt: timestamp,
        itemIds: [],
      })),
      companion: { state: "idle", bubble: "ready" },
    }), "utf8");
    const store = new ChroniStore(dir);
    store.recordSourceFailure(Array.from({ length: 90 }, (_, index) => ({ sourceName: `new-${index}.txt`, sourceType: "txt", text: `内容 ${index}` })), "无日程");

    const sourceIds = new Set(store.snapshot().sources.map((source) => source.id));
    assert.equal(sourceIds.has("source-left"), true);
    assert.equal(sourceIds.has("source-right"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read-only recovery still permits ephemeral companion startup state", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-store-read-only-"));
  try {
    writeFileSync(join(dir, "chroni-state.json"), "{ broken", "utf8");
    chmodSync(dir, 0o500);
    const store = new ChroniStore(dir);

    assert.equal(store.snapshot().services.storage, "read-only");
    assert.doesNotThrow(() => store.setCompanion("idle", "已进入只读恢复模式"));
    assert.equal(store.snapshot().companion.bubble, "已进入只读恢复模式");
    assert.throws(() => store.updatePreferences({ remindersEnabled: false }), /只读保护状态/);
  } finally {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every public snapshot section is render-safe after partial state corruption", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-store-render-safe-"));
  try {
    const timestamp = "2026-07-14T00:00:00.000Z";
    writeFileSync(join(dir, "chroni-state.json"), JSON.stringify({
      items: [item("valid-task", "有效任务", "2026-07-20T12:00:00.000Z", "历史来源")],
      sources: [],
      preferences: {
        companionEnabled: "yes",
        companionStyle: "unknown",
        remindersEnabled: 1,
        quietHoursEnabled: null,
        quietHoursStart: "99:00",
        quietHoursEnd: [],
        hotkey: 42,
        llm: { enabled: "yes", provider: "unknown", baseUrl: null, model: [] },
      },
      companion: { state: "dancing", bubble: null },
      intakeDrafts: [{
        id: "draft-safe",
        sourceName: "broken.txt",
        sourceType: null,
        candidate: { title: "待确认任务", dueAt: "not-a-date", deliverables: "not-an-array" },
        confidence: { title: "high" },
        pendingClarificationIds: "not-an-array",
        status: "needs-clarification",
        createdAt: "bad",
        updatedAt: null,
      }, null],
      clarifications: [{
        id: "clarification-safe",
        draftId: "draft-safe",
        field: "dueAt",
        status: "pending",
        question: null,
        reason: 42,
        options: [{ id: "bad-option" }, { id: "valid-option", label: "下周五", value: "2026-07-17T12:00:00.000Z" }],
        allowFreeText: "yes",
        required: null,
        createdAt: "bad",
      }, { id: "orphan", draftId: "missing", field: "title", status: "pending", options: [] }],
      taskPlans: [{
        id: "plan-safe",
        taskId: "valid-task",
        version: "one",
        goal: null,
        steps: [{ id: "step-safe", taskId: null, title: "完成任务", estimatedMinutes: 60, dependsOn: null }],
        estimatedTotalMinutes: "sixty",
        bufferMinutes: "none",
        plannerSource: "unknown",
        status: "unknown",
        createdAt: "bad",
      }, { id: "orphan-plan", taskId: "missing", version: 1, steps: [] }],
      taskPlanRevisions: [{ id: "revision-safe", taskId: "valid-task", planId: "plan-safe", fromVersion: "bad", toVersion: null, changes: [null], createdAt: "bad" }],
      agent: {
        memory: { maxDailyMinutes: "many", workdayStart: "later", reminderFrequency: "always", automaticInspectionEnabled: "yes" },
        behaviorMemory: { preferences: [null, { id: "bad-preference", key: "unknown" }], recentFeedbackEvents: "bad", learningEnabled: "yes" },
        latestRun: {
          id: "run-safe",
          startedAt: timestamp,
          completedAt: timestamp,
          observation: null,
          priorities: [null],
          actions: [{ tool: "notify", status: "unknown" }],
          suggestions: "bad",
          trace: [{ id: "bad-trace", stage: "unknown", timestamp }],
        },
        appliedPlan: "bad",
        lastAutomaticRunAt: "bad",
        traceHistory: [null, [{ id: "trace-safe", sequence: "one", stage: "observe", timestamp, summary: null, success: "yes", data: { nested: {} } }]],
      },
    }), "utf8");

    const snapshot = new ChroniStore(dir).snapshot();
    assert.equal(snapshot.preferences.companionEnabled, true);
    assert.equal(snapshot.preferences.companionStyle, "classic");
    assert.equal(snapshot.preferences.llm.enabled, false);
    assert.equal(snapshot.companion.state, "idle");
    assert.equal(snapshot.intakeDrafts.length, 1);
    assert.deepEqual(snapshot.intakeDrafts[0].pendingClarificationIds, ["clarification-safe"]);
    assert.equal(snapshot.clarifications.length, 1);
    assert.equal(snapshot.clarifications[0].options.length, 1);
    assert.equal(typeof snapshot.clarifications[0].question, "string");
    assert.equal(snapshot.taskPlans.length, 1);
    assert.equal(snapshot.taskPlans[0].goal.length > 0, true);
    assert.deepEqual(snapshot.taskPlans[0].deliverables, []);
    assert.equal(snapshot.taskPlans[0].steps[0].taskId, "valid-task");
    assert.equal(snapshot.taskPlanRevisions[0].changes.length, 0);
    assert.equal(snapshot.agent.memory.maxDailyMinutes, 240);
    assert.deepEqual(snapshot.agent.behaviorMemory.preferences, []);
    assert.ok(snapshot.agent.latestRun);
    assert.deepEqual(snapshot.agent.latestRun.plan.blocks, []);
    assert.deepEqual(snapshot.agent.latestRun.actions, []);
    assert.doesNotThrow(() => buildAgentDashboard(snapshot.agent.latestRun));
    assert.equal(snapshot.services.storage, "recovered");
    assert.match(snapshot.services.storageDiagnostic, /异常记录|偏好设置|桌宠状态/);
    assert.doesNotThrow(() => JSON.stringify(snapshot));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
