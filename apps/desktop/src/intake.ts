import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import type { DdlItem, ChroniInputFile, ChroniLlmSettings, ExtractResult, ExtractedFailure, ExtractedInput, Importance, IntakePayload, IntakeResult } from "./shared/types.js";
import type { ChroniStore } from "./store.js";
import { requestChatCompletion } from "./llm-client.js";

const plainTextExtensions = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".ics", ".log", ".html", ".htm", ".xml", ".yaml", ".yml", ".rtf"]);
const documentExtensions = new Set([".docx", ".pdf"]);
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
};

type LlmExtraction = {
  items: DdlItem[];
  attempted: number;
  rejected: number;
  errors: string[];
};

export async function processIntake(payload: IntakePayload, store: ChroniStore): Promise<IntakeResult> {
  store.setCompanion("processing", "正在识别 DDL...");
  const result = await extractPayload(payload, { llm: store.snapshot().preferences.llm });
  if (!result.ok) {
    const fallbackFailures = result.failures.length ? [] : fallbackExtractedInputs(payload, result.extracted);
    store.recordSourceFailure(fallbackFailures, result.reason);
    recordExtractionFailures(store, result.failures);
    const snapshot = store.setCompanion("confused", result.reason);
    return { ok: false, reason: result.reason, snapshot };
  }

  let snapshot = store.addItems(result.items, result.message, result.extracted);
  snapshot = recordExtractionFailures(store, result.failures) ?? snapshot;
  return { ok: true, created: result.items, message: snapshot.companion.bubble, snapshot };
}

export async function reprocessSource(sourceId: string, store: ChroniStore): Promise<IntakeResult> {
  const source = store.sourceById(sourceId);
  if (!source) {
    const snapshot = store.setCompanion("confused", "找不到原始输入，无法重新识别。");
    return { ok: false, reason: "找不到原始输入。", snapshot };
  }
  store.setCompanion("processing", "正在重新识别来源...");
  const result = await extractPayload({ kind: "text", text: source.text }, { llm: store.snapshot().preferences.llm });
  if (!result.ok) {
    const snapshot = store.markSourceFailed(sourceId, result.reason);
    return { ok: false, reason: result.reason, snapshot };
  }
  const nextItems = result.items.map((item) => ({
    ...item,
    sourceId,
    sourceSummary: `${source.sourceName}: ${item.sourceSummary.replace(/^直接文本:\s*/, "")}`,
  }));
  const snapshot = store.replaceSourceItems(sourceId, nextItems, result.message.replace("已加入", "已重新识别"));
  return { ok: true, created: nextItems, message: snapshot.companion.bubble, snapshot };
}

export async function extractPayload(payload: IntakePayload, options: ExtractOptions = {}): Promise<ExtractResult> {
  const extracted: ExtractedInput[] = [];
  const failures: ExtractedFailure[] = [];
  try {
    if (payload.kind === "text") {
      const text = payload.text?.trim() ?? "";
      if (!text) return { ok: false, reason: "输入内容为空。", extracted, failures, items: [] };
      extracted.push({ sourceName: "直接文本", sourceType: "text", text });
    } else {
      const fileResult = await extractFromFilesWithFailures(payload.files ?? []);
      extracted.push(...fileResult.extracted);
      failures.push(...fileResult.failures);
      if (!extracted.length && failures.length) {
        const reason = failures.length === 1 ? failures[0].reason : `${failures.length} 个文件无法读取或不支持。`;
        return { ok: false, reason, extracted, failures, items: [] };
      }
    }

    const llm = await extractWithLlmIfAvailable(extracted, options.llm);
    const modelSources = new Set(extracted
      .filter((input) => llm.items.some((item) => item.sourceSummary.startsWith(`${input.sourceName}:`)))
      .map((input) => input.sourceName));
    const ruleItems = extracted.flatMap((input) => modelSources.has(input.sourceName)
      ? []
      : extractDdlItemsFromText(input.text, input.sourceName));
    const items = mergeDuplicateItems([...llm.items, ...ruleItems]);
    if (!items.length) {
      if (llm.errors.length && isLlmEnabled(options.llm)) {
        return { ok: false, reason: `模型服务不可用：${llm.errors[0]}`, extracted, failures, items: [] };
      }
      if (hasPossibleTaskWithoutDeadline(extracted.map((input) => input.text).join("\n"))) {
        return { ok: false, reason: "关键信息不足：没有明确截止时间。", extracted, failures, items: [] };
      }
      return { ok: false, reason: "没有识别到明确 DDL。", extracted, failures, items: [] };
    }
    const count = Math.min(items.length, 12);
    const message = extractionMessage(count, llm);
    return {
      ok: true,
      extracted,
      failures,
      items: mergeDuplicateItems(items).slice(0, 12),
      message,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      extracted,
      failures,
      items: [],
    };
  }
}

