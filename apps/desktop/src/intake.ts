import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import type { DdlExtractionContext, DdlItem, ChroniInputFile, ChroniLlmSettings, ExtractResult, ExtractedFailure, ExtractedInput, Importance, IntakeDraft, IntakePayload, IntakeResult, PendingExtractedTask, PendingClarification } from "./shared/types.js";
import type { ChroniStore } from "./store.js";
import { requestChatCompletion } from "./llm-client.js";
import { resolveLlmSettings } from "./llm-settings.js";
import { analyzeCompletenessWithLlm } from "./agent/clarification-agent.js";
import { selectPlanningPreferences } from "./agent/preference-selector.js";
import { generateTaskPlan } from "./agent/task-plan-agent.js";
import { deadlineDateFromText, isConditionalDeadlineText, stripDeadlineTemporalExpressions } from "./shared/deadline-text.js";
import { formatOperationError, formatUserFacingMessage } from "./shared/errors.js";
import { localFilePathFromText } from "./shared/local-file-input.js";

const plainTextExtensions = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".ics", ".log", ".html", ".htm", ".xml", ".yaml", ".yml", ".rtf"]);
const spreadsheetExtensions = new Set([".xlsx"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);
const unsupportedExtensions = new Set([".exe", ".dll", ".zip", ".rar", ".7z", ".mp4", ".mov", ".mp3", ".wav", ".app", ".dmg"]);

const maxTextBytes = 2 * 1024 * 1024;
const maxDocumentBytes = 18 * 1024 * 1024;
const minimumOcrConfidence = 55;
const llmChunkCharacters = 60_000;
const llmChunkOverlap = 800;

type ExtractOptions = {
  llm?: ChroniLlmSettings;
  /** Stable interpretation anchor for relative expressions during reprocessing. */
  referenceNow?: Date;
};

type LlmDdlCandidate = {
  title?: unknown;
  dueAt?: unknown;
  importance?: unknown;
  sourceSummary?: unknown;
  contextExcerpt?: unknown;
  deliverables?: unknown;
  submissionMethod?: unknown;
  constraints?: unknown;
  risks?: unknown;
  uncertainties?: unknown;
  reminderSuggestions?: unknown;
  taskType?: unknown;
};

type LlmPendingCandidate = Omit<LlmDdlCandidate, "dueAt"> & {
  question?: unknown;
  reason?: unknown;
};

type LlmExtraction = {
  items: DdlItem[];
  pendingItems: PendingExtractedTask[];
  attempted: number;
  rejected: number;
  errors: string[];
};

type WorkbookSheet = {
  sheet: string;
  data: unknown[][];
};

type TesseractResult = {
  data: { text: string; confidence?: number };
};

type TesseractModule = {
  recognize?: (input: Buffer | string, languages?: string, options?: { cachePath?: string }) => Promise<TesseractResult>;
  default?: {
    recognize?: (input: Buffer | string, languages?: string, options?: { cachePath?: string }) => Promise<TesseractResult>;
  };
};

export async function processIntake(payload: IntakePayload, store: ChroniStore): Promise<IntakeResult> {
  const pastedFilePath = payload.kind === "text" ? localFilePathFromText(payload.text) : undefined;
  if (pastedFilePath) store.discardPathOnlyTextIntake(pastedFilePath);
  store.setCompanion("processing", "正在识别 DDL...");
  const result = await extractPayload(payload, { llm: store.llmSettings() });
  if (!result.ok) {
    let clarificationSnapshot;
    let firstQuestion = "";
    for (const sourceInput of result.extracted) {
      for (const input of clarificationTaskInputs(sourceInput)) {
        const analysis = groundCompletenessAnalysis(
          await analyzeCompletenessWithLlm(input, resolveLlmSettings(store.llmSettings())),
          input,
        );
        if (analysis.status !== "needs-clarification") continue;
        clarificationSnapshot = store.saveIntakeDraft(analysis.draft, analysis.clarifications, sourceInput);
        firstQuestion ||= analysis.clarifications[0]?.question ?? "还需要确认任务信息。";
      }
    }
    if (clarificationSnapshot) {
      recordExtractionFailures(store, result.failures);
      return { ok: false, reason: `需要确认：${firstQuestion}`, snapshot: store.snapshot() };
    }
    const fallbackFailures = result.failures.length ? [] : fallbackExtractedInputs(payload, result.extracted);
    store.recordSourceFailure(fallbackFailures, result.reason);
    recordExtractionFailures(store, result.failures);
    const snapshot = store.setCompanion("confused", result.reason);
    return { ok: false, reason: result.reason, snapshot };
  }

  const incomplete: Array<{ sourceInput: ExtractedInput; analysis: Awaited<ReturnType<typeof analyzeCompletenessWithLlm>> }> = [];
  for (const sourceInput of result.extracted) {
    for (const input of ambiguousTaskInputs(sourceInput)) {
      if (result.pendingItems.some((pending) => pendingCoversInput(pending, input))) continue;
      const analysis = groundCompletenessAnalysis(
        await analyzeCompletenessWithLlm(input, resolveLlmSettings(store.llmSettings())),
        input,
      );
      if (analysis.clarifications.some((item) => item.required && item.field === "dueAt")) incomplete.push({ sourceInput, analysis });
    }
  }
  const extractedItems = result.items.filter((item) => !containsAmbiguousNextWeek(item.extraction?.contextExcerpt ?? sourceEvidence(item.sourceSummary)));
  const { items: safeItems, immediate: immediatePending, deferred: deferredPending } = classifyPendingItems(extractedItems, result.pendingItems);
  const immediateBlocking = incomplete.filter((entry) => !sourceHasResolvedItem(entry.sourceInput.sourceName, safeItems));
  const deferredBlocking = incomplete.filter((entry) => sourceHasResolvedItem(entry.sourceInput.sourceName, safeItems));
  const beforeIds = new Set(store.snapshot().items.map((item) => item.id));
  let snapshot = store.addItems(safeItems, result.message, result.extracted);
  const created = snapshot.items.filter((item) => !beforeIds.has(item.id));
  const planningFailureCount = await ensureTaskPlans(created.map((item) => item.id), store, "default");
  snapshot = store.snapshot();
  for (const pending of immediatePending) {
    const input = sourceInputForPending(pending, result.extracted);
    snapshot = savePendingExtractedTask(pending, store, input);
  }
  for (const pending of deferredPending) {
    const input = sourceInputForPending(pending, result.extracted);
    const relatedTask = matchingResolvedItem(pending, snapshot.items);
    snapshot = savePendingExtractedTask(pending, store, input, relatedTask?.id, false);
  }
  for (const entry of immediateBlocking) snapshot = store.saveIntakeDraft(entry.analysis.draft, entry.analysis.clarifications, entry.sourceInput);
  for (const entry of deferredBlocking) {
    snapshot = store.saveIntakeDraft(entry.analysis.draft, entry.analysis.clarifications.map((item) => ({ ...item, required: false })), entry.sourceInput);
  }
  snapshot = recordExtractionFailures(store, result.failures) ?? snapshot;
  const hasBlockedModelDeadline = immediatePending.some(isBlockedModelDeadline);
  if (!created.length && ((immediateBlocking.length && !immediatePending.length) || hasBlockedModelDeadline)) {
    const question = immediateBlocking[0]?.analysis.clarifications[0]?.question
      ?? immediatePending[0]?.question
      ?? "请补充截止时间。";
    return { ok: false, reason: `需要确认：${question}`, snapshot };
  }
  const duplicateOnly = !created.length && safeItems.length > 0 && !immediateBlocking.length && !immediatePending.length;
  const intakeMessage = duplicateOnly ? "识别到的日程已经存在，未重复添加。" : result.message;
  const requiredCount = immediateBlocking.length + immediatePending.length;
  const clarificationMessage = requiredCount ? `${intakeMessage} 另有 ${requiredCount} 项需要确认。` : intakeMessage;
  const planningFailureMessage = planningFailureCount ? ` ${planningFailureCount} 项执行规划暂未生成，可稍后在任务详情中重试。` : "";
  const message = `${clarificationMessage}${planningFailureMessage}`;
  if (created.length && planningFailureMessage) snapshot = store.setCompanion("success", message);
  return { ok: true, created, message, snapshot };
}

function savePendingExtractedTask(pending: PendingExtractedTask, store: ChroniStore, input?: ExtractedInput, replacesTaskId?: string, required = true) {
  const now = new Date().toISOString();
  const draftId = `draft-${randomUUID()}`;
  const draft: IntakeDraft = {
    id: draftId,
    ...(replacesTaskId ? { replacesTaskId } : {}),
    sourceName: pending.sourceName,
    sourceType: pending.sourceType,
    candidate: {
      title: pending.title,
      importance: pending.importance,
      taskType: pending.taskType,
      deliverables: pending.extraction.deliverables,
      sourceSummary: pending.sourceSummary,
      extraction: pending.extraction,
    },
    confidence: { title: 0.9, dueAt: 0, taskType: pending.taskType ? 0.8 : 0.4 },
    pendingClarificationIds: [],
    status: "needs-clarification",
    createdAt: now,
    updatedAt: now,
  };
  const clarification: PendingClarification = {
    id: `clarification-${randomUUID()}`,
    draftId,
    field: "dueAt",
    question: pending.question,
    reason: pending.reason,
    options: [],
    allowFreeText: true,
    required,
    status: "pending",
    createdAt: now,
    resumeToken: randomUUID(),
  };
  draft.pendingClarificationIds = [clarification.id];
  return store.saveIntakeDraft(draft, [clarification], input);
}

function classifyPendingItems(items: DdlItem[], pendingItems: PendingExtractedTask[]): { items: DdlItem[]; immediate: PendingExtractedTask[]; deferred: PendingExtractedTask[] } {
  const immediate: PendingExtractedTask[] = [];
  const deferred: PendingExtractedTask[] = [];
  const enrichedItems = items.map((item) => ({ ...item, extraction: item.extraction ? { ...item.extraction, uncertainties: [...item.extraction.uncertainties] } : undefined }));
  for (const pending of pendingItems) {
    if (!sourceHasResolvedItem(pending.sourceName, enrichedItems)) {
      immediate.push(pending);
      continue;
    }
    deferred.push(pending);
    const related = matchingResolvedItem(pending, enrichedItems);
    if (!related?.extraction) continue;
    const evidence = sourceEvidence(pending.sourceSummary).trim();
    const uncertainty = evidence || pending.reason;
    related.extraction.uncertainties = [...new Set([...related.extraction.uncertainties, uncertainty])].slice(0, 12);
  }
  return { items: enrichedItems, immediate, deferred };
}

function sourceHasResolvedItem(source: string, items: DdlItem[]): boolean {
  const normalized = source.trim().toLowerCase();
  return items.some((item) => sourceName(item.sourceSummary) === normalized);
}

function matchingResolvedItem(pending: PendingExtractedTask, items: DdlItem[]): DdlItem | undefined {
  const sameSource = items.filter((item) => sourceName(item.sourceSummary) === pending.sourceName.trim().toLowerCase());
  const titleMatch = sameSource.find((item) => sameTaskTitle(item.title, pending.title));
  if (titleMatch) return titleMatch;
  const evidence = normalizeEvidenceText(`${pending.title} ${sourceEvidence(pending.sourceSummary)}`);
  return sameSource
    .map((item) => ({ item, score: evidenceOverlapScore(evidence, normalizeEvidenceText(`${item.title} ${sourceEvidence(item.sourceSummary)}`)) }))
    .filter((entry) => entry.score >= 0.35)
    .sort((left, right) => right.score - left.score)[0]?.item;
}

export async function ensureTaskPlan(taskId: string, store: ChroniStore, regenerate = false, mode: "default" | "rules-only" = "default") {
  const snapshot = store.snapshot();
  const task = snapshot.items.find((item) => item.id === taskId);
  if (!task) throw new Error("找不到要规划的任务。");
  if (!regenerate && store.taskPlanByTaskId(taskId)) return store.taskPlanByTaskId(taskId)!;
  const taskType = /(作业|课程|实验|论文|考试|答辩)/.test(`${task.title} ${task.sourceSummary}`) ? "coursework" : "general";
  const preferences = selectPlanningPreferences(snapshot.agent.behaviorMemory, { taskType, importance: task.importance, dueAt: task.dueAt });
  const applied = snapshot.agent.behaviorMemory.autoApplyEnabled ? preferences : preferences.filter((item) => item.source === "explicit");
  const settings = resolveLlmSettings(store.llmSettings());
  const planningSettings = mode === "rules-only" || !snapshot.agent.memory.useLlmPlanning
    ? { ...settings, enabled: false }
    : settings;
  const plan = await generateTaskPlan(task, applied, planningSettings);
  return store.saveGeneratedTaskPlan(plan).plan;
}

async function ensureTaskPlans(taskIds: string[], store: ChroniStore, mode: "default" | "rules-only", regenerate = false): Promise<number> {
  const queue = [...new Set(taskIds)];
  const workerCount = Math.min(mode === "rules-only" ? 1 : 3, queue.length);
  let failureCount = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const taskId = queue.shift();
      if (!taskId) return;
      try {
        await ensureTaskPlan(taskId, store, regenerate, mode);
      } catch {
        failureCount += 1;
      }
    }
  }));
  return failureCount;
}

