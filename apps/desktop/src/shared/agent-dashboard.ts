import type { AgentRunResult, AgentTaskAssessment, AgentWorkBlock } from "./types.js";

export type AgentDashboard = {
  highRiskCount: number;
  attentionTasks: AgentTaskAssessment[];
  todayBlocks: AgentWorkBlock[];
  suggestions: string[];
  failedActionCount: number;
  coveragePercent: number;
};

export function buildAgentDashboard(latest?: AgentRunResult): AgentDashboard {
  if (!latest) {
    return {
      highRiskCount: 0,
      attentionTasks: [],
      todayBlocks: [],
      suggestions: [],
      failedActionCount: 0,
      coveragePercent: 0,
    };
  }

  const attentionTasks = latest.priorities
    .filter((item) => item.riskLevel === "high" || item.riskLevel === "critical")
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const highRiskCount = latest.priorities.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical").length;
  const todayBlocks = [...latest.plan.blocks]
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
    .slice(0, 4);
  const suggestions = [...new Set(latest.suggestions.map(humanizeSuggestion).filter(Boolean))].slice(0, 3);

  return {
    highRiskCount,
    attentionTasks,
    todayBlocks,
    suggestions,
    failedActionCount: latest.actions.filter((action) => action.status === "failed").length,
    coveragePercent: Math.max(0, Math.min(100, Math.round(latest.verification.coveragePercent ?? 0))),
  };
}

function humanizeSuggestion(value: string): string {
  return value
    .trim()
    .replace(/风险等级为 critical\b/gi, "风险等级为严重")
    .replace(/风险等级为 high\b/gi, "风险等级为高")
    .replace(/风险等级为 medium\b/gi, "风险等级为中")
    .replace(/风险等级为 low\b/gi, "风险等级为低");
}