function extractionMessage(count: number, llm: LlmExtraction): string {
  if (!llm.attempted) return count === 1 ? "已加入 1 条日程。" : `已加入 ${count} 条日程。`;
  if (llm.items.length && llm.errors.length) {
    return `模型已提取日程，另有 ${llm.errors.length} 个分块失败；共加入 ${count} 条日程。`;
  }
  if (llm.items.length) return `DeepSeek 已参与提取，共加入 ${count} 条日程。`;
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
  return !!(settings?.enabled || process.env.CHRONI_LLM_ENABLED === "1");
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
  const envApiKey = process.env.CHRONI_LLM_API_KEY ?? "";
  const enabled = settings?.enabled || process.env.CHRONI_LLM_ENABLED === "1";
  const apiKey = settings?.apiKey || envApiKey;
  const baseUrl = settings?.baseUrl || process.env.CHRONI_LLM_BASE_URL || "https://api.openai.com/v1";
  const model = settings?.model || process.env.CHRONI_LLM_MODEL || "gpt-4.1-mini";
  const result: LlmExtraction = { items: [], attempted: 0, rejected: 0, errors: [] };
  if (!enabled || !apiKey || !model) return result;

  const resolvedSettings: ChroniLlmSettings = { enabled: true, provider: "openai-compatible", baseUrl, apiKey, model };
  const today = new Date().toISOString();
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
          "从输入中抽取明确的截止事项。",
          "字段结构固定：{\"items\":[{\"title\":\"短标题\",\"dueAt\":\"ISO-8601时间\",\"importance\":\"high|medium|low\",\"sourceSummary\":\"一句来源摘要\"}]}。",
          "title 控制在 16 个中文字符以内。",
          "dueAt 必须是包含时区的 ISO-8601 字符串。",
          "sourceSummary 必须直接截取自原文中的短片段，不要改写或总结。",
          "没有明确截止时间的内容不要输出。",
          "即使没有日程，也必须输出 JSON：{\"items\":[]}。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `当前时间：${today}`,
          `来源 ID：${sourceId}`,
          `来源文件：${input.sourceName}`,
          `分块：${chunkIndex + 1}/${chunks.length}`,
          "请从以下原文中抽取 DDL，并输出 JSON：",
          chunk,
        ].join("\n"),
      },
    ], {
      body: {
        temperature: 0.1,
        max_tokens: 4_096,
        response_format: { type: "json_object" },
        ...(baseUrl.includes("deepseek.com") ? { thinking: { type: "disabled" } } : {}),
      },
        });
        const parsed = parseLlmJson(content);
        const candidates = Array.isArray(parsed.items) ? parsed.items as LlmDdlCandidate[] : [];
        for (const candidate of candidates) {
          const item = itemFromLlmCandidate(candidate, input.text, input.sourceName);
          if (item) result.items.push(item);
          else result.rejected += 1;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        result.errors.push(`${input.sourceName} 第 ${chunkIndex + 1}/${chunks.length} 段：${detail}`);
      }
    }
  }
  result.items = mergeDuplicateItems(result.items);
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

function parseLlmJson(content: string): { items?: unknown } {
  const trimmed = content.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as { items?: unknown };
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) as { items?: unknown } : {};
  }
}