export async function reprocessSource(sourceId: string, store: ChroniStore): Promise<IntakeResult> {
  const source = store.sourceById(sourceId);
  if (!source) {
    const snapshot = store.setCompanion("confused", "找不到原始输入，无法重新识别。");
    return { ok: false, reason: "找不到原始输入。", snapshot };
  }
  store.setCompanion("processing", "正在重新识别来源...");
  const previousItems = store.snapshot().items.filter((item) => item.sourceId === sourceId);
  const referenceNow = stableSourceReferenceTime(source.createdAt);
  const result = await extractPayload({ kind: "text", text: source.text }, { llm: store.llmSettings(), referenceNow });
  if (!result.ok) {
    const snapshot = store.markSourceFailed(sourceId, result.reason);
    return { ok: false, reason: result.reason, snapshot };
  }
  const nextItems = result.items.map((item) => ({
    ...item,
    sourceId,
    sourceSummary: `${source.sourceName}: ${item.sourceSummary.replace(/^直接文本:\s*/, "")}`,
  }));
  const message = result.message.replace("已加入", "已重新识别");
  const unmatchedPreviousItems = previousItemsNotRepresented(previousItems, nextItems);
  const claimedReplacementIds = new Set<string>();
  const pendingReplacements = result.pendingItems.map((pending) => {
    const replacement = previousItemForPending(
      unmatchedPreviousItems.filter((item) => !claimedReplacementIds.has(item.id)),
      pending,
    );
    if (replacement) claimedReplacementIds.add(replacement.id);
    return { pending, replacement, required: !!replacement || !nextItems.length };
  });
  const preserveTaskIds = pendingReplacements.flatMap(({ replacement, required }) => replacement && required ? [replacement.id] : []);
  let snapshot = nextItems.length
    ? store.replaceSourceItems(sourceId, nextItems, message, { preserveTaskIds })
    : store.markSourceAwaitingClarification(sourceId, "重新识别后仍需确认截止时间，已保留现有日程。");
  const extracted: ExtractedInput = { sourceName: source.sourceName, sourceType: source.sourceType, text: source.text };
  for (const { pending, replacement, required } of pendingReplacements) {
    const normalizedPending = {
      ...pending,
      sourceName: source.sourceName,
      sourceType: source.sourceType,
      sourceSummary: `${source.sourceName}: ${pending.sourceSummary.replace(/^直接文本:\s*/, "")}`,
    };
    const relatedTask = replacement ?? matchingResolvedItem(normalizedPending, snapshot.items);
    snapshot = savePendingExtractedTask(normalizedPending, store, extracted, relatedTask?.id, required);
  }
  const preservedTaskIdSet = new Set(preserveTaskIds);
  const refreshedTaskIds = nextItems.length
    ? snapshot.items.filter((item) => item.sourceId === sourceId && !preservedTaskIdSet.has(item.id)).map((item) => item.id)
    : [];
  const planningFailureCount = await ensureTaskPlans(refreshedTaskIds, store, "default", true);
  snapshot = store.snapshot();
  const refreshedItems = snapshot.items.filter((item) => refreshedTaskIds.includes(item.id));
  const finalMessage = planningFailureCount ? `${message} ${planningFailureCount} 项执行规划暂未生成，可稍后重试。` : message;
  if (planningFailureCount && refreshedItems.length) snapshot = store.setCompanion("success", finalMessage);
  return { ok: true, created: refreshedItems, message: finalMessage, snapshot };
}

