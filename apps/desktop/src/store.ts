import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createAgentMemory, updateAgentMemory } from "./agent/agent-memory.js";
import { applyFeedbackEvent, createBehaviorMemory, setPreferenceStatus, upsertExplicitPreference } from "./agent/behavior-memory.js";
import { cloneAgentRun } from "./agent/agent-state.js";
import { diffTaskPlans } from "./agent/task-plan-diff.js";
import { validateTaskPlan } from "./agent/task-plan-validator.js";
import { hasLlmEnvironmentConfiguration, llmEnabledEnvironmentOverride, resolveLlmSettings } from "./llm-settings.js";
import { compareScheduleItems, visibleActiveScheduleItems } from "./shared/schedule.js";
import type { AgentBehaviorMemory, AgentMemory, AgentMemoryPatch, AgentPlan, AgentRunResult, AgentTraceEntry, BehaviorMemoryPatch, ClarificationAnswerPayload, ClarificationResult, CompanionState, DdlItem, ExplicitPreferenceInput, ChroniPreferences, ChroniPreferencesPatch, ChroniSnapshot, ExtractedInput, IntakeDraft, ItemPatch, PendingClarification, PetPlacement, PlanningFeedbackEvent, ServiceStatus, SourceExtractionStatus, SourceRecord, TaskPlan, TaskPlanResult, TaskPlanRevision, TaskPlanUpdatePayload } from "./shared/types.js";

export type SecretCodec = {
  encrypt(value: string): string;
  decrypt(value: string): string;
};

type PersistedLlmSettings = Partial<ChroniPreferences["llm"]> & {
  apiKeyProtected?: string;
};

type StoredState = {
  items: DdlItem[];
  sources: SourceRecord[];
  intakeDrafts: IntakeDraft[];
  clarifications: PendingClarification[];
  taskPlans: TaskPlan[];
  taskPlanRevisions: TaskPlanRevision[];
  preferences: ChroniPreferences;
  companion: {
    state: CompanionState;
    bubble: string;
  };
  petPlacement?: PetPlacement;
  agent: {
    memory: AgentMemory;
    behaviorMemory: AgentBehaviorMemory;
    latestRun?: AgentRunResult;
    appliedPlan?: AgentPlan;
    lastAutomaticRunAt?: string;
    traceHistory: AgentTraceEntry[][];
  };
};

export class ChroniStore {
  readonly filePath: string;
  #state: StoredState;
  #needsSecretMigration = false;

