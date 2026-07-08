export type ChroniView = "pet" | "schedule" | "control";

export type CompanionState =
  | "idle"
  | "clicked"
  | "hover_accept"
  | "processing"
  | "success"
  | "confused"
  | "deadline_near"
  | "overdue"
  | "celebrating"
  | "sleeping";

export type Importance = "high" | "medium" | "low";

export type ServiceState = "ready" | "limited" | "unavailable";

export type DdlItem = {
  id: string;
  title: string;
  importance: Importance;
  dueAt: string;
  sourceSummary: string;
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  snoozedUntil?: string;
};

export type ChroniPreferences = {
  companionEnabled: boolean;
  remindersEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  hotkey: string;
  llm: ChroniLlmSettings;
};

export type ChroniPreferencesPatch = Partial<Omit<ChroniPreferences, "llm">> & {
  llm?: Partial<ChroniLlmSettings>;
};

export type ChroniLlmProvider = "openai-compatible";

export type ChroniLlmSettings = {
  enabled: boolean;
  provider: ChroniLlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ServiceStatus = {
  parser: ServiceState;
  ocr: ServiceState;
  model: ServiceState;
  storagePath: string;
  privacy: string;
  notes: string[];
};

export type ChroniSnapshot = {
  items: DdlItem[];
  preferences: ChroniPreferences;
  companion: {
    state: CompanionState;
    bubble: string;
  };
  services: ServiceStatus;
};

export type IntakePayload = {
  kind: "text" | "files";
  text?: string;
  files?: ChroniInputFile[];
};

export type ChroniInputFile = {
  path?: string;
  name: string;
  type?: string;
  contentBase64?: string;
};

export type ExtractedInput = {
  sourceName: string;
  sourceType: string;
  text: string;
};

export type ExtractResult =
  | { ok: true; extracted: ExtractedInput[]; items: DdlItem[]; message: string }
  | { ok: false; reason: string; extracted: ExtractedInput[]; items: [] };

export type IntakeResult =
  | { ok: true; created: DdlItem[]; message: string; snapshot: ChroniSnapshot }
  | { ok: false; reason: string; snapshot: ChroniSnapshot };

export type ItemPatch = Partial<Pick<DdlItem, "title" | "importance" | "dueAt" | "sourceSummary" | "completed" | "snoozedUntil">>;