function sameTaskTitle(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/(提交|完成|截止|任务)/g, "").replace(/\s+/g, "").toLowerCase();
  const a = normalize(left);
  const b = normalize(right);
  return a.length >= 2 && b.length >= 2 && (a === b || a.includes(b) || b.includes(a));
}

function previousItemForPending(previousItems: DdlItem[], pending: PendingExtractedTask): DdlItem | undefined {
  const titleMatches = previousItems.filter((item) => sameTaskTitle(item.title, pending.title));
  if (titleMatches.length === 1) return titleMatches[0];
  const pendingEvidence = normalizeEvidenceText(sourceEvidence(pending.sourceSummary));
  const candidates = titleMatches.length ? titleMatches : previousItems;
  if (candidates.length === 1) return candidates[0];
  const best = candidates
    .map((item) => ({ item, overlap: evidenceOverlapScore(pendingEvidence, normalizeEvidenceText(sourceEvidence(item.sourceSummary))) }))
    .sort((left, right) => right.overlap - left.overlap)[0];
  return best && best.overlap >= (titleMatches.length ? 0.15 : 0.35) ? best.item : undefined;
}

function previousItemsNotRepresented(previousItems: DdlItem[], nextItems: DdlItem[]): DdlItem[] {
  const represented = new Set<string>();
  for (const nextItem of nextItems) {
    const candidates = previousItems.filter((previous) => !represented.has(previous.id) && sameTaskTitle(previous.title, nextItem.title));
    if (!candidates.length) continue;
    const exact = candidates.find((previous) => previous.dueAt.slice(0, 16) === nextItem.dueAt.slice(0, 16));
    const matched = exact ?? candidates
      .map((item) => ({ item, overlap: evidenceOverlapScore(normalizeEvidenceText(sourceEvidence(nextItem.sourceSummary)), normalizeEvidenceText(sourceEvidence(item.sourceSummary))) }))
      .sort((left, right) => right.overlap - left.overlap)[0]?.item;
    if (matched) represented.add(matched.id);
  }
  return previousItems.filter((item) => !represented.has(item.id));
}

