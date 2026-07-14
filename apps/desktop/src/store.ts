import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createAgentMemory, updateAgentMemory } from "./agent/agent-memory.js";
import { applyFeedbackEvent, createBehaviorMemory, setPreferenceStatus, upsertExplicitPreference } from "./agent/behavior-memory.js";
import { cloneAgentRun } from "./agent/agent-state.js";
import { diffTaskPlans } from "./agent/task-plan-diff.js";
import { validateTaskPlan } from "./agent/task-plan-validator.js";
import { hasLlmEnvironmentConfiguration, llmEnabledEnvironmentOverride, resolveLlmSettings } from "./llm-settings.js";
import { compareScheduleItems, visibleActiveScheduleItems } from "./shared/schedule.js";
import type { AgentBehaviorMemory, AgentMemory, AgentMemoryPatch, AgentPlan, AgentRunResult, AgentTraceEntry, BehaviorMemoryPatch, ClarificationAnswerPayload, ClarificationResult, CompanionState, DdlItem, ExplicitPreferenceInput, ChroniPreferences, ChroniPreferencesPatch, ChroniSnapshot, ExtractedInput, IntakeDraft, ItemPatch, PendingClarification, PetPlacement, PlanningFeedbackEvent, ReplaceSourceItemsOptions, ServiceStatus, SourceExtractionStatus, SourceRecord, TaskPlan, TaskPlanResult, TaskPlanRevision, TaskPlanUpdatePayload } from "./shared/types.js";

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
  #storageStatus: ServiceStatus["storage"] = "ready";
  #storageDiagnostic?: string;
  #unreadableApiKeyProtected?: string;
  #storageWriteBlocked = false;

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
      preferences: { ...this.#state.preferences, llm: { ...this.#state.preferences.llm, apiKey: "" } },
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
    if (state === "processing" || state === "hover_accept") this.#state.companion = { state, bubble };
    else this.#settleCompanion({ state, bubble });
    // Companion poses and bubbles are ephemeral. In read-only recovery mode they may
    // still update in memory so startup can expose storage diagnostics to the user.
    if (!this.#storageWriteBlocked) this.#save();
    return this.snapshot();
  }

  #activePendingClarification(): PendingClarification | undefined {
    const activeDraftIds = new Set(this.#state.intakeDrafts
      .filter((draft) => draft.status === "needs-clarification")
      .map((draft) => draft.id));
    return this.#state.clarifications.find((item) => item.status === "pending" && item.required && activeDraftIds.has(item.draftId));
  }

  #settleCompanion(preferred = companionStateForItems(this.#state.items)): void {
    if (!this.#state.preferences.companionEnabled) {
      this.#state.companion = { state: "sleeping", bubble: "桌宠入口已暂时关闭。" };
      return;
    }
    const pending = this.#activePendingClarification();
    this.#state.companion = pending
      ? { state: "needs_clarification", bubble: pending.question || "还有日程信息需要确认。" }
      : preferred;
  }

  #appendStorageDiagnostic(message: string, status: ServiceStatus["storage"] = "recovered"): void {
    this.#storageStatus = status;
    this.#storageDiagnostic = this.#storageDiagnostic ? `${this.#storageDiagnostic} ${message}` : message;
  }

  #referencedSourceIds(extra: Iterable<string> = []): Set<string> {
    return new Set([
      ...extra,
      ...this.#state.items.flatMap((item) => item.sourceId ? [item.sourceId] : []),
      ...this.#state.intakeDrafts.flatMap((draft) => draft.sourceId && (draft.status === "needs-clarification" || draft.status === "ready") ? [draft.sourceId] : []),
      ...this.#state.clarifications.flatMap((item) => item.sourceId && item.status === "pending" ? [item.sourceId] : []),
    ]);
  }

  #pruneSources(sources: SourceRecord[], extra: Iterable<string> = []): SourceRecord[] {
    return pruneSources(sources, this.#referencedSourceIds(extra));
  }

  #synchronizeSourceItemIds(): void {
    const idsBySource = new Map<string, string[]>();
    for (const item of this.#state.items) {
      if (!item.sourceId) continue;
      const ids = idsBySource.get(item.sourceId) ?? [];
      ids.push(item.id);
      idsBySource.set(item.sourceId, ids);
    }
    this.#state.sources = this.#state.sources.map((source) => ({
      ...source,
      itemIds: [...new Set(idsBySource.get(source.id) ?? [])],
    }));
  }

  petPlacement(): PetPlacement | undefined {
    return this.#state.petPlacement ? { ...this.#state.petPlacement } : undefined;
  }

  llmSettings(): ChroniPreferences["llm"] {
    return { ...this.#state.preferences.llm };
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
    const hasRequiredClarification = clarifications.some((item) => item.required);
    let sourceId = draft.sourceId;
    if (extracted) {
      const existingSource = this.#state.sources.find((source) => source.sourceName === extracted.sourceName && source.text === extracted.text);
      if (existingSource) {
        sourceId = existingSource.id;
        if (hasRequiredClarification && !existingSource.itemIds.length) {
          existingSource.extractionStatus = "pending";
          existingSource.lastError = "等待用户补全截止时间等必要信息";
          existingSource.summary = `${existingSource.sourceName}，等待确认截止信息`;
          existingSource.updatedAt = new Date().toISOString();
        }
      } else {
        const source = sourceRecordFromInput(extracted, hasRequiredClarification ? "pending" : "success", hasRequiredClarification ? "等待用户补全截止时间等必要信息" : undefined);
        source.summary = hasRequiredClarification ? `${source.sourceName}，等待确认截止信息` : `${source.sourceName}，已记录可选完善信息`;
        this.#state.sources = [source, ...this.#state.sources];
        sourceId = source.id;
      }
    }
    const storedDraft = { ...structuredClone(draft), sourceId };
    const existing = this.#state.intakeDrafts.find((item) => isSamePendingDraft(item, storedDraft, this.#state.clarifications, clarifications));
    if (existing) {
      this.#settleCompanion();
      this.#state.sources = this.#pruneSources(this.#state.sources);
      this.#save();
      return this.snapshot();
    }
    this.#state.intakeDrafts = [storedDraft, ...this.#state.intakeDrafts.filter((item) => item.id !== draft.id)].slice(0, 100);
    this.#state.clarifications = [
      ...clarifications.map((item) => ({ ...structuredClone(item), sourceId })),
      ...this.#state.clarifications.filter((item) => !clarifications.some((candidate) => candidate.id === item.id)),
    ].slice(0, 200);
    this.#state.sources = this.#pruneSources(this.#state.sources, sourceId ? [sourceId] : []);
    this.#settleCompanion(hasRequiredClarification
      ? { state: "needs_clarification", bubble: clarifications.find((item) => item.required)?.question ?? "还需要确认一项信息。" }
      : companionStateForItems(this.#state.items));
    this.#recordWorkflowTrace([
      { stage: "observe", summary: hasRequiredClarification ? `发现「${draft.candidate.title ?? "未命名任务"}」缺少必要信息。` : `发现「${draft.candidate.title ?? "未命名任务"}」可在主计划后继续完善。`, data: { draftId: draft.id, clarificationCount: clarifications.length } },
      { stage: "plan", summary: hasRequiredClarification ? "决定先创建待确认草稿，暂不创建正式任务。" : "主任务继续执行，将补充信息降级为非阻塞完善项。", data: { requiredCount: clarifications.filter((item) => item.required).length } },
      { stage: "act", summary: hasRequiredClarification ? `已创建 ${clarifications.length} 个待确认问题。` : `已记录 ${clarifications.length} 个可选完善项。`, data: { draftId: draft.id } },
      { stage: "verify", summary: hasRequiredClarification ? "草稿和恢复令牌已持久化，未生成重复任务。" : "正式任务与计划保持可用，未触发即时追问。", data: { persisted: true } },
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
      this.#settleCompanion({ state: "needs_clarification", bubble: unresolved[0]?.question ?? "还需要补充任务信息。" });
      this.#recordWorkflowTrace([
        { stage: "observe", summary: "已读取草稿、待确认问题和用户回答。", data: { draftId: draft.id } },
        { stage: "plan", summary: "回答已合并，但仍存在必要字段。", data: { unresolvedCount: unresolved.length } },
        { stage: "act", summary: "保留草稿并等待下一项回答。", data: { createdTask: false } },
        { stage: "verify", summary: "未提前创建正式任务。", data: { duplicateCreated: false } },
      ]);
      this.#save();
      return { ok: true, message: "回答已保存，仍有信息需要确认。", snapshot: this.snapshot() };
    }
    const replacement = draft.replacesTaskId
      ? this.#state.items.find((item) => item.id === draft.replacesTaskId && (!draft.sourceId || item.sourceId === draft.sourceId))
      : undefined;
    const proposed = itemFromDraft(draft);
    const existing = this.#state.items.find((item) => item.id !== replacement?.id && sameTaskOccurrence(item, proposed));
    const hadTaskPlan = !!replacement && this.#state.taskPlans.some((plan) => plan.taskId === replacement.id && plan.status !== "superseded");
    let task = existing ?? proposed;
    if (replacement) {
      task = {
        ...proposed,
        id: replacement.id,
        createdAt: replacement.createdAt,
        completed: replacement.completed,
        snoozedUntil: replacement.snoozedUntil,
        lastRemindedAt: replacement.lastRemindedAt,
        estimatedMinutes: draft.candidate.estimatedMinutes ?? replacement.estimatedMinutes,
        progressPercent: draft.candidate.progressPercent ?? replacement.progressPercent,
      };
      if (existing) {
        this.#state.items = this.#state.items.filter((item) => item.id !== existing.id);
        this.#state.taskPlans = this.#state.taskPlans.filter((plan) => plan.taskId !== existing.id);
        this.#state.taskPlanRevisions = this.#state.taskPlanRevisions.filter((revision) => revision.taskId !== existing.id);
      }
      this.#state.items = this.#state.items.map((item) => item.id === replacement.id ? task : item);
      this.#state.taskPlans = this.#state.taskPlans.map((plan) => plan.taskId === replacement.id
        ? { ...plan, latestSafeStartAt: latestSafeStartAt(plan, task.dueAt), updatedAt: answeredAt }
        : plan);
    } else if (!existing) {
      this.#state.items.push(task);
    }
    draft.status = "applied";
    draft.appliedTaskId = task.id;
    if (draft.sourceId) {
      this.#state.sources = this.#state.sources.map((source) => source.id === draft.sourceId
        ? { ...source, extractionStatus: "success", lastError: undefined, itemIds: [...new Set([...source.itemIds.filter((id) => id !== replacement?.id), task.id])], summary: replacement ? `${source.sourceName}，补全后更新 1 条日程` : `${source.sourceName}，补全后生成 1 条日程`, updatedAt: answeredAt, lastExtractedAt: answeredAt }
        : source);
    }
    this.#settleCompanion({ state: "success", bubble: replacement ? `信息已补全，已更新「${task.title}」。` : `信息已补全，已创建「${task.title}」。` });
    this.#recordWorkflowTrace([
      { stage: "observe", summary: "已读取补全后的任务草稿。", data: { draftId: draft.id } },
      { stage: "plan", summary: "必要字段完整，可以创建正式任务。", data: { hasTitle: true, hasDueAt: true } },
      { stage: "act", summary: existing ? "匹配到已有任务，未重复创建。" : replacement ? "已根据确认结果更新原日程。" : "已根据明确回答创建正式任务。", data: { taskId: task.id, duplicate: !!existing, replaced: !!replacement } },
      { stage: "verify", summary: "草稿已标记应用，恢复令牌不会再次创建任务。", data: { applied: true } },
    ]);
    this.#save();
    return {
      ok: true,
      message: existing && !replacement
        ? "信息已补全，匹配到已有任务。"
        : replacement
          ? hadTaskPlan ? "信息已补全并更新原日程，原有执行规划已保留。" : "信息已补全并更新原日程，正在准备执行规划。"
          : "信息已补全并创建任务，正在准备执行规划。",
      createdTaskId: task.id,
      snapshot: this.snapshot(),
    };
  }

  dismissClarification(id: string): ChroniSnapshot {
    const clarification = this.#state.clarifications.find((item) => item.id === id);
    if (!clarification) throw new Error("找不到待确认问题。");
    if (clarification.status === "dismissed") return this.snapshot();
    if (clarification.required) throw new Error("必要信息不能跳过，可选择稍后处理或放弃草稿。");
    clarification.status = "dismissed";
    clarification.answeredAt = new Date().toISOString();
    this.#settleCompanion();
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
    this.#settleCompanion();
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
      latestSafeStartAt: new Date(new Date(task.dueAt).getTime() - (payload.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0) + payload.bufferMinutes) * 60_000).toISOString(),
      updatedAt,
    };
    validateTaskPlan(next, task);
    const changes = diffTaskPlans(current, next);
    const revision: TaskPlanRevision = { id: `plan-revision-${randomUUID()}`, taskId, planId: current.id, fromVersion: current.version, toVersion: next.version, source: "user", changes, createdAt: updatedAt };
    this.#state.taskPlans = this.#state.taskPlans.map((plan) => plan.id === current.id ? next : plan);
    this.#state.taskPlanRevisions = [revision, ...this.#state.taskPlanRevisions].filter((item, _index, all) => all.filter((candidate) => candidate.taskId === item.taskId).indexOf(item) < 20);
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
    const sources = extracted.map((input) => {
      const existing = this.#state.sources.find((source) => source.sourceName === input.sourceName && source.text === input.text);
      if (!existing) return sourceRecordFromInput(input);
      const updatedAt = new Date().toISOString();
      return { ...existing, sourceType: input.sourceType, updatedAt, lastExtractedAt: updatedAt, lastError: undefined };
    });
    const candidates = items.map((item) => {
      const source = sourceForItem(item, sources);
      return source ? { ...item, sourceId: source.id } : item;
    });
    const resolvedPreviousSourceIds = new Set(sources.flatMap((source) => {
      const hasResolvedItem = candidates.some((item) => item.sourceId === source.id);
      if (!hasResolvedItem) return [];
      return this.#state.sources
        .filter((existing) => existing.sourceName === source.sourceName && existing.text === source.text)
        .map((existing) => existing.id);
    }));
    this.#expirePendingDraftsForSources(resolvedPreviousSourceIds);
    const accepted: DdlItem[] = [];
    const nextItems = [...this.#state.items];
    for (const candidate of candidates) {
      if (nextItems.some((item) => sameTaskOccurrence(item, candidate))) continue;
      accepted.push(candidate);
      nextItems.push(candidate);
    }
    for (const source of sources) {
      const acceptedForSource = accepted.filter((item) => item.sourceId === source.id);
      source.itemIds = nextItems.filter((item) => item.sourceId === source.id).map((item) => item.id);
      source.extractionStatus = acceptedForSource.length ? "success" : "duplicate";
      source.summary = source.extractionStatus === "success"
        ? `${source.sourceName}，生成 ${acceptedForSource.length} 条日程`
        : `${source.sourceName}，识别结果已存在`;
    }
    this.#state.items = nextItems;
    this.#state.sources = sources.length ? this.#pruneSources([...sources, ...this.#state.sources]) : this.#state.sources;
    this.#settleCompanion(accepted.length
      ? { state: "success", bubble: message }
      : { state: "confused", bubble: "这条 DDL 已经在日程里了。" });
    this.#save();
    return this.snapshot();
  }

  recordSourceFailure(extracted: ExtractedInput[], reason: string): ChroniSnapshot {
    const sources = extracted.map((input) => {
      const existing = this.#state.sources.find((source) => source.sourceName === input.sourceName && source.text === input.text);
      if (!existing) return sourceRecordFromInput(input, "failed", reason);
      const updatedAt = new Date().toISOString();
      return { ...existing, sourceType: input.sourceType, extractionStatus: "failed" as const, lastError: reason, updatedAt, lastExtractedAt: updatedAt };
    });
    this.#state.sources = sources.length ? this.#pruneSources([...sources, ...this.#state.sources]) : this.#state.sources;
    this.#settleCompanion(this.#state.companion);
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
      this.#settleCompanion({ state: "confused", bubble: "截止时间格式无效，未保存修改。" });
      this.#save();
      return this.snapshot();
    }
    if (patch.snoozedUntil !== undefined && patch.snoozedUntil !== null && !isValidDateString(patch.snoozedUntil)) {
      this.#settleCompanion({ state: "confused", bubble: "稍后提醒时间无效，未保存修改。" });
      this.#save();
      return this.snapshot();
    }
    this.#state.items = this.#state.items.map((item) => {
      if (item.id !== id) return item;
      const updated: DdlItem = { ...item, ...patch, updatedAt: new Date().toISOString() } as DdlItem;
      if (Object.hasOwn(patch, "snoozedUntil") && patch.snoozedUntil == null) delete updated.snoozedUntil;
      if (Object.hasOwn(patch, "estimatedMinutes") && patch.estimatedMinutes == null) delete updated.estimatedMinutes;
      if (Object.hasOwn(patch, "progressPercent") && patch.progressPercent == null) delete updated.progressPercent;
      return updated;
    });
    const updated = this.#state.items.find((item) => item.id === id);
    if (updated && patch.dueAt !== undefined) {
      this.#state.taskPlans = this.#state.taskPlans.map((plan) => plan.taskId === id
        ? { ...plan, latestSafeStartAt: latestSafeStartAt(plan, updated.dueAt), updatedAt: new Date().toISOString() }
        : plan);
    }
    const scheduleCompanion = companionStateForItems(this.#state.items);
    this.#settleCompanion(updated?.completed && patch.completed === true
      && scheduleCompanion.state !== "deadline_near" && scheduleCompanion.state !== "overdue"
      ? { state: "celebrating", bubble: "完成得很干脆。" }
      : scheduleCompanion);
    this.#save();
    return this.snapshot();
  }

  markItemReminded(id: string): ChroniSnapshot {
    this.#state.items = this.#state.items.map((item) => item.id === id ? { ...item, lastRemindedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item);
    this.#settleCompanion(this.#state.companion);
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
    this.#settleCompanion();
    this.#save();
    return this.snapshot();
  }

  replaceSourceItems(sourceId: string, items: DdlItem[], message = "已重新识别来源。", options: ReplaceSourceItemsOptions = {}): ChroniSnapshot {
    const source = this.#state.sources.find((record) => record.id === sourceId);
    if (!source) {
      this.#settleCompanion({ state: "confused", bubble: "找不到原始输入，无法重新识别。" });
      this.#save();
      return this.snapshot();
    }
    const previousSourceItems = this.#state.items.filter((item) => item.sourceId === sourceId);
    const preserveTaskIds = new Set((options.preserveTaskIds ?? []).filter((id) => previousSourceItems.some((item) => item.id === id)));
    const unmatchedPrevious = previousSourceItems.filter((item) => !preserveTaskIds.has(item.id));
    const retainedCandidates = items.map((item) => {
      const previousIndex = bestPreviousMatchIndex(item, unmatchedPrevious);
      const previous = previousIndex >= 0 ? unmatchedPrevious.splice(previousIndex, 1)[0] : undefined;
      if (!previous) return { ...item, sourceId };
      return {
        ...item,
        id: previous.id,
        sourceId,
        completed: previous.completed,
        snoozedUntil: previous.snoozedUntil,
        lastRemindedAt: previous.lastRemindedAt,
        estimatedMinutes: previous.estimatedMinutes ?? item.estimatedMinutes,
        progressPercent: previous.progressPercent ?? item.progressPercent,
        createdAt: previous.createdAt,
      };
    });
    const existing = this.#state.items.filter((item) => item.sourceId !== sourceId || preserveTaskIds.has(item.id));
    const accepted = mergeNewItems(existing, retainedCandidates);
    if (items.length) this.#expirePendingDraftsForSources(new Set([sourceId]));
    this.#state.items = accepted;
    const validTaskIds = new Set(accepted.map((item) => item.id));
    this.#state.taskPlans = this.#state.taskPlans.filter((plan) => validTaskIds.has(plan.taskId));
    this.#state.taskPlanRevisions = this.#state.taskPlanRevisions.filter((revision) => validTaskIds.has(revision.taskId));
    this.#state.clarifications = this.#state.clarifications.filter((clarification) => !clarification.taskId || validTaskIds.has(clarification.taskId));
    this.#state.agent.behaviorMemory.recentFeedbackEvents = this.#state.agent.behaviorMemory.recentFeedbackEvents.filter((event) => validTaskIds.has(event.taskId));
    this.#state.taskPlans = this.#state.taskPlans.map((plan) => {
      const task = accepted.find((item) => item.id === plan.taskId);
      return task ? { ...plan, latestSafeStartAt: latestSafeStartAt(plan, task.dueAt) } : plan;
    });
    const itemIds = accepted.filter((item) => item.sourceId === sourceId).map((item) => item.id);
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
    this.#settleCompanion(itemIds.length
      ? { state: "success", bubble: message }
      : { state: "confused", bubble: "重新识别后没有明确 DDL。" });
    this.#save();
    return this.snapshot();
  }

  #expirePendingDraftsForSources(sourceIds: Set<string>): void {
    if (!sourceIds.size) return;
    const updatedAt = new Date().toISOString();
    const draftIds = new Set(this.#state.intakeDrafts
      .filter((draft) => draft.status === "needs-clarification" && draft.sourceId && sourceIds.has(draft.sourceId))
      .map((draft) => draft.id));
    if (!draftIds.size) return;
    this.#state.intakeDrafts = this.#state.intakeDrafts.map((draft) => draftIds.has(draft.id)
      ? { ...draft, status: "cancelled", updatedAt }
      : draft);
    this.#state.clarifications = this.#state.clarifications.map((clarification) => draftIds.has(clarification.draftId) && clarification.status === "pending"
      ? { ...clarification, status: "expired", answeredAt: updatedAt }
      : clarification);
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
    this.#settleCompanion(found
      ? { state: "confused", bubble: reason }
      : { state: "confused", bubble: "找不到原始输入，无法重新识别。" });
    this.#save();
    return this.snapshot();
  }

  markSourceAwaitingClarification(sourceId: string, reason: string): ChroniSnapshot {
    const updatedAt = new Date().toISOString();
    this.#state.sources = this.#state.sources.map((source) => source.id === sourceId
      ? { ...source, extractionStatus: "pending", lastError: reason, summary: `${source.sourceName}，等待确认并保留现有日程`, updatedAt, lastExtractedAt: updatedAt }
      : source);
    this.#settleCompanion({ state: "needs_clarification", bubble: reason });
    this.#save();
    return this.snapshot();
  }

  updatePreferences(patch: ChroniPreferencesPatch): ChroniSnapshot {
    if (patch.quietHoursStart !== undefined && !isValidClockTime(patch.quietHoursStart)) {
      this.#settleCompanion({ state: "confused", bubble: "勿扰时间格式无效，未保存修改。" });
      this.#save();
      return this.snapshot();
    }
    if (patch.quietHoursEnd !== undefined && !isValidClockTime(patch.quietHoursEnd)) {
      this.#settleCompanion({ state: "confused", bubble: "勿扰时间格式无效，未保存修改。" });
      this.#save();
      return this.snapshot();
    }
    if (patch.llm && Object.hasOwn(patch.llm, "apiKey")) this.#unreadableApiKeyProtected = undefined;
    this.#state.preferences = {
      ...this.#state.preferences,
      ...patch,
      llm: { ...this.#state.preferences.llm, ...(patch.llm ?? {}) },
    };
    if (!this.#state.preferences.companionEnabled) {
      this.#state.companion = { state: "sleeping", bubble: "桌宠入口已暂时关闭。" };
    } else this.#settleCompanion(patch.companionEnabled === true && this.#state.companion.state === "sleeping"
      ? companionStateForItems(this.#state.items)
      : this.#state.companion);
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
      storage: this.#storageStatus,
      ...(this.#storageDiagnostic ? { storageDiagnostic: this.#storageDiagnostic } : {}),
      modelEnvironmentConfigured: environmentConfigured,
      modelEnabledOverride: llmEnabledEnvironmentOverride(),
      storagePath: this.filePath,
      privacy: modelEnabled
        ? "日程、追问、计划和行为偏好保存在本机；启用 LLM 时，会发送日程识别所需文本片段（长文档可能分块覆盖全文）和选中的结构化偏好。"
        : "日程和来源保存在本机，未启用 LLM 时不会发送到模型服务。",
      notes: [
        ...(this.#storageDiagnostic ? [this.#storageDiagnostic] : []),
        ...(this.#unreadableApiKeyProtected ? ["已保留暂时无法解密的 LLM API Key 密文；在系统安全存储恢复前不会覆盖。"] : []),
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
      return this.#decodeState(readFileSync(this.filePath, "utf8"));
    } catch {
      const corruptPath = this.#preserveCorruptState();
      const backupPath = `${this.filePath}.backup`;
      if (existsSync(backupPath)) {
        try {
          const recovered = this.#decodeState(readFileSync(backupPath, "utf8"));
          this.#appendStorageDiagnostic(corruptPath
            ? "检测到本地状态文件损坏，已从自动备份恢复；损坏原件已另存为安全副本。"
            : "检测到本地状态文件损坏，已从自动备份恢复。", "recovered");
          return recovered;
        } catch {
          // The corrupt primary has already been preserved. Keep both files for diagnosis.
        }
      }
      this.#appendStorageDiagnostic(corruptPath
        ? "检测到本地状态文件损坏，未找到可用备份；损坏原件已另存为安全副本，当前使用新的空状态。"
        : "检测到本地状态文件损坏且无法创建安全副本；为避免覆盖原件，本次运行处于只读保护状态。",
      corruptPath ? "reset" : "read-only");
      return createDefaultState();
    }
  }

  #decodeState(raw: string): StoredState {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as Partial<StoredState> & {
      preferences?: Partial<ChroniPreferences> & { llm?: PersistedLlmSettings };
    };
    const fallback = createDefaultState();
    const rawPreferences = plainRecord(parsed.preferences);
    const persistedLlm = plainRecord(rawPreferences?.llm) as PersistedLlmSettings | undefined;
    const legacyApiKey = typeof persistedLlm?.apiKey === "string" ? persistedLlm.apiKey : "";
    const apiKeyProtected = typeof persistedLlm?.apiKeyProtected === "string" ? persistedLlm.apiKeyProtected : undefined;
    let apiKey = legacyApiKey;
    if (apiKeyProtected) {
      if (this.secretCodec) {
        try {
          apiKey = this.secretCodec.decrypt(apiKeyProtected);
        } catch {
          apiKey = "";
          this.#unreadableApiKeyProtected = apiKeyProtected;
        }
      } else this.#unreadableApiKeyProtected = apiKeyProtected;
    }
    if (legacyApiKey) this.#needsSecretMigration = true;
    const normalizedPreferences = normalizeChroniPreferences(parsed.preferences, persistedLlm, apiKey);
    if (normalizedPreferences.repaired) this.#appendStorageDiagnostic("已修复损坏或类型不正确的偏好设置，并对无效字段使用安全默认值。");
    const normalizedItems = normalizeDdlItems(parsed.items);
    if (normalizedItems.discarded) {
      this.#appendStorageDiagnostic(`已跳过 ${normalizedItems.discarded} 条损坏或不完整的日程记录，其余本地数据已正常载入。`);
    }
    const normalizedSources = normalizeSourceRecords(parsed.sources);
    if (normalizedSources.discarded) {
      this.#appendStorageDiagnostic(`已跳过 ${normalizedSources.discarded} 条损坏或不完整的来源记录。`);
    }
    const validSourceIds = new Set(normalizedSources.sources.map((source) => source.id));
    let detachedItemCount = 0;
    const items: DdlItem[] = normalizedItems.items.map((item): DdlItem => {
      if (!item.sourceId || validSourceIds.has(item.sourceId)) return item;
      detachedItemCount += 1;
      const { sourceId: _sourceId, ...detached } = item;
      return detached;
    });
    if (detachedItemCount) this.#appendStorageDiagnostic(`已修复 ${detachedItemCount} 条日程的失效来源引用，日程内容仍保留。`);
    const normalizedDrafts = normalizeIntakeDrafts(parsed.intakeDrafts, validSourceIds);
    const draftIds = new Set(normalizedDrafts.values.map((draft) => draft.id));
    const itemIds = new Set(items.map((item) => item.id));
    const normalizedClarifications = normalizePendingClarifications(parsed.clarifications, draftIds, validSourceIds, itemIds);
    const clarificationIdsByDraft = new Map<string, string[]>();
    for (const clarification of normalizedClarifications.values) {
      const ids = clarificationIdsByDraft.get(clarification.draftId) ?? [];
      ids.push(clarification.id);
      clarificationIdsByDraft.set(clarification.draftId, ids);
    }
    let repairedDraftLinks = 0;
    const intakeDrafts = normalizedDrafts.values.map((draft) => {
      const pendingClarificationIds = clarificationIdsByDraft.get(draft.id) ?? [];
      let status = draft.status;
      if (status === "needs-clarification" && !pendingClarificationIds.some((id) => normalizedClarifications.values.some((item) => item.id === id && item.status === "pending"))) {
        status = draft.candidate.title && draft.candidate.dueAt ? "ready" : "cancelled";
      }
      if (status !== draft.status || !sameStringArray(draft.pendingClarificationIds, pendingClarificationIds)) repairedDraftLinks += 1;
      return { ...draft, status, pendingClarificationIds };
    });
    const draftSourceIds = new Map(intakeDrafts.map((draft) => [draft.id, draft.sourceId]));
    const pendingSourceIds = new Set(normalizedClarifications.values
      .filter((clarification) => clarification.status === "pending")
      .map((clarification) => clarification.sourceId ?? draftSourceIds.get(clarification.draftId))
      .filter((sourceId): sourceId is string => !!sourceId));
    const linkedItemSourceIds = new Set(items.map((item) => item.sourceId).filter((sourceId): sourceId is string => !!sourceId));
    const sources = normalizedSources.sources.map((source) => pendingSourceIds.has(source.id) && !linkedItemSourceIds.has(source.id)
      ? {
          ...source,
          extractionStatus: "pending" as const,
          lastError: "等待用户补全截止时间等必要信息",
          summary: `${source.sourceName}，等待确认截止信息`,
        }
      : source);
    const taskById = new Map(items.map((item) => [item.id, item]));
    const normalizedPlans = normalizeTaskPlans(parsed.taskPlans, taskById);
    const planIds = new Set(normalizedPlans.values.map((plan) => plan.id));
    const normalizedRevisions = normalizeTaskPlanRevisions(parsed.taskPlanRevisions, itemIds, planIds);
    const normalizedAgent = normalizeAgentState(parsed.agent, itemIds);
    const recoveryDetails = [
      normalizationDetail("待确认草稿", normalizedDrafts, repairedDraftLinks),
      normalizationDetail("追问信息", normalizedClarifications),
      normalizationDetail("任务计划", normalizedPlans),
      normalizationDetail("计划版本", normalizedRevisions),
      normalizationDetail("Agent 状态", normalizedAgent),
    ].filter((detail): detail is string => !!detail);
    if (recoveryDetails.length) this.#appendStorageDiagnostic(`已清理本地状态中的异常记录：${recoveryDetails.join("；")}。`);
    const normalizedCompanion = normalizeCompanionState(parsed.companion, fallback.companion);
    if (normalizedCompanion.repaired) this.#appendStorageDiagnostic("已恢复无效的桌宠状态显示。");
    return synchronizeStateSourceItemIds({
      items,
      sources,
      intakeDrafts,
      clarifications: normalizedClarifications.values,
      taskPlans: normalizedPlans.values,
      taskPlanRevisions: normalizedRevisions.values,
      preferences: normalizedPreferences.value,
      companion: normalizedCompanion.value,
      petPlacement: isPetPlacement(parsed.petPlacement) ? { ...parsed.petPlacement } : undefined,
      agent: normalizedAgent.value,
    });
  }

  #preserveCorruptState(): string | undefined {
    const suffix = new Date().toISOString().replace(/[:.]/g, "-");
    const corruptPath = `${this.filePath}.corrupt-${suffix}`;
    try {
      renameSync(this.filePath, corruptPath);
      return corruptPath;
    } catch {
      try {
        copyFileSync(this.filePath, corruptPath);
        return corruptPath;
      } catch {
        this.#storageWriteBlocked = true;
        return undefined;
      }
    }
  }

  #save(): void {
    this.#synchronizeSourceItemIds();
    if (this.#storageWriteBlocked) throw new Error("本地状态文件处于只读保护状态：无法创建损坏文件的安全副本，未保存本次修改。");
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    if (existsSync(this.filePath) && !this.#needsSecretMigration) {
      let primaryValid = true;
      try {
        JSON.parse(readFileSync(this.filePath, "utf8").replace(/^\uFEFF/, ""));
      } catch {
        primaryValid = false;
        const corruptPath = this.#preserveCorruptState();
        if (this.#storageWriteBlocked) throw new Error("保存前发现本地状态文件损坏，且无法创建安全副本；未覆盖原文件，也未保存本次修改。");
        this.#appendStorageDiagnostic(corruptPath
          ? "保存前发现本地状态文件已损坏，已另存原件并使用内存中的有效状态继续保存。"
          : "保存前发现本地状态文件已损坏，已使用内存中的有效状态继续保存。");
      }
      if (primaryValid && existsSync(this.filePath)) {
        try {
          copyFileSync(this.filePath, `${this.filePath}.backup`);
        } catch {
          this.#appendStorageDiagnostic("本次未能刷新自动备份；主状态文件仍会使用原子写入保存。", "recovered");
        }
      }
    }
    const { apiKey, ...llm } = this.#state.preferences.llm;
    const apiKeyProtected = apiKey && this.secretCodec ? this.secretCodec.encrypt(apiKey) : this.#unreadableApiKeyProtected;
    const persistedState = {
      ...this.#state,
      preferences: {
        ...this.#state.preferences,
        llm: { ...llm, ...(apiKeyProtected ? { apiKeyProtected } : {}) },
      },
    };
    writeFileSync(tmp, JSON.stringify(persistedState, null, 2), "utf8");
    renameSync(tmp, this.filePath);
    if (apiKeyProtected) this.#unreadableApiKeyProtected = apiKeyProtected;
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

type NormalizedCollection<T> = { values: T[]; dropped: number; repaired: number };
type NormalizedValue<T> = { value: T; dropped: number; repaired: number };

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeChroniPreferences(value: unknown, llmValue: PersistedLlmSettings | undefined, apiKey: string): { value: ChroniPreferences; repaired: number } {
  const defaults = createDefaultPreferences();
  const input = plainRecord(value);
  const llm = plainRecord(llmValue);
  let repaired = value !== undefined && !input ? 1 : 0;
  const booleanField = <K extends "companionEnabled" | "remindersEnabled" | "quietHoursEnabled">(field: K): ChroniPreferences[K] => {
    if (!input || input[field] === undefined) return defaults[field];
    if (typeof input[field] === "boolean") return input[field] as ChroniPreferences[K];
    repaired += 1;
    return defaults[field];
  };
  const clockField = (field: "quietHoursStart" | "quietHoursEnd"): string => {
    if (!input || input[field] === undefined) return defaults[field];
    if (typeof input[field] === "string" && isValidClockTime(input[field] as string)) return input[field] as string;
    repaired += 1;
    return defaults[field];
  };
  const companionStyle = input?.companionStyle;
  if (companionStyle !== undefined && companionStyle !== "classic" && companionStyle !== "mint" && companionStyle !== "sunrise") repaired += 1;
  const llmInputWasInvalid = input?.llm !== undefined && !llm;
  if (llmInputWasInvalid) repaired += 1;
  const llmBoolean = llm?.enabled;
  if (llmBoolean !== undefined && typeof llmBoolean !== "boolean") repaired += 1;
  const llmProvider = llm?.provider;
  if (llmProvider !== undefined && llmProvider !== "openai-compatible") repaired += 1;
  const llmString = (field: "baseUrl" | "model", fallback: string): string => {
    const candidate = llm?.[field];
    if (candidate === undefined) return fallback;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, field === "baseUrl" ? 2_048 : 200);
    repaired += 1;
    return fallback;
  };
  let hotkey = defaults.hotkey;
  if (input?.hotkey !== undefined) {
    if (typeof input.hotkey === "string") hotkey = input.hotkey.slice(0, 100);
    else repaired += 1;
  }
  return {
    value: {
      companionEnabled: booleanField("companionEnabled"),
      companionStyle: companionStyle === "classic" || companionStyle === "mint" || companionStyle === "sunrise" ? companionStyle : defaults.companionStyle,
      remindersEnabled: booleanField("remindersEnabled"),
      quietHoursEnabled: booleanField("quietHoursEnabled"),
      quietHoursStart: clockField("quietHoursStart"),
      quietHoursEnd: clockField("quietHoursEnd"),
      hotkey,
      llm: {
        enabled: typeof llmBoolean === "boolean" ? llmBoolean : defaults.llm.enabled,
        provider: "openai-compatible",
        baseUrl: llmString("baseUrl", defaults.llm.baseUrl),
        apiKey,
        model: llmString("model", defaults.llm.model),
      },
    },
    repaired,
  };
}