  constructor(userDataPath: string, readonly secretCodec?: SecretCodec) {
    this.filePath = join(userDataPath, "chroni-state.json");
    this.#state = this.#load();
    if (this.#needsSecretMigration) this.#save();
  }

  snapshot(): ChroniSnapshot {
    return {
      items: [...this.#state.items].sort(compareDdlItems),
      sources: [...this.#state.sources].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      intakeDrafts: structuredClone(this.#state.intakeDrafts),
      clarifications: structuredClone(this.#state.clarifications),
      taskPlans: structuredClone(this.#state.taskPlans),
      taskPlanRevisions: structuredClone(this.#state.taskPlanRevisions),
      preferences: { ...this.#state.preferences, llm: { ...this.#state.preferences.llm } },
      companion: { ...this.#state.companion },
      services: this.serviceStatus(),
      agent: {
        memory: { ...this.#state.agent.memory },
        behaviorMemory: { ...structuredClone(this.#state.agent.behaviorMemory), recentFeedbackEvents: [] },
        recentPlanningFeedback: structuredClone(this.#state.agent.behaviorMemory.recentFeedbackEvents.slice(0, 10)),
        latestRun: this.#state.agent.latestRun ? cloneAgentRun(this.#state.agent.latestRun) : undefined,
        appliedPlan: this.#state.agent.appliedPlan ? structuredClone(this.#state.agent.appliedPlan) : undefined,
        lastAutomaticRunAt: this.#state.agent.lastAutomaticRunAt,
      },
    };
  }

  setCompanion(state: CompanionState, bubble: string): ChroniSnapshot {
    this.#state.companion = { state, bubble };
    this.#save();
    return this.snapshot();
  }

  petPlacement(): PetPlacement | undefined {
    return this.#state.petPlacement ? { ...this.#state.petPlacement } : undefined;
  }

  updatePetPlacement(placement: PetPlacement): void {
    this.#state.petPlacement = { ...placement };
    this.#save();
  }

  updateAgentMemory(patch: AgentMemoryPatch): ChroniSnapshot {
    this.#state.agent.memory = updateAgentMemory(this.#state.agent.memory, patch);
    this.#save();
    return this.snapshot();
  }

  saveIntakeDraft(draft: IntakeDraft, clarifications: PendingClarification[], extracted?: ExtractedInput): ChroniSnapshot {
    const existing = this.#state.intakeDrafts.find((item) => item.status === "needs-clarification" && item.sourceName === draft.sourceName && item.candidate.title === draft.candidate.title);
    if (existing) return this.snapshot();
    let sourceId = draft.sourceId;
    if (extracted) {
      const source = sourceRecordFromInput(extracted, "failed", "等待用户补全截止时间等必要信息");
      source.summary = `${source.sourceName}，等待确认截止信息`;
      this.#state.sources = pruneSources([source, ...this.#state.sources]);
      sourceId = source.id;
    }
    const storedDraft = { ...structuredClone(draft), sourceId };
    this.#state.intakeDrafts = [storedDraft, ...this.#state.intakeDrafts.filter((item) => item.id !== draft.id)].slice(0, 100);
    this.#state.clarifications = [
      ...clarifications.map((item) => ({ ...structuredClone(item), sourceId })),
      ...this.#state.clarifications.filter((item) => !clarifications.some((candidate) => candidate.id === item.id)),
    ].slice(0, 200);
    this.#state.companion = { state: "needs_clarification", bubble: clarifications[0]?.question ?? "还需要确认一项信息。" };
    this.#recordWorkflowTrace([
      { stage: "observe", summary: `发现「${draft.candidate.title ?? "未命名任务"}」缺少必要信息。`, data: { draftId: draft.id, clarificationCount: clarifications.length } },
      { stage: "plan", summary: "决定先创建待确认草稿，暂不创建正式任务。", data: { requiredCount: clarifications.filter((item) => item.required).length } },
      { stage: "act", summary: `已创建 ${clarifications.length} 个待确认问题。`, data: { draftId: draft.id } },
      { stage: "verify", summary: "草稿和恢复令牌已持久化，未生成重复任务。", data: { persisted: true } },
    ]);
    this.#save();
    return this.snapshot();
  }

  answerClarification(id: string, payload: ClarificationAnswerPayload): ClarificationResult {
    const clarification = this.#state.clarifications.find((item) => item.id === id);
    if (!clarification) throw new Error("找不到待确认问题。");
    const draft = this.#state.intakeDrafts.find((item) => item.id === clarification.draftId);
    if (!draft) throw new Error("找不到对应的任务草稿。");
    if (clarification.status === "answered") {
      return { ok: true, message: "该问题已经回答，未重复创建任务。", createdTaskId: draft.appliedTaskId, snapshot: this.snapshot() };
    }
    if (clarification.status !== "pending" || draft.status === "cancelled") throw new Error("该问题当前不可回答。");
    const option = payload.optionId ? clarification.options.find((item) => item.id === payload.optionId) : undefined;
    if (payload.optionId && !option) throw new Error("追问选项无效。");
    const answer = option?.value ?? payload.value;
    if (answer === undefined || answer === "") throw new Error("回答不能为空。");
    applyClarificationAnswer(draft, clarification.field, answer);
    const answeredAt = new Date().toISOString();
    clarification.status = "answered";
    clarification.answer = structuredClone(answer);
    clarification.answeredAt = answeredAt;
    draft.updatedAt = answeredAt;
    const unresolved = this.#state.clarifications.filter((item) => item.draftId === draft.id && item.required && item.status === "pending");
    if (unresolved.length || !draft.candidate.title || !draft.candidate.dueAt) {
      draft.status = "needs-clarification";
      this.#state.companion = { state: "needs_clarification", bubble: unresolved[0]?.question ?? "还需要补充任务信息。" };
      this.#recordWorkflowTrace([
        { stage: "observe", summary: "已读取草稿、待确认问题和用户回答。", data: { draftId: draft.id } },
        { stage: "plan", summary: "回答已合并，但仍存在必要字段。", data: { unresolvedCount: unresolved.length } },
        { stage: "act", summary: "保留草稿并等待下一项回答。", data: { createdTask: false } },
        { stage: "verify", summary: "未提前创建正式任务。", data: { duplicateCreated: false } },
      ]);
      this.#save();
      return { ok: true, message: "回答已保存，仍有信息需要确认。", snapshot: this.snapshot() };
    }
    const existing = this.#state.items.find((item) => dedupeKey(item) === dedupeKeyFromCandidate(draft.candidate.title!, draft.candidate.dueAt!));
    const task = existing ?? itemFromDraft(draft);
    if (!existing) this.#state.items.push(task);
    draft.status = "applied";
    draft.appliedTaskId = task.id;
    if (draft.sourceId) {
      this.#state.sources = this.#state.sources.map((source) => source.id === draft.sourceId
        ? { ...source, extractionStatus: "success", lastError: undefined, itemIds: [...new Set([...source.itemIds, task.id])], summary: `${source.sourceName}，补全后生成 1 条日程`, updatedAt: answeredAt, lastExtractedAt: answeredAt }
        : source);
    }
    this.#state.companion = { state: "success", bubble: `信息已补全，已创建「${task.title}」。` };
    this.#recordWorkflowTrace([
      { stage: "observe", summary: "已读取补全后的任务草稿。", data: { draftId: draft.id } },
      { stage: "plan", summary: "必要字段完整，可以创建正式任务。", data: { hasTitle: true, hasDueAt: true } },
      { stage: "act", summary: existing ? "匹配到已有任务，未重复创建。" : "已根据明确回答创建正式任务。", data: { taskId: task.id, duplicate: !!existing } },
      { stage: "verify", summary: "草稿已标记应用，恢复令牌不会再次创建任务。", data: { applied: true } },
    ]);
    this.#save();
    return { ok: true, message: existing ? "信息已补全，匹配到已有任务。" : "信息已补全并创建任务，正在准备执行规划。", createdTaskId: task.id, snapshot: this.snapshot() };
  }

  dismissClarification(id: string): ChroniSnapshot {
    const clarification = this.#state.clarifications.find((item) => item.id === id);
    if (!clarification) throw new Error("找不到待确认问题。");
    if (clarification.status === "dismissed") return this.snapshot();
    if (clarification.required) throw new Error("必要信息不能跳过，可选择稍后处理或放弃草稿。");
    clarification.status = "dismissed";
    clarification.answeredAt = new Date().toISOString();
    this.#save();
    return this.snapshot();
  }

  cancelIntakeDraft(id: string): ChroniSnapshot {
    const draft = this.#state.intakeDrafts.find((item) => item.id === id);
    if (!draft) throw new Error("找不到任务草稿。");
    if (draft.status === "applied") throw new Error("已应用草稿不能放弃。");
    draft.status = "cancelled";
    draft.updatedAt = new Date().toISOString();
    this.#state.clarifications = this.#state.clarifications.map((item) => item.draftId === id && item.status === "pending" ? { ...item, status: "expired" } : item);
    this.#state.companion = companionStateForItems(this.#state.items);
    this.#save();
    return this.snapshot();
  }

  taskPlanByTaskId(taskId: string): TaskPlan | undefined {
    const plans = this.#state.taskPlans.filter((plan) => plan.taskId === taskId && plan.status !== "superseded");
    return structuredClone(plans.sort((a, b) => b.version - a.version)[0]);
  }

  saveGeneratedTaskPlan(plan: TaskPlan): TaskPlanResult {
    const task = this.#state.items.find((item) => item.id === plan.taskId);
    if (!task) throw new Error("找不到要规划的任务。");
    validateTaskPlan(plan, task);
    const previousVersions = this.#state.taskPlans.filter((item) => item.taskId === task.id);
    const version = Math.max(0, ...previousVersions.map((item) => item.version)) + 1;
    const stored = { ...structuredClone(plan), version, status: "draft" as const, updatedAt: new Date().toISOString() };
    this.#state.taskPlans = [stored, ...this.#state.taskPlans.map((item) => item.taskId === task.id && item.status === "draft" ? { ...item, status: "superseded" as const } : item)];
    this.#recordWorkflowTrace([
      { stage: "observe", summary: `读取任务「${task.title}」及可用规划偏好。`, data: { taskId: task.id, preferenceCount: stored.memoryPreferenceIds.length } },
      { stage: "plan", summary: `生成 ${stored.steps.length} 步规划草案，共 ${stored.estimatedTotalMinutes} 分钟。`, data: { plannerSource: stored.plannerSource, version } },
      { stage: "act", summary: "规划已保存为草案，未覆盖用户当前计划。", data: { planId: stored.id, status: stored.status } },
      { stage: "verify", summary: "依赖无环，步骤和总耗时已通过本地校验。", data: { valid: true } },
    ]);
    this.#save();
    return { ok: true, plan: structuredClone(stored), snapshot: this.snapshot(), message: `已生成任务规划草案 v${version}，确认后才会设为当前计划。` };
  }

  activateTaskPlan(taskId: string, planId: string): TaskPlanResult {
    const plan = this.#state.taskPlans.find((item) => item.id === planId && item.taskId === taskId);
    const task = this.#state.items.find((item) => item.id === taskId);
    if (!plan || !task) throw new Error("找不到对应的任务规划。");
    validateTaskPlan(plan, task);
    this.#state.taskPlans = this.#state.taskPlans.map((item) => item.taskId !== taskId ? item : item.id === planId ? { ...item, status: "active" } : item.status === "active" ? { ...item, status: "superseded" } : item);
    this.#state.items = this.#state.items.map((item) => item.id === taskId ? { ...item, estimatedMinutes: plan.estimatedTotalMinutes, updatedAt: new Date().toISOString() } : item);
    this.#save();
    return { ok: true, plan: structuredClone({ ...plan, status: "active" }), snapshot: this.snapshot(), message: "规划已确认并设为当前计划。" };
  }

  updateTaskPlan(taskId: string, payload: TaskPlanUpdatePayload): TaskPlanResult {
    const current = this.taskPlanByTaskId(taskId);
    const task = this.#state.items.find((item) => item.id === taskId);
    if (!current || !task) throw new Error("找不到可编辑的任务规划。");
    if (payload.baseVersion !== current.version) throw new Error("规划已更新，请加载最新版本后再保存。");
    const updatedAt = new Date().toISOString();
    const next: TaskPlan = {
      ...current,
      ...structuredClone(payload),
      version: current.version + 1,
      estimatedTotalMinutes: payload.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0),
      steps: payload.steps.map((step, index) => {
        const previous = current.steps.find((item) => item.id === step.id);
        const modifiedFields = previous
          ? [previous.title !== step.title ? "title" : "", previous.description !== step.description ? "description" : "", previous.estimatedMinutes !== step.estimatedMinutes ? "estimatedMinutes" : "", previous.order !== index + 1 ? "order" : ""].filter(Boolean)
          : ["createdByUser"];
        return { ...step, taskId, order: index + 1, origin: previous?.origin ?? "user", userModifiedFields: [...new Set([...(previous?.userModifiedFields ?? []), ...modifiedFields])], updatedAt };
      }),
      updatedAt,
    };
    validateTaskPlan(next, task);
    const changes = diffTaskPlans(current, next);
    const revision: TaskPlanRevision = { id: `plan-revision-${randomUUID()}`, taskId, planId: current.id, fromVersion: current.version, toVersion: next.version, source: "user", changes, createdAt: updatedAt };
    this.#state.taskPlans = this.#state.taskPlans.map((plan) => plan.id === current.id ? next : plan);
    this.#state.taskPlanRevisions = [revision, ...this.#state.taskPlanRevisions].filter((item, index, all) => all.filter((candidate) => candidate.taskId === item.taskId).indexOf(item) < 20);
    if (next.status === "active") this.#state.items = this.#state.items.map((item) => item.id === taskId ? { ...item, estimatedMinutes: next.estimatedTotalMinutes, updatedAt } : item);
    if (changes.length) {
      const event = feedbackEvent(current, next, task, changes, updatedAt);
      this.#state.agent.behaviorMemory = applyFeedbackEvent(this.#state.agent.behaviorMemory, event);
      const changedPreferences = this.#state.agent.behaviorMemory.preferences.filter((preference) => preference.lastObservedAt === updatedAt);
      this.#recordWorkflowTrace([
        { stage: "observe", summary: `用户保存了规划 v${current.version} 到 v${next.version} 的修改。`, data: { taskId, changeCount: changes.length } },
        { stage: "plan", summary: "已从结构化 Diff 中提取稳定规划信号。", data: { feedbackEventId: event.id } },
        { stage: "act", summary: `已更新 ${changedPreferences.length} 条行为偏好证据。`, data: { preferenceIds: changedPreferences.map((item) => item.id).join(",").slice(0, 240) } },
        { stage: "verify", summary: "偏好置信度与证据计数一致，用户计划未被静默覆盖。", data: { planVersion: next.version } },
      ]);
    }
    this.#save();
    return { ok: true, plan: structuredClone(next), snapshot: this.snapshot(), message: `规划修改已保存为 v${next.version}。` };
  }

  updateBehaviorMemory(patch: BehaviorMemoryPatch): ChroniSnapshot {
    this.#state.agent.behaviorMemory = { ...this.#state.agent.behaviorMemory, ...patch, lastUpdatedAt: new Date().toISOString() };
    this.#save();
    return this.snapshot();
  }

  upsertExplicitPlanningPreference(input: ExplicitPreferenceInput): ChroniSnapshot {
    this.#state.agent.behaviorMemory = upsertExplicitPreference(this.#state.agent.behaviorMemory, input);
    this.#save();
    return this.snapshot();
  }

  setPlanningPreferenceStatus(id: string, status: "active" | "disabled"): ChroniSnapshot {
    if (!this.#state.agent.behaviorMemory.preferences.some((item) => item.id === id)) throw new Error("找不到规划偏好。");
    this.#state.agent.behaviorMemory = setPreferenceStatus(this.#state.agent.behaviorMemory, id, status);
    this.#save();
    return this.snapshot();
  }

  deletePlanningPreference(id: string): ChroniSnapshot {
    this.#state.agent.behaviorMemory.preferences = this.#state.agent.behaviorMemory.preferences.filter((item) => item.id !== id);
    this.#save();
    return this.snapshot();
  }

  clearBehaviorMemory(): ChroniSnapshot {
    const current = this.#state.agent.behaviorMemory;
    this.#state.agent.behaviorMemory = createBehaviorMemory({ learningEnabled: current.learningEnabled, autoApplyEnabled: current.autoApplyEnabled });
    this.#save();
    return this.snapshot();
  }

  saveAgentRun(result: AgentRunResult): ChroniSnapshot {
    const stored = cloneAgentRun(result);
    this.#state.agent.latestRun = stored;
    if (stored.trigger && stored.trigger !== "manual") this.#state.agent.lastAutomaticRunAt = stored.completedAt;
    this.#state.agent.traceHistory = [stored.trace.map((entry) => ({ ...entry, data: { ...entry.data } })), ...this.#state.agent.traceHistory].slice(0, 10);
    this.#save();
    return this.snapshot();
  }

  saveAppliedAgentPlan(plan: AgentPlan): ChroniSnapshot {
    this.#state.agent.appliedPlan = structuredClone(plan);
    this.#save();
    return this.snapshot();
  }

  agentTraceHistory(): AgentTraceEntry[][] {
    return this.#state.agent.traceHistory.map((trace) => trace.map((entry) => ({ ...entry, data: { ...entry.data } })));
  }

  #recordWorkflowTrace(entries: Array<{ stage: AgentTraceEntry["stage"]; summary: string; data?: AgentTraceEntry["data"]; success?: boolean }>): void {
    const timestamp = new Date().toISOString();
    const trace = entries.map((entry, index): AgentTraceEntry => ({
      id: `trace-${randomUUID()}`,
      sequence: index + 1,
      stage: entry.stage,
      timestamp,
      summary: entry.summary.slice(0, 300),
      success: entry.success ?? true,
      data: { ...(entry.data ?? {}) },
    }));
    this.#state.agent.traceHistory = [trace, ...this.#state.agent.traceHistory].slice(0, 10);
  }

  addItems(items: DdlItem[], message = "已加入日程。", extracted: ExtractedInput[] = []): ChroniSnapshot {
    const existingKeys = new Set(this.#state.items.map((item) => dedupeKey(item)));
    const existingByKey = new Map(this.#state.items.map((item) => [dedupeKey(item), item]));
    const sources = extracted.map((input) => sourceRecordFromInput(input));
    const sourceByName = new Map(sources.map((source) => [source.sourceName, source]));
    const accepted = items
      .filter((item) => !existingKeys.has(dedupeKey(item)))
      .map((item) => {
        const source = sourceForItem(item, sources, sourceByName);
        return source ? { ...item, sourceId: source.id } : item;
      });
    for (const source of sources) {
      const sourceItems = items.filter((item) => sourceForItem(item, sources, sourceByName)?.id === source.id);
      const acceptedForSource = accepted.filter((item) => item.sourceId === source.id);
      const duplicateIds = sourceItems
        .map((item) => existingByKey.get(dedupeKey(item))?.id)
        .filter((id): id is string => !!id);
      source.itemIds = [...new Set([...acceptedForSource.map((item) => item.id), ...duplicateIds])];
      source.extractionStatus = acceptedForSource.length ? "success" : "duplicate";
      source.summary = source.extractionStatus === "success"
        ? `${source.sourceName}，生成 ${acceptedForSource.length} 条日程`
        : `${source.sourceName}，识别结果已存在`;
    }
    this.#state.items = [...this.#state.items, ...accepted];
    this.#state.sources = sources.length ? pruneSources([...sources, ...this.#state.sources]) : this.#state.sources;
    this.#state.companion = accepted.length
      ? { state: "success", bubble: message }
      : { state: "confused", bubble: "这条 DDL 已经在日程里了。" };
    this.#save();
    return this.snapshot();
  }

  recordSourceFailure(extracted: ExtractedInput[], reason: string): ChroniSnapshot {
    const sources = extracted.map((input) => sourceRecordFromInput(input, "failed", reason));
    this.#state.sources = sources.length ? pruneSources([...sources, ...this.#state.sources]) : this.#state.sources;
    this.#save();
    return this.snapshot();
  }

  sourceById(id: string): SourceRecord | undefined {
    return this.#state.sources.find((source) => source.id === id);
  }

  updateSourceText(id: string, text: string): ChroniSnapshot {
    this.#state.sources = this.#state.sources.map((source) => source.id === id
      ? { ...source, text, updatedAt: new Date().toISOString() }
      : source);
    this.#save();
    return this.snapshot();
  }

  updateItem(id: string, patch: ItemPatch): ChroniSnapshot {
    if (!this.#state.items.some((item) => item.id === id)) return this.snapshot();
    if (patch.dueAt !== undefined && !isValidDateString(patch.dueAt)) {
      this.#state.companion = { state: "confused", bubble: "截止时间格式无效，未保存修改。" };
      this.#save();
      return this.snapshot();
    }
    if (patch.snoozedUntil !== undefined && !isValidDateString(patch.snoozedUntil)) {
      this.#state.companion = { state: "confused", bubble: "稍后提醒时间无效，未保存修改。" };
      this.#save();
      return this.snapshot();
    }
    this.#state.items = this.#state.items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item);
    const updated = this.#state.items.find((item) => item.id === id);
    this.#state.companion = updated?.completed && patch.completed === true
      ? { state: "celebrating", bubble: "完成得很干脆。" }
      : companionStateForItems(this.#state.items);
    this.#save();
    return this.snapshot();
  }

  markItemReminded(id: string): ChroniSnapshot {
    this.#state.items = this.#state.items.map((item) => item.id === id ? { ...item, lastRemindedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item);
    this.#save();
    return this.snapshot();
  }

  deleteItem(id: string): ChroniSnapshot {
    this.#state.items = this.#state.items.filter((item) => item.id !== id);
    this.#state.sources = this.#state.sources.map((source) => ({ ...source, itemIds: source.itemIds.filter((itemId) => itemId !== id) }));
    this.#state.taskPlans = this.#state.taskPlans.filter((plan) => plan.taskId !== id);
    this.#state.taskPlanRevisions = this.#state.taskPlanRevisions.filter((revision) => revision.taskId !== id);
    this.#state.clarifications = this.#state.clarifications.filter((clarification) => clarification.taskId !== id);
    this.#state.agent.behaviorMemory.recentFeedbackEvents = this.#state.agent.behaviorMemory.recentFeedbackEvents.filter((event) => event.taskId !== id);
    this.#state.companion = companionStateForItems(this.#state.items);
    this.#save();
    return this.snapshot();
  }

  replaceSourceItems(sourceId: string, items: DdlItem[], message = "已重新识别来源。"): ChroniSnapshot {
    const source = this.#state.sources.find((record) => record.id === sourceId);
    if (!source) {
      this.#state.companion = { state: "confused", bubble: "找不到原始输入，无法重新识别。" };
      this.#save();
      return this.snapshot();
    }
    const existing = this.#state.items.filter((item) => item.sourceId !== sourceId);
    const accepted = mergeNewItems(existing, items.map((item) => ({ ...item, sourceId })));
    const itemIds = itemIdsForCandidates(accepted, items);
    this.#state.items = accepted;
    this.#state.sources = this.#state.sources.map((record) => record.id === sourceId
      ? {
        ...record,
        itemIds,
        extractionStatus: itemIds.length ? "success" : "duplicate",
        lastError: undefined,
        summary: itemIds.length ? `${record.sourceName}，重新识别 ${itemIds.length} 条日程` : `${record.sourceName}，重新识别结果已存在`,
        updatedAt: new Date().toISOString(),
        lastExtractedAt: new Date().toISOString(),
      }
      : record);
    this.#state.companion = itemIds.length
      ? { state: "success", bubble: message }
      : { state: "confused", bubble: "重新识别后没有明确 DDL。" };
    this.#save();
    return this.snapshot();
  }

  markSourceFailed(sourceId: string, reason: string): ChroniSnapshot {
    let found = false;
    this.#state.sources = this.#state.sources.map((record) => {
      if (record.id !== sourceId) return record;
      found = true;
      return {
        ...record,
        extractionStatus: "failed",
        lastError: reason,
        summary: `${record.sourceName}，重新识别失败`,
        updatedAt: new Date().toISOString(),
        lastExtractedAt: new Date().toISOString(),
      };
    });
    this.#state.companion = found
      ? { state: "confused", bubble: reason }
      : { state: "confused", bubble: "找不到原始输入，无法重新识别。" };
    this.#save();
    return this.snapshot();
  }

  updatePreferences(patch: ChroniPreferencesPatch): ChroniSnapshot {
    if (patch.quietHoursStart !== undefined && !isValidClockTime(patch.quietHoursStart)) {
      this.#state.companion = { state: "confused", bubble: "勿扰时间格式无效，未保存修改。" };
      this.#save();
      return this.snapshot();
    }
    if (patch.quietHoursEnd !== undefined && !isValidClockTime(patch.quietHoursEnd)) {
      this.#state.companion = { state: "confused", bubble: "勿扰时间格式无效，未保存修改。" };
      this.#save();
      return this.snapshot();
    }
    this.#state.preferences = {
      ...this.#state.preferences,
      ...patch,
      llm: { ...this.#state.preferences.llm, ...(patch.llm ?? {}) },
    };
    if (!this.#state.preferences.companionEnabled) this.#state.companion = { state: "sleeping", bubble: "桌宠入口已暂时关闭。" };
    this.#save();
    return this.snapshot();
  }

  serviceStatus(): ServiceStatus {
    const llm = this.#state.preferences.llm;
    const resolvedLlm = resolveLlmSettings(llm);
    const modelEnabled = resolvedLlm.enabled;
    const modelReady = modelEnabled && !!resolvedLlm.apiKey;
    const environmentConfigured = hasLlmEnvironmentConfiguration();
    return {
      parser: "ready",
      ocr: "ready",
      model: modelReady ? "ready" : "limited",
      modelEnvironmentConfigured: environmentConfigured,
      modelEnabledOverride: llmEnabledEnvironmentOverride(),
      storagePath: this.filePath,
      privacy: modelEnabled
        ? "日程、追问、计划和行为偏好保存在本机；启用 LLM 时，仅发送当前任务相关片段和选中的结构化偏好。"
        : "日程和来源保存在本机，未启用 LLM 时不会发送到模型服务。",
      notes: [
        "已支持文本、PDF、DOCX、XLSX、CSV、网页/结构化文本和图片 OCR 的本地抽取。",
        modelReady
          ? `LLM 智能抽取已启用，当前模型：${resolvedLlm.model || "未设置"}${environmentConfigured ? "（环境变量优先）" : ""}。`
          : "未配置 LLM API Key 时会使用本地规则抽取；配置后优先使用大模型抽取并自动回退。",
        this.secretCodec
          ? "LLM API Key 使用操作系统安全存储加密。"
          : "当前系统安全存储不可用，界面填写的 LLM API Key 仅在本次运行有效；可改用 CHRONI_LLM_API_KEY。",
        `${this.#state.sources.length} 条输入来源保存在本机，可在控制中心重新识别。`,
        this.#state.preferences.remindersEnabled
          ? `提醒已开启${this.#state.preferences.quietHoursEnabled ? `，勿扰时间 ${this.#state.preferences.quietHoursStart}-${this.#state.preferences.quietHoursEnd}` : ""}。`
          : "提醒已关闭。",
        this.#state.preferences.companionEnabled ? "桌宠入口已开启。" : "桌宠入口已隐藏，可在控制中心重新开启。",
        "信息不完整时会保存待确认草稿；任务计划只有经用户确认后才会启用。",
      ],
    };
  }

  #load(): StoredState {
    if (!existsSync(this.filePath)) return createDefaultState();
    try {
      const raw = readFileSync(this.filePath, "utf8").replace(/^\uFEFF/, "");
      const parsed = JSON.parse(raw) as Partial<StoredState> & {
        preferences?: Partial<ChroniPreferences> & { llm?: PersistedLlmSettings };
      };
      const fallback = createDefaultState();
      const defaultPreferences = createDefaultPreferences();
      const persistedLlm = (parsed.preferences?.llm ?? {}) as PersistedLlmSettings;
      const { apiKey: legacyApiKey, apiKeyProtected, ...llmSettings } = persistedLlm;
      let apiKey = typeof legacyApiKey === "string" ? legacyApiKey : "";
      if (apiKeyProtected && this.secretCodec) {
        try {
          apiKey = this.secretCodec.decrypt(apiKeyProtected);
        } catch {
          apiKey = "";
        }
      }
      if (legacyApiKey) this.#needsSecretMigration = true;
      return {
        items: Array.isArray(parsed.items) ? parsed.items : fallback.items,
        sources: Array.isArray(parsed.sources) ? (parsed.sources as SourceRecord[]).map(normalizeSourceRecord) : fallback.sources,
        intakeDrafts: Array.isArray(parsed.intakeDrafts) ? parsed.intakeDrafts.filter(isIntakeDraft).slice(0, 100) : [],
        clarifications: Array.isArray(parsed.clarifications) ? parsed.clarifications.filter(isPendingClarification).slice(0, 200) : [],
        taskPlans: Array.isArray(parsed.taskPlans) ? parsed.taskPlans.filter(isTaskPlan).slice(0, 500) : [],
        taskPlanRevisions: Array.isArray(parsed.taskPlanRevisions) ? parsed.taskPlanRevisions.filter(isTaskPlanRevision).slice(0, 1_000) : [],
        preferences: {
          ...defaultPreferences,
          ...(parsed.preferences ?? {}),
          llm: { ...defaultPreferences.llm, ...llmSettings, apiKey },
        },
        companion: parsed.companion?.state ? parsed.companion as StoredState["companion"] : fallback.companion,
        petPlacement: isPetPlacement(parsed.petPlacement) ? { ...parsed.petPlacement } : undefined,
        agent: normalizeAgentState(parsed.agent),
      };
    } catch {
      return createDefaultState();
    }
  }

  #save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const { apiKey, ...llm } = this.#state.preferences.llm;
    const apiKeyProtected = apiKey && this.secretCodec ? this.secretCodec.encrypt(apiKey) : undefined;
    const persistedState = {
      ...this.#state,
      preferences: {
        ...this.#state.preferences,
        llm: { ...llm, ...(apiKeyProtected ? { apiKeyProtected } : {}) },
      },
    };
    writeFileSync(tmp, JSON.stringify(persistedState, null, 2), "utf8");
    renameSync(tmp, this.filePath);
    this.#needsSecretMigration = false;
  }
}