function stableSourceReferenceTime(createdAt: string): Date {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function groundCompletenessAnalysis(
  analysis: Awaited<ReturnType<typeof analyzeCompletenessWithLlm>>,
  input: ExtractedInput,
): Awaited<ReturnType<typeof analyzeCompletenessWithLlm>> {
  const evidence = `${input.sourceName}: ${input.text.trim().slice(0, 2_000)}`;
  return {
    ...analysis,
    draft: {
      ...analysis.draft,
      candidate: { ...analysis.draft.candidate, sourceSummary: evidence },
    },
  };
}

function ambiguousTaskInputs(input: ExtractedInput): ExtractedInput[] {
  const segments = input.text
    .split(/[\r\n。；;.!?？]+/)
    .map((segment) => segment.trim())
    .filter((segment) => containsAmbiguousNextWeek(segment) && hasPossibleTaskWithoutDeadline(segment));
  return [...new Set(segments)].map((text) => ({ ...input, text }));
}

function clarificationTaskInputs(input: ExtractedInput): ExtractedInput[] {
  const segments = candidateLines(normalizeText(input.text)).filter(hasPossibleTaskWithoutDeadline);
  if (!segments.length) return hasPossibleTaskWithoutDeadline(input.text) ? [input] : [];
  return segments.map((text) => ({ ...input, text }));
}

function sourceInputForPending(pending: PendingExtractedTask, inputs: ExtractedInput[]): ExtractedInput | undefined {
  const sameName = inputs.filter((candidate) => candidate.sourceName === pending.sourceName);
  if (sameName.length <= 1) return sameName[0];
  const evidence = sourceEvidence(pending.sourceSummary);
  return sameName.find((candidate) => hasSourceEvidence(evidence, candidate.text)) ?? sameName[0];
}

function pendingCoversInput(pending: PendingExtractedTask, input: ExtractedInput): boolean {
  if (pending.sourceName !== input.sourceName) return false;
  const pendingEvidence = normalizeEvidenceText(sourceEvidence(pending.sourceSummary));
  const inputEvidence = normalizeEvidenceText(input.text);
  return Math.min(pendingEvidence.length, inputEvidence.length) >= 6
    && (pendingEvidence.includes(inputEvidence) || inputEvidence.includes(pendingEvidence));
}

function containsAmbiguousNextWeek(text: string): boolean {
  return /下周(?![一二三四五六日天])/.test(text);
}

export async function extractPayload(payload: IntakePayload, options: ExtractOptions = {}): Promise<ExtractResult> {
  const extracted: ExtractedInput[] = [];
  const failures: ExtractedFailure[] = [];
  const referenceNow = validReferenceTime(options.referenceNow);
  const pastedFilePath = payload.kind === "text" ? localFilePathFromText(payload.text) : undefined;
  const effectivePayload: IntakePayload = pastedFilePath
    ? { kind: "files", files: [{ name: basename(pastedFilePath), path: pastedFilePath }] }
    : payload;
  try {
    if (effectivePayload.kind === "text") {
      const text = effectivePayload.text?.trim() ?? "";
      if (!text) return { ok: false, reason: "输入内容为空。", extracted, failures, items: [], pendingItems: [] };
      extracted.push({ sourceName: "直接文本", sourceType: "text", text });
    } else {
      const fileResult = await extractFromFilesWithFailures(effectivePayload.files ?? []);
      extracted.push(...fileResult.extracted);
      failures.push(...fileResult.failures);
      if (!extracted.length && failures.length) {
        const reason = failures.length === 1 ? failures[0].reason : `${failures.length} 个文件无法读取或不支持。`;
        return { ok: false, reason, extracted, failures, items: [], pendingItems: [] };
      }
    }

    const llm = await extractWithLlmIfAvailable(extracted, options.llm, referenceNow);
    const ruleItems = extracted.flatMap((input) => extractDdlItemsFromText(input.text, input.sourceName, referenceNow));
    const pendingItems = llm.pendingItems.filter((pending) => ![...llm.items, ...ruleItems].some((item) => pendingCoversResolvedItem(pending, item)));
    const items = mergeModelAndRuleItems(llm.items, ruleItems, pendingItems);
    if (!items.length && !pendingItems.length) {
      if (llm.errors.length && isLlmEnabled(options.llm)) {
        return { ok: false, reason: "模型服务暂时不可用，请检查 API 配置和网络后重试。", extracted, failures, items: [], pendingItems: [] };
      }
      if (hasPossibleTaskWithoutDeadline(extracted.map((input) => input.text).join("\n"))) {
        return { ok: false, reason: "关键信息不足：没有明确截止时间。", extracted, failures, items: [], pendingItems: [] };
      }
      return { ok: false, reason: "没有识别到明确 DDL。", extracted, failures, items: [], pendingItems: [] };
    }
    const count = Math.min(items.length, 12);
    const message = extractionMessage(count, llm, pendingItems.length);
    return {
      ok: true,
      extracted,
      failures,
      items: mergeDuplicateItems(items).slice(0, 12),
      pendingItems: pendingItems.slice(0, 12),
      message,
    };
  } catch (error) {
    return {
      ok: false,
      reason: formatOperationError(error, "日程识别暂时不可用，请稍后重试。"),
      extracted,
      failures,
      items: [],
      pendingItems: [],
    };
  }
}

function extractionMessage(count: number, llm: LlmExtraction, pendingCount: number): string {
  if (pendingCount && !count) return `模型已识别 ${pendingCount} 项任务，等待补充精确截止时间。`;
  const pendingSuffix = pendingCount ? `，另记录 ${pendingCount} 项可选完善信息` : "";
  if (!llm.attempted) return count === 1 ? "已加入 1 条日程。" : `已加入 ${count} 条日程。`;
  if (llm.items.length && llm.errors.length) {
    return `模型已提取日程，另有 ${llm.errors.length} 个分块失败；共加入 ${count} 条日程。`;
  }
  if (llm.items.length) return `模型已参与提取，共加入 ${count} 条日程${pendingSuffix}。`;
  if (llm.errors.length) return `模型服务暂时不可用，已使用本地规则加入 ${count} 条日程。`;
  return `模型未返回有效日程，已使用本地规则加入 ${count} 条日程。`;
}

function recordExtractionFailures(store: ChroniStore, failures: ExtractedFailure[]) {
  let snapshot;
  for (const failure of failures) {
    snapshot = store.recordSourceFailure([failure], failure.reason);
  }
  return snapshot;
}

function isLlmEnabled(settings?: ChroniLlmSettings): boolean {
  return resolveLlmSettings(settings).enabled;
}

function hasPossibleTaskWithoutDeadline(text: string): boolean {
  return /(作业|报告|项目|提交|完成|ddl|deadline|due|考试|答辩|实验|汇报|presentation|quiz|任务|提醒)/i.test(text);
}

function fallbackExtractedInputs(payload: IntakePayload, extracted: ExtractedInput[]): ExtractedInput[] {
  if (extracted.length) return extracted;
  if (payload.kind === "text") {
    const text = payload.text?.trim() ?? "";
    return text ? [{ sourceName: "直接文本", sourceType: "text", text }] : [];
  }
  return (payload.files ?? []).map((file) => {
    const name = file.name || (file.path ? basename(file.path) : "未命名文件");
    const extension = extname(name || file.path || "").toLowerCase();
    return {
      sourceName: name,
      sourceType: extension ? extension.slice(1) : "unknown",
      text: "",
    };
  });
}

async function extractWithLlmIfAvailable(extracted: ExtractedInput[], settings: ChroniLlmSettings | undefined, referenceNow: Date): Promise<LlmExtraction> {
  const resolvedSettings = resolveLlmSettings(settings);
  const result: LlmExtraction = { items: [], pendingItems: [], attempted: 0, rejected: 0, errors: [] };
  if (!resolvedSettings.enabled || !resolvedSettings.apiKey || !resolvedSettings.model) return result;

  const today = referenceNow.toISOString();
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  for (const [sourceIndex, input] of extracted.entries()) {
    const sourceId = `source-${sourceIndex + 1}`;
    const chunks = splitTextForLlm(input.text);
    for (const [chunkIndex, chunk] of chunks.entries()) {
      result.attempted += 1;
      try {
        const content = await requestChatCompletion(resolvedSettings, [
      {
        role: "system",
        content: [
          "你是 Chroni 的 DDL 信息抽取器。",
          "只输出 JSON，不输出解释。",
          "从输入中完整抽取明确的截止事项，以及需要准备或参加的固定时间活动。",
          "同一段中同时存在材料提交截止和活动开始时间时，必须分别输出两项，不能只保留材料截止。",
          "deliverables 必须逐项完整列出原文中的所有提交物，不得合并成泛化描述或省略条目。",
          "不要把文档的用途、希望系统输出、个人偏好本身当作任务。",
          "字段结构固定：{\"items\":[{\"title\":\"短标题\",\"dueAt\":\"ISO-8601时间\",\"importance\":\"high|medium|low\",\"sourceSummary\":\"原文截止句\",\"contextExcerpt\":\"包含要求的原文片段\",\"deliverables\":[],\"submissionMethod\":\"\",\"constraints\":[],\"risks\":[],\"uncertainties\":[],\"reminderSuggestions\":[],\"taskType\":\"\"}],\"pendingItems\":[{\"title\":\"短标题\",\"importance\":\"high|medium|low\",\"sourceSummary\":\"原文片段\",\"contextExcerpt\":\"原文片段\",\"deliverables\":[],\"question\":\"需要向用户确认的问题\",\"reason\":\"不能安全确定的原因\"}]}。",
          "title 控制在 16 个中文字符以内。",
          "dueAt 必须是包含时区的 ISO-8601 字符串。",
          "原文未写明时区时，必须按用户时区解释日期和时间。",
          "sourceSummary 和 contextExcerpt 必须直接摘自原文，不得改写；允许去掉 Markdown 标记。contextExcerpt 应尽量覆盖该任务的提交物、提交方式、限制和风险。",
          "deliverables、submissionMethod、constraints、risks、uncertainties、reminderSuggestions 必须能在原文中找到依据，不得补写常识。",
          "只有日期、课次或时段但无法换算成精确钟点、因而无法建立可靠日程的独立任务，才放入 pendingItems；禁止擅自使用 23:59。",
          "如果同一任务已有明确正式截止，又出现“可能提前”“以通知为准”等条件性候选时间：保留正式截止在 items，把候选变更原文写入该 item 的 uncertainties，并把确认通知的建议写入 reminderSuggestions；不得额外创建正式任务。",
          "缺失提交平台、非关键格式或活动的精确课次钟点，不得阻止同一文档中其他明确任务的抽取与规划；可放入 pendingItems 供主计划完成后再完善。",
          "先完整输出所有可直接执行的 items，再记录 pendingItems；不得因为存在次要缺失信息而减少或拒绝明确任务。",
          "即使没有日程，也必须输出 JSON：{\"items\":[],\"pendingItems\":[]}。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `当前时间：${today}`,
          `用户时区：${userTimeZone}`,
          `来源 ID：${sourceId}`,
          `来源文件：${input.sourceName}`,
          `分块：${chunkIndex + 1}/${chunks.length}`,
          "请从以下原文中抽取 DDL，并输出 JSON：",
          chunk,
        ].join("\n"),
      },
    ], {
      body: {
        temperature: 0,
        max_tokens: 8_192,
        response_format: { type: "json_object" },
      },
        });
        const parsed = parseLlmJson(content);
        const candidates = Array.isArray(parsed.items) ? parsed.items as LlmDdlCandidate[] : [];
        for (const candidate of candidates) {
          const item = itemFromLlmCandidate(candidate, input.text, input.sourceName, referenceNow);
          if (item) result.items.push(item);
          else {
            const pending = pendingItemFromImpreciseCandidate(candidate, input, referenceNow);
            if (pending) result.pendingItems.push(pending);
            else result.rejected += 1;
          }
        }
        const pendingCandidates = Array.isArray(parsed.pendingItems) ? parsed.pendingItems as LlmPendingCandidate[] : [];
        for (const candidate of pendingCandidates) {
          const pending = pendingItemFromLlmCandidate(candidate, input);
          if (pending) result.pendingItems.push(pending);
          else result.rejected += 1;
        }
      } catch (error) {
        const detail = formatUserFacingMessage(error, "模型服务暂时不可用，请稍后重试。");
        result.errors.push(`${input.sourceName} 第 ${chunkIndex + 1}/${chunks.length} 段：${detail}`);
      }
    }
  }
  result.items = mergeDuplicateItems(result.items);
  result.pendingItems = mergePendingItems(result.pendingItems);
  return result;
}

export function splitTextForLlm(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= llmChunkCharacters) return [normalized];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + llmChunkCharacters, normalized.length);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf("\n", end), normalized.lastIndexOf("。", end));
      if (boundary > start + llmChunkCharacters * 0.75) end = boundary + 1;
    }
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - llmChunkOverlap);
  }
  return chunks;
}

