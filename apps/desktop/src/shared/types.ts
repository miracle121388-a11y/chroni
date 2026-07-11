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

export type SourceExtractionStatus = "success" | "failed" | "duplicate";

export type CompanionStyle = "classic" | "mint" | "sunrise";

export type PetPlacement = {
  displayId: number;
  xRatio: number;
  yRatio: number;
};

export type AgentReminderFrequency = "important-only" | "daily" | "off";

export type AgentMemory = {
  maxDailyMinutes: number;
  workdayStart: string;
  workdayEnd: string;
  reminderFrequency: AgentReminderFrequency;
};

export type AgentMemoryPatch = Partial<AgentMemory>;

export type AgentRiskLevel = "low" | "medium" | "high" | "critical";

export type AgentTaskAssessment = {
  taskId: string;
  title: string;
  dueAt: string;
  importance: Importance;
  riskLevel: AgentRiskLevel;
  score: number;
  estimatedMinutes: number;
  reasons: string[];
};

export type AgentObservation = {
  observedAt: string;
  totalCount: number;
  incompleteCount: number;
  activeCount: number;
  snoozedCount: number;
  overdueCount: number;
  activeTasks: DdlItem[];
};

export type AgentWorkBlock = {
  taskId: string;
  title: string;
  startAt: string;
  endAt: string;
  allocatedMinutes: number;
};

export type AgentPlan = {
  blocks: AgentWorkBlock[];
  plannedMinutes: number;
  overflowMinutes: number;
  unplannedTaskIds: string[];
};

export type AgentTraceStage = "observe" | "plan" | "act" | "verify";

export type AgentTraceEntry = {
  id: string;
  sequence: number;
  stage: AgentTraceStage;
  timestamp: string;
  summary: string;
  success: boolean;
  data: Record<string, string | number | boolean | null>;
};

export type AgentAction = {
  tool: string;
  status: "success" | "failed" | "skipped";
  summary: string;
};

export type AgentVerification = {
  status: "healthy" | "attention" | "critical";
  unresolvedHighRiskTaskIds: string[];
  unplannedPriorityTaskIds: string[];
  capacityOverflowMinutes: number;
  summary: string;
};

export type AgentRunResult = {
  id: string;
  startedAt: string;
  completedAt: string;
  observation: AgentObservation;
  priorities: AgentTaskAssessment[];
  plan: AgentPlan;
  actions: AgentAction[];
  verification: AgentVerification;
  suggestions: string[];
  trace: AgentTraceEntry[];
};

export type AgentSnapshot = {
  memory: AgentMemory;
  latestRun?: AgentRunResult;
};

export type AgentIcsExportResult = {
  path: string;
  itemCount: number;
};

export type DdlItem = {
  id: string;
  title: string;
  importance: Importance;
  dueAt: string;
  sourceSummary: string;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  snoozedUntil?: string;
  lastRemindedAt?: string;
};

export type SourceRecord = {
  id: string;
  sourceName: string;
  sourceType: string;
  text: string;
  summary: string;
  extractionStatus: SourceExtractionStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  lastExtractedAt: string;
  itemIds: string[];
};

export type ChroniPreferences = {
  companionEnabled: boolean;
  companionStyle: CompanionStyle;
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

export type LlmConnectionResult =
  | { ok: true; message: string }
  | { ok: false; kind: "configuration" | "authentication" | "model" | "rate_limit" | "timeout" | "response" | "network"; message: string };

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
  sources: SourceRecord[];
  preferences: ChroniPreferences;
  companion: {
    state: CompanionState;
    bubble: string;
  };
  services: ServiceStatus;
  agent: AgentSnapshot;
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

export type ExtractedFailure = ExtractedInput & {
  reason: string;
};

export type ExtractResult =
  | { ok: true; extracted: ExtractedInput[]; failures: ExtractedFailure[]; items: DdlItem[]; message: string }
  | { ok: false; reason: string; extracted: ExtractedInput[]; failures: ExtractedFailure[]; items: [] };

export type IntakeResult =
  | { ok: true; created: DdlItem[]; message: string; snapshot: ChroniSnapshot }
  | { ok: false; reason: string; snapshot: ChroniSnapshot };

export type ItemPatch = Partial<Pick<DdlItem, "title" | "importance" | "dueAt" | "sourceSummary" | "completed" | "snoozedUntil">>;
