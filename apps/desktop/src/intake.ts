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
  store.setCompanion("processing", "正在识别 DDL...");
  const result = await extractPayload(payload, { llm: store.llmSettings() });
  if (!result.ok) {
    let clarificationSnapshot;
    let firstQuestion = "";
    for (const input of result.extracted) {
      if (!hasPossibleTaskWithoutDeadline(input.text)) continue;
      const analysis = await analyzeCompletenessWithLlm(input, resolveLlmSettings(store.llmSettings()));
      if (analysis.status !== "needs-clarification") continue;
      clarificationSnapshot = store.saveIntakeDraft(analysis.draft, analysis.clarifications, input);
      firstQuestion ||= analysis.clarifications[0]?.question ?? "还需要确认任务信息。";
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

  const blocking: Array<{ input: ExtractedInput; analysis: Awaited<ReturnType<typeof analyzeCompletenessWithLlm>> }> = [];
  for (const input of result.extracted.flatMap(ambiguousTaskInputs)) {
    const analysis = await analyzeCompletenessWithLlm(input, resolveLlmSettings(store.llmSettings()));
    if (analysis.clarifications.some((item) => item.required && item.field === "dueAt")) blocking.push({ input, analysis });
  }
  const safeItems = result.items.filter((item) => !containsAmbiguousNextWeek(item.extraction?.contextExcerpt ?? sourceEvidence(item.sourceSummary)));
  const beforeIds = new Set(store.snapshot().items.map((item) => item.id));
  let snapshot = store.addItems(safeItems, result.message, result.extracted);
  const created = snapshot.items.filter((item) => !beforeIds.has(item.id));
  await ensureTaskPlans(created.map((item) => item.id), store, created.length > 1 ? "rules-only" : "default");
  snapshot = store.snapshot();
  for (const pending of result.pendingItems) {
    const input = result.extracted.find((candidate) => candidate.sourceName === pending.sourceName);
    snapshot = savePendingExtractedTask(pending, store, input);
  }
  for (const entry of blocking) snapshot = store.saveIntakeDraft(entry.analysis.draft, entry.analysis.clarifications, entry.input);
  snapshot = recordExtractionFailures(store, result.failures) ?? snapshot;
  if (!created.length && blocking.length && !result.pendingItems.length) return { ok: false, reason: `需要确认：${blocking[0].analysis.clarifications[0]?.question ?? "请补充截止时间。"}`, snapshot };
  const clarificationMessage = blocking.length ? `${result.message} 另有 ${blocking.length} 项等待确认。` : result.message;
  const resolvedPlanningSettings = resolveLlmSettings(store.llmSettings());
  const bulkPlanningMessage = created.length > 1 && snapshot.agent.memory.useLlmPlanning && resolvedPlanningSettings.enabled && resolvedPlanningSettings.apiKey
    ? " 批量任务已先生成本地草案；可在任务详情中按需使用大模型优化。"
    : "";
  const message = `${clarificationMessage}${bulkPlanningMessage}`;
  if (created.length && bulkPlanningMessage) snapshot = store.setCompanion("success", message);
  return { ok: true, created, message, snapshot };
}

function savePendingExtractedTask(pending: PendingExtractedTask, store: ChroniStore, input?: ExtractedInput) {
  const now = new Date().toISOString();
  const draftId = `draft-${randomUUID()}`;
  const draft: IntakeDraft = {
    id: draftId,
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
    required: true,
    status: "pending",
    createdAt: now,
    resumeToken: randomUUID(),
  };
  draft.pendingClarificationIds = [clarification.id];
  return store.saveIntakeDraft(draft, [clarification], input);
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

async function ensureTaskPlans(taskIds: string[], store: ChroniStore, mode: "default" | "rules-only", regenerate = false): Promise<void> {
  const queue = [...new Set(taskIds)];
  const workerCount = Math.min(mode === "rules-only" ? 1 : 3, queue.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const taskId = queue.shift();
      if (!taskId) return;
      await ensureTaskPlan(taskId, store, regenerate, mode);
    }
  }));
}