function createDefaultPreferences(): ChroniPreferences {
  return {
    companionEnabled: true,
    companionStyle: "classic",
    remindersEnabled: true,
    quietHoursEnabled: false,
    quietHoursStart: "22:30",
    quietHoursEnd: "08:00",
    hotkey: "Ctrl+Shift+C",
    llm: {
      enabled: false,
      provider: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      model: "deepseek-v4-flash",
    },
  };
}

function createDefaultState(): StoredState {
  return {
    items: [],
    sources: [],
    intakeDrafts: [],
    clarifications: [],
    taskPlans: [],
    taskPlanRevisions: [],
    preferences: createDefaultPreferences(),
    companion: {
      state: "idle",
      bubble: "把 DDL 文件、截图或文字拖给我。",
    },
    agent: {
      memory: createAgentMemory(),
      behaviorMemory: createBehaviorMemory(),
      traceHistory: [],
    },
  };
}

function normalizeAgentState(value: unknown): StoredState["agent"] {
  if (!value || typeof value !== "object") return { memory: createAgentMemory(), behaviorMemory: createBehaviorMemory(), traceHistory: [] };
  const agent = value as Partial<StoredState["agent"]>;
  return {
    memory: createAgentMemory(agent.memory),
    behaviorMemory: createBehaviorMemory(agent.behaviorMemory),
    latestRun: agent.latestRun,
    appliedPlan: agent.appliedPlan ? structuredClone(agent.appliedPlan) : undefined,
    lastAutomaticRunAt: typeof agent.lastAutomaticRunAt === "string" ? agent.lastAutomaticRunAt : undefined,
    traceHistory: Array.isArray(agent.traceHistory) ? agent.traceHistory.slice(0, 10) : [],
  };
}

