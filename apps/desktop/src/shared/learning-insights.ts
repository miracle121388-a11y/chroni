import type { DailyReview } from "./types.js";

export type LearningTrendStatus = "collecting" | "improving" | "stable" | "declining";

export type LearningInsights = {
  windowDays: 7;
  recordedDays: number;
  comparisonDays: number;
  streakDays: number;
  completionRate: number;
  completionRateChange?: number;
  executionEfficiency: number;
  executionEfficiencyChange?: number;
  carryoverRate: number;
  carryoverImprovement?: number;
  rhythmBalanceScore: number;
  overloadedDays: number;
  recommendedPlanningCapacity: number;
  trendStatus: LearningTrendStatus;
  recommendations: string[];
};

type WindowMetrics = {
  recordedDays: number;
  taskDays: number;
  completionRate: number;
  executionEfficiency: number;
  carryoverRate: number;
  rhythmBalanceScore: number;
  overloadedDays: number;
};

export function buildLearningInsights(reviews: DailyReview[], configuredCapacity: number, now = new Date()): LearningInsights {
  const capacity = Math.max(30, Math.round(configuredCapacity || 240));
  const today = startOfDay(now);
  const current = reviewsInRange(reviews, addDays(today, -6), today);
  const previous = reviewsInRange(reviews, addDays(today, -13), addDays(today, -7));
  const currentMetrics = windowMetrics(current, capacity);
  const previousMetrics = windowMetrics(previous, capacity);
  const hasComparison = previousMetrics.recordedDays > 0 && previousMetrics.taskDays > 0;
  const completionRateChange = hasComparison ? currentMetrics.completionRate - previousMetrics.completionRate : undefined;
  const executionEfficiencyChange = hasComparison ? currentMetrics.executionEfficiency - previousMetrics.executionEfficiency : undefined;
  const carryoverImprovement = hasComparison ? previousMetrics.carryoverRate - currentMetrics.carryoverRate : undefined;
  const recommendedPlanningCapacity = adaptiveCapacity(capacity, currentMetrics);
  const trendStatus = trendStatusFor(completionRateChange, executionEfficiencyChange, carryoverImprovement, currentMetrics.recordedDays);
  const recommendations = insightRecommendations(currentMetrics, recommendedPlanningCapacity, capacity, hasComparison);

  return {
    windowDays: 7,
    recordedDays: currentMetrics.recordedDays,
    comparisonDays: previousMetrics.recordedDays,
    streakDays: reviewStreak(reviews, today),
    completionRate: currentMetrics.completionRate,
    ...(completionRateChange !== undefined ? { completionRateChange } : {}),
    executionEfficiency: currentMetrics.executionEfficiency,
    ...(executionEfficiencyChange !== undefined ? { executionEfficiencyChange } : {}),
    carryoverRate: currentMetrics.carryoverRate,
    ...(carryoverImprovement !== undefined ? { carryoverImprovement } : {}),
    rhythmBalanceScore: currentMetrics.rhythmBalanceScore,
    overloadedDays: currentMetrics.overloadedDays,
    recommendedPlanningCapacity,
    trendStatus,
    recommendations,
  };
}

