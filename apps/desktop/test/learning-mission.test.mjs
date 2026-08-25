import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRuleTaskPlan } from "../dist/agent/task-plan-agent.js";
import { ChroniStore } from "../dist/store.js";

function task() {
  const now = new Date().toISOString();
  return {
    id: "database-project",
    title: "数据库课程项目",
    importance: "high",
    dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    sourceSummary: "课程通知要求提交 PDF 报告和 SQL 文件",
    createdAt: now,
    updatedAt: now,
    completed: false,
    progressPercent: 10,
    extraction: {
      contextExcerpt: "请提交 PDF 报告和 SQL 文件，报告须包含关系模式、查询结果和实验截图。",
      deliverables: ["PDF 报告", "SQL 文件"],
      submissionMethod: "课程平台",
      constraints: ["报告包含关系模式、查询结果和实验截图"],
      risks: [],
      uncertainties: [],
      reminderSuggestions: [],
    },
  };
}

test("a grounded learning mission is synchronized from source evidence and the active plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-learning-mission-"));
  try {
    const store = new ChroniStore(dir);
    store.addItems([task()], "任务已建立", [{ sourceName: "数据库作业说明.txt", sourceType: "text/plain", text: "请提交 PDF 报告和 SQL 文件" }]);
    const item = store.snapshot().items[0];
    const generated = store.saveGeneratedTaskPlan(createRuleTaskPlan(item, [], new Date()));
    store.activateTaskPlan(item.id, generated.plan.id);

    const mission = store.snapshot().learningMissions[0];
    assert.equal(mission.taskId, item.id);
    assert.equal(mission.sourceName, "数据库作业说明.txt");
    assert.deepEqual(mission.deliverables, ["PDF 报告", "SQL 文件"]);
    assert.ok(mission.milestones.length >= 2);
    assert.ok(mission.successCriteria.some((criterion) => criterion.includes("实验截图")));
    assert.equal(mission.plannerSource, "rules");
    assert.equal(mission.nextAction, mission.milestones[0].title);
    store.recordLearningMissionCheckpoint(mission.id, {
      status: "completed",
      summary: "已完成第一个里程碑",
      milestoneId: mission.milestones[0].id,
      actualMinutes: 35,
    });
    const advanced = store.snapshot();
    assert.equal(advanced.taskPlans.find((candidate) => candidate.status === "active").steps[0].status, "completed");
    assert.equal(advanced.learningMissions[0].milestones[0].status, "completed");
    assert.ok(advanced.learningMissions[0].progressPercent > mission.progressPercent);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evidence and checkpoints persist while local paths never enter the state file", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-learning-evidence-"));
  try {
    const store = new ChroniStore(dir);
    store.addItems([task()]);
    const mission = store.snapshot().learningMissions[0];
    store.addLearningMissionEvidence(mission.id, {
      kind: "file",
      title: "report.pdf",
      linkedDeliverable: "PDF 报告",
      bytes: 2048,
      sha256: "a".repeat(64),
      modifiedAt: new Date().toISOString(),
      path: "D:\\private\\report.pdf",
    });
    store.recordLearningMissionCheckpoint(mission.id, {
      status: "blocked",
      summary: "完成关系模式设计，查询结果仍需验证",
      actualMinutes: 75,
      blocker: "测试数据库暂时不可用",
      reflection: "恢复后先运行最小查询集",
    });

    const reloaded = new ChroniStore(dir).snapshot().learningMissions[0];
    assert.equal(reloaded.evidence.length, 1);
    assert.equal(reloaded.evidence[0].sha256, "a".repeat(64));
    assert.equal(reloaded.evidenceCoveragePercent, 50);
    assert.equal(reloaded.checkpoints[0].actualMinutes, 75);
    assert.equal(reloaded.status, "at-risk");
    assert.match(reloaded.nextAction, /测试数据库暂时不可用/);
    assert.doesNotMatch(readFileSync(store.filePath, "utf8"), /D:\\\\private/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("learning mission lifecycle follows the source task without leaving orphan records", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-learning-lifecycle-"));
  try {
    const store = new ChroniStore(dir);
    store.addItems([task()]);
    assert.equal(store.snapshot().learningMissions.length, 1);
    store.updateItem("database-project", { completed: true, progressPercent: 100 });
    assert.equal(store.snapshot().learningMissions[0].status, "completed");
    store.deleteItem("database-project");
    assert.equal(store.snapshot().learningMissions.length, 0);
    assert.equal(new ChroniStore(dir).snapshot().learningMissions.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