function parseLlmJson(content: string): { items?: unknown; pendingItems?: unknown } {
  const trimmed = content.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as { items?: unknown; pendingItems?: unknown };
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) as { items?: unknown; pendingItems?: unknown } : {};
  }
}

export function itemFromLlmCandidate(candidate: LlmDdlCandidate, evidenceText = "", sourceName = "", referenceNow = new Date()): DdlItem | null {
  const title = String(candidate.title ?? "").trim().slice(0, 16);
  const dueAtRaw = String(candidate.dueAt ?? "").trim();
  const sourceSummary = String(candidate.sourceSummary ?? title).trim().slice(0, 500);
  if (!title || !hasDeadlineIntent(`${title} ${sourceSummary}`)) return null;
  if (evidenceText && !hasSourceEvidence(sourceSummary, evidenceText)) return null;
  if (modelDeadlineEvidenceStatus(dueAtRaw, sourceSummary, referenceNow) !== "grounded") return null;
  const dueAt = strictIsoDate(dueAtRaw);
  if (!dueAt) return null;
  const importance = candidate.importance === "high" || candidate.importance === "medium" || candidate.importance === "low"
    ? candidate.importance
    : importanceFromText(`${title} ${sourceSummary}`);
  const extraction = extractionContextFromCandidate(candidate, evidenceText, sourceSummary);
  return createItem(title, dueAt.toISOString(), sourceName ? `${sourceName}: ${sourceSummary}` : sourceSummary, importance, extraction);
}

function pendingItemFromImpreciseCandidate(candidate: LlmDdlCandidate, input: ExtractedInput, referenceNow: Date): PendingExtractedTask | null {
  const title = String(candidate.title ?? "").trim().slice(0, 80);
  const sourceSummary = String(candidate.sourceSummary ?? "").trim().slice(0, 500);
  const evidenceStatus = modelDeadlineEvidenceStatus(String(candidate.dueAt ?? "").trim(), sourceSummary, referenceNow);
  if (!title || !sourceSummary || evidenceStatus === "grounded" || !hasSourceEvidence(sourceSummary, input.text)) return null;
  const importance = candidate.importance === "high" || candidate.importance === "medium" || candidate.importance === "low"
    ? candidate.importance
    : importanceFromText(`${title} ${sourceSummary}`);
  return {
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    title,
    importance,
    taskType: typeof candidate.taskType === "string" ? candidate.taskType.trim().slice(0, 80) : undefined,
    sourceSummary: `${input.sourceName}: ${sourceSummary}`,
    extraction: extractionContextFromCandidate(candidate, input.text, sourceSummary),
    question: evidenceStatus === "conditional" ? `“${title}”的候选截止时间是否已经正式生效？` : `“${title}”的准确截止日期和时间是什么？`,
    reason: modelDeadlineIssueReason(evidenceStatus),
  };
}

function pendingItemFromLlmCandidate(candidate: LlmPendingCandidate, input: ExtractedInput): PendingExtractedTask | null {
  const title = String(candidate.title ?? "").trim().slice(0, 80);
  const sourceSummary = String(candidate.sourceSummary ?? "").trim().slice(0, 500);
  const question = String(candidate.question ?? "").trim().slice(0, 160);
  const reason = String(candidate.reason ?? "").trim().slice(0, 240);
  if (!title || !sourceSummary || !question || !reason || !hasSourceEvidence(sourceSummary, input.text)) return null;
  const importance = candidate.importance === "high" || candidate.importance === "medium" || candidate.importance === "low"
    ? candidate.importance
    : importanceFromText(`${title} ${sourceSummary}`);
  return {
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    title,
    importance,
    taskType: typeof candidate.taskType === "string" ? candidate.taskType.trim().slice(0, 80) : undefined,
    sourceSummary: `${input.sourceName}: ${sourceSummary}`,
    extraction: extractionContextFromCandidate(candidate, input.text, sourceSummary),
    question,
    reason,
  };
}

function extractionContextFromCandidate(candidate: LlmDdlCandidate, evidenceText: string, sourceSummary: string): DdlExtractionContext {
  const proposedContext = String(candidate.contextExcerpt ?? "").trim().slice(0, 2_000);
  const contextExcerpt = proposedContext && (!evidenceText || hasSourceEvidence(proposedContext, evidenceText))
    ? proposedContext
    : sourceSummary;
  const submissionMethod = groundedString(candidate.submissionMethod, evidenceText, 300);
  return {
    contextExcerpt,
    deliverables: groundedStrings(candidate.deliverables, evidenceText, 12, 200),
    ...(submissionMethod ? { submissionMethod } : {}),
    constraints: groundedStrings(candidate.constraints, evidenceText, 12, 300),
    risks: groundedStrings(candidate.risks, evidenceText, 12, 300),
    uncertainties: groundedStrings(candidate.uncertainties, evidenceText, 12, 300),
    reminderSuggestions: groundedStrings(candidate.reminderSuggestions, evidenceText, 8, 200),
  };
}

function groundedStrings(value: unknown, evidenceText: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => groundedString(entry, evidenceText, maxLength))
    .filter((entry): entry is string => !!entry))]
    .slice(0, maxItems);
}

function groundedString(value: unknown, evidenceText: string, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, maxLength);
  if (!text || (evidenceText && !hasSourceEvidence(text, evidenceText, 2) && evidenceSimilarity(text, evidenceText) < 0.55)) return undefined;
  return text;
}

function evidenceSimilarity(value: string, evidenceText: string): number {
  const candidate = normalizeEvidenceText(value);
  const evidence = normalizeEvidenceText(evidenceText);
  if (candidate.length < 4) return 0;
  const pairs = Array.from({ length: candidate.length - 1 }, (_, index) => candidate.slice(index, index + 2));
  return pairs.filter((pair) => evidence.includes(pair)).length / pairs.length;
}

function hasSourceEvidence(sourceSummary: string, evidenceText: string, minimumLength = 6): boolean {
  const summary = normalizeEvidenceText(sourceSummary);
  const evidence = normalizeEvidenceText(evidenceText);
  if (summary.length < minimumLength) return false;
  return evidence.includes(summary);
}

function normalizeEvidenceText(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：,.!?:;()[\]【】《》"'“”‘’*_`#>~\-]/g, "")
    .toLowerCase();
}

type ModelDeadlineEvidenceStatus = "grounded" | "conditional" | "ambiguous" | "mismatch" | "missing";

