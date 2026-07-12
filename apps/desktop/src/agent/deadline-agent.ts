import { randomUUID } from "node:crypto";
import { verifyAgentPlan } from "./agent-state.js";
import { createTraceRecorder } from "./agent-trace.js";
import { observeTasks, type DeadlineAgentTools } from "./agent-tools.js";
import { planFromProposal, type AgentPlanner } from "./agent-planner.js";
import type { AgentMemory, AgentPlan, AgentRunResult, AgentRunTrigger, AgentTaskAssessment, DdlItem } from "../shared/types.js";

export type DeadlineAgentOptions = {
  tools: DeadlineAgentTools;
  getMemory(): AgentMemory;
  saveRun(result: AgentRunResult): void | Promise<void>;
  now?: () => Date;
  createId?: () => string;
  planner?: AgentPlanner;
};

export class DeadlineAgent {
  readonly tools: DeadlineAgentTools;
  readonly #getMemory: DeadlineAgentOptions["getMemory"];
  readonly #saveRun: DeadlineAgentOptions["saveRun"];
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #planner?: AgentPlanner;
  #inFlight?: Promise<AgentRunResult>;

  constructor(options: DeadlineAgentOptions) {
    this.tools = options.tools;
    this.#getMemory = options.getMemory;
    this.#saveRun = options.saveRun;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? (() => `agent-${randomUUID()}`);
    this.#planner = options.planner;
  }

