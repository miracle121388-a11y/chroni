import type { AgentRunResult, AgentVerification } from "../shared/types.js";

export function verificationStatus(result: Pick<AgentVerification, "unresolvedHighRiskTaskIds" | "unplannedPriorityTaskIds" | "capacityOverflowMinutes">): AgentVerification["status"] {
  if (result.unresolvedHighRiskTaskIds.length && result.unplannedPriorityTaskIds.length) return "critical";
  if (result.unresolvedHighRiskTaskIds.length || result.unplannedPriorityTaskIds.length || result.capacityOverflowMinutes > 0) return "attention";
  return "healthy";
}

export function cloneAgentRun(result: AgentRunResult): AgentRunResult {
  return structuredClone(result);
}
