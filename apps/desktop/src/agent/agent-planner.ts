import { requestChatCompletion } from "../llm-client.js";
import type { AgentMemory, AgentPlan, AgentTaskAssessment, ChroniLlmSettings } from "../shared/types.js";
import { planCoverage } from "./agent-tools.js";

export type AgentPlannerProposal = {
  allocations: Array<{ taskId: string; minutes: number }>;
  suggestions: string[];
};

export type AgentPlanningContext = {
  assessments: AgentTaskAssessment[];
  memory: AgentMemory;
  initialPlan: AgentPlan;
  now: Date;
};

export type AgentPlannerResult = {
  proposal?: AgentPlannerProposal;
  fallbackReason?: "unavailable" | "invalid-response" | "request-failed";
};

export type AgentPlanner = {
  propose(context: AgentPlanningContext): Promise<AgentPlannerResult>;
};

export function createLlmAgentPlanner(settings: ChroniLlmSettings, fetchImpl?: typeof fetch): AgentPlanner {
  return {
    async propose(context) {
      try {
        const content = await requestChatCompletion(settings, [
          {
            role: "system",
            content: [
              "你是 Chroni Deadline Agent 的受约束规划器。",
              "只输出 JSON：{\"allocations\":[{\"taskId\":\"...\",\"minutes\":60}],\"suggestions\":[\"简短建议\"]}。",
              "只能使用输入中的 taskId；每项至少 15 分钟；不得超过任务剩余工时或今日容量。",
              "suggestions 最多 3 条，每条不超过 120 个字符。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              now: context.now.toISOString(),
              capacityMinutes: availableCapacity(context.memory, context.now),
              tasks: context.assessments.slice(0, 32).map((item) => ({
                taskId: item.taskId,
                title: item.title.slice(0, 80),
                dueAt: item.dueAt,
                riskLevel: item.riskLevel,
                score: item.score,
                remainingMinutes: item.estimatedMinutes,
                reasons: item.reasons.slice(0, 3),
              })),
            }),
          },
        ], {
          fetchImpl,
          body: { temperature: 0.1, max_tokens: 1_500, response_format: { type: "json_object" } },
        });
        let parsed: unknown;
        try {
          parsed = JSON.parse(content) as unknown;
        } catch {
          return { fallbackReason: "invalid-response" };
        }
        const proposal = validateProposal(parsed, context);
        return proposal ? { proposal } : { fallbackReason: "invalid-response" };
      } catch {
        return { fallbackReason: "request-failed" };
      }
    },
  };
}

export function planFromProposal(proposal: AgentPlannerProposal, context: AgentPlanningContext): AgentPlan {
  const start = new Date(Math.max(context.now.getTime(), atLocalClock(context.now, context.memory.workdayStart).getTime()));
  let cursor = start;
  const byId = new Map(context.assessments.map((item) => [item.taskId, item]));
  const blocks = proposal.allocations.map((allocation) => {
    const item = byId.get(allocation.taskId)!;
    const end = new Date(cursor.getTime() + allocation.minutes * 60_000);
    const block = { taskId: item.taskId, title: item.title, startAt: cursor.toISOString(), endAt: end.toISOString(), allocatedMinutes: allocation.minutes };
    cursor = end;
    return block;
  });
  const requestedMinutes = context.assessments.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const plannedMinutes = blocks.reduce((sum, block) => sum + block.allocatedMinutes, 0);
  const coverage = planCoverage(context.assessments, blocks);
  return {
    blocks,
    requestedMinutes,
    plannedMinutes,
    overflowMinutes: Math.max(0, requestedMinutes - plannedMinutes),
    unplannedTaskIds: coverage.filter((item) => item.allocatedMinutes < item.requiredMinutes).map((item) => item.taskId),
    plannerSource: "llm",
    coverage,
  };
}

function validateProposal(value: unknown, context: AgentPlanningContext): AgentPlannerProposal | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.allocations) || !Array.isArray(record.suggestions)) return undefined;
  const byId = new Map(context.assessments.map((item) => [item.taskId, item]));
  const seen = new Set<string>();
  const allocations: AgentPlannerProposal["allocations"] = [];
  let total = 0;
  for (const entry of record.allocations) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const allocation = entry as Record<string, unknown>;
    if (typeof allocation.taskId !== "string" || !Number.isInteger(allocation.minutes)) return undefined;
    const task = byId.get(allocation.taskId);
    const minutes = allocation.minutes as number;
    if (!task || seen.has(task.taskId) || minutes < 15 || minutes > task.estimatedMinutes) return undefined;
    seen.add(task.taskId);
    total += minutes;
    allocations.push({ taskId: task.taskId, minutes });
  }
  if (total > availableCapacity(context.memory, context.now)) return undefined;
  if (record.suggestions.length > 3 || record.suggestions.some((item) => typeof item !== "string" || !item.trim() || item.length > 120)) return undefined;
  return { allocations, suggestions: record.suggestions as string[] };
}

function availableCapacity(memory: AgentMemory, now: Date): number {
  const start = atLocalClock(now, memory.workdayStart);
  const end = atLocalClock(now, memory.workdayEnd);
  return Math.min(memory.maxDailyMinutes, Math.max(0, Math.floor((end.getTime() - Math.max(now.getTime(), start.getTime())) / 60_000)));
}

function atLocalClock(date: Date, clock: string): Date {
  const [hour, minute] = clock.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}