function modelDeadlineEvidenceStatus(dueAtRaw: string, sourceSummary: string, referenceNow: Date): ModelDeadlineEvidenceStatus {
  if (isConditionalDeadlineText(sourceSummary)) return "conditional";
  const parsedEvidence = deadlineDateFromText(sourceSummary, referenceNow);
  if (!parsedEvidence) return hasDeadlineTemporalReference(sourceSummary) ? "ambiguous" : "missing";
  if (!strictIsoDate(dueAtRaw)) return "mismatch";
  return deadlineEvidenceMatches(dueAtRaw, parsedEvidence) ? "grounded" : "mismatch";
}

function deadlineEvidenceMatches(dueAtRaw: string, parsedEvidence: string): boolean {
  const candidate = strictIsoDate(dueAtRaw);
  const evidenceDate = new Date(parsedEvidence);
  return !!candidate && !Number.isNaN(evidenceDate.getTime())
    && Math.abs(candidate.getTime() - evidenceDate.getTime()) < 60_000;
}

function hasDeadlineTemporalReference(text: string): boolean {
  return /20\d{2}\s*[年/.\-]|\d{1,2}\s*[月/.\-]\s*\d{1,2}|今天|今日|今早|今晚|明天|明日|明早|明晚|后天|后日|\d+\s*天后|(?:上|下|本|这)?(?:个)?(?:周|星期)[一二三四五六日天]?|第[一二三四五六七八九十\d]+节|上午|下午|晚上|中午|凌晨|早上|早晨|傍晚|\d{1,2}\s*[:：点时]/i.test(text);
}

function modelDeadlineIssueReason(status: Exclude<ModelDeadlineEvidenceStatus, "grounded">): string {
  if (status === "conditional") return "原文说明该变更仍取决于后续条件或通知，不能直接覆盖正式截止时间。";
  if (status === "mismatch") return "模型返回的时间与原文时间证据不一致，已阻止直接创建日程。";
  if (status === "ambiguous") return "原文只有日期、课次或模糊时段，无法安全换算为准确截止时间。";
  return "原文没有可验证的截止时间，模型给出的时间不能直接采用。";
}

function isBlockedModelDeadline(pending: PendingExtractedTask): boolean {
  return (["conditional", "ambiguous", "mismatch", "missing"] as const)
    .some((status) => pending.reason === modelDeadlineIssueReason(status));
}

function evidenceOverlapScore(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length < 2) return 0;
  const pairs = Array.from({ length: shorter.length - 1 }, (_, index) => shorter.slice(index, index + 2));
  return pairs.filter((pair) => longer.includes(pair)).length / pairs.length;
}

function validReferenceTime(value?: Date): Date {
  return value && !Number.isNaN(value.getTime()) ? new Date(value) : new Date();
}

export async function extractFromFiles(files: ChroniInputFile[]): Promise<ExtractedInput[]> {
  const result = await extractFromFilesWithFailures(files);
  if (!result.extracted.length && result.failures.length) throw new Error(result.failures[0].reason);
  return result.extracted;
}

async function extractFromFilesWithFailures(files: ChroniInputFile[]): Promise<{ extracted: ExtractedInput[]; failures: ExtractedFailure[] }> {
  if (!files.length) throw new Error("没有收到可读取的文件。");
  const extracted: ExtractedInput[] = [];
  const failures: ExtractedFailure[] = [];
  for (const file of files) {
    try {
      extracted.push(await extractSingleFile(file));
    } catch (error) {
      failures.push(failureFromFile(file, formatOperationError(error, "文件读取失败，请重新选择文件。")));
    }
  }
  return { extracted, failures };
}

function failureFromFile(file: ChroniInputFile, reason: string): ExtractedFailure {
  const name = file.name || (file.path ? basename(file.path) : "未命名文件");
  const extension = extname(name || file.path || "").toLowerCase();
  return {
    sourceName: name,
    sourceType: extension ? extension.slice(1) : "unknown",
    text: "",
    reason,
  };
}

export function extractDdlItemsFromText(text: string, sourceName = "输入内容", referenceNow = new Date()): DdlItem[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const candidates = candidateLines(normalized);
  const items = candidates
    .map((line, index) => {
      if (!hasDeadlineIntent(line) || isConditionalDeadlineText(line)) return null;
      const dueAt = safeDateFromText(line, referenceNow);
      if (!dueAt) return null;
      let titleSource = line;
      let title = shortTitle(titleSource);
      const previous = candidates[index - 1];
      if (title === "未命名 DDL" && previous && hasTaskTitleEvidence(previous) && !safeDateFromText(previous, referenceNow)) {
        titleSource = `${previous}。${line}`;
        title = shortTitle(titleSource);
      }
      if (title === "未命名 DDL") return null;
      return createItem(title, dueAt, `${sourceName}: ${titleSource.slice(0, 180)}`);
    })
    .filter((item): item is DdlItem => !!item);

  if (items.length) return mergeDuplicateItems(items);
  if (!hasDeadlineIntent(normalized) || isConditionalDeadlineText(normalized)) return [];
  const dueAt = safeDateFromText(normalized, referenceNow);
  const title = shortTitle(normalized);
  return dueAt && title !== "未命名 DDL" ? [createItem(title, dueAt, `${sourceName}: ${normalized.slice(0, 180)}`)] : [];
}

function safeDateFromText(text: string, referenceNow = new Date()): string | null {
  try {
    return dateFromText(text, referenceNow);
  } catch {
    return null;
  }
}

async function extractSingleFile(file: ChroniInputFile): Promise<ExtractedInput> {
  const name = file.name || (file.path ? basename(file.path) : "未命名文件");
  const extension = extname(name || file.path || "").toLowerCase();
  if (unsupportedExtensions.has(extension)) throw new Error(`文件类型不支持：${name}`);
  if (!extension) throw new Error(`无法判断文件类型：${name}`);

  const isPlainText = plainTextExtensions.has(extension);
  const sizeLimit = isPlainText ? maxTextBytes : maxDocumentBytes;
  const sizeError = `${isPlainText ? "文本文件" : "文件"}过大：${name}`;
  const buffer = readFileBuffer(file, sizeLimit, sizeError);
  const sourceType = extension.slice(1);
  if (buffer.length > maxDocumentBytes) throw new Error(`文件过大：${name}`);

  if (isPlainText) {
    if (buffer.length > maxTextBytes) throw new Error(`文本文件过大：${name}`);
    const text = textFromBuffer(buffer);
    assertReliableExtractedText(text, name);
    return { sourceName: name, sourceType, text };
  }
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    assertReliableExtractedText(result.value, name);
    return { sourceName: name, sourceType, text: result.value };
  }
  if (extension === ".pdf") {
    const text = await extractPdfText(buffer, name);
    return { sourceName: name, sourceType, text };
  }
  if (spreadsheetExtensions.has(extension)) {
    const sheets = await readXlsxFile(buffer) as unknown as WorkbookSheet[];
    const text = workbookText(sheets);
    assertReliableExtractedText(text, name);
    return { sourceName: name, sourceType, text };
  }
  if (imageExtensions.has(extension)) {
    const result = await recognizeImage(buffer);
    const text = result.text;
    assertReliableExtractedText(text, name, "图片 OCR 失败");
    if (!isReliableOcrResult(text, result.confidence)) throw new Error(`图片 OCR 置信度不足：${name}`);
    return { sourceName: name, sourceType, text };
  }

  throw new Error(`文件类型不支持：${name}`);
}

