import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentDashboard } from "../dist/shared/agent-dashboard.js";

function runFixture() {
  return {
    id: "run-1",
    startedAt: "2026-07-14T00:00:00.000Z",
    completedAt: "2026-07-14T00:01:00.000Z",
    observation: { observedAt: "2026-07-14T00:00:00.000Z", totalCount: 8, incompleteCount: 7, activeCount: 6, snoozedCount: 1, overdueCount: 1, activeTasks: [] },
    priorities: [
      { taskId: "critical", title: "马上提交课程报告", dueAt: "2026-07-14T03:00:00.000Z", importance: "high", riskLevel: "critical", score: 100, estimatedMinutes: 90, reasons: ["已经逾期"] },
      { taskId: "high-1", title: "准备演示", dueAt: "2026-07-14T08:00:00.000Z", importance: "high", riskLevel: "high", score: 90, estimatedMinutes: 60, reasons: ["剩余时间不足"] },
      { taskId: "high-2", title: "复习考试", dueAt: "2026-07-15T08:00:00.000Z", importance: "medium", riskLevel: "high", score: 80, estimatedMinutes: 120, reasons: ["工作量较大"] },
      { taskId: "high-3", title: "不应出现在首屏", dueAt: "2026-07-16T08:00:00.000Z", importance: "medium", riskLevel: "high", score: 70, estimatedMinutes: 120, reasons: ["容量紧张"] },
      { taskId: "low", title: "低风险杂项", dueAt: "2026-07-20T08:00:00.000Z", importance: "low", riskLevel: "low", score: 10, estimatedMinutes: 20, reasons: ["暂无风险"] },
    ],
    plan: {
      blocks: [
        { taskId: "b5", title: "第五段", startAt: "2026-07-14T13:00:00.000Z", endAt: "2026-07-14T13:30:00.000Z", allocatedMinutes: 30 },
        { taskId: "b1", title: "第一段", startAt: "2026-07-14T08:00:00.000Z", endAt: "2026-07-14T08:30:00.000Z", allocatedMinutes: 30 },
        { taskId: "b2", title: "第二段", startAt: "2026-07-14T09:00:00.000Z", endAt: "2026-07-14T09:30:00.000Z", allocatedMinutes: 30 },
        { taskId: "b3", title: "第三段", startAt: "2026-07-14T10:00:00.000Z", endAt: "2026-07-14T10:30:00.000Z", allocatedMinutes: 30 },
        { taskId: "b4", title: "第四段", startAt: "2026-07-14T11:00:00.000Z", endAt: "2026-07-14T11:30:00.000Z", allocatedMinutes: 30 },
      ],
      plannedMinutes: 150,
      overflowMinutes: 0,
      unplannedTaskIds: [],
    },
    actions: [{ tool: "notify", status: "failed", summary: "通知不可用" }],
    verification: { status: "critical", unresolvedHighRiskTaskIds: ["critical"], unplannedPriorityTaskIds: [], capacityOverflowMinutes: 0, summary: "有任务需要立即处理", coveragePercent: 72 },
    suggestions: ["优先处理课程报告，风险等级为 high。", "优先处理课程报告，风险等级为 high。", "将复习拆成两段", "稍后整理资料", "不应显示的第四条"],
    trace: [],
  };
}

test("Agent dashboard keeps the first screen focused on urgent and actionable information", () => {
  const dashboard = buildAgentDashboard(runFixture());
  assert.equal(dashboard.highRiskCount, 4);
  assert.deepEqual(dashboard.attentionTasks.map((item) => item.taskId), ["critical", "high-1", "high-2"]);
  assert.deepEqual(dashboard.todayBlocks.map((item) => item.taskId), ["b1", "b2", "b3", "b4"]);
  assert.deepEqual(dashboard.suggestions, ["优先处理课程报告，风险等级为高。", "将复习拆成两段", "稍后整理资料"]);
  assert.equal(dashboard.failedActionCount, 1);
  assert.equal(dashboard.coveragePercent, 72);
});

test("Agent dashboard has useful defaults before the first inspection", () => {
  assert.deepEqual(buildAgentDashboard(undefined), {
    highRiskCount: 0,
    attentionTasks: [],
    todayBlocks: [],
    suggestions: [],
    failedActionCount: 0,
    coveragePercent: 0,
  });
});