function windowMetrics(reviews: DailyReview[], capacity: number): WindowMetrics {
  const taskDays = reviews.filter((review) => review.totalTasks > 0);
  const totalTasks = taskDays.reduce((sum, review) => sum + review.totalTasks, 0);
  const completedTasks = taskDays.reduce((sum, review) => sum + review.completedTasks, 0);
  const plannedMinutes = taskDays.reduce((sum, review) => sum + Math.max(0, review.plannedMinutes), 0);
  const completedMinutes = taskDays.reduce((sum, review) => sum + Math.max(0, review.completedMinutes), 0);
  const carryoverDays = taskDays.filter((review) => review.unfinishedTaskTitles.length > 0 || review.completedTasks < review.totalTasks).length;
  const overloadedDays = taskDays.filter((review) => review.plannedMinutes > capacity).length;
  const planned = taskDays.map((review) => Math.max(0, review.plannedMinutes));
  const spread = planned.length > 1 ? Math.max(...planned) - Math.min(...planned) : 0;
  const overloadPenalty = taskDays.length ? Math.round(overloadedDays / taskDays.length * 55) : 0;
  const variationPenalty = Math.min(35, Math.round(spread / capacity * 25));
  return {
    recordedDays: reviews.length,
    taskDays: taskDays.length,
    completionRate: percent(completedTasks, totalTasks),
    executionEfficiency: percent(Math.min(completedMinutes, plannedMinutes), plannedMinutes),
    carryoverRate: percent(carryoverDays, taskDays.length),
    rhythmBalanceScore: taskDays.length ? Math.max(0, 100 - overloadPenalty - variationPenalty) : 0,
    overloadedDays,
  };
}

function adaptiveCapacity(configuredCapacity: number, metrics: WindowMetrics): number {
  if (metrics.recordedDays < 2 || metrics.taskDays < 2) return configuredCapacity;
  let factor = 1;
  if (metrics.executionEfficiency < 50 || metrics.completionRate < 50) factor = 0.7;
  else if (metrics.executionEfficiency < 70 || metrics.completionRate < 70) factor = 0.85;
  if (metrics.carryoverRate >= 60) factor = Math.min(factor, 0.75);
  if (metrics.overloadedDays >= 2) factor = Math.min(factor, 0.8);
  return Math.max(30, Math.min(configuredCapacity, Math.floor(configuredCapacity * factor / 15) * 15));
}

function insightRecommendations(metrics: WindowMetrics, recommended: number, configured: number, hasComparison: boolean): string[] {
  if (!metrics.recordedDays) return ["完成今天的日程后保存一次回顾，Chroni 将从本机数据建立个人基线。"];
  const recommendations: string[] = [];
  if (recommended < configured) recommendations.push(`下轮自动规划暂按每天 ${recommended} 分钟收敛，避免继续超排；完成率恢复后再放宽。`);
  if (metrics.carryoverRate >= 50) recommendations.push("未完成计划触发“重新启动”：先安排 15 分钟最小步骤，再根据实际进度重排剩余工作。");
  if (metrics.overloadedDays > 0) recommendations.push(`最近 7 天有 ${metrics.overloadedDays} 天超出设定容量，优先移走低重要性任务并保留截止缓冲。`);
  if (metrics.executionEfficiency >= 80 && metrics.completionRate >= 80) recommendations.push("当前执行节奏稳定，保持现有容量，并继续优先覆盖高学业影响任务。");
  if (!hasComparison && metrics.recordedDays < 7) recommendations.push(`再记录 ${7 - metrics.recordedDays} 天即可形成首个完整的前后 7 天对照。`);
  return recommendations.slice(0, 3);
}

function trendStatusFor(completion?: number, efficiency?: number, carryover?: number, recordedDays = 0): LearningTrendStatus {
  if (recordedDays < 2 || completion === undefined || efficiency === undefined || carryover === undefined) return "collecting";
  const signal = completion + efficiency + carryover;
  if (signal >= 12) return "improving";
  if (signal <= -12) return "declining";
  return "stable";
}

function reviewsInRange(reviews: DailyReview[], from: Date, to: Date): DailyReview[] {
  const fromKey = dateKey(from);
  const toKey = dateKey(to);
  return reviews.filter((review) => review.date >= fromKey && review.date <= toKey);
}

function reviewStreak(reviews: DailyReview[], today: Date): number {
  const keys = new Set(reviews.map((review) => review.date));
  let cursor = keys.has(dateKey(today)) ? today : addDays(today, -1);
  let streak = 0;
  while (keys.has(dateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round(numerator / denominator * 100) : 0;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount);
}

function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