export async function reprocessSource(sourceId: string, store: ChroniStore): Promise<IntakeResult> {
  const source = store.sourceById(sourceId);
  if (!source) {
    const snapshot = store.setCompanion("confused", "找不到原始输入，无法重新识别。");
    return { ok: false, reason: "找不到原始输入。", snapshot };
  }
  store.setCompanion("processing", "正在重新识别来源...");
  const result = await extractPayload({ kind: "text", text: source.text }, { llm: store.llmSettings() });
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
  let snapshot = store.replaceSourceItems(sourceId, nextItems, message);
  const extracted: ExtractedInput = { sourceName: source.sourceName, sourceType: source.sourceType, text: source.text };
  for (const pending of result.pendingItems) {
    snapshot = savePendingExtractedTask({
      ...pending,
      sourceName: source.sourceName,
      sourceType: source.sourceType,
      sourceSummary: `${source.sourceName}: ${pending.sourceSummary.replace(/^直接文本:\s*/, "")}`,
    }, store, extracted);
  }
  const refreshedTaskIds = snapshot.items.filter((item) => item.sourceId === sourceId).map((item) => item.id);
  await ensureTaskPlans(refreshedTaskIds, store, refreshedTaskIds.length > 1 ? "rules-only" : "default", true);
  snapshot = store.snapshot();
  const refreshedItems = snapshot.items.filter((item) => refreshedTaskIds.includes(item.id));
  return { ok: true, created: refreshedItems, message, snapshot };
}

function ambiguousTaskInputs(input: ExtractedInput): ExtractedInput[] {
  const segments = input.text
    .split(/[\r\n。；;.!?？]+/)
    .map((segment) => segment.trim())
    .filter((segment) => containsAmbiguousNextWeek(segment) && hasPossibleTaskWithoutDeadline(segment));
  return [...new Set(segments)].map((text) => ({ ...input, text }));
}

function containsAmbiguousNextWeek(text: string): boolean {
  return /下周(?![一二三四五六日天])/.test(text);
}

export async function extractPayload(payload: IntakePayload, options: ExtractOptions = {}): Promise<ExtractResult> {
  const extracted: ExtractedInput[] = [];
  const failures: ExtractedFailure[] = [];
  try {
    if (payload.kind === "text") {
      const text = payload.text?.trim() ?? "";
      if (!text) return { ok: false, reason: "输入内容为空。", extracted, failures, items: [], pendingItems: [] };
      extracted.push({ sourceName: "直接文本", sourceType: "text", text });
    } else {
      const fileResult = await extractFromFilesWithFailures(payload.files ?? []);
      extracted.push(...fileResult.extracted);
      failures.push(...fileResult.failures);
      if (!extracted.length && failures.length) {
        const reason = failures.length === 1 ? failures[0].reason : `${failures.length} 个文件无法读取或不支持。`;
        return { ok: false, reason, extracted, failures, items: [], pendingItems: [] };
      }
    }

    const llm = await extractWithLlmIfAvailable(extracted, options.llm);
    const ruleItems = extracted.flatMap((input) => extractDdlItemsFromText(input.text, input.sourceName));
    const items = mergeModelAndRuleItems(llm.items, ruleItems, llm.pendingItems);
    if (!items.length && !llm.pendingItems.length) {
      if (llm.errors.length && isLlmEnabled(options.llm)) {
        return { ok: false, reason: `模型服务不可用：${llm.errors[0]}`, extracted, failures, items: [], pendingItems: [] };
      }
      if (hasPossibleTaskWithoutDeadline(extracted.map((input) => input.text).join("\n"))) {
        return { ok: false, reason: "关键信息不足：没有明确截止时间。", extracted, failures, items: [], pendingItems: [] };
      }
      return { ok: false, reason: "没有识别到明确 DDL。", extracted, failures, items: [], pendingItems: [] };
    }
    const count = Math.min(items.length, 12);
    const message = extractionMessage(count, llm, llm.pendingItems.length);
    return {
      ok: true,
      extracted,
      failures,
      items: mergeDuplicateItems(items).slice(0, 12),
      pendingItems: llm.pendingItems.slice(0, 12),
      message,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      extracted,
      failures,
      items: [],
      pendingItems: [],
    };
  }
}