async function extractPdfText(buffer: Buffer, name: string): Promise<string> {
  const mod = await import("pdf-parse") as unknown as {
    PDFParse: new (options: { data: Uint8Array }) => {
      getText: () => Promise<{ text: string }>;
      getScreenshot: (options: { scale: number; imageBuffer: boolean; imageDataUrl: boolean }) => Promise<{ pages: Array<{ data: Uint8Array; pageNumber: number }> }>;
      destroy: () => Promise<void>;
    };
  };
  const parser = new mod.PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    if (parsed.text.trim() && looksLikeReliableText(parsed.text.trim())) return parsed.text;

    const screenshots = await parser.getScreenshot({ scale: 2, imageBuffer: true, imageDataUrl: false });
    const pageTexts: string[] = [];
    for (const page of screenshots.pages) {
      const result = await recognizeImage(Buffer.from(page.data));
      if (isReliableOcrResult(result.text, result.confidence)) {
        pageTexts.push(`[第 ${page.pageNumber} 页]\n${result.text.trim()}`);
      }
    }
    const text = pageTexts.join("\n\n");
    assertReliableExtractedText(text, name, "PDF 没有文本层，页面 OCR 也未识别到可靠文本");
    return text;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function recognizeImage(image: Buffer): Promise<{ text: string; confidence?: number }> {
  const mod = await import("tesseract.js") as unknown as TesseractModule;
  const cachePath = ocrCachePath();
  return recognizeImageWithTesseract(image, mod, cachePath);
}

export async function recognizeImageWithTesseract(image: Buffer, mod: TesseractModule, cachePath: string): Promise<{ text: string; confidence?: number }> {
  const recognize = mod.recognize ?? mod.default?.recognize;
  if (typeof recognize !== "function") throw new Error("图片 OCR 组件不可用。");
  const result = await recognize(image, "chi_sim+eng", { cachePath });
  return result.data;
}

function ocrCachePath(): string {
  const homeCache = process.env.HOME
    ? join(process.env.HOME, process.platform === "darwin" ? "Library/Caches" : ".cache")
    : undefined;
  return ensureOcrCachePath([
    process.env.CHRONI_OCR_CACHE_PATH,
    process.env.APPDATA ? join(process.env.APPDATA, "Chroni", "ocr") : undefined,
    process.env.XDG_CACHE_HOME ? join(process.env.XDG_CACHE_HOME, "Chroni", "ocr") : undefined,
    homeCache ? join(homeCache, "Chroni", "ocr") : undefined,
    join(tmpdir(), "Chroni", "ocr"),
  ]);
}

export function ensureOcrCachePath(candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate)) continue;
    try {
      mkdirSync(candidate, { recursive: true });
      accessSync(candidate, constants.W_OK);
      return candidate;
    } catch {
      // Try the next platform cache location before giving up on OCR.
    }
  }
  throw new Error("无法创建可写的图片 OCR 缓存目录。");
}

export function workbookText(sheets: WorkbookSheet[]): string {
  return sheets.flatMap((sheet) => {
    const rows = sheet.data
      .map((row) => row.map((cell) => cell instanceof Date ? cell.toISOString() : String(cell ?? "")))
      .filter((row) => row.some((cell) => cell.trim()))
      .map((row) => row.join(", "));
    return rows.length ? [`[工作表: ${sheet.sheet}]\n${rows.join("\n")}`] : [];
  }).join("\n\n");
}

function readFileBuffer(file: ChroniInputFile, maxBytes: number, sizeError: string): Buffer {
  if (file.contentBase64) {
    if (file.contentBase64.length > Math.ceil(maxBytes / 3) * 4 + 4) throw new Error(sizeError);
    const buffer = Buffer.from(file.contentBase64, "base64");
    if (buffer.length > maxBytes) throw new Error(sizeError);
    return buffer;
  }
  if (!file.path || !existsSync(file.path)) throw new Error(`文件无法读取：${file.name}`);
  const stat = statSync(file.path);
  if (!stat.isFile()) throw new Error(`不是可读取的文件：${file.name}`);
  if (stat.size > maxBytes) throw new Error(sizeError);
  return readFileSync(file.path);
}

function textFromBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }

  const oddNulls = countByteAtParity(buffer, 0, 1);
  const evenNulls = countByteAtParity(buffer, 0, 0);
  if (oddNulls > buffer.length / 8 && oddNulls > evenNulls * 2) return new TextDecoder("utf-16le").decode(buffer);
  if (evenNulls > buffer.length / 8 && evenNulls > oddNulls * 2) return new TextDecoder("utf-16be").decode(buffer);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(buffer);
    } catch {
      return buffer.toString("utf8");
    }
  }
}

function countByteAtParity(buffer: Buffer, value: number, parity: 0 | 1): number {
  let count = 0;
  for (let index = parity; index < buffer.length; index += 2) {
    if (buffer[index] === value) count += 1;
  }
  return count;
}

function assertReliableExtractedText(text: string, name: string, emptyReason = "文件没有可读取文本"): void {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${emptyReason}：${name}`);
  if (!looksLikeReliableText(trimmed)) throw new Error(`文件文本无法可靠解析：${name}`);
}

function looksLikeReliableText(text: string): boolean {
  if (text.length < 4) return false;
  const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
  if (replacementCount / text.length > 0.02) return false;
  const controlCount = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
  if (controlCount / text.length > 0.01) return false;
  const readableCount = (text.match(/[\p{Script=Han}A-Za-z0-9，。！？、；：,.!?:;()\[\]【】《》\s/-]/gu) ?? []).length;
  return readableCount / text.length >= 0.55;
}

export function isReliableOcrResult(text: string, confidence?: number): boolean {
  if (!looksLikeReliableText(text.trim())) return false;
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return false;
  return confidence >= minimumOcrConfidence;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\par[d]?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function candidateLines(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const sentenceParts = lines.flatMap((line) => line.split(/[。；;.!?？]+/).map((part) => part.trim()).filter(Boolean));
  const taskParts = sentenceParts.flatMap((line) => hasMultipleTemporalExpressions(line) && !isConditionalDeadlineText(line)
    ? line.split(/[，,]/).map((part) => part.trim()).filter(Boolean)
    : [line]);
  return [...new Set(taskParts)].filter((line) => line.length <= 280);
}

function hasMultipleTemporalExpressions(text: string): boolean {
  const matches = text.match(/20\d{2}\s*[年/.\-]\s*\d{1,2}\s*[月/.\-]\s*\d{1,2}|\d{1,2}(?:\s*[月/\-]\s*|\.)\d{1,2}|今天|今日|今早|今晚|明天|明日|明早|明晚|后天|后日|下(?:个)?(?:周|星期)[一二三四五六日天]|(?:周|星期)[一二三四五六日天]/g);
  return (matches?.length ?? 0) > 1;
}

function hasTaskTitleEvidence(text: string): boolean {
  return /(作业|报告|项目|论文|实验|测验|考试|答辩|汇报|展示|会议|活动|任务|presentation|assignment|report|project)/i.test(text);
}

function hasDeadlineIntent(text: string): boolean {
  return /(作业|报告|项目|论文|实验|测验|小测|考试|期中|期末|答辩|面试|汇报|展示|路演|会议|活动|presentation|quiz|essay|paper|homework|assignment|project|ddl|deadline|due|截止|截至|提交|完成|上交|交付|deliverable|turn\s*in|submit)/i.test(text);
}

export function shortTitle(text: string): string {
  const cleaned = stripDeadlineTemporalExpressions(text)
    .replace(/如果[^，,。；;]+[，,]?/g, " ")
    .replace(/以[^，,。；;]+为准/g, " ")
    .replace(/(可能|暂定|尚未确定|待确认|待通知|另行通知|已经发布|已发布|时间如下)/g, " ")
    .replace(/(?:提交|上交|交付|交)(?=作业|报告|论文|项目|实验|文件|材料|代码|PPT)/gi, " ")
    .replace(/参加(?=答辩|会议|展示|汇报|考试|活动)/g, " ")
    .replace(/(截止|截至|ddl|deadline|due|提交|完成|之前|前|到期|提醒|请在|需要|任务)[:：]*/gi, " ")
    .replace(/^[。！？.!?,，、:：\s]+|[。！？.!?,，、:：\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "未命名 DDL").slice(0, 16);
}

function createItem(title: string, dueAt: string, sourceSummary: string, importance = importanceFromText(`${title} ${sourceSummary}`), extraction?: DdlExtractionContext): DdlItem {
  const now = new Date().toISOString();
  return {
    id: `ddl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    importance,
    dueAt,
    sourceSummary,
    ...(extraction ? { extraction } : {}),
    createdAt: now,
    updatedAt: now,
    completed: false,
  };
}

