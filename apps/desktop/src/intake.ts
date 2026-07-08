import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import type { DdlItem, ChroniInputFile, ChroniLlmSettings, ExtractResult, ExtractedInput, Importance, IntakePayload, IntakeResult } from "./shared/types.js";
import type { ChroniStore } from "./store.js";

const plainTextExtensions = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".ics", ".log", ".html", ".htm", ".xml", ".yaml", ".yml", ".rtf"]);
const documentExtensions = new Set([".docx", ".pdf"]);
const spreadsheetExtensions = new Set([".xlsx"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);
const unsupportedExtensions = new Set([".exe", ".dll", ".zip", ".rar", ".7z", ".mp4", ".mov", ".mp3", ".wav", ".app", ".dmg"]);

const maxTextBytes = 2 * 1024 * 1024;
const maxDocumentBytes = 18 * 1024 * 1024;

type ExtractOptions = {
  llm?: ChroniLlmSettings;
};

type LlmDdlCandidate = {
  title?: unknown;
  dueAt?: unknown;
  importance?: unknown;
  sourceSummary?: unknown;
};

export async function processIntake(payload: IntakePayload, store: ChroniStore): Promise<IntakeResult> {
  store.setCompanion("processing", "正在识别 DDL...");
  const result = await extractPayload(payload, { llm: store.snapshot().preferences.llm });
  if (!result.ok) {
    const snapshot = store.setCompanion("confused", result.reason);
    return { ok: false, reason: result.reason, snapshot };
  }

  const snapshot = store.addItems(result.items, result.message);
  return { ok: true, created: result.items, message: snapshot.companion.bubble, snapshot };
}

export async function extractPayload(payload: IntakePayload, options: ExtractOptions = {}): Promise<ExtractResult> {
  const extracted: ExtractedInput[] = [];
  try {
    if (payload.kind === "text") {
      const text = payload.text?.trim() ?? "";
      if (!text) return { ok: false, reason: "输入内容为空。", extracted, items: [] };
      extracted.push({ sourceName: "直接文本", sourceType: "text", text });
    } else {
      extracted.push(...await extractFromFiles(payload.files ?? []));
    }

    const ruleItems = extracted.flatMap((input) => extractDdlItemsFromText(input.text, input.sourceName));
    const llmItems = await extractWithLlmIfAvailable(extracted, options.llm).catch(() => []);
    const items = llmItems.length ? llmItems : ruleItems;
    if (!items.length) {
      return { ok: false, reason: "没有识别到明确 DDL。", extracted, items: [] };
    }
    return {
      ok: true,
      extracted,
      items: mergeDuplicateItems(items).slice(0, 12),
      message: items.length === 1 ? "已加入 1 条日程。" : `已加入 ${Math.min(items.length, 12)} 条日程。`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      extracted,
      items: [],
    };
  }
}

async function extractWithLlmIfAvailable(extracted: ExtractedInput[], settings?: ChroniLlmSettings): Promise<DdlItem[]> {
  const envApiKey = process.env.CHRONI_LLM_API_KEY ?? "";
  const enabled = settings?.enabled || process.env.CHRONI_LLM_ENABLED === "1";
  const apiKey = settings?.apiKey || envApiKey;
  const baseUrl = normalizeBaseUrl(settings?.baseUrl || process.env.CHRONI_LLM_BASE_URL || "https://api.openai.com/v1");
  const model = settings?.model || process.env.CHRONI_LLM_MODEL || "gpt-4.1-mini";
  if (!enabled || !apiKey || !model) return [];

  const allText = extracted.map((input) => `来源：${input.sourceName}\n${input.text}`).join("\n\n---\n\n").slice(0, 24_000);
  const today = new Date().toISOString();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是 Chroni 的 DDL 信息抽取器。",
            "只输出 JSON，不输出解释。",
            "从输入中抽取明确的截止事项。",
            "字段结构固定：{\"items\":[{\"title\":\"短标题\",\"dueAt\":\"ISO-8601时间\",\"importance\":\"high|medium|low\",\"sourceSummary\":\"一句来源摘要\"}]}。",
            "title 控制在 16 个中文字符以内。",
            "dueAt 必须是可被 JavaScript Date 解析的 ISO-8601 字符串。",
            "没有明确截止时间的内容不要输出。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `当前时间：${today}\n\n请抽取以下内容中的 DDL：\n${allText}`,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`LLM 服务不可用：HTTP ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = parseLlmJson(content);
  const candidates = Array.isArray(parsed.items) ? parsed.items as LlmDdlCandidate[] : [];
  return candidates
    .map((candidate) => itemFromLlmCandidate(candidate))
    .filter((item): item is DdlItem => !!item);
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

function itemFromLlmCandidate(candidate: LlmDdlCandidate): DdlItem | null {
  const title = String(candidate.title ?? "").trim().slice(0, 16);
  const dueAtRaw = String(candidate.dueAt ?? "").trim();
  const dueAt = new Date(dueAtRaw);
  if (!title || Number.isNaN(dueAt.getTime())) return null;
  const importance = candidate.importance === "high" || candidate.importance === "medium" || candidate.importance === "low"
    ? candidate.importance
    : importanceFromText(`${title} ${candidate.sourceSummary ?? ""}`);
  return createItem(title, dueAt.toISOString(), String(candidate.sourceSummary ?? title).slice(0, 180), importance);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export async function extractFromFiles(files: ChroniInputFile[]): Promise<ExtractedInput[]> {
  if (!files.length) throw new Error("没有收到可读取的文件。");
  const results: ExtractedInput[] = [];
  for (const file of files) {
    results.push(await extractSingleFile(file));
  }
  return results;
}

export function extractDdlItemsFromText(text: string, sourceName = "输入内容"): DdlItem[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const candidates = candidateLines(normalized);
  const items = candidates
    .map((line) => {
      const dueAt = dateFromText(line);
      if (!dueAt) return null;
      return createItem(shortTitle(line), dueAt, `${sourceName}: ${line.slice(0, 180)}`);
    })
    .filter((item): item is DdlItem => !!item);

  if (items.length) return items;
  const dueAt = dateFromText(normalized);
  return dueAt ? [createItem(shortTitle(normalized), dueAt, `${sourceName}: ${normalized.slice(0, 180)}`)] : [];
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
    return { sourceName: name, sourceType, text: textFromBuffer(buffer) };
  }
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return { sourceName: name, sourceType, text: result.value };
  }
  if (extension === ".pdf") {
    const mod = await import("pdf-parse") as unknown as { default: (data: Buffer) => Promise<{ text: string }> };
    const result = await mod.default(buffer);
    return { sourceName: name, sourceType, text: result.text };
  }
  if (spreadsheetExtensions.has(extension)) {
    const rows = await readXlsxFile(buffer) as unknown as unknown[][];
    const text = rows.map((row) => row.map((cell: unknown) => cell instanceof Date ? cell.toISOString() : String(cell ?? "")).join(", ")).join("\n");
    return { sourceName: name, sourceType, text };
  }
  if (imageExtensions.has(extension)) {
    const mod = await import("tesseract.js") as unknown as {
      recognize: (image: Buffer | string, langs?: string) => Promise<{ data: { text: string } }>;
    };
    const result = await mod.recognize(buffer, "chi_sim+eng");
    const text = result.data.text;
    if (!text.trim()) throw new Error(`图片 OCR 失败：${name}`);
    return { sourceName: name, sourceType, text };
  }

  throw new Error(`文件类型不支持：${name}`);
}

function readFileBuffer(file: ChroniInputFile): Buffer {
  if (file.contentBase64) return Buffer.from(file.contentBase64, "base64");
  if (!file.path || !existsSync(file.path)) throw new Error(`文件无法读取：${file.name}`);
  const stat = statSync(file.path);
  if (!stat.isFile()) throw new Error(`不是可读取的文件：${file.name}`);
  return readFileSync(file.path);
}

function textFromBuffer(buffer: Buffer): string {
  const text = buffer.toString("utf8");
  return text.includes("\u0000") ? buffer.toString("utf16le") : text;
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

export function shortTitle(text: string): string {
  const cleaned = text
    .replace(/(截止|截至|ddl|deadline|due|提交|完成|之前|前|到期|提醒|请在|需要|任务)[:：]*/gi, " ")
    .replace(/\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?/g, " ")
    .replace(/\d{1,2}[月/-]\d{1,2}日?/g, " ")
    .replace(/\d{1,2}[:：]\d{2}/g, " ")
    .replace(/(明天|后天|今天|今晚|上午|下午|晚上|中午|周[一二三四五六日天]|星期[一二三四五六日天])/g, " ")
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
  const full = normalized.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?(?:\s*(上午|下午|晚上|中午)?\s*(\d{1,2})(?:[:：点](\d{2})?)?)?/);
  if (full) return toIso(Number(full[1]), Number(full[2]), Number(full[3]), full[5], full[6], full[4]);

  const partial = normalized.match(/(\d{1,2})[月/-](\d{1,2})日?(?:\s*(上午|下午|晚上|中午)?\s*(\d{1,2})(?:[:：点](\d{2})?)?)?/);
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

function nextWeekday(dayText: string, text: string): string {
  const target = "一二三四五六日天".indexOf(dayText);
  const targetDay = target >= 6 ? 0 : target + 1;
  const date = new Date();
  const diff = (targetDay - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  const { hour, minute } = parseTime(text);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function parseTime(text: string): { hour: number; minute: number } {
  const match = text.match(/(上午|下午|晚上|中午)?\s*(\d{1,2})(?:[:：点](\d{2})?)?/);
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
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) throw new Error("无法解析截止时间。");
  return date.toISOString();
}
