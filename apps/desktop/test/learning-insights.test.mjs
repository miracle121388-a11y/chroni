import assert from "node:assert/strict";
import test from "node:test";

import { buildLearningInsights } from "../dist/shared/learning-insights.js";

function review(date, { total = 4, completed = 4, planned = 180, completedMinutes = 180 } = {}) {
  return {
    date,
    summary: "合成回顾",
    note: "",
    totalTasks: total,
    completedTasks: completed,
    plannedMinutes: planned,
    completedMinutes,
    unfinishedTaskTitles: completed < total ? ["待延续任务"] : [],
    createdAt: `${date}T20:00:00.000Z`,
    updatedAt: `${date}T20:00:00.000Z`,
  };
}

test("continuous reviews expose completion, procrastination proxy and rhythm changes", () => {
  const now = new Date(2026, 8, 1, 21, 0);
  const reviews = [];
  for (let offset = 13; offset >= 7; offset -= 1) reviews.push(review(dateKey(addDays(now, -offset)), { completed: 2, planned: 300, completedMinutes: 150 }));
  for (let offset = 6; offset >= 0; offset -= 1) reviews.push(review(dateKey(addDays(now, -offset)), {
    completed: offset < 4 ? 4 : 3,
    planned: 180,
    completedMinutes: offset < 4 ? 180 : 135,
  }));

  const insights = buildLearningInsights(reviews, 240, now);
  assert.equal(insights.recordedDays, 7);
  assert.equal(insights.comparisonDays, 7);
  assert.equal(insights.streakDays, 14);
  assert.equal(insights.trendStatus, "improving");
  assert.equal(insights.completionRateChange > 30, true);
  assert.equal(insights.carryoverImprovement > 50, true);
  assert.equal(insights.rhythmBalanceScore, 100);
});

test("repeated under-execution produces a smaller next planning capacity and rescue advice", () => {
  const now = new Date(2026, 8, 1, 21, 0);
  const reviews = [
    review(dateKey(now), { completed: 1, planned: 240, completedMinutes: 60 }),
    review(dateKey(addDays(now, -1)), { completed: 1, planned: 240, completedMinutes: 60 }),
  ];

  const insights = buildLearningInsights(reviews, 240, now);
  assert.equal(insights.recommendedPlanningCapacity, 165);
  assert.equal(insights.recommendations.some((item) => item.includes("15 分钟最小步骤")), true);
  assert.equal(insights.carryoverRate, 100);
});

function addDays(value, amount) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount);
}

function dateKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
