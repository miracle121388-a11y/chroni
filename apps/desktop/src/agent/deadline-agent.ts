import { randomUUID } from "node:crypto";
import { verificationStatus } from "./agent-state.js";
import { createTraceRecorder } from "./agent-trace.js";
import { observeTasks, type DeadlineAgentTools } from "./agent-tools.js";
import type { AgentMemory, AgentPlan, AgentRunResult, AgentTaskAssessment, DdlItem } from "../shared/types.js";

export type DeadlineAgentOptions = {
  tools: DeadlineAgentTools;
  getMemory(): AgentMemory;
  saveRun(result: AgentRunResult): void | Promise<void>;
  now?: () => Date;
  createId?: () => string;
};

export class DeadlineAgent {
  readonly tools: DeadlineAgentTools;
  readonly #getMemory: DeadlineAgentOptions["getMemory"];
  readonly #saveRun: DeadlineAgentOptions["saveRun"];
  readonly #now: () => Date;
  readonly #createId: () => string;
  #inFlight?: Promise<AgentRunResult>;

  constructor(options: DeadlineAgentOptions) {
    this.tools = options.tools;
    this.#getMemory = options.getMemory;
    this.#saveRun = options.saveRun;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? (() => `agent-${randomUUID()}`);
  }

  run(): Promise<AgentRunResult> {
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = this.#execute().finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  async #execute(): Promise<AgentRunResult> {
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
        plan = await this.tools.replan(priorities, memory, started);
        actions.push({ tool: "replan", status: "success", summary: "已按风险和每日容量重新规划。" });
        trace.record("act", "已调用重新规划工具。", { tool: "replan", plannedMinutes: plan.plannedMinutes, overflowMinutes: plan.overflowMinutes });
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
        await this.tools.sendReminder(reminderTarget);
        actions.push({ tool: "reminder", status: "success", summary: `已提醒：${reminderTarget.title}` });
        trace.record("act", memory.reminderFrequency === "daily" ? "已调用每日提醒工具通知最高优先任务。" : "已调用提醒工具通知最高风险任务。", { tool: "reminder", taskId: reminderTarget.taskId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actions.push({ tool: "reminder", status: "failed", summary: message });
        trace.record("act", "提醒工具调用失败。", { tool: "reminder", error: message.slice(0, 240) }, false);
      }
    }

    const unresolvedHighRiskTaskIds = highRisk.map((item) => item.taskId);
    const unplannedPriorityTaskIds = plan.unplannedTaskIds.filter((id) => highRisk.some((item) => item.taskId === id));
    const status = verificationStatus({
      unresolvedHighRiskTaskIds,
      unplannedPriorityTaskIds,
      capacityOverflowMinutes: plan.overflowMinutes,
    });
    const verification = {
      status,
      unresolvedHighRiskTaskIds,
      unplannedPriorityTaskIds,
      capacityOverflowMinutes: plan.overflowMinutes,
      summary: verificationSummary(status, unresolvedHighRiskTaskIds.length, plan.overflowMinutes),
    } satisfies AgentRunResult["verification"];
    trace.record("verify", verification.summary, {
      status,
      unresolvedHighRiskCount: unresolvedHighRiskTaskIds.length,
      unplannedPriorityCount: unplannedPriorityTaskIds.length,
      overflowMinutes: plan.overflowMinutes,
    });

    const result: AgentRunResult = {
      id: this.#createId(),
      startedAt: started.toISOString(),
      completedAt: this.#now().toISOString(),
      observation,
      priorities,
      plan,
      actions,
      verification,
      suggestions: dailySuggestions(priorities, plan),
      trace: trace.entries(),
    };
    await this.#saveRun(result);
    return result;
  }
}

function verificationSummary(status: AgentRunResult["verification"]["status"], highRiskCount: number, overflowMinutes: number): string {
  if (status === "healthy") return "复查完成：今日计划没有时间缺口或高风险任务。";
  if (status === "critical") return `复查发现 ${highRiskCount} 个高风险任务仍未充分安排。`;
  if (overflowMinutes > 0) return `复查发现今日容量仍不足 ${overflowMinutes} 分钟。`;
  return `复查完成：${highRiskCount} 个高风险任务需要持续关注。`;
}

function dailySuggestions(priorities: AgentTaskAssessment[], plan: AgentPlan): string[] {
  if (!priorities.length) return ["今天没有待处理 DDL，可以保持当前节奏。"];
  const suggestions = [`优先处理「${priorities[0].title}」，风险等级为 ${priorities[0].riskLevel}。`];
  if (plan.blocks.length) suggestions.push(`已安排 ${plan.blocks.length} 个工作块，共 ${plan.plannedMinutes} 分钟。`);
  if (plan.overflowMinutes > 0) suggestions.push(`今日容量仍缺少 ${plan.overflowMinutes} 分钟，请减少低优先级投入或提前开始。`);
  return suggestions;
}
