import type { AgentPlan, AgentRunResult, AgentTaskAssessment, AgentVerification } from "../shared/types.js";

export function verificationStatus(result: Pick<AgentVerification, "unresolvedHighRiskTaskIds" | "unplannedPriorityTaskIds" | "capacityOverflowMinutes">): AgentVerification["status"] {
  if (result.unresolvedHighRiskTaskIds.length && result.unplannedPriorityTaskIds.length) return "critical";
  if (result.unresolvedHighRiskTaskIds.length || result.unplannedPriorityTaskIds.length || result.capacityOverflowMinutes > 0) return "attention";
  return "healthy";
}

export function cloneAgentRun(result: AgentRunResult): AgentRunResult {
  return structuredClone(result);
}

export function verifyAgentPlan(assessments: AgentTaskAssessment[], plan: AgentPlan): AgentVerification {
  const coverage = plan.coverage ?? assessments.map((item) => ({ taskId: item.taskId, requiredMinutes: item.estimatedMinutes, allocatedMinutes: 0, coveragePercent: 0 }));
  const highRiskTaskIds = assessments.filter(isHighRisk).map((item) => item.taskId);
  const highRiskCoverage = coverage.filter((item) => highRiskTaskIds.includes(item.taskId));
  const mitigatedHighRiskTaskIds = highRiskCoverage.filter((item) => item.allocatedMinutes >= item.requiredMinutes).map((item) => item.taskId);
  const unresolvedHighRiskTaskIds = highRiskCoverage.filter((item) => item.allocatedMinutes < item.requiredMinutes).map((item) => item.taskId);
  const zeroCoveredHighRisk = highRiskCoverage.some((item) => item.allocatedMinutes === 0 && item.requiredMinutes > 0);
  const allocated = coverage.reduce((sum, item) => sum + item.allocatedMinutes, 0);
  const required = coverage.reduce((sum, item) => sum + item.requiredMinutes, 0);
  const coveragePercent = required ? Math.min(100, Math.round(allocated / required * 100)) : 100;
  const unplannedPriorityTaskIds = plan.unplannedTaskIds.filter((id) => highRiskTaskIds.includes(id));
  const status: AgentVerification["status"] = zeroCoveredHighRisk
    ? "critical"
    : unresolvedHighRiskTaskIds.length || plan.overflowMinutes > 0
      ? "attention"
      : "healthy";
  return {
    status,
    highRiskTaskIds,
    mitigatedHighRiskTaskIds,
    unresolvedHighRiskTaskIds,
    unplannedPriorityTaskIds,
    capacityOverflowMinutes: plan.overflowMinutes,
    coveragePercent,
    summary: status === "healthy"
      ? "复查完成：高风险任务已被当前计划覆盖。"
      : status === "critical"
        ? "复查发现仍有高风险任务没有获得有效工作时间。"
        : `复查完成：当前计划覆盖 ${coveragePercent}%，仍需关注容量缺口。`,
  };
}

function isHighRisk(item: AgentTaskAssessment): boolean {
  return item.riskLevel === "high" || item.riskLevel === "critical";
}