function applyClarificationAnswer(draft: IntakeDraft, field: PendingClarification["field"], answer: string | number | string[]): void {
  if (field === "title") {
    if (typeof answer !== "string" || !answer.trim()) throw new Error("任务标题回答无效。");
    draft.candidate.title = answer.trim().slice(0, 120);
    return;
  }
  if (field === "dueAt" || field === "dueTime") {
    if (typeof answer !== "string" || Number.isNaN(new Date(answer).getTime())) throw new Error("截止时间回答无效。");
    draft.candidate.dueAt = new Date(answer).toISOString();
    return;
  }
  if (field === "estimatedMinutes") {
    const value = Number(answer);
    if (!Number.isInteger(value) || value < 15 || value > 1_440) throw new Error("预计耗时回答无效。");
    draft.candidate.estimatedMinutes = value;
    return;
  }
  if (field === "progressPercent") {
    const value = Number(answer);
    if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error("当前进度回答无效。");
    draft.candidate.progressPercent = value;
    return;
  }
  if (field === "deliverables") draft.candidate.deliverables = Array.isArray(answer) ? answer.map(String).slice(0, 12) : [String(answer)];
  if (field === "taskType") draft.candidate.taskType = String(answer).slice(0, 80);
}

function itemFromDraft(draft: IntakeDraft): DdlItem {
  const now = new Date().toISOString();
  return {
    id: `ddl-${randomUUID()}`,
    title: draft.candidate.title!,
    dueAt: draft.candidate.dueAt!,
    importance: draft.candidate.importance ?? "medium",
    estimatedMinutes: draft.candidate.estimatedMinutes,
    progressPercent: draft.candidate.progressPercent,
    sourceId: draft.sourceId,
    sourceSummary: `${draft.sourceName}: 用户补全后创建`,
    createdAt: now,
    updatedAt: now,
    completed: false,
  };
}