  run(trigger: AgentRunTrigger = "manual"): Promise<AgentRunResult> {
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = this.#execute(trigger).finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  async #execute(trigger: AgentRunTrigger): Promise<AgentRunResult> {
    const started = this.#now();
    const memory = { ...this.#getMemory() };
    const trace = createTraceRecorder(() => this.#now().toISOString());
    const tasks = await this.tools.readTasks();
    const observation = observeTasks(tasks, started);
    trace.record("observe", "已读取当前任务、截止时间和稍后提醒状态。", {
      taskCount: observation.totalCount,
      activeCount: observation.activeCount,
      snoozedCount: observation.snoozedCount,
      overdueCount: observation.overdueCount,
    });

    const priorities = this.tools.assessRisks(observation.activeTasks, started);
    const highRisk = priorities.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical");
    let plan = this.tools.plan(priorities, memory, started);
    let modelSuggestions: string[] = [];
    if (this.#planner && memory.useLlmPlanning && priorities.length) {
      let plannerResult;
      try {
        plannerResult = await this.#planner.propose({ assessments: priorities, memory, initialPlan: plan, now: started });
      } catch {
        plannerResult = { fallbackReason: "request-failed" as const };
      }
      if (plannerResult.proposal) {
        plan = planFromProposal(plannerResult.proposal, { assessments: priorities, memory, initialPlan: plan, now: started });
        modelSuggestions = plannerResult.proposal.suggestions;
        trace.record("plan", "大模型已生成结构化规划，并通过本地约束校验。", { plannerSource: "llm", allocationCount: plan.blocks.length });
      } else {
        const unavailable = plannerResult.fallbackReason === "unavailable";
        plan = { ...plan, plannerSource: unavailable ? "rules" : "rules-fallback", fallbackReason: unavailable ? undefined : plannerResult.fallbackReason };
        trace.record("plan", unavailable ? "未配置可用模型，使用本地规则规划。" : "大模型规划不可用，已回退本地规则。", { plannerSource: plan.plannerSource ?? "rules", fallbackReason: plannerResult.fallbackReason ?? "invalid-response" }, unavailable);
      }
    }
    trace.record("plan", priorities.length ? "已完成风险排序并生成今日初始工作计划。" : "当前没有待规划任务。", {
      priorityCount: priorities.length,
      highRiskCount: highRisk.length,
      plannedMinutes: plan.plannedMinutes,
      overflowMinutes: plan.overflowMinutes,
    });

    const actions: AgentRunResult["actions"] = [];
    const shouldReplan = highRisk.length > 0 || plan.overflowMinutes > 0;
    if (shouldReplan) {
      try {
        const candidate = await this.tools.replan(priorities, memory, started);
        if (isBetterPlan(candidate, plan, highRisk.map((item) => item.taskId))) {
          plan = { ...candidate, plannerSource: plan.plannerSource === "rules-fallback" ? "rules-fallback" : candidate.plannerSource };
          actions.push({ tool: "replan", status: "success", summary: "风险优先重排改善了高风险任务覆盖。" });
        } else {
          actions.push({ tool: "replan", status: "skipped", summary: "备选重排没有改善当前计划，已保留原计划。" });
        }
        trace.record("act", "已比较风险优先重排与当前计划。", { tool: "replan", plannedMinutes: plan.plannedMinutes, overflowMinutes: plan.overflowMinutes });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actions.push({ tool: "replan", status: "failed", summary: message });
        trace.record("act", "重新规划工具调用失败，保留初始计划。", { tool: "replan", error: message.slice(0, 240) }, false);
      }
    } else {
      actions.push({ tool: "replan", status: "skipped", summary: "当前风险和容量无需重新规划。" });
      trace.record("act", "当前计划无需调用重新规划工具。", { tool: "replan", skipped: true });
    }

    const reminderTarget = memory.reminderFrequency === "daily" ? priorities[0] : highRisk[0];
    if (reminderTarget && memory.reminderFrequency !== "off") {
      try {
        const outcome = await this.tools.sendReminder(reminderTarget) ?? { sent: true, reason: "sent" as const };
        actions.push({ tool: "reminder", status: outcome.sent ? "success" : "skipped", summary: outcome.sent ? `已提醒：${reminderTarget.title}` : `未发送提醒：${outcome.reason}` });
        trace.record("act", outcome.sent ? "提醒工具已发送通知。" : "提醒工具未发送通知。", { tool: "reminder", taskId: reminderTarget.taskId, reason: outcome.reason });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actions.push({ tool: "reminder", status: "failed", summary: message });
        trace.record("act", "提醒工具调用失败。", { tool: "reminder", error: message.slice(0, 240) }, false);
      }
    }

    if (this.tools.persistPlan) {
      try {
        await this.tools.persistPlan(plan);
        actions.push({ tool: "persist-plan", status: "success", summary: "今日工作块已保存。" });
      } catch (error) {
        actions.push({ tool: "persist-plan", status: "failed", summary: error instanceof Error ? error.message : String(error) });
      }
    }
    const verification = verifyAgentPlan(priorities, plan);
    const status = verification.status;
    trace.record("verify", verification.summary, {
      status,
      unresolvedHighRiskCount: verification.unresolvedHighRiskTaskIds.length,
      unplannedPriorityCount: verification.unplannedPriorityTaskIds.length,
      overflowMinutes: plan.overflowMinutes,
    });

    const result: AgentRunResult = {
      id: this.#createId(),
      trigger,
      plannerSource: plan.plannerSource ?? "rules",
      startedAt: started.toISOString(),
      completedAt: this.#now().toISOString(),
      observation,
      priorities,
      plan,
      actions,
      verification,
      suggestions: modelSuggestions.length ? [...modelSuggestions, ...dailySuggestions(priorities, plan)].slice(0, 4) : dailySuggestions(priorities, plan),
      trace: trace.entries(),
    };
    await this.#saveRun(result);
    return result;
  }
}

function isBetterPlan(candidate: AgentPlan, current: AgentPlan, highRiskIds: string[]): boolean {
  const metric = (plan: AgentPlan) => {
    const coverage = plan.coverage ?? [];
    return {
      zero: highRiskIds.filter((id) => (coverage.find((item) => item.taskId === id)?.allocatedMinutes ?? 0) === 0).length,
      covered: coverage.filter((item) => highRiskIds.includes(item.taskId)).reduce((sum, item) => sum + item.allocatedMinutes, 0),
    };
  };
  const next = metric(candidate);
  const previous = metric(current);
  return next.zero < previous.zero
    || (next.zero === previous.zero && next.covered > previous.covered)
    || (next.zero === previous.zero && next.covered === previous.covered && candidate.overflowMinutes < current.overflowMinutes);
}

function dailySuggestions(priorities: AgentTaskAssessment[], plan: AgentPlan): string[] {
  if (!priorities.length) return ["今天没有待处理 DDL，可以保持当前节奏。"];
  const suggestions = [`优先处理「${priorities[0].title}」，风险等级为 ${priorities[0].riskLevel}。`];
  if (plan.blocks.length) suggestions.push(`已安排 ${plan.blocks.length} 个工作块，共 ${plan.plannedMinutes} 分钟。`);
  if (plan.overflowMinutes > 0) suggestions.push(`今日容量仍缺少 ${plan.overflowMinutes} 分钟，请减少低优先级投入或提前开始。`);
  return suggestions;
}
