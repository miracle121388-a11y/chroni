import type { DdlItem, Importance } from "./types.js";

export type TaskPrioritySignals = {
  effectiveImportance: Importance;
  semanticScore: number;
  progressScore: number;
  effortScore: number;
  totalScore: number;
  reasons: string[];
};

const importanceRank: Record<Importance, number> = { low: 0, medium: 1, high: 2 };

/**
 * Infers stakes from the task itself. This deliberately does not infer a date:
 * semantic ranking may be approximate, while calendar creation must stay
 * grounded in explicit source-time evidence.
 */
export function inferImportanceFromText(text: string): Importance {
  if (/(?:期末|期中|考试|考核|答辩|毕业|论文(?:终稿|定稿|提交)|final\s*(?:exam|project|paper)?|升学|奖学金|保研|面试|录取|必须|务必|强制|紧急|重要|逾期)/i.test(text)) return "high";
  if (/(?:课程|作业|报告|项目|论文|实验|测验|小测|汇报|展示|路演|比赛|申请|报名|提交|上交|交付|发送|上传|会议|presentation|assignment|report|project|quiz|essay|paper|submit|turn\s*in)/i.test(text)) return "medium";
  return "low";
}

export function strongerImportance(left: Importance, right: Importance): Importance {
  return importanceRank[left] >= importanceRank[right] ? left : right;
}

export function taskPrioritySignals(item: Pick<DdlItem, "title" | "sourceSummary" | "extraction" | "importance" | "dueAt" | "estimatedMinutes" | "progressPercent">, now = new Date()): TaskPrioritySignals {
  const context = [
    item.title,
    item.sourceSummary,
    item.extraction?.contextExcerpt,
    ...(item.extraction?.constraints ?? []),
    ...(item.extraction?.risks ?? []),
  ].filter(Boolean).join(" ");
  const inferred = inferImportanceFromText(context);
  const effectiveImportance = strongerImportance(item.importance, inferred);
  const reasons: string[] = [];
  let semanticScore = effectiveImportance === "high" ? 52 : effectiveImportance === "medium" ? 26 : 8;

  if (/(?:期末|期中|考试|考核|答辩|毕业|final\s*(?:exam|project|paper)?)/i.test(context)) {
    semanticScore += 24;
    reasons.push("影响课程考核或关键学业结果");
  } else if (/(?:课程|作业|实验|论文|测验|小测|quiz|assignment|essay|paper)/i.test(context)) {
    semanticScore += 12;
    reasons.push("属于正式学习任务");
  }
  if (/(?:必须|务必|强制|紧急|重要|逾期)/i.test(context)) {
    semanticScore += 12;
    reasons.push("原文包含强约束或紧急信号");
  }

  const dueTime = new Date(item.dueAt).getTime();
  const hoursRemaining = (dueTime - now.getTime()) / 3_600_000;
  const progress = typeof item.progressPercent === "number" ? Math.max(0, Math.min(100, item.progressPercent)) : undefined;
  let progressScore = 0;
  if (progress !== undefined && hoursRemaining <= 72 && progress < 100) {
    if (progress <= 25) progressScore = hoursRemaining <= 24 ? 34 : 24;
    else if (progress <= 50) progressScore = hoursRemaining <= 24 ? 22 : 14;
    else if (progress <= 75) progressScore = 8;
    if (progressScore) reasons.push(`当前仅完成 ${Math.round(progress)}%`);
  }

  let effortScore = 0;
  if (typeof item.estimatedMinutes === "number" && item.estimatedMinutes > 0 && Number.isFinite(hoursRemaining) && hoursRemaining > 0) {
    const remainingMinutes = Math.ceil(item.estimatedMinutes * (100 - (progress ?? 0)) / 100);
    const wallClockMinutes = hoursRemaining * 60;
    const pressure = remainingMinutes / Math.max(30, wallClockMinutes);
    effortScore = pressure >= 0.5 ? 24 : pressure >= 0.25 ? 16 : pressure >= 0.1 ? 8 : 0;
    if (effortScore >= 16) reasons.push("剩余工作量与可用时间不匹配");
  }

  return {
    effectiveImportance,
    semanticScore,
    progressScore,
    effortScore,
    totalScore: deadlineScore(hoursRemaining) + semanticScore + progressScore + effortScore,
    reasons,
  };
}

function deadlineScore(hoursRemaining: number): number {
  if (!Number.isFinite(hoursRemaining)) return 0;
  if (hoursRemaining < 0) return 600;
  if (hoursRemaining <= 6) return 300;
  if (hoursRemaining <= 12) return 250;
  if (hoursRemaining <= 24) return 200;
  if (hoursRemaining <= 48) return 145;
  if (hoursRemaining <= 72) return 110;
  if (hoursRemaining <= 168) return 55;
  if (hoursRemaining <= 336) return 20;
  return 0;
}
