import { requestChatCompletion } from "../llm-client.js";
import type { AgentMemory, AgentPlan, AgentTaskAssessment, ChroniLlmSettings, DailyTask } from "../shared/types.js";
import { forecastWorkBlocks, planCoverage } from "./agent-tools.js";

export type AgentPlannerProposal = {
  allocations: Array<{ taskId: string; minutes: number }>;
  suggestions: string[];
};

export type AgentPlanningContext = {
  assessments: AgentTaskAssessment[];
  memory: AgentMemory;
  initialPlan: AgentPlan;
  now: Date;
  dailyTasks?: DailyTask[];
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
              "先处理 priorityScore 更高、完成进度更低或近期计划未完成的任务；rescue 任务先给一个容易启动的短时段，再安排后续推进。",
              "suggestions 最多 3 条，每条不超过 120 个字符。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              now: context.now.toISOString(),
              capacityMinutes: availableCapacity(context.memory, context.now, context.initialPlan.capacityMinutes, context.initialPlan.availableMinutes),
              tasks: context.assessments.slice(0, 32).map((item) => ({
                taskId: item.taskId,
                title: item.title.slice(0, 80),
                dueAt: item.dueAt,
                riskLevel: item.riskLevel,
                score: item.score,
                priorityScore: item.priorityScore ?? item.score,
                progressPercent: item.progressPercent,
                missedPlanCount: item.missedPlanCount ?? 0,
                interventionLevel: item.interventionLevel ?? "none",
                recommendedSessionMinutes: item.recommendedSessionMinutes,
                remainingMinutes: item.estimatedMinutes,
                allocatableMinutes: item.nextStepMinutes ?? item.estimatedMinutes,
                actionable: item.actionable !== false,
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
  const byId = new Map(context.assessments.map((item) => [item.taskId, item]));
  const blocks = scheduleProposalInInitialWindows(proposal, byId, context);
  const requestedMinutes = context.assessments.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const plannedMinutes = blocks.reduce((sum, block) => sum + block.allocatedMinutes, 0);
  const coverage = planCoverage(context.assessments, blocks);
  const plan: AgentPlan = {
    blocks,
    requestedMinutes,
    plannedMinutes,
    ...(context.initialPlan.capacityMinutes ? { capacityMinutes: context.initialPlan.capacityMinutes } : {}),
    ...(context.initialPlan.availableMinutes !== undefined ? { availableMinutes: context.initialPlan.availableMinutes } : {}),
    ...(context.initialPlan.adaptationReasons?.length ? { adaptationReasons: [...context.initialPlan.adaptationReasons] } : {}),
    overflowMinutes: Math.max(0, requestedMinutes - plannedMinutes),
    unplannedTaskIds: coverage.filter((item) => item.allocatedMinutes < item.requiredMinutes).map((item) => item.taskId),
    plannerSource: "llm",
    coverage,
  };
  const forecastMemory = context.initialPlan.capacityMinutes && context.initialPlan.capacityMinutes < context.memory.maxDailyMinutes
    ? { ...context.memory, maxDailyMinutes: context.initialPlan.capacityMinutes }
    : context.memory;
  plan.forecastBlocks = forecastWorkBlocks(context.assessments, forecastMemory, context.now, blocks, context.dailyTasks ?? []);
  plan.forecastHorizonDays = 7;
  return plan;
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
    if (!task || task.actionable === false || seen.has(task.taskId) || minutes < 15 || minutes > (task.nextStepMinutes ?? task.estimatedMinutes)) return undefined;
    seen.add(task.taskId);
    total += minutes;
    allocations.push({ taskId: task.taskId, minutes });
  }
  if (total > availableCapacity(context.memory, context.now, context.initialPlan.capacityMinutes, context.initialPlan.availableMinutes)) return undefined;
  if (record.suggestions.length > 3 || record.suggestions.some((item) => typeof item !== "string" || !item.trim() || item.length > 120)) return undefined;
  return { allocations, suggestions: record.suggestions as string[] };
}

function scheduleProposalInInitialWindows(proposal: AgentPlannerProposal, byId: Map<string, AgentTaskAssessment>, context: AgentPlanningContext): AgentPlan["blocks"] {
  const windows = [...context.initialPlan.blocks]
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
    .reduce<Array<{ start: number; end: number }>>((merged, block) => {
      const start = new Date(block.startAt).getTime();
      const end = new Date(block.endAt).getTime();
      const previous = merged[merged.length - 1];
      if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
      else merged.push({ start, end });
      return merged;
    }, []);
  if (!windows.length && context.initialPlan.availableMinutes === undefined) {
    const start = Math.max(context.now.getTime(), atLocalClock(context.now, context.memory.workdayStart).getTime());
    windows.push({ start, end: start + availableCapacity(context.memory, context.now, context.initialPlan.capacityMinutes) * 60_000 });
  }
  const blocks: AgentPlan["blocks"] = [];
  let windowIndex = 0;
  let cursor = windows[0]?.start ?? 0;
  for (const allocation of proposal.allocations) {
    const item = byId.get(allocation.taskId)!;
    let remaining = allocation.minutes;
    while (remaining > 0 && windowIndex < windows.length) {
      const window = windows[windowIndex];
      const start = Math.max(cursor, window.start);
      const available = Math.max(0, Math.floor((window.end - start) / 60_000));
      if (!available) {
        windowIndex += 1;
        cursor = windows[windowIndex]?.start ?? 0;
        continue;
      }
      const minutes = Math.min(remaining, available);
      const end = start + minutes * 60_000;
      blocks.push({ taskId: item.taskId, stepId: item.nextStepId, title: item.nextStepTitle ? `${item.title} · ${item.nextStepTitle}` : item.title, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), allocatedMinutes: minutes });
      remaining -= minutes;
      cursor = end;
      if (cursor >= window.end) {
        windowIndex += 1;
        cursor = windows[windowIndex]?.start ?? 0;
      }
    }
  }
  return blocks;
}

function availableCapacity(memory: AgentMemory, now: Date, adaptiveLimit?: number, calendarLimit?: number): number {
  const start = atLocalClock(now, memory.workdayStart);
  const end = atLocalClock(now, memory.workdayEnd);
  return Math.min(memory.maxDailyMinutes, adaptiveLimit ?? memory.maxDailyMinutes, calendarLimit ?? Number.POSITIVE_INFINITY, Math.max(0, Math.floor((end.getTime() - Math.max(now.getTime(), start.getTime())) / 60_000)));
}

function atLocalClock(date: Date, clock: string): Date {
  const [hour, minute] = clock.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}