function normalizeCompanionState(value: unknown, fallback: StoredState["companion"]): { value: StoredState["companion"]; repaired: number } {
  if (value === undefined) return { value: fallback, repaired: 0 };
  const input = plainRecord(value);
  const states: CompanionState[] = ["idle", "clicked", "hover_accept", "processing", "needs_clarification", "success", "confused", "deadline_near", "overdue", "celebrating", "sleeping"];
  if (!input || !states.includes(input.state as CompanionState) || typeof input.bubble !== "string" || !input.bubble.trim()) return { value: fallback, repaired: 1 };
  return { value: { state: input.state as CompanionState, bubble: input.bubble.trim().slice(0, 300) }, repaired: input.bubble.length > 300 ? 1 : 0 };
}

function normalizeIntakeDrafts(value: unknown, validSourceIds: Set<string>): NormalizedCollection<IntakeDraft> {
  if (!Array.isArray(value)) return { values: [], dropped: value === undefined ? 0 : 1, repaired: 0 };
  const values: IntakeDraft[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  let repaired = 0;
  for (const entry of value.slice(0, 100)) {
    const input = plainRecord(entry);
    const candidateInput = plainRecord(input?.candidate);
    const id = safeNonEmptyString(input?.id, 200);
    const sourceName = safeNonEmptyString(input?.sourceName, 260);
    const statuses: IntakeDraft["status"][] = ["needs-clarification", "ready", "applied", "cancelled"];
    if (!input || !candidateInput || !id || !sourceName || ids.has(id) || !statuses.includes(input.status as IntakeDraft["status"])) {
      dropped += 1;
      continue;
    }
    ids.add(id);
    const candidate: IntakeDraft["candidate"] = {};
    const title = safeNonEmptyString(candidateInput.title, 120);
    if (title) candidate.title = title;
    const dueAt = normalizedDate(candidateInput.dueAt);
    if (dueAt) candidate.dueAt = dueAt;
    else if (candidateInput.dueAt !== undefined) repaired += 1;
    if (candidateInput.importance === "high" || candidateInput.importance === "medium" || candidateInput.importance === "low") candidate.importance = candidateInput.importance;
    else if (candidateInput.importance !== undefined) repaired += 1;
    if (isBoundedInteger(candidateInput.estimatedMinutes, 15, 1_440)) candidate.estimatedMinutes = candidateInput.estimatedMinutes;
    else if (candidateInput.estimatedMinutes !== undefined) repaired += 1;
    if (isBoundedInteger(candidateInput.progressPercent, 0, 100)) candidate.progressPercent = candidateInput.progressPercent;
    else if (candidateInput.progressPercent !== undefined) repaired += 1;
    if (candidateInput.deliverables !== undefined) candidate.deliverables = safeStringList(candidateInput.deliverables, 20, 300);
    const taskType = safeNonEmptyString(candidateInput.taskType, 80);
    if (taskType) candidate.taskType = taskType;
    const sourceSummary = safeNonEmptyString(candidateInput.sourceSummary, 500);
    if (sourceSummary) candidate.sourceSummary = sourceSummary;
    const extraction = normalizeExtractionContext(candidateInput.extraction);
    if (extraction) candidate.extraction = extraction;
    const confidenceInput = plainRecord(input.confidence);
    const confidence: Record<string, number> = {};
    if (confidenceInput) {
      for (const [key, candidateValue] of Object.entries(confidenceInput).slice(0, 20)) {
        if (typeof candidateValue === "number" && Number.isFinite(candidateValue)) confidence[key.slice(0, 80)] = Math.max(0, Math.min(1, candidateValue));
        else repaired += 1;
      }
    } else if (input.confidence !== undefined) repaired += 1;
    const createdAt = normalizedDate(input.createdAt) ?? new Date().toISOString();
    const updatedAt = normalizedDate(input.updatedAt) ?? createdAt;
    if (!normalizedDate(input.createdAt) || !normalizedDate(input.updatedAt)) repaired += 1;
    const draft: IntakeDraft = {
      id,
      sourceName,
      sourceType: safeNonEmptyString(input.sourceType, 100) ?? "text",
      candidate,
      confidence,
      pendingClarificationIds: safeStringList(input.pendingClarificationIds, 50, 200),
      status: input.status as IntakeDraft["status"],
      createdAt,
      updatedAt,
    };
    const sourceId = safeNonEmptyString(input.sourceId, 200);
    if (sourceId && validSourceIds.has(sourceId)) draft.sourceId = sourceId;
    else if (sourceId) repaired += 1;
    const replacesTaskId = safeNonEmptyString(input.replacesTaskId, 200);
    if (replacesTaskId) draft.replacesTaskId = replacesTaskId;
    const appliedTaskId = safeNonEmptyString(input.appliedTaskId, 200);
    if (appliedTaskId) draft.appliedTaskId = appliedTaskId;
    values.push(draft);
  }
  dropped += Math.max(0, value.length - 100);
  return { values, dropped, repaired };
}

function normalizePendingClarifications(value: unknown, validDraftIds: Set<string>, validSourceIds: Set<string>, validTaskIds: Set<string>): NormalizedCollection<PendingClarification> {
  if (!Array.isArray(value)) return { values: [], dropped: value === undefined ? 0 : 1, repaired: 0 };
  const values: PendingClarification[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  let repaired = 0;
  const fields: PendingClarification["field"][] = ["title", "dueAt", "dueTime", "taskType", "deliverables", "estimatedMinutes", "progressPercent", "difficulty", "other"];
  const statuses: PendingClarification["status"][] = ["pending", "answered", "dismissed", "expired"];
  for (const entry of value.slice(0, 200)) {
    const input = plainRecord(entry);
    const id = safeNonEmptyString(input?.id, 200);
    const draftId = safeNonEmptyString(input?.draftId, 200);
    if (!input || !id || !draftId || ids.has(id) || !validDraftIds.has(draftId) || !fields.includes(input.field as PendingClarification["field"]) || !statuses.includes(input.status as PendingClarification["status"])) {
      dropped += 1;
      continue;
    }
    ids.add(id);
    const question = safeNonEmptyString(input.question, 160) ?? "请补充这条任务的必要信息。";
    const reason = safeNonEmptyString(input.reason, 240) ?? "原始信息不完整，需要确认后才能继续。";
    if (!safeNonEmptyString(input.question, 160) || !safeNonEmptyString(input.reason, 240)) repaired += 1;
    const options: PendingClarification["options"] = [];
    if (Array.isArray(input.options)) {
      const optionIds = new Set<string>();
      for (const optionEntry of input.options.slice(0, 8)) {
        const option = plainRecord(optionEntry);
        const optionId = safeNonEmptyString(option?.id, 80);
        const label = safeNonEmptyString(option?.label, 80);
        const optionValue = normalizeClarificationValue(option?.value);
        if (!option || !optionId || !label || optionValue === undefined || optionIds.has(optionId)) {
          repaired += 1;
          continue;
        }
        optionIds.add(optionId);
        const explanation = safeNonEmptyString(option.explanation, 200);
        options.push({ id: optionId, label, value: optionValue, ...(explanation ? { explanation } : {}) });
      }
    } else if (input.options !== undefined) repaired += 1;
    const createdAt = normalizedDate(input.createdAt) ?? new Date().toISOString();
    const clarification: PendingClarification = {
      id,
      draftId,
      field: input.field as PendingClarification["field"],
      question,
      reason,
      options,
      allowFreeText: typeof input.allowFreeText === "boolean" ? input.allowFreeText : true,
      required: typeof input.required === "boolean" ? input.required : true,
      status: input.status as PendingClarification["status"],
      createdAt,
      resumeToken: safeNonEmptyString(input.resumeToken, 200) ?? `recovered-${id}`,
    };
    if (typeof input.allowFreeText !== "boolean" || typeof input.required !== "boolean" || !normalizedDate(input.createdAt) || !safeNonEmptyString(input.resumeToken, 200)) repaired += 1;
    const sourceId = safeNonEmptyString(input.sourceId, 200);
    if (sourceId && validSourceIds.has(sourceId)) clarification.sourceId = sourceId;
    else if (sourceId) repaired += 1;
    const taskId = safeNonEmptyString(input.taskId, 200);
    if (taskId && validTaskIds.has(taskId)) clarification.taskId = taskId;
    else if (taskId) repaired += 1;
    const answeredAt = normalizedDate(input.answeredAt);
    if (answeredAt) clarification.answeredAt = answeredAt;
    else if (input.answeredAt !== undefined) repaired += 1;
    const answer = normalizeClarificationValue(input.answer);
    if (answer !== undefined) clarification.answer = answer;
    else if (input.answer !== undefined) repaired += 1;
    values.push(clarification);
  }
  dropped += Math.max(0, value.length - 200);
  return { values, dropped, repaired };
}

function normalizeClarificationValue(value: unknown): string | number | string[] | undefined {
  if (typeof value === "string") return value.slice(0, 2_000);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.map((item) => item.slice(0, 500)).slice(0, 20);
  return undefined;
}

function normalizeTaskPlans(value: unknown, taskById: Map<string, DdlItem>): NormalizedCollection<TaskPlan> {
  if (!Array.isArray(value)) return { values: [], dropped: value === undefined ? 0 : 1, repaired: 0 };
  const values: TaskPlan[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  let repaired = 0;
  for (const entry of value.slice(0, 500)) {
    const input = plainRecord(entry);
    const id = safeNonEmptyString(input?.id, 200);
    const taskId = safeNonEmptyString(input?.taskId, 200);
    const task = taskId ? taskById.get(taskId) : undefined;
    if (!input || !id || !taskId || !task || ids.has(id) || !Array.isArray(input.steps)) {
      dropped += 1;
      continue;
    }
    const steps: TaskPlan["steps"] = [];
    const stepIds = new Set<string>();
    for (const [index, stepEntry] of input.steps.slice(0, 12).entries()) {
      const stepInput = plainRecord(stepEntry);
      const stepId = safeNonEmptyString(stepInput?.id, 200);
      const title = safeNonEmptyString(stepInput?.title, 80);
      if (!stepInput || !stepId || !title || stepIds.has(stepId) || !isBoundedInteger(stepInput.estimatedMinutes, 15, 480)) {
        repaired += 1;
        continue;
      }
      const statuses: TaskPlan["steps"][number]["status"][] = ["pending", "in-progress", "blocked", "completed", "skipped"];
      const status = statuses.includes(stepInput.status as TaskPlan["steps"][number]["status"]) ? stepInput.status as TaskPlan["steps"][number]["status"] : "pending";
      const dependencies = safeStringList(stepInput.dependsOn, 12, 200).filter((dependency) => stepIds.has(dependency) && dependency !== stepId);
      if (dependencies.length !== safeStringList(stepInput.dependsOn, 12, 200).length || status !== stepInput.status || stepInput.taskId !== taskId || stepInput.order !== index + 1) repaired += 1;
      const createdAt = normalizedDate(stepInput.createdAt) ?? normalizedDate(input.createdAt) ?? new Date().toISOString();
      const updatedAt = normalizedDate(stepInput.updatedAt) ?? createdAt;
      const step: TaskPlan["steps"][number] = {
        id: stepId,
        taskId,
        title,
        description: typeof stepInput.description === "string" ? stepInput.description.slice(0, 500) : "",
        estimatedMinutes: stepInput.estimatedMinutes,
        order: steps.length + 1,
        dependsOn: dependencies,
        completionCriteria: safeStringList(stepInput.completionCriteria, 8, 200),
        status,
        origin: stepInput.origin === "user" ? "user" : "agent",
        userModifiedFields: safeStringList(stepInput.userModifiedFields, 20, 80),
        memoryPreferenceIds: safeStringList(stepInput.memoryPreferenceIds, 8, 200),
        createdAt,
        updatedAt,
      };
      const suggestedStartAt = normalizedDate(stepInput.suggestedStartAt);
      if (suggestedStartAt) step.suggestedStartAt = suggestedStartAt;
      const suggestedEndAt = normalizedDate(stepInput.suggestedEndAt);
      if (suggestedEndAt && new Date(suggestedEndAt).getTime() <= new Date(task.dueAt).getTime()) step.suggestedEndAt = suggestedEndAt;
      else if (stepInput.suggestedEndAt !== undefined) repaired += 1;
      stepIds.add(stepId);
      steps.push(step);
    }
    if (!steps.length) {
      dropped += 1;
      continue;
    }
    ids.add(id);
    const plannerSources: TaskPlan["plannerSource"][] = ["rules", "llm", "personalized-llm", "rules-fallback"];
    const statuses: TaskPlan["status"][] = ["draft", "active", "superseded"];
    const bufferMinutes = isBoundedInteger(input.bufferMinutes, 0, 1_440) ? input.bufferMinutes : 0;
    const estimatedTotalMinutes = steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
    if (bufferMinutes !== input.bufferMinutes || estimatedTotalMinutes !== input.estimatedTotalMinutes || !plannerSources.includes(input.plannerSource as TaskPlan["plannerSource"]) || !statuses.includes(input.status as TaskPlan["status"])) repaired += 1;
    const requiredConstraints = [
      ...(task.extraction?.constraints ?? []),
      ...(task.extraction?.submissionMethod ? [task.extraction.submissionMethod] : []),
    ];
    const createdAt = normalizedDate(input.createdAt) ?? new Date().toISOString();
    const updatedAt = normalizedDate(input.updatedAt) ?? createdAt;
    const plan: TaskPlan = {
      id,
      taskId,
      version: isBoundedInteger(input.version, 1, 100_000) ? input.version : 1,
      goal: safeNonEmptyString(input.goal, 200) ?? `完成「${task.title}」`,
      deliverables: groundedStringUnion(safeStringList(input.deliverables, 30, 300), task.extraction?.deliverables ?? []),
      constraints: groundedStringUnion(safeStringList(input.constraints, 30, 300), requiredConstraints),
      steps,
      estimatedTotalMinutes,
      bufferMinutes,
      plannerSource: plannerSources.includes(input.plannerSource as TaskPlan["plannerSource"]) ? input.plannerSource as TaskPlan["plannerSource"] : "rules-fallback",
      memoryPreferenceIds: safeStringList(input.memoryPreferenceIds, 50, 200),
      summary: safeNonEmptyString(input.summary, 500) ?? "已恢复任务规划，请在启用前核对执行步骤。",
      uncertainties: groundedStringUnion(safeStringList(input.uncertainties, 30, 300), task.extraction?.uncertainties ?? []),
      status: statuses.includes(input.status as TaskPlan["status"]) ? input.status as TaskPlan["status"] : "draft",
      createdAt,
      updatedAt,
    };
    const taskType = safeNonEmptyString(input.taskType, 80);
    if (taskType) plan.taskType = taskType;
    plan.latestSafeStartAt = normalizedDate(input.latestSafeStartAt) ?? latestSafeStartAt(plan, task.dueAt);
    values.push(plan);
  }
  dropped += Math.max(0, value.length - 500);
  return { values, dropped, repaired };
}

function normalizeTaskPlanRevisions(value: unknown, validTaskIds: Set<string>, validPlanIds: Set<string>): NormalizedCollection<TaskPlanRevision> {
  if (!Array.isArray(value)) return { values: [], dropped: value === undefined ? 0 : 1, repaired: 0 };
  const values: TaskPlanRevision[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  let repaired = 0;
  for (const entry of value.slice(0, 1_000)) {
    const input = plainRecord(entry);
    const id = safeNonEmptyString(input?.id, 200);
    const taskId = safeNonEmptyString(input?.taskId, 200);
    const planId = safeNonEmptyString(input?.planId, 200);
    if (!input || !id || !taskId || !planId || ids.has(id) || !validTaskIds.has(taskId) || !validPlanIds.has(planId)) {
      dropped += 1;
      continue;
    }
    const changes = Array.isArray(input.changes) ? input.changes.flatMap(normalizePlanChange).slice(0, 100) : [];
    if (!Array.isArray(input.changes) || changes.length !== input.changes.length) repaired += 1;
    ids.add(id);
    values.push({
      id,
      taskId,
      planId,
      fromVersion: isBoundedInteger(input.fromVersion, 0, 100_000) ? input.fromVersion : 0,
      toVersion: isBoundedInteger(input.toVersion, 1, 100_001) ? input.toVersion : 1,
      source: input.source === "agent" ? "agent" : "user",
      changes,
      createdAt: normalizedDate(input.createdAt) ?? new Date().toISOString(),
    });
  }
  dropped += Math.max(0, value.length - 1_000);
  return { values, dropped, repaired };
}

function normalizeAgentState(value: unknown, validTaskIds = new Set<string>()): NormalizedValue<StoredState["agent"]> {
  const input = plainRecord(value);
  if (!input) {
    return {
      value: { memory: createAgentMemory(), behaviorMemory: createBehaviorMemory(), traceHistory: [] },
      dropped: 0,
      repaired: value === undefined ? 0 : 1,
    };
  }
  const memory = normalizeAgentMemory(input.memory);
  const behaviorMemory = normalizeBehaviorMemory(input.behaviorMemory, validTaskIds);
  const latestRun = normalizeAgentRun(input.latestRun);
  const appliedPlan = normalizeAgentPlan(input.appliedPlan);
  const traceHistory: AgentTraceEntry[][] = [];
  let repairedTraceHistory = 0;
  if (Array.isArray(input.traceHistory)) {
    for (const trace of input.traceHistory.slice(0, 10)) {
      if (!Array.isArray(trace)) {
        repairedTraceHistory += 1;
        continue;
      }
      const normalized = normalizeTraceEntries(trace);
      repairedTraceHistory += normalized.dropped + normalized.repaired;
      if (normalized.values.length) traceHistory.push(normalized.values);
    }
  } else if (input.traceHistory !== undefined) repairedTraceHistory += 1;
  const lastAutomaticRunAt = normalizedDate(input.lastAutomaticRunAt);
  return {
    value: {
      memory: memory.value,
      behaviorMemory: behaviorMemory.value,
      ...(latestRun.value ? { latestRun: latestRun.value } : {}),
      ...(appliedPlan.value ? { appliedPlan: appliedPlan.value } : {}),
      ...(lastAutomaticRunAt ? { lastAutomaticRunAt } : {}),
      traceHistory,
    },
    dropped: behaviorMemory.dropped + latestRun.dropped + appliedPlan.dropped,
    repaired: memory.repaired + behaviorMemory.repaired + latestRun.repaired + appliedPlan.repaired + repairedTraceHistory + (input.lastAutomaticRunAt !== undefined && !lastAutomaticRunAt ? 1 : 0),
  };
}

function normalizeAgentMemory(value: unknown): { value: AgentMemory; repaired: number } {
  const defaults = createAgentMemory();
  const input = plainRecord(value);
  if (!input) return { value: defaults, repaired: value === undefined ? 0 : 1 };
  let repaired = 0;
  const maxDailyMinutes = isBoundedInteger(input.maxDailyMinutes, 30, 720) ? input.maxDailyMinutes : defaults.maxDailyMinutes;
  const workdayStart = typeof input.workdayStart === "string" && isValidClockTime(input.workdayStart) ? input.workdayStart : defaults.workdayStart;
  const workdayEnd = typeof input.workdayEnd === "string" && isValidClockTime(input.workdayEnd) ? input.workdayEnd : defaults.workdayEnd;
  const frequency = input.reminderFrequency === "important-only" || input.reminderFrequency === "daily" || input.reminderFrequency === "off" ? input.reminderFrequency : defaults.reminderFrequency;
  for (const [candidate, valid] of [
    [input.maxDailyMinutes, isBoundedInteger(input.maxDailyMinutes, 30, 720)],
    [input.workdayStart, typeof input.workdayStart === "string" && isValidClockTime(input.workdayStart)],
    [input.workdayEnd, typeof input.workdayEnd === "string" && isValidClockTime(input.workdayEnd)],
    [input.reminderFrequency, frequency === input.reminderFrequency],
    [input.automaticInspectionEnabled, typeof input.automaticInspectionEnabled === "boolean"],
    [input.useLlmPlanning, typeof input.useLlmPlanning === "boolean"],
  ] as Array<[unknown, boolean]>) if (candidate !== undefined && !valid) repaired += 1;
  return {
    value: {
      maxDailyMinutes,
      workdayStart,
      workdayEnd,
      reminderFrequency: frequency,
      automaticInspectionEnabled: typeof input.automaticInspectionEnabled === "boolean" ? input.automaticInspectionEnabled : defaults.automaticInspectionEnabled,
      useLlmPlanning: typeof input.useLlmPlanning === "boolean" ? input.useLlmPlanning : defaults.useLlmPlanning,
    },
    repaired,
  };
}

function normalizeBehaviorMemory(value: unknown, validTaskIds: Set<string>): NormalizedValue<AgentBehaviorMemory> {
  const input = plainRecord(value);
  if (!input) return { value: createBehaviorMemory(), dropped: 0, repaired: value === undefined ? 0 : 1 };
  const preferences: AgentBehaviorMemory["preferences"] = [];
  let dropped = 0;
  let repaired = 0;
  const preferenceIds = new Set<string>();
  if (Array.isArray(input.preferences)) {
    for (const entry of input.preferences.slice(0, 100)) {
      const preference = normalizePlanningPreference(entry);
      if (!preference || preferenceIds.has(preference.id)) {
        dropped += 1;
        continue;
      }
      preferenceIds.add(preference.id);
      preferences.push(preference);
    }
    dropped += Math.max(0, input.preferences.length - 100);
  } else if (input.preferences !== undefined) repaired += 1;
  const feedback = normalizePlanningFeedbackEvents(input.recentFeedbackEvents, validTaskIds);
  const lastUpdatedAt = normalizedDate(input.lastUpdatedAt);
  if (input.lastUpdatedAt !== undefined && !lastUpdatedAt) repaired += 1;
  return {
    value: {
      version: isBoundedInteger(input.version, 1, 100_000) ? input.version : 1,
      preferences,
      recentFeedbackEvents: feedback.values,
      learningEnabled: typeof input.learningEnabled === "boolean" ? input.learningEnabled : true,
      autoApplyEnabled: typeof input.autoApplyEnabled === "boolean" ? input.autoApplyEnabled : false,
      ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
    },
    dropped: dropped + feedback.dropped,
    repaired: repaired + feedback.repaired
      + (input.version !== undefined && !isBoundedInteger(input.version, 1, 100_000) ? 1 : 0)
      + (input.learningEnabled !== undefined && typeof input.learningEnabled !== "boolean" ? 1 : 0)
      + (input.autoApplyEnabled !== undefined && typeof input.autoApplyEnabled !== "boolean" ? 1 : 0),
  };
}

function normalizePlanningPreference(value: unknown): AgentBehaviorMemory["preferences"][number] | undefined {
  const input = plainRecord(value);
  const id = safeNonEmptyString(input?.id, 200);
  const keys: AgentBehaviorMemory["preferences"][number]["key"][] = ["preferredStepMinutes", "preferredStepCount", "bufferRatio", "estimateMultiplier", "preferReviewStep", "preferResearchBeforeExecution", "preferLongCoreWorkStep", "preferEarlyStart", "preferredPlanningGranularity"];
  if (!input || !id || !keys.includes(input.key as AgentBehaviorMemory["preferences"][number]["key"]) || !isPreferenceValue(input.value)) return undefined;
  const scopeInput = plainRecord(input.scope);
  const scope: AgentBehaviorMemory["preferences"][number]["scope"] = {};
  if (typeof scopeInput?.taskType === "string") scope.taskType = scopeInput.taskType.slice(0, 80);
  if (scopeInput?.importance === "high" || scopeInput?.importance === "medium" || scopeInput?.importance === "low") scope.importance = scopeInput.importance;
  if (scopeInput?.dueWindowBucket === "under-24h" || scopeInput?.dueWindowBucket === "1-3d" || scopeInput?.dueWindowBucket === "4-7d" || scopeInput?.dueWindowBucket === "over-7d") scope.dueWindowBucket = scopeInput.dueWindowBucket;
  return {
    id,
    key: input.key as AgentBehaviorMemory["preferences"][number]["key"],
    scope,
    value: input.value,
    confidence: boundedFiniteNumber(input.confidence, 0, 1, 0),
    evidenceCount: boundedIntegerOr(input.evidenceCount, 0, 100_000, 0),
    positiveEvidenceCount: boundedIntegerOr(input.positiveEvidenceCount, 0, 100_000, 0),
    negativeEvidenceCount: boundedIntegerOr(input.negativeEvidenceCount, 0, 100_000, 0),
    lastObservedAt: normalizedDate(input.lastObservedAt) ?? new Date().toISOString(),
    status: input.status === "active" || input.status === "disabled" ? input.status : "candidate",
    source: input.source === "explicit" ? "explicit" : "inferred",
    explanation: safeNonEmptyString(input.explanation, 500) ?? "已恢复一条规划偏好。",
  };
}

function normalizePlanningFeedbackEvents(value: unknown, validTaskIds: Set<string>): NormalizedCollection<PlanningFeedbackEvent> {
  if (!Array.isArray(value)) return { values: [], dropped: value === undefined ? 0 : 1, repaired: 0 };
  const values: PlanningFeedbackEvent[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  let repaired = 0;
  for (const entry of value.slice(0, 100)) {
    const input = plainRecord(entry);
    const context = plainRecord(input?.context);
    const id = safeNonEmptyString(input?.id, 200);
    const taskId = safeNonEmptyString(input?.taskId, 200);
    const planId = safeNonEmptyString(input?.planId, 200);
    const sources: PlanningFeedbackEvent["source"][] = ["plan-edit", "plan-accept", "plan-reset"];
    if (!input || !context || !id || !taskId || !planId || ids.has(id) || !validTaskIds.has(taskId) || !sources.includes(input.source as PlanningFeedbackEvent["source"])) {
      dropped += 1;
      continue;
    }
    ids.add(id);
    const changes = Array.isArray(input.changes) ? input.changes.flatMap(normalizePlanChange).slice(0, 100) : [];
    if (!Array.isArray(input.changes) || changes.length !== input.changes.length) repaired += 1;
    values.push({
      id,
      taskId,
      planId,
      planVersion: boundedIntegerOr(input.planVersion, 1, 100_000, 1),
      ...(safeNonEmptyString(input.taskType, 80) ? { taskType: safeNonEmptyString(input.taskType, 80) } : {}),
      source: input.source as PlanningFeedbackEvent["source"],
      changes,
      context: {
        dueWindowHours: boundedFiniteNumber(context.dueWindowHours, 0, 1_000_000, 0),
        importance: context.importance === "high" || context.importance === "low" ? context.importance : "medium",
        originalStepCount: boundedIntegerOr(context.originalStepCount, 0, 100, 0),
        finalStepCount: boundedIntegerOr(context.finalStepCount, 0, 100, 0),
        originalTotalMinutes: boundedFiniteNumber(context.originalTotalMinutes, 0, 1_000_000, 0),
        finalTotalMinutes: boundedFiniteNumber(context.finalTotalMinutes, 0, 1_000_000, 0),
        originalBufferMinutes: boundedFiniteNumber(context.originalBufferMinutes, 0, 1_440, 0),
        finalBufferMinutes: boundedFiniteNumber(context.finalBufferMinutes, 0, 1_440, 0),
      },
      createdAt: normalizedDate(input.createdAt) ?? new Date().toISOString(),
    });
  }
  dropped += Math.max(0, value.length - 100);
  return { values, dropped, repaired };
}

function normalizeAgentRun(value: unknown): NormalizedValue<AgentRunResult | undefined> {
  if (value === undefined) return { value: undefined, dropped: 0, repaired: 0 };
  const input = plainRecord(value);
  const id = safeNonEmptyString(input?.id, 200);
  const startedAt = normalizedDate(input?.startedAt);
  const completedAt = normalizedDate(input?.completedAt);
  if (!input || !id || !startedAt || !completedAt) return { value: undefined, dropped: 1, repaired: 0 };
  let repaired = 0;
  let dropped = 0;
  const observationInput = plainRecord(input.observation);
  if (!observationInput) repaired += 1;
  const activeTasks = normalizeDdlItems(observationInput?.activeTasks);
  dropped += activeTasks.discarded;
  const priorities: AgentRunResult["priorities"] = [];
  if (Array.isArray(input.priorities)) {
    for (const entry of input.priorities.slice(0, 200)) {
      const priority = normalizeAgentAssessment(entry);
      if (priority) priorities.push(priority);
      else dropped += 1;
    }
  } else if (input.priorities !== undefined) repaired += 1;
  const plan = normalizeAgentPlan(input.plan);
  repaired += plan.repaired;
  dropped += plan.dropped;
  const actions: AgentRunResult["actions"] = [];
  if (Array.isArray(input.actions)) {
    for (const entry of input.actions.slice(0, 100)) {
      const action = normalizeAgentAction(entry);
      if (action) actions.push(action);
      else dropped += 1;
    }
  } else if (input.actions !== undefined) repaired += 1;
  const trace = normalizeTraceEntries(input.trace);
  repaired += trace.repaired;
  dropped += trace.dropped;
  const verification = normalizeAgentVerification(input.verification);
  repaired += verification.repaired;
  const trigger = input.trigger === "manual" || input.trigger === "startup" || input.trigger === "daily" || input.trigger === "task-change" ? input.trigger : undefined;
  const plannerSource = input.plannerSource === "rules" || input.plannerSource === "llm" || input.plannerSource === "rules-fallback" ? input.plannerSource : undefined;
  if (input.trigger !== undefined && !trigger) repaired += 1;
  if (input.plannerSource !== undefined && !plannerSource) repaired += 1;
  const activeCount = activeTasks.items.filter((item) => !item.completed).length;
  const observation: AgentRunResult["observation"] = {
    observedAt: normalizedDate(observationInput?.observedAt) ?? startedAt,
    totalCount: boundedIntegerOr(observationInput?.totalCount, 0, 1_000_000, activeTasks.items.length),
    incompleteCount: boundedIntegerOr(observationInput?.incompleteCount, 0, 1_000_000, activeCount),
    activeCount: boundedIntegerOr(observationInput?.activeCount, 0, 1_000_000, activeCount),
    snoozedCount: boundedIntegerOr(observationInput?.snoozedCount, 0, 1_000_000, 0),
    overdueCount: boundedIntegerOr(observationInput?.overdueCount, 0, 1_000_000, 0),
    activeTasks: activeTasks.items,
  };
  return {
    value: {
      id,
      startedAt,
      completedAt,
      observation,
      priorities,
      plan: plan.value ?? emptyAgentPlan(),
      actions,
      verification: verification.value,
      suggestions: safeStringList(input.suggestions, 20, 500),
      trace: trace.values,
      ...(trigger ? { trigger } : {}),
      ...(plannerSource ? { plannerSource } : {}),
    },
    dropped,
    repaired: repaired + (!plan.value ? 1 : 0),
  };
}

function normalizeAgentAssessment(value: unknown): AgentRunResult["priorities"][number] | undefined {
  const input = plainRecord(value);
  const taskId = safeNonEmptyString(input?.taskId, 200);
  const title = safeNonEmptyString(input?.title, 120);
  const dueAt = normalizedDate(input?.dueAt);
  if (!input || !taskId || !title || !dueAt) return undefined;
  const risks: AgentRunResult["priorities"][number]["riskLevel"][] = ["low", "medium", "high", "critical"];
  const assessment: AgentRunResult["priorities"][number] = {
    taskId,
    title,
    dueAt,
    importance: input.importance === "high" || input.importance === "low" ? input.importance : "medium",
    riskLevel: risks.includes(input.riskLevel as AgentRunResult["priorities"][number]["riskLevel"]) ? input.riskLevel as AgentRunResult["priorities"][number]["riskLevel"] : "medium",
    score: boundedFiniteNumber(input.score, -1_000_000, 1_000_000, 0),
    estimatedMinutes: boundedFiniteNumber(input.estimatedMinutes, 0, 1_000_000, 0),
    reasons: safeStringList(input.reasons, 20, 500),
  };
  const nextStepId = safeNonEmptyString(input.nextStepId, 200);
  const nextStepTitle = safeNonEmptyString(input.nextStepTitle, 120);
  if (nextStepId) assessment.nextStepId = nextStepId;
  if (nextStepTitle) assessment.nextStepTitle = nextStepTitle;
  if (typeof input.nextStepMinutes === "number" && Number.isFinite(input.nextStepMinutes)) assessment.nextStepMinutes = Math.max(0, input.nextStepMinutes);
  if (typeof input.availableMinutesUntilDue === "number" && Number.isFinite(input.availableMinutesUntilDue)) assessment.availableMinutesUntilDue = input.availableMinutesUntilDue;
  if (typeof input.slackMinutes === "number" && Number.isFinite(input.slackMinutes)) assessment.slackMinutes = input.slackMinutes;
  if (typeof input.actionable === "boolean") assessment.actionable = input.actionable;
  return assessment;
}

function normalizeAgentPlan(value: unknown): NormalizedValue<AgentPlan | undefined> {
  if (value === undefined) return { value: undefined, dropped: 0, repaired: 0 };
  const input = plainRecord(value);
  if (!input) return { value: undefined, dropped: 1, repaired: 0 };
  const blocks = normalizeAgentWorkBlocks(input.blocks);
  const forecastBlocks = normalizeAgentWorkBlocks(input.forecastBlocks);
  const coverage: NonNullable<AgentPlan["coverage"]> = [];
  let dropped = blocks.dropped + forecastBlocks.dropped;
  let repaired = blocks.repaired + forecastBlocks.repaired;
  if (Array.isArray(input.coverage)) {
    for (const entry of input.coverage.slice(0, 500)) {
      const item = plainRecord(entry);
      const taskId = safeNonEmptyString(item?.taskId, 200);
      if (!item || !taskId) {
        dropped += 1;
        continue;
      }
      coverage.push({
        taskId,
        requiredMinutes: boundedFiniteNumber(item.requiredMinutes, 0, 1_000_000, 0),
        allocatedMinutes: boundedFiniteNumber(item.allocatedMinutes, 0, 1_000_000, 0),
        coveragePercent: boundedFiniteNumber(item.coveragePercent, 0, 100, 0),
      });
    }
  } else if (input.coverage !== undefined) repaired += 1;
  const plannerSource = input.plannerSource === "rules" || input.plannerSource === "llm" || input.plannerSource === "rules-fallback" ? input.plannerSource : undefined;
  const plan: AgentPlan = {
    blocks: blocks.values,
    plannedMinutes: boundedFiniteNumber(input.plannedMinutes, 0, 1_000_000, blocks.values.reduce((sum, block) => sum + block.allocatedMinutes, 0)),
    overflowMinutes: boundedFiniteNumber(input.overflowMinutes, 0, 1_000_000, 0),
    unplannedTaskIds: safeStringList(input.unplannedTaskIds, 500, 200),
    ...(forecastBlocks.values.length ? { forecastBlocks: forecastBlocks.values } : {}),
    ...(isBoundedInteger(input.forecastHorizonDays, 1, 365) ? { forecastHorizonDays: input.forecastHorizonDays } : {}),
    ...(typeof input.requestedMinutes === "number" && Number.isFinite(input.requestedMinutes) ? { requestedMinutes: Math.max(0, input.requestedMinutes) } : {}),
    ...(plannerSource ? { plannerSource } : {}),
    ...(safeNonEmptyString(input.fallbackReason, 500) ? { fallbackReason: safeNonEmptyString(input.fallbackReason, 500) } : {}),
    ...(coverage.length ? { coverage } : {}),
  };
  if (!Array.isArray(input.blocks) || (input.plannerSource !== undefined && !plannerSource)) repaired += 1;
  return { value: plan, dropped, repaired };
}

function emptyAgentPlan(): AgentPlan {
  return { blocks: [], plannedMinutes: 0, overflowMinutes: 0, unplannedTaskIds: [], plannerSource: "rules" };
}

function normalizeAgentWorkBlocks(value: unknown): NormalizedCollection<AgentPlan["blocks"][number]> {
  if (!Array.isArray(value)) return { values: [], dropped: value === undefined ? 0 : 1, repaired: 0 };
  const values: AgentPlan["blocks"] = [];
  let dropped = 0;
  for (const entry of value.slice(0, 500)) {
    const input = plainRecord(entry);
    const taskId = safeNonEmptyString(input?.taskId, 200);
    const title = safeNonEmptyString(input?.title, 160);
    const startAt = normalizedDate(input?.startAt);
    const endAt = normalizedDate(input?.endAt);
    if (!input || !taskId || !title || !startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime() || !isBoundedInteger(input.allocatedMinutes, 1, 1_440)) {
      dropped += 1;
      continue;
    }
    values.push({
      taskId,
      ...(safeNonEmptyString(input.stepId, 200) ? { stepId: safeNonEmptyString(input.stepId, 200) } : {}),
      title,
      startAt,
      endAt,
      allocatedMinutes: input.allocatedMinutes,
    });
  }
  dropped += Math.max(0, value.length - 500);
  return { values, dropped, repaired: 0 };
}

function normalizeAgentAction(value: unknown): AgentRunResult["actions"][number] | undefined {
  const input = plainRecord(value);
  const tool = safeNonEmptyString(input?.tool, 120);
  if (!input || !tool || (input.status !== "success" && input.status !== "failed" && input.status !== "skipped")) return undefined;
  return { tool, status: input.status, summary: safeNonEmptyString(input.summary, 500) ?? "该操作没有提供说明。" };
}

function normalizeAgentVerification(value: unknown): { value: AgentRunResult["verification"]; repaired: number } {
  const input = plainRecord(value);
  if (!input) return {
    value: { status: "attention", unresolvedHighRiskTaskIds: [], unplannedPriorityTaskIds: [], capacityOverflowMinutes: 0, summary: "历史巡检结果不完整，建议重新检查。" },
    repaired: value === undefined ? 1 : 1,
  };
  const statuses: AgentRunResult["verification"]["status"][] = ["healthy", "attention", "critical"];
  const verification: AgentRunResult["verification"] = {
    status: statuses.includes(input.status as AgentRunResult["verification"]["status"]) ? input.status as AgentRunResult["verification"]["status"] : "attention",
    unresolvedHighRiskTaskIds: safeStringList(input.unresolvedHighRiskTaskIds, 500, 200),
    unplannedPriorityTaskIds: safeStringList(input.unplannedPriorityTaskIds, 500, 200),
    capacityOverflowMinutes: boundedFiniteNumber(input.capacityOverflowMinutes, 0, 1_000_000, 0),
    summary: safeNonEmptyString(input.summary, 500) ?? "历史巡检结果已恢复，建议重新检查。",
  };
  if (Array.isArray(input.highRiskTaskIds)) verification.highRiskTaskIds = safeStringList(input.highRiskTaskIds, 500, 200);
  if (Array.isArray(input.mitigatedHighRiskTaskIds)) verification.mitigatedHighRiskTaskIds = safeStringList(input.mitigatedHighRiskTaskIds, 500, 200);
  if (typeof input.coveragePercent === "number" && Number.isFinite(input.coveragePercent)) verification.coveragePercent = Math.max(0, Math.min(100, input.coveragePercent));
  return {
    value: verification,
    repaired: (!statuses.includes(input.status as AgentRunResult["verification"]["status"]) || !safeNonEmptyString(input.summary, 500)) ? 1 : 0,
  };
}

function normalizeTraceEntries(value: unknown): NormalizedCollection<AgentTraceEntry> {
  if (!Array.isArray(value)) return { values: [], dropped: value === undefined ? 0 : 1, repaired: 0 };
  const values: AgentTraceEntry[] = [];
  let dropped = 0;
  let repaired = 0;
  const stages: AgentTraceEntry["stage"][] = ["observe", "plan", "act", "verify"];
  for (const [index, entry] of value.slice(0, 200).entries()) {
    const input = plainRecord(entry);
    const timestamp = normalizedDate(input?.timestamp);
    if (!input || !timestamp || !stages.includes(input.stage as AgentTraceEntry["stage"])) {
      dropped += 1;
      continue;
    }
    const dataInput = plainRecord(input.data);
    const data: AgentTraceEntry["data"] = {};
    if (dataInput) {
      for (const [key, candidate] of Object.entries(dataInput).slice(0, 50)) {
        if (typeof candidate === "string" || typeof candidate === "number" && Number.isFinite(candidate) || typeof candidate === "boolean" || candidate === null) data[key.slice(0, 100)] = candidate;
        else repaired += 1;
      }
    }
    values.push({
      id: safeNonEmptyString(input.id, 200) ?? `recovered-trace-${index + 1}`,
      sequence: index + 1,
      stage: input.stage as AgentTraceEntry["stage"],
      timestamp,
      summary: safeNonEmptyString(input.summary, 300) ?? "已恢复一条巡检记录。",
      success: typeof input.success === "boolean" ? input.success : true,
      data,
    });
  }
  dropped += Math.max(0, value.length - 200);
  return { values, dropped, repaired };
}

function normalizePlanChange(value: unknown): TaskPlanRevision["changes"] {
  const input = plainRecord(value);
  const stepId = safeNonEmptyString(input?.stepId, 200);
  if (!input || typeof input.type !== "string") return [];
  if (input.type === "step-added" && stepId) {
    const afterStepId = safeNonEmptyString(input.afterStepId, 200);
    return [{ type: "step-added", stepId, ...(afterStepId ? { afterStepId } : {}) }];
  }
  if (input.type === "step-removed" && stepId) return [{ type: "step-removed", stepId }];
  if (input.type === "step-reordered" && stepId && isBoundedInteger(input.fromOrder, 1, 100) && isBoundedInteger(input.toOrder, 1, 100)) {
    return [{ type: "step-reordered", stepId, fromOrder: input.fromOrder, toOrder: input.toOrder }];
  }
  if (input.type === "duration-changed" && stepId && isBoundedInteger(input.beforeMinutes, 0, 10_000) && isBoundedInteger(input.afterMinutes, 0, 10_000)) {
    return [{ type: "duration-changed", stepId, beforeMinutes: input.beforeMinutes, afterMinutes: input.afterMinutes }];
  }
  if (input.type === "title-changed" && stepId && typeof input.before === "string" && typeof input.after === "string") {
    return [{ type: "title-changed", stepId, before: input.before.slice(0, 80), after: input.after.slice(0, 80) }];
  }
  if (input.type === "buffer-changed" && isBoundedInteger(input.beforeMinutes, 0, 1_440) && isBoundedInteger(input.afterMinutes, 0, 1_440)) {
    return [{ type: "buffer-changed", beforeMinutes: input.beforeMinutes, afterMinutes: input.afterMinutes }];
  }
  return [];
}

function safeNonEmptyString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function safeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => item.trim().slice(0, maxLength))
    .slice(0, maxItems);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function boundedIntegerOr(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return isBoundedInteger(value, minimum, maximum) ? value : fallback;
}

function boundedFiniteNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function isPreferenceValue(value: unknown): value is number | boolean | string {
  return typeof value === "boolean" || typeof value === "string" && value.length <= 200 || typeof value === "number" && Number.isFinite(value);
}

function groundedStringUnion(values: string[], required: string[]): string[] {
  const result = [...values];
  for (const candidate of required) {
    const normalized = normalizeEvidence(candidate);
    if (!normalized || result.some((value) => {
      const existing = normalizeEvidence(value);
      return existing.includes(normalized) || normalized.includes(existing);
    })) continue;
    result.push(candidate.slice(0, 300));
  }
  return result.slice(0, 30);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizationDetail(label: string, result: { dropped: number; repaired: number }, extraRepaired = 0): string | undefined {
  const repaired = result.repaired + extraRepaired;
  if (!result.dropped && !repaired) return undefined;
  return `${label}${result.dropped ? `丢弃 ${result.dropped} 条` : ""}${result.dropped && repaired ? "、" : ""}${repaired ? `修复 ${repaired} 处` : ""}`;
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
    sourceSummary: draft.candidate.sourceSummary ?? `${draft.sourceName}: 用户补全后创建`,
    extraction: draft.candidate.extraction,
    createdAt: now,
    updatedAt: now,
    completed: false,
  };
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

function normalizeDdlItems(value: unknown): { items: DdlItem[]; discarded: number } {
  if (!Array.isArray(value)) return { items: [], discarded: value === undefined ? 0 : 1 };
  const items: DdlItem[] = [];
  const ids = new Set<string>();
  let discarded = 0;
  for (const entry of value) {
    const item = normalizeDdlItem(entry);
    if (!item || ids.has(item.id)) {
      discarded += 1;
      continue;
    }
    ids.add(item.id);
    items.push(item);
  }
  return { items, discarded };
}

function normalizeDdlItem(value: unknown): DdlItem | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
  const dueAt = normalizedDate(input.dueAt);
  if (!id || !title || !dueAt) return undefined;
  const createdAt = normalizedDate(input.createdAt) ?? new Date().toISOString();
  const updatedAt = normalizedDate(input.updatedAt) ?? createdAt;
  const importance = input.importance === "high" || input.importance === "low" || input.importance === "medium" ? input.importance : "medium";
  const result: DdlItem = {
    id,
    title,
    importance,
    dueAt,
    sourceSummary: typeof input.sourceSummary === "string" && input.sourceSummary.trim()
      ? input.sourceSummary.trim().slice(0, 500)
      : "本地历史记录：来源说明缺失",
    createdAt,
    updatedAt,
    completed: typeof input.completed === "boolean" ? input.completed : false,
  };
  if (typeof input.sourceId === "string" && input.sourceId.trim()) result.sourceId = input.sourceId.trim();
  const snoozedUntil = normalizedDate(input.snoozedUntil);
  if (snoozedUntil) result.snoozedUntil = snoozedUntil;
  const lastRemindedAt = normalizedDate(input.lastRemindedAt);
  if (lastRemindedAt) result.lastRemindedAt = lastRemindedAt;
  if (Number.isInteger(input.estimatedMinutes) && Number(input.estimatedMinutes) >= 15 && Number(input.estimatedMinutes) <= 1_440) result.estimatedMinutes = Number(input.estimatedMinutes);
  if (Number.isInteger(input.progressPercent) && Number(input.progressPercent) >= 0 && Number(input.progressPercent) <= 100) result.progressPercent = Number(input.progressPercent);
  const extraction = normalizeExtractionContext(input.extraction);
  if (extraction) result.extraction = extraction;
  return result;
}

function normalizeExtractionContext(value: unknown): DdlItem["extraction"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const stringList = (candidate: unknown, limit: number) => Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim().slice(0, 300)).slice(0, limit)
    : [];
  return {
    contextExcerpt: typeof input.contextExcerpt === "string" ? input.contextExcerpt.slice(0, 12_000) : "",
    deliverables: stringList(input.deliverables, 20),
    ...(typeof input.submissionMethod === "string" && input.submissionMethod.trim() ? { submissionMethod: input.submissionMethod.trim().slice(0, 500) } : {}),
    constraints: stringList(input.constraints, 20),
    risks: stringList(input.risks, 20),
    uncertainties: stringList(input.uncertainties, 20),
    reminderSuggestions: stringList(input.reminderSuggestions, 20),
  };
}

function normalizedDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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

function sourceForItem(item: DdlItem, sources: SourceRecord[]): SourceRecord | undefined {
  const expectedName = sourceNameFromSummary(item.sourceSummary);
  const named = sources.filter((source) => source.sourceName === expectedName);
  const evidence = sourceEvidenceFromSummary(item.sourceSummary);
  return named.find((source) => hasSourceEvidence(evidence, source.text))
    ?? sources.find((source) => hasSourceEvidence(evidence, source.text))
    ?? (named.length === 1 ? named[0] : undefined)
    ?? sources[0];
}

function sourceEvidenceFromSummary(summary: string): string {
  const separator = summary.indexOf(":");
  return separator >= 0 ? summary.slice(separator + 1) : summary;
}

function hasSourceEvidence(summary: string, sourceText: string): boolean {
  const needle = normalizeEvidence(summary);
  if (needle.length < 6) return false;
  return normalizeEvidence(sourceText).includes(needle);
}

function normalizeEvidence(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：,.!?:;()[\]【】《》"'“”‘’*_`#>~\-]/g, "")
    .toLowerCase();
}

function isSamePendingDraft(existing: IntakeDraft, candidate: IntakeDraft, existingClarifications: PendingClarification[], candidateClarifications: PendingClarification[]): boolean {
  if (existing.status !== "needs-clarification" || existing.sourceId !== candidate.sourceId) return false;
  if (existing.id === candidate.id) return true;
  const existingTokens = new Set(existingClarifications.filter((item) => item.draftId === existing.id).map((item) => item.resumeToken));
  if (candidateClarifications.some((item) => existingTokens.has(item.resumeToken))) return true;
  const leftEvidence = normalizeEvidence(existing.candidate.sourceSummary ?? "");
  const rightEvidence = normalizeEvidence(candidate.candidate.sourceSummary ?? "");
  if (leftEvidence.length < 6 || rightEvidence.length < 6 || !evidenceEquivalent(leftEvidence, rightEvidence)) return false;
  const leftTitle = normalizeTaskTitle(existing.candidate.title ?? "");
  const rightTitle = normalizeTaskTitle(candidate.candidate.title ?? "");
  if (leftTitle && rightTitle && leftTitle !== rightTitle) return false;
  const leftDueAt = existing.candidate.dueAt ? dateMinute(existing.candidate.dueAt) : undefined;
  const rightDueAt = candidate.candidate.dueAt ? dateMinute(candidate.candidate.dueAt) : undefined;
  return !leftDueAt || !rightDueAt || leftDueAt === rightDueAt;
}

function sameTaskOccurrence(left: DdlItem, right: DdlItem): boolean {
  if (dedupeKey(left) !== dedupeKey(right)) return false;
  if (left.sourceId !== right.sourceId) return false;
  const leftEvidence = normalizeEvidence(sourceEvidenceFromSummary(left.sourceSummary));
  const rightEvidence = normalizeEvidence(sourceEvidenceFromSummary(right.sourceSummary));
  if (leftEvidence.length >= 6 && rightEvidence.length >= 6) return evidenceEquivalent(leftEvidence, rightEvidence);
  return true;
}

function evidenceEquivalent(left: string, right: string): boolean {
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.8;
}

function normalizeTaskTitle(value: string): string {
  return value.replace(/(提交|完成|截止|任务)/g, "").replace(/\s+/g, "").toLowerCase();
}

function dateMinute(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 16);
}

function bestPreviousMatchIndex(candidate: DdlItem, previous: DdlItem[]): number {
  let bestIndex = -1;
  let bestScore = 64;
  for (const [index, item] of previous.entries()) {
    const score = previousMatchScore(item, candidate);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex;
}

function previousMatchScore(previous: DdlItem, candidate: DdlItem): number {
  if (sameTaskOccurrence(previous, { ...candidate, sourceId: previous.sourceId })) return 1_000;
  const previousTitle = normalizeTaskTitle(previous.title);
  const candidateTitle = normalizeTaskTitle(candidate.title);
  let score = previousTitle === candidateTitle
    ? 35
    : previousTitle.length >= 2 && candidateTitle.length >= 2 && (previousTitle.includes(candidateTitle) || candidateTitle.includes(previousTitle)) ? 20 : 0;
  const dueDifference = Math.abs(new Date(previous.dueAt).getTime() - new Date(candidate.dueAt).getTime());
  if (dueDifference <= 60_000) score += 45;
  else if (dueDifference <= 3_600_000) score += 30;
  else if (previous.dueAt.slice(0, 10) === candidate.dueAt.slice(0, 10)) score += 10;
  const previousEvidence = normalizeEvidence(sourceEvidenceFromSummary(previous.sourceSummary));
  const candidateEvidence = normalizeEvidence(sourceEvidenceFromSummary(candidate.sourceSummary));
  if (previousEvidence.length >= 6 && candidateEvidence.length >= 6) {
    score += evidenceEquivalent(previousEvidence, candidateEvidence) ? 50 : -60;
  }
  return score;
}

function latestSafeStartAt(plan: TaskPlan, dueAt: string): string {
  return new Date(new Date(dueAt).getTime() - (plan.estimatedTotalMinutes + plan.bufferMinutes) * 60_000).toISOString();
}

function pruneSources(sources: SourceRecord[], protectedSourceIds = new Set<string>()): SourceRecord[] {
  const sourceKey = (source: SourceRecord) => `${source.sourceName}|${createHash("sha256").update(source.text).digest("hex")}`;
  const protectedKeys = new Set(sources.filter((source) => protectedSourceIds.has(source.id)).map(sourceKey));
  const seenIds = new Set<string>();
  const seenUnprotectedKeys = new Set<string>();
  const unique: SourceRecord[] = [];
  for (const source of sources) {
    if (seenIds.has(source.id)) continue;
    seenIds.add(source.id);
    const key = sourceKey(source);
    if (protectedSourceIds.has(source.id)) {
      unique.push(source);
      seenUnprotectedKeys.add(key);
      continue;
    }
    if (protectedKeys.has(key) || seenUnprotectedKeys.has(key)) continue;
    seenUnprotectedKeys.add(key);
    unique.push(source);
  }
  const protectedCount = unique.filter((source) => protectedSourceIds.has(source.id)).length;
  let unprotectedRemaining = Math.max(0, 80 - protectedCount);
  return unique.filter((source) => {
    if (protectedSourceIds.has(source.id)) return true;
    if (!unprotectedRemaining) return false;
    unprotectedRemaining -= 1;
    return true;
  });
}

function mergeNewItems(existing: DdlItem[], candidates: DdlItem[]): DdlItem[] {
  const result = [...existing];
  const accepted = candidates.filter((item) => {
    if (result.some((candidate) => sameTaskOccurrence(candidate, item))) return false;
    result.push(item);
    return true;
  });
  return [...existing, ...accepted];
}

function synchronizeStateSourceItemIds(state: StoredState): StoredState {
  const itemIdsBySource = new Map<string, string[]>();
  for (const item of state.items) {
    if (!item.sourceId) continue;
    const ids = itemIdsBySource.get(item.sourceId) ?? [];
    ids.push(item.id);
    itemIdsBySource.set(item.sourceId, ids);
  }
  return {
    ...state,
    sources: state.sources.map((source) => ({ ...source, itemIds: [...new Set(itemIdsBySource.get(source.id) ?? [])] })),
  };
}

function isValidDateString(value: string): boolean {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isValidClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeSourceRecords(value: unknown): { sources: SourceRecord[]; discarded: number } {
  if (!Array.isArray(value)) return { sources: [], discarded: value === undefined ? 0 : 1 };
  const sources: SourceRecord[] = [];
  const ids = new Set<string>();
  let discarded = 0;
  for (const entry of value) {
    const source = normalizeSourceRecord(entry);
    if (!source || ids.has(source.id)) {
      discarded += 1;
      continue;
    }
    ids.add(source.id);
    sources.push(source);
  }
  return { sources, discarded };
}

function normalizeSourceRecord(value: unknown): SourceRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const sourceName = typeof source.sourceName === "string" ? source.sourceName.trim() : "";
  if (!id || !sourceName || typeof source.text !== "string") return undefined;
  const createdAt = normalizedDate(source.createdAt) ?? new Date().toISOString();
  const updatedAt = normalizedDate(source.updatedAt) ?? createdAt;
  return {
    id,
    sourceName,
    sourceType: typeof source.sourceType === "string" && source.sourceType.trim() ? source.sourceType.trim() : "text",
    text: source.text,
    summary: typeof source.summary === "string" && source.summary.trim() ? source.summary.trim().slice(0, 500) : `${sourceName}，历史来源`,
    extractionStatus: source.extractionStatus === "failed" || source.extractionStatus === "duplicate" || source.extractionStatus === "pending" ? source.extractionStatus : "success",
    ...(typeof source.lastError === "string" && source.lastError.trim() ? { lastError: source.lastError.trim().slice(0, 1_000) } : {}),
    createdAt,
    updatedAt,
    lastExtractedAt: normalizedDate(source.lastExtractedAt) ?? updatedAt,
    itemIds: Array.isArray(source.itemIds) ? source.itemIds.filter((item): item is string => typeof item === "string") : [],
  };
}