function dedupeKeyFromCandidate(title: string, dueAt: string): string {
  return `${title.trim().toLowerCase()}|${new Date(dueAt).toISOString().slice(0, 16)}`;
}

function feedbackEvent(before: TaskPlan, after: TaskPlan, task: DdlItem, changes: TaskPlanRevision["changes"], createdAt: string): PlanningFeedbackEvent {
  return {
    id: `feedback-${randomUUID()}`,
    taskId: task.id,
    planId: after.id,
    planVersion: after.version,
    taskType: after.taskType,
    source: "plan-edit",
    changes: structuredClone(changes),
    context: {
      dueWindowHours: Math.max(0, (new Date(task.dueAt).getTime() - new Date(createdAt).getTime()) / 3_600_000),
      importance: task.importance,
      originalStepCount: before.steps.length,
      finalStepCount: after.steps.length,
      originalTotalMinutes: before.estimatedTotalMinutes,
      finalTotalMinutes: after.estimatedTotalMinutes,
      originalBufferMinutes: before.bufferMinutes,
      finalBufferMinutes: after.bufferMinutes,
    },
    createdAt,
  };
}

function isIntakeDraft(value: unknown): value is IntakeDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<IntakeDraft>;
  return typeof draft.id === "string" && typeof draft.sourceName === "string" && !!draft.candidate && Array.isArray(draft.pendingClarificationIds);
}

