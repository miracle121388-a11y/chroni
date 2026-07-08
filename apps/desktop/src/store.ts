import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CompanionState, DdlItem, ChroniPreferences, ChroniPreferencesPatch, ChroniSnapshot, ExtractedInput, ItemPatch, ServiceStatus, SourceRecord } from "./shared/types.js";

type StoredState = {
  items: DdlItem[];
  sources: SourceRecord[];
  preferences: ChroniPreferences;
  companion: {
    state: CompanionState;
    bubble: string;
  };
};

const defaultPreferences: ChroniPreferences = {
  companionEnabled: true,
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

const defaultState: StoredState = {
  items: [
    {
      id: "seed-course-report",
      title: "课程报告 PDF",
      importance: "high",
      dueAt: nextDateAt(2, 23, 59),
      sourceSummary: "示例：拖入课程通知后生成的 DDL。",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completed: false,
    },
    {
      id: "seed-lab-submit",
      title: "实验记录提交",
      importance: "medium",
      dueAt: nextDateAt(5, 18, 0),
      sourceSummary: "示例：近期需要关注的普通事项。",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completed: false,
    },
  ],
  sources: [],
  preferences: defaultPreferences,
  companion: {
    state: "idle",
    bubble: "把 DDL 文件、截图或文字拖给我。",
  },
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
    const sources = extracted.map((input) => sourceRecordFromInput(input));
    const sourceByName = new Map(sources.map((source) => [source.sourceName, source]));
    const accepted = items
      .filter((item) => !existingKeys.has(dedupeKey(item)))
      .map((item) => {
        const source = sourceByName.get(sourceNameFromSummary(item.sourceSummary)) ?? sources[0];
        return source ? { ...item, sourceId: source.id } : item;
      });
    for (const source of sources) {
      source.itemIds = accepted.filter((item) => item.sourceId === source.id).map((item) => item.id);
    }
    this.#state.items = [...this.#state.items, ...accepted];
    this.#state.sources = accepted.length ? pruneSources([...sources, ...this.#state.sources]) : this.#state.sources;
    this.#state.companion = accepted.length
      ? { state: "success", bubble: message }
      : { state: "confused", bubble: "这条 DDL 已经在日程里了。" };
    this.#save();
    return this.snapshot();
  }

  sourceById(id: string): SourceRecord | undefined {
    return this.#state.sources.find((source) => source.id === id);
  }

  updateItem(id: string, patch: ItemPatch): ChroniSnapshot {
    this.#state.items = this.#state.items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item);
    const updated = this.#state.items.find((item) => item.id === id);
    if (updated?.completed) this.#state.companion = { state: "celebrating", bubble: "完成得很干脆。" };
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
    this.#state.companion = { state: "idle", bubble: "已删除误识别事项。" };
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
    const itemIds = accepted.filter((item) => item.sourceId === sourceId).map((item) => item.id);
    this.#state.items = accepted;
    this.#state.sources = this.#state.sources.map((record) => record.id === sourceId
      ? { ...record, itemIds, updatedAt: new Date().toISOString(), lastExtractedAt: new Date().toISOString() }
      : record);
    this.#state.companion = itemIds.length
      ? { state: "success", bubble: message }
      : { state: "confused", bubble: "重新识别后没有明确 DDL。" };
    this.#save();
    return this.snapshot();
  }

  updatePreferences(patch: ChroniPreferencesPatch): ChroniSnapshot {
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
    if (!existsSync(this.filePath)) return defaultState;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StoredState>;
      return {
        items: Array.isArray(parsed.items) ? parsed.items : defaultState.items,
        sources: Array.isArray(parsed.sources) ? parsed.sources as SourceRecord[] : defaultState.sources,
        preferences: {
          ...defaultPreferences,
          ...(parsed.preferences ?? {}),
          llm: { ...defaultPreferences.llm, ...(parsed.preferences?.llm ?? {}) },
        },
        companion: parsed.companion?.state ? parsed.companion as StoredState["companion"] : defaultState.companion,
      };
    } catch {
      return defaultState;
    }
  }

  #save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.#state, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }
}

export function sourceRecordFromInput(input: ExtractedInput): SourceRecord {
  const now = new Date().toISOString();
  return {
    id: `source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    text: input.text,
    summary: `${input.sourceName}，抽取 ${input.text.length} 字`,
    createdAt: now,
    updatedAt: now,
    lastExtractedAt: now,
    itemIds: [],
  };
}

export function compareDdlItems(a: DdlItem, b: DdlItem): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  const urgentDiff = urgencyScore(b) - urgencyScore(a);
  if (urgentDiff) return urgentDiff;
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

export function visibleItems(items: DdlItem[], limit = 6): DdlItem[] {
  const now = Date.now();
  return items
    .filter((item) => !item.completed)
    .filter((item) => !item.snoozedUntil || new Date(item.snoozedUntil).getTime() <= now)
    .sort(compareDdlItems)
    .slice(0, limit);
}

export function companionStateForItems(items: DdlItem[]): { state: CompanionState; bubble: string } {
  const active = items.filter((item) => !item.completed);
  if (!active.length) return { state: "celebrating", bubble: "今天暂时没有紧急 DDL。" };
  const first = [...active].sort(compareDdlItems)[0];
  const hours = (new Date(first.dueAt).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return { state: "overdue", bubble: `${first.title} 已逾期。` };
  if (hours <= 24) return { state: "deadline_near", bubble: `${first.title} 快到截止时间了。` };
  return { state: "idle", bubble: `最近要注意：${first.title}` };
}

function urgencyScore(item: DdlItem): number {
  const hours = (new Date(item.dueAt).getTime() - Date.now()) / 3_600_000;
  const timeScore = hours < 0 ? 500 : hours <= 24 ? 400 : hours <= 72 ? 250 : hours <= 168 ? 120 : 0;
  const importanceScore = item.importance === "high" ? 60 : item.importance === "medium" ? 30 : 10;
  return timeScore + importanceScore;
}

function dedupeKey(item: DdlItem): string {
  return `${item.title.trim().toLowerCase()}|${new Date(item.dueAt).toISOString().slice(0, 16)}`;
}

function sourceNameFromSummary(summary: string): string {
  return summary.split(":", 1)[0] || "";
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

function nextDateAt(daysFromNow: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}