function importanceFromText(text: string): Importance {
  if (/(重要|紧急|final|期末|考试|答辩|面试|deadline|ddl|逾期|必须)/i.test(text)) return "high";
  if (/(作业|报告|项目|提交|会议|review|quiz|实验|presentation|汇报|小组)/i.test(text)) return "medium";
  return "low";
}

function mergeDuplicateItems(items: DdlItem[]): DdlItem[] {
  const merged: DdlItem[] = [];
  const exactKeys = new Set<string>();
  for (const item of items) {
    const key = `${item.title}|${item.dueAt.slice(0, 16)}`;
    if (exactKeys.has(key)) continue;
    const evidenceDuplicate = merged.some((existing) => existing.dueAt.slice(0, 16) === item.dueAt.slice(0, 16)
      && sourceName(existing.sourceSummary) === sourceName(item.sourceSummary)
      && hasOverlappingSourceEvidence(existing, item));
    if (evidenceDuplicate) continue;
    exactKeys.add(key);
    merged.push(item);
  }
  return merged;
}

function mergePendingItems(items: PendingExtractedTask[]): PendingExtractedTask[] {
  const merged: PendingExtractedTask[] = [];
  for (const item of items) {
    const evidence = normalizeEvidenceText(sourceEvidence(item.sourceSummary));
    const duplicate = merged.some((existing) => {
      if (existing.sourceName !== item.sourceName) return false;
      const existingEvidence = normalizeEvidenceText(sourceEvidence(existing.sourceSummary));
      return Math.min(evidence.length, existingEvidence.length) >= 6
        && (evidence.includes(existingEvidence) || existingEvidence.includes(evidence));
    });
    if (!duplicate) merged.push(item);
  }
  return merged;
}

export function mergeModelAndRuleItems(modelItems: DdlItem[], ruleItems: DdlItem[], pendingItems: PendingExtractedTask[] = []): DdlItem[] {
  const reconciledModelItems = modelItems.map((modelItem) => {
    const localMatch = ruleItems.find((ruleItem) => timezoneVariantOfSameEvidence(modelItem, ruleItem));
    return localMatch ? { ...modelItem, dueAt: localMatch.dueAt } : modelItem;
  });
  const ruleFallbacks = ruleItems.filter((ruleItem) => !reconciledModelItems.some((modelItem) => sameExtractedDeadline(modelItem, ruleItem))
    && !pendingItems.some((pendingItem) => pendingCoversRuleItem(pendingItem, ruleItem)));
  return mergeDuplicateItems([...reconciledModelItems, ...ruleFallbacks]);
}

function pendingCoversRuleItem(pendingItem: PendingExtractedTask, ruleItem: DdlItem): boolean {
  if (pendingItem.sourceName.toLowerCase() !== sourceName(ruleItem.sourceSummary)) return false;
  const pendingEvidence = normalizeEvidenceText(sourceEvidence(pendingItem.sourceSummary));
  const ruleEvidence = normalizeEvidenceText(sourceEvidence(ruleItem.sourceSummary));
  return Math.min(pendingEvidence.length, ruleEvidence.length) >= 6
    && (pendingEvidence.includes(ruleEvidence) || ruleEvidence.includes(pendingEvidence));
}

function pendingCoversResolvedItem(pendingItem: PendingExtractedTask, item: DdlItem): boolean {
  if (pendingItem.sourceName.toLowerCase() !== sourceName(item.sourceSummary)) return false;
  const pendingEvidence = normalizeEvidenceText(sourceEvidence(pendingItem.sourceSummary));
  const itemEvidence = normalizeEvidenceText(sourceEvidence(item.sourceSummary));
  return !isConditionalDeadlineText(sourceEvidence(item.sourceSummary))
    && !hasImpreciseClockExpression(sourceEvidence(item.sourceSummary))
    && Math.min(pendingEvidence.length, itemEvidence.length) >= 6
    && (pendingEvidence.includes(itemEvidence) || itemEvidence.includes(pendingEvidence));
}

function sameExtractedDeadline(modelItem: DdlItem, ruleItem: DdlItem): boolean {
  const modelSource = sourceName(modelItem.sourceSummary);
  const ruleSource = sourceName(ruleItem.sourceSummary);
  if (modelSource !== ruleSource || modelItem.dueAt.slice(0, 16) !== ruleItem.dueAt.slice(0, 16)) return false;
  const modelText = normalizeEvidenceText(`${modelItem.title} ${modelItem.sourceSummary}`);
  const ruleText = normalizeEvidenceText(`${ruleItem.title} ${ruleItem.sourceSummary}`);
  const modelTitle = normalizeEvidenceText(modelItem.title);
  const ruleTitle = normalizeEvidenceText(ruleItem.title);
  return modelTitle === ruleTitle
    || modelText.includes(ruleTitle)
    || ruleText.includes(modelTitle)
    || hasOverlappingSourceEvidence(modelItem, ruleItem);
}

function timezoneVariantOfSameEvidence(modelItem: DdlItem, ruleItem: DdlItem): boolean {
  if (sourceName(modelItem.sourceSummary) !== sourceName(ruleItem.sourceSummary)) return false;
  if (!hasOverlappingSourceEvidence(modelItem, ruleItem)) return false;
  const difference = Math.abs(new Date(modelItem.dueAt).getTime() - new Date(ruleItem.dueAt).getTime());
  return difference > 0 && difference <= 14 * 60 * 60 * 1_000;
}

function hasOverlappingSourceEvidence(modelItem: DdlItem, ruleItem: DdlItem): boolean {
  const modelEvidence = normalizeEvidenceText(sourceEvidence(modelItem.sourceSummary));
  const ruleEvidence = normalizeEvidenceText(sourceEvidence(ruleItem.sourceSummary));
  if (Math.min(modelEvidence.length, ruleEvidence.length) < 6
    || (!modelEvidence.includes(ruleEvidence) && !ruleEvidence.includes(modelEvidence))) return false;
  return true;
}

function sourceName(summary: string): string {
  return summary.slice(0, Math.max(0, summary.indexOf(":"))).trim().toLowerCase();
}

function sourceEvidence(summary: string): string {
  const separator = summary.indexOf(":");
  return separator >= 0 ? summary.slice(separator + 1) : summary;
}

function dateFromText(text: string, referenceNow = new Date()): string | null {
  return deadlineDateFromText(text, referenceNow) ?? null;
}

function hasImpreciseClockExpression(text: string): boolean {
  return /第[一二三四五六七八九十\d]+节(?:课)?/.test(text)
    || (hasDeadlineTemporalReference(text) && !deadlineDateFromText(text));
}

function strictIsoDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (!isValidDateParts(year, month, day, hour, minute, second)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isValidDateParts(year: number, month: number, day: number, hour: number, minute: number, second = 0): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return false;
  if (month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute
    && date.getSeconds() === second;
}