function extractionMessage(count: number, llm: LlmExtraction, pendingCount: number): string {
  if (pendingCount && !count) return `DeepSeek 已识别 ${pendingCount} 项任务，等待补充精确截止时间。`;
  const pendingSuffix = pendingCount ? `，另有 ${pendingCount} 项等待确认` : "";
  if (!llm.attempted) return count === 1 ? "已加入 1 条日程。" : `已加入 ${count} 条日程。`;
  if (llm.items.length && llm.errors.length) {
    return `模型已提取日程，另有 ${llm.errors.length} 个分块失败；共加入 ${count} 条日程。`;
  }
  if (llm.items.length) return `DeepSeek 已参与提取，共加入 ${count} 条日程${pendingSuffix}。`;
  if (llm.errors.length) return `模型服务不可用，已使用本地规则加入 ${count} 条日程：${llm.errors[0]}`;
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
  return /(作业|报告|提交|完成|ddl|deadline|due|考试|答辩|实验|汇报|presentation|quiz|任务|提醒)/i.test(text);
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

async function extractWithLlmIfAvailable(extracted: ExtractedInput[], settings?: ChroniLlmSettings): Promise<LlmExtraction> {
  const resolvedSettings = resolveLlmSettings(settings);
  const result: LlmExtraction = { items: [], pendingItems: [], attempted: 0, rejected: 0, errors: [] };
  if (!resolvedSettings.enabled || !resolvedSettings.apiKey || !resolvedSettings.model) return result;

  const today = new Date().toISOString();
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
          "只有日期、课次或时段但无法换算成精确钟点的任务放入 pendingItems，提出一个精确时间问题，禁止擅自使用 23:59。",
          "条件性候选截止（例如“可能提前”“如果……则……”“以通知为准”）不得作为正式 items，必须放入 pendingItems；原始已确认截止仍保留在 items。",
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
          const item = itemFromLlmCandidate(candidate, input.text, input.sourceName);
          if (item) result.items.push(item);
          else {
            const pending = pendingItemFromImpreciseCandidate(candidate, input);
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
        const detail = error instanceof Error ? error.message : String(error);
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

export function itemFromLlmCandidate(candidate: LlmDdlCandidate, evidenceText = "", sourceName = ""): DdlItem | null {
  const title = String(candidate.title ?? "").trim().slice(0, 16);
  const dueAtRaw = String(candidate.dueAt ?? "").trim();
  const sourceSummary = String(candidate.sourceSummary ?? title).trim().slice(0, 500);
  if (!title || !hasDeadlineIntent(`${title} ${sourceSummary}`)) return null;
  if (evidenceText && !hasSourceEvidence(sourceSummary, evidenceText)) return null;
  if (hasImpreciseClockExpression(sourceSummary) || isConditionalDeadlineStatement(sourceSummary)) return null;
  const dueAt = strictIsoDate(dueAtRaw);
  if (!dueAt) return null;
  const importance = candidate.importance === "high" || candidate.importance === "medium" || candidate.importance === "low"
    ? candidate.importance
    : importanceFromText(`${title} ${sourceSummary}`);
  const extraction = extractionContextFromCandidate(candidate, evidenceText, sourceSummary);
  return createItem(title, dueAt.toISOString(), sourceName ? `${sourceName}: ${sourceSummary}` : sourceSummary, importance, extraction);
}

function pendingItemFromImpreciseCandidate(candidate: LlmDdlCandidate, input: ExtractedInput): PendingExtractedTask | null {
  const title = String(candidate.title ?? "").trim().slice(0, 80);
  const sourceSummary = String(candidate.sourceSummary ?? "").trim().slice(0, 500);
  const conditional = isConditionalDeadlineStatement(sourceSummary);
  const impreciseClock = hasImpreciseClockExpression(sourceSummary);
  if (!title || !sourceSummary || (!impreciseClock && !conditional) || !hasSourceEvidence(sourceSummary, input.text)) return null;
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
    question: conditional ? `“${title}”的候选截止时间是否已经正式生效？` : `“${title}”的具体日期和钟点是什么？`,
    reason: conditional ? "原文说明该变更仍取决于后续条件或通知，不能直接覆盖正式截止时间。" : "原文使用课次或模糊时段，无法安全换算为精确钟点。",
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
      failures.push(failureFromFile(file, error instanceof Error ? error.message : String(error)));
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

export function extractDdlItemsFromText(text: string, sourceName = "输入内容"): DdlItem[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const candidates = candidateLines(normalized);
  const items = candidates
    .map((line) => {
      if (!hasDeadlineIntent(line)) return null;
      const dueAt = safeDateFromText(line);
      if (!dueAt) return null;
      return createItem(shortTitle(line), dueAt, `${sourceName}: ${line.slice(0, 180)}`);
    })
    .filter((item): item is DdlItem => !!item);

  if (items.length) return mergeDuplicateItems(items);
  if (!hasDeadlineIntent(normalized)) return [];
  const dueAt = safeDateFromText(normalized);
  return dueAt ? [createItem(shortTitle(normalized), dueAt, `${sourceName}: ${normalized.slice(0, 180)}`)] : [];
}

function safeDateFromText(text: string): string | null {
  try {
    return dateFromText(text);
  } catch {
    return null;
  }
}

async function extractSingleFile(file: ChroniInputFile): Promise<ExtractedInput> {
  const name = file.name || (file.path ? basename(file.path) : "未命名文件");
  const extension = extname(name || file.path || "").toLowerCase();
  if (unsupportedExtensions.has(extension)) throw new Error(`文件类型不支持：${name}`);
  if (!extension) throw new Error(`无法判断文件类型：${name}`);

  const buffer = readFileBuffer(file);
  const sourceType = extension.slice(1);
  if (buffer.length > maxDocumentBytes) throw new Error(`文件过大：${name}`);

  if (plainTextExtensions.has(extension)) {
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

function readFileBuffer(file: ChroniInputFile): Buffer {
  if (file.contentBase64) return Buffer.from(file.contentBase64, "base64");
  if (!file.path || !existsSync(file.path)) throw new Error(`文件无法读取：${file.name}`);
  const stat = statSync(file.path);
  if (!stat.isFile()) throw new Error(`不是可读取的文件：${file.name}`);
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
  // Prefer the smallest grounded sentence so one ambiguous task cannot taint a
  // separate explicit task that happens to share the same source line.
  return [...new Set([...sentenceParts, ...lines])].filter((line) => line.length <= 280);
}

function hasDeadlineIntent(text: string): boolean {
  return /(作业|报告|论文|实验|测验|小测|考试|期中|期末|答辩|面试|汇报|展示|路演|会议|活动|presentation|quiz|essay|paper|homework|assignment|project|ddl|deadline|due|截止|截至|提交|完成|上交|交付|deliverable|turn\s*in|submit)/i.test(text);
}

export function shortTitle(text: string): string {
  const cleaned = text
    .replace(/(截止|截至|ddl|deadline|due|提交|完成|之前|前|到期|提醒|请在|需要|任务)[:：]*/gi, " ")
    .replace(/\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?/g, " ")
    .replace(/\d{1,2}[月/.-]\d{1,2}日?/g, " ")
    .replace(/\d{1,2}[:：]\d{2}/g, " ")
    .replace(/(明天|后天|今天|今晚|上午|下午|晚上|中午|下个?周[一二三四五六日天]|下个?星期[一二三四五六日天]|周[一二三四五六日天]|星期[一二三四五六日天])/g, " ")
    .replace(/^[,，、:：\s]+|[,，、:：\s]+$/g, "")
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
  if (/(作业|报告|提交|会议|review|quiz|实验|presentation|汇报|小组)/i.test(text)) return "medium";
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

function dateFromText(text: string): string | null {
  const now = new Date();
  const normalized = text.replace(/\s+/g, " ");
  const full = normalized.match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?(?:\s*(?:at\s+)?(上午|下午|晚上|中午)?\s*(\d{1,2})(?:[:：点](\d{2})?)?)?/i);
  if (full) {
    if (!full[5] && hasImpreciseClockExpression(normalized)) return null;
    return toIso(Number(full[1]), Number(full[2]), Number(full[3]), full[5], full[6], full[4]);
  }

  const partial = normalized.match(/(\d{1,2})(?:\s*[月/-]\s*|\.)(\d{1,2})\s*日?(?:\s*(?:at\s+)?(上午|下午|晚上|中午)?\s*(\d{1,2})(?:[:：点](\d{2})?)?)?/i);
  if (partial) {
    if (!partial[4] && hasImpreciseClockExpression(normalized)) return null;
    const month = Number(partial[1]);
    const day = Number(partial[2]);
    const candidate = new Date(now.getFullYear(), month - 1, day);
    const year = candidate.getTime() < now.getTime() - 86_400_000 ? now.getFullYear() + 1 : now.getFullYear();
    return toIso(year, month, day, partial[4], partial[5], partial[3]);
  }

  const iso = normalized.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[4], iso[5]);

  if (/今天|今晚/.test(normalized)) return relativeDate(0, normalized);
  if (/明天/.test(normalized)) return relativeDate(1, normalized);
  if (/后天/.test(normalized)) return relativeDate(2, normalized);

  const dayMatch = normalized.match(/(\d+)\s*天后/);
  if (dayMatch) return relativeDate(Number(dayMatch[1]), normalized);

  const nextWeek = normalized.match(/下(?:个)?(?:周|星期)([一二三四五六日天])/);
  if (nextWeek) return nextWeekday(nextWeek[1], normalized, true);

  const weekday = normalized.match(/(?:周|星期)([一二三四五六日天])/);
  if (weekday) return nextWeekday(weekday[1], normalized);

  return null;
}

function hasImpreciseClockExpression(text: string): boolean {
  return /第[一二三四五六七八九十\d]+节(?:课)?/.test(text)
    || /(上午|下午|晚上|中午)(?!\s*\d{1,2}\s*(?:[:：点]))/.test(text);
}

function isConditionalDeadlineStatement(text: string): boolean {
  return /(可能|如果|若|视情况|以.+(?:通知|消息|公告)为准|尚未确定|待确认)/.test(text);
}

function relativeDate(days: number, text: string): string | null {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const time = timeForRelativeText(text);
  if (!time) return null;
  const { hour, minute } = time;
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function nextWeekday(dayText: string, text: string, forceNextWeek = false): string | null {
  const target = "一二三四五六日天".indexOf(dayText);
  const targetDay = target >= 6 ? 0 : target + 1;
  const date = new Date();
  const currentDay = date.getDay();
  const diff = forceNextWeek
    ? (((1 - currentDay + 7) % 7) || 7) + (targetDay === 0 ? 6 : targetDay - 1)
    : (targetDay - currentDay + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  const time = timeForRelativeText(text);
  if (!time) return null;
  const { hour, minute } = time;
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function timeForRelativeText(text: string): { hour: number; minute: number } | null {
  const explicit = parseExplicitTime(text);
  if (explicit) return explicit;
  return /(上午|下午|晚上|中午)/.test(text) ? null : { hour: 23, minute: 59 };
}

function parseExplicitTime(text: string): { hour: number; minute: number } | null {
  const match = text.match(/(上午|下午|晚上|中午)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/)
    ?? text.match(/(上午|下午|晚上|中午)?\s*(\d{1,2})\s*点\s*(?:(\d{1,2})\s*分?)?/);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = match[3] ? Number(match[3]) : 0;
  if ((match[1] === "下午" || match[1] === "晚上") && hour < 12) hour += 12;
  if (match[1] === "中午" && hour < 11) hour += 12;
  return { hour, minute };
}

function toIso(year: number, month: number, day: number, hourText?: string, minuteText?: string, period?: string): string {
  let hour = hourText ? Number(hourText) : 23;
  const minute = minuteText ? Number(minuteText) : 59;
  if ((period === "下午" || period === "晚上") && hour < 12) hour += 12;
  if (period === "中午" && hour < 11) hour += 12;
  if (!isValidDateParts(year, month, day, hour, minute)) throw new Error("无法解析截止时间。");
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) throw new Error("无法解析截止时间。");
  return date.toISOString();
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