export function itemFromLlmCandidate(candidate: LlmDdlCandidate, evidenceText = "", sourceName = ""): DdlItem | null {
  const title = String(candidate.title ?? "").trim().slice(0, 16);
  const dueAtRaw = String(candidate.dueAt ?? "").trim();
  const sourceSummary = String(candidate.sourceSummary ?? title).slice(0, 180);
  if (!title || !hasDeadlineIntent(`${title} ${sourceSummary}`)) return null;
  if (evidenceText && !hasSourceEvidence(sourceSummary, evidenceText)) return null;
  const dueAt = strictIsoDate(dueAtRaw);
  if (!dueAt) return null;
  const importance = candidate.importance === "high" || candidate.importance === "medium" || candidate.importance === "low"
    ? candidate.importance
    : importanceFromText(`${title} ${sourceSummary}`);
  return createItem(title, dueAt.toISOString(), sourceName ? `${sourceName}: ${sourceSummary}` : sourceSummary, importance);
}

function hasSourceEvidence(sourceSummary: string, evidenceText: string): boolean {
  const summary = normalizeEvidenceText(sourceSummary);
  const evidence = normalizeEvidenceText(evidenceText);
  if (summary.length < 6) return false;
  return evidence.includes(summary);
}

function normalizeEvidenceText(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：,.!?:;()[\]【】《》"'“”‘’]/g, "")
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

  if (items.length) return items;
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
    const rows = await readXlsxFile(buffer) as unknown as unknown[][];
    const text = rows.map((row) => row.map((cell: unknown) => cell instanceof Date ? cell.toISOString() : String(cell ?? "")).join(", ")).join("\n");
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
  const mod = await import("tesseract.js") as unknown as {
    recognize: (input: Buffer | string, langs?: string) => Promise<{ data: { text: string; confidence?: number } }>;
  };
  const result = await mod.recognize(image, "chi_sim+eng");
  return result.data;
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
  return [...new Set([...lines, ...sentenceParts])].filter((line) => line.length <= 280);
}

function hasDeadlineIntent(text: string): boolean {
  return /(作业|报告|论文|实验|测验|小测|考试|期中|期末|答辩|面试|汇报|presentation|quiz|essay|paper|homework|assignment|project|ddl|deadline|due|截止|截至|提交|完成|上交|交付|deliverable|turn\s*in|submit)/i.test(text);
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

function createItem(title: string, dueAt: string, sourceSummary: string, importance = importanceFromText(`${title} ${sourceSummary}`)): DdlItem {
  const now = new Date().toISOString();
  return {
    id: `ddl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    importance,
    dueAt,
    sourceSummary,
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
  const map = new Map<string, DdlItem>();
  for (const item of items) {
    const key = `${item.title}|${item.dueAt.slice(0, 16)}`;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function dateFromText(text: string): string | null {
  const now = new Date();
  const normalized = text.replace(/\s+/g, " ");
  const full = normalized.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?(?:\s*(上午|下午|晚上|中午)?\s*(\d{1,2})(?:[:：点](\d{2})?)?)?/);
  if (full) return toIso(Number(full[1]), Number(full[2]), Number(full[3]), full[5], full[6], full[4]);

  const partial = normalized.match(/(\d{1,2})[月/.-](\d{1,2})日?(?:\s*(上午|下午|晚上|中午)?\s*(\d{1,2})(?:[:：点](\d{2})?)?)?/);
  if (partial) {
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

function relativeDate(days: number, text: string): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const { hour, minute } = parseTime(text);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function nextWeekday(dayText: string, text: string, forceNextWeek = false): string {
  const target = "一二三四五六日天".indexOf(dayText);
  const targetDay = target >= 6 ? 0 : target + 1;
  const date = new Date();
  const currentDay = date.getDay();
  const diff = forceNextWeek
    ? (((1 - currentDay + 7) % 7) || 7) + (targetDay === 0 ? 6 : targetDay - 1)
    : (targetDay - currentDay + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  const { hour, minute } = parseTime(text);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function parseTime(text: string): { hour: number; minute: number } {
  const match = text.match(/(上午|下午|晚上|中午)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/)
    ?? text.match(/(上午|下午|晚上|中午)?\s*(\d{1,2})\s*点\s*(?:(\d{1,2})\s*分?)?/);
  if (!match) return { hour: 23, minute: 59 };
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
