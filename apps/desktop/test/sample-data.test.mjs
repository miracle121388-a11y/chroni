import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { exportRedactedAgentEvidence } from "../dist/agent/evidence-report.js";
import { clearSampleDataStore, createSampleDataStore, SAMPLE_DATA_NAMESPACE } from "../dist/sample-data.js";
import { ensureTaskPlan } from "../dist/intake.js";
import { ChroniStore } from "../dist/store.js";

const now = new Date("2026-08-06T10:00:00+08:00");

test("complete sample data creates a no-key task, evidence, and executable plan", async () => {
  const root = mkdtempSync(join(tmpdir(), "chroni-sample-clear-"));
  try {
    const store = createSampleDataStore(root, undefined, "clear", now);
    const snapshot = store.snapshot();
    assert.equal(snapshot.preferences.llm.enabled, false);
    assert.equal(store.llmSettings().apiKey, "");
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.learningMissions.length, 1);
    assert.deepEqual(snapshot.learningMissions[0].deliverables, ["PDF 报告", "SQL 文件"]);
    assert.deepEqual(snapshot.items[0].extraction.deliverables, ["PDF 报告", "SQL 文件"]);
    assert.match(snapshot.sources[0].text, /数据库系统/);

    const plan = await ensureTaskPlan(snapshot.items[0].id, store, true, "rules-only");
    assert.ok(plan.steps.length >= 3);
    assert.equal(plan.plannerSource, "rules");
    assert.ok(plan.steps.every((step) => step.estimatedMinutes > 0));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clarification sample preserves known deliverables and asks only for the missing due time", () => {
  const root = mkdtempSync(join(tmpdir(), "chroni-sample-clarification-"));
  try {
    const store = createSampleDataStore(root, undefined, "clarification", now);
    let snapshot = store.snapshot();
    assert.equal(snapshot.items.length, 0);
    assert.equal(snapshot.intakeDrafts[0].candidate.title, "课程展示材料提交");
    assert.deepEqual(snapshot.intakeDrafts[0].candidate.deliverables, ["展示材料", "演示视频"]);
    assert.equal(snapshot.clarifications.length, 1);
    assert.equal(snapshot.clarifications[0].field, "dueAt");
    assert.equal(snapshot.clarifications[0].required, true);

    const result = store.answerClarification(snapshot.clarifications[0].id, { value: "2026-08-14T10:00:00+08:00" });
    snapshot = result.snapshot;
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].title, "课程展示材料提交");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("conflict sample retains conflicting evidence until the user chooses a source", () => {
  const root = mkdtempSync(join(tmpdir(), "chroni-sample-conflict-"));
  try {
    const store = createSampleDataStore(root, undefined, "conflict", now);
    const pending = store.snapshot().clarifications[0];
    assert.equal(pending.options.length, 2);
    assert.match(pending.reason, /不会自行覆盖原始截止时间/);
    assert.match(store.snapshot().sources[0].text, /周五 18:00/);
    assert.match(store.snapshot().sources[0].text, /周日 22:00/);

    const result = store.answerClarification(pending.id, { optionId: "announcement-sunday" });
    assert.equal(result.snapshot.items.length, 1);
    assert.equal(new Date(result.snapshot.items[0].dueAt).getDay(), 0);
    assert.equal(new Date(result.snapshot.items[0].dueAt).getHours(), 22);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sample data namespace never changes the primary store and is removable", () => {
  const root = mkdtempSync(join(tmpdir(), "chroni-sample-isolation-"));
  try {
    const primary = new ChroniStore(root);
    primary.addItems([{
      id: "primary-task",
      title: "用户正式任务",
      importance: "medium",
      dueAt: "2026-08-20T12:00:00.000Z",
      sourceSummary: "正式数据",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completed: false,
    }], "已添加正式任务");
    const before = readFileSync(primary.filePath, "utf8");

    createSampleDataStore(root, undefined, "clear", now);
    assert.equal(readFileSync(primary.filePath, "utf8"), before);
    assert.equal(new ChroniStore(root).snapshot().items[0].title, "用户正式任务");
    assert.equal(existsSync(join(root, SAMPLE_DATA_NAMESPACE, "chroni-state.json")), true);

    clearSampleDataStore(root);
    assert.equal(existsSync(join(root, SAMPLE_DATA_NAMESPACE)), false);
    assert.equal(readFileSync(primary.filePath, "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("redacted evidence export is reproducible and excludes private task content", async () => {
  const root = mkdtempSync(join(tmpdir(), "chroni-sample-evidence-"));
  try {
    const store = createSampleDataStore(root, undefined, "clear", now);
    const task = store.snapshot().items[0];
    const plan = await ensureTaskPlan(task.id, store, true, "rules-only");
    store.activateTaskPlan(task.id, plan.id);
    const mission = store.snapshot().learningMissions[0];
    store.addLearningMissionEvidence(mission.id, { kind: "note", title: "private evidence title", note: "private evidence body", linkedDeliverable: "PDF 报告" });
    store.recordLearningMissionCheckpoint(mission.id, { status: "on-track", summary: "private checkpoint summary", actualMinutes: 30 });
    const result = exportRedactedAgentEvidence(store.snapshot(), store.agentTraceHistory(), join(root, "exports"), {
      version: "0.1.4-test",
      platform: "win32",
      architecture: "x64",
      petAssetMode: "original",
      demoScenario: "clear",
    }, now);
    const json = readFileSync(result.jsonPath, "utf8");
    const markdown = readFileSync(result.markdownPath, "utf8");
    assert.match(json, /chroni-evidence-v1/);
    assert.match(json, /"redacted": true/);
    assert.match(json, /"learningMissionCount": 1/);
    assert.match(json, /"missionEvidenceCount": 1/);
    assert.match(json, /"missionCheckpointCount": 1/);
    assert.match(markdown, /Integrity SHA-256/);
    assert.equal(json.includes("数据库系统课程作业三"), false);
    assert.equal(json.includes("示例-A-数据库作业通知.txt"), false);
    assert.equal(json.includes("apiKey"), false);
    assert.equal(json.includes("private evidence title"), false);
    assert.equal(json.includes("private checkpoint summary"), false);
    assert.equal(json.includes(store.filePath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