function isPendingClarification(value: unknown): value is PendingClarification {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PendingClarification>;
  return typeof item.id === "string" && typeof item.draftId === "string" && typeof item.question === "string" && Array.isArray(item.options);
}

function isTaskPlan(value: unknown): value is TaskPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<TaskPlan>;
  return typeof plan.id === "string" && typeof plan.taskId === "string" && Number.isInteger(plan.version) && Array.isArray(plan.steps);
}

function isTaskPlanRevision(value: unknown): value is TaskPlanRevision {
  if (!value || typeof value !== "object") return false;
  const revision = value as Partial<TaskPlanRevision>;
  return typeof revision.id === "string" && typeof revision.taskId === "string" && Array.isArray(revision.changes);
}

function isPetPlacement(value: unknown): value is PetPlacement {
  if (!value || typeof value !== "object") return false;
  const placement = value as Partial<PetPlacement>;
  return Number.isFinite(placement.displayId)
    && Number.isFinite(placement.xRatio)
    && Number.isFinite(placement.yRatio);
}

export function sourceRecordFromInput(input: ExtractedInput, status: SourceExtractionStatus = "success", lastError?: string): SourceRecord {
  const now = new Date().toISOString();
  return {
    id: `source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    text: input.text,
    summary: status === "failed" ? `${input.sourceName}，识别失败` : `${input.sourceName}，抽取 ${input.text.length} 字`,
    extractionStatus: status,
    lastError,
    createdAt: now,
    updatedAt: now,
    lastExtractedAt: now,
    itemIds: [],
  };
}

export function compareDdlItems(a: DdlItem, b: DdlItem): number {
  return compareScheduleItems(a, b);
}

export function visibleItems(items: DdlItem[], limit = 6): DdlItem[] {
  return visibleActiveScheduleItems(items).slice(0, limit);
}

export function companionStateForItems(items: DdlItem[]): { state: CompanionState; bubble: string } {
  const incomplete = items.filter((item) => !item.completed);
  const active = visibleActiveScheduleItems(items);
  if (!items.length) return { state: "idle", bubble: "把 DDL 文件、截图或文字拖给我。" };
  if (!incomplete.length) return { state: "celebrating", bubble: "今天暂时没有紧急 DDL。" };
  if (!active.length) return { state: "idle", bubble: "稍后提醒的事项会按时回来。" };
  const first = active[0];
  const hours = (new Date(first.dueAt).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return { state: "overdue", bubble: `${first.title} 已逾期。` };
  if (hours <= 24) return { state: "deadline_near", bubble: `${first.title} 快到截止时间了。` };
  return { state: "idle", bubble: `最近要注意：${first.title}` };
}

function dedupeKey(item: DdlItem): string {
  return `${item.title.trim().toLowerCase()}|${new Date(item.dueAt).toISOString().slice(0, 16)}`;
}

function sourceNameFromSummary(summary: string): string {
  return summary.split(":", 1)[0] || "";
}

function sourceForItem(item: DdlItem, sources: SourceRecord[], sourceByName: Map<string, SourceRecord>): SourceRecord | undefined {
  return sourceByName.get(sourceNameFromSummary(item.sourceSummary))
    ?? sources.find((source) => hasSourceEvidence(item.sourceSummary, source.text))
    ?? sources[0];
}

function hasSourceEvidence(summary: string, sourceText: string): boolean {
  const needle = normalizeEvidence(summary);
  if (needle.length < 6) return false;
  return normalizeEvidence(sourceText).includes(needle);
}

function normalizeEvidence(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：,.!?:;()[\]【】《》"'“”‘’]/g, "")
    .toLowerCase();
}

function pruneSources(sources: SourceRecord[]): SourceRecord[] {
  const seen = new Set<string>();
  const result: SourceRecord[] = [];
  for (const source of sources) {
    const key = `${source.sourceName}|${source.text.slice(0, 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result.slice(0, 80);
}

function mergeNewItems(existing: DdlItem[], candidates: DdlItem[]): DdlItem[] {
  const keys = new Set(existing.map((item) => dedupeKey(item)));
  const accepted = candidates.filter((item) => {
    const key = dedupeKey(item);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  return [...existing, ...accepted];
}

function itemIdsForCandidates(items: DdlItem[], candidates: DdlItem[]): string[] {
  const byKey = new Map(items.map((item) => [dedupeKey(item), item.id]));
  return [...new Set(candidates.map((item) => byKey.get(dedupeKey(item))).filter((id): id is string => !!id))];
}

function isValidDateString(value: string): boolean {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isValidClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeSourceRecord(source: SourceRecord): SourceRecord {
  return {
    ...source,
    extractionStatus: source.extractionStatus ?? "success",
    itemIds: Array.isArray(source.itemIds) ? source.itemIds : [],
    lastExtractedAt: source.lastExtractedAt ?? source.updatedAt ?? source.createdAt ?? new Date().toISOString(),
  };
}
