import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compareScheduleItems, visibleActiveScheduleItems } from "./shared/schedule.js";
import type { CompanionState, DdlItem, ChroniPreferences, ChroniPreferencesPatch, ChroniSnapshot, ExtractedInput, ItemPatch, ServiceStatus, SourceExtractionStatus, SourceRecord } from "./shared/types.js";

type StoredState = {
  items: DdlItem[];
  sources: SourceRecord[];
  preferences: ChroniPreferences;
  companion: {
    state: CompanionState;
    bubble: string;
  };
};

export class ChroniStore {
  readonly filePath: string;
  #state: StoredState;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "chroni-state.json");
    this.#state = this.#load();
  }

  snapshot(): ChroniSnapshot {
    return {
      items: [...this.#state.items].sort(compareDdlItems),
      sources: [...this.#state.sources].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      preferences: { ...this.#state.preferences },
      companion: { ...this.#state.companion },
      services: this.serviceStatus(),
    };
  }

  setCompanion(state: CompanionState, bubble: string): ChroniSnapshot {
    this.#state.companion = { state, bubble };
    this.#save();
    return this.snapshot();
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
    const envKey = process.env.CHRONI_LLM_API_KEY ?? "";
    const llm = this.#state.preferences.llm;
    const modelEnabled = llm.enabled || process.env.CHRONI_LLM_ENABLED === "1";
    const modelReady = modelEnabled && !!(llm.apiKey || envKey);
    return {
      parser: "ready",
      ocr: "ready",
      model: modelReady ? "ready" : "limited",
      storagePath: this.filePath,
      privacy: "当前版本把日程数据保存在本机 JSON 文件中，不上传原始输入。",
      notes: [
        "已支持文本、PDF、DOCX、XLSX、CSV、网页/结构化文本和图片 OCR 的本地抽取。",
        modelReady
          ? `LLM 智能抽取已启用，当前模型：${llm.model || process.env.CHRONI_LLM_MODEL || "未设置"}。`
          : "未配置 LLM API Key 时会使用本地规则抽取；配置后优先使用大模型抽取并自动回退。",
        `${this.#state.sources.length} 条输入来源保存在本机，可在控制中心重新识别。`,
        this.#state.preferences.remindersEnabled
          ? `提醒已开启${this.#state.preferences.quietHoursEnabled ? `，勿扰时间 ${this.#state.preferences.quietHoursStart}-${this.#state.preferences.quietHoursEnd}` : ""}。`
          : "提醒已关闭。",
        this.#state.preferences.companionEnabled ? "桌宠入口已开启。" : "桌宠入口已隐藏，可在控制中心重新开启。",
        "识别结果不设确认步骤，可在控制中心轻量修正。",
      ],
    };
  }

  #load(): StoredState {
    if (!existsSync(this.filePath)) return createDefaultState();
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StoredState>;
      const fallback = createDefaultState();
      const defaultPreferences = createDefaultPreferences();
      return {
        items: Array.isArray(parsed.items) ? parsed.items : fallback.items,
        sources: Array.isArray(parsed.sources) ? (parsed.sources as SourceRecord[]).map(normalizeSourceRecord) : fallback.sources,
        preferences: {
          ...defaultPreferences,
          ...(parsed.preferences ?? {}),
          llm: { ...defaultPreferences.llm, ...(parsed.preferences?.llm ?? {}) },
        },
        companion: parsed.companion?.state ? parsed.companion as StoredState["companion"] : fallback.companion,
      };
    } catch {
      return createDefaultState();
    }
  }

  #save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.#state, null, 2), "utf8");
    renameSync(tmp, this.filePath);
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
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4.1-mini",
    },
  };
}

function createDefaultState(): StoredState {
  return {
    items: [],
    sources: [],
    preferences: createDefaultPreferences(),
    companion: {
      state: "idle",
      bubble: "把 DDL 文件、截图或文字拖给我。",
    },
  };
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
