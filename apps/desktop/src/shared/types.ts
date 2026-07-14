export type ChroniView = "pet" | "schedule" | "control";

export type CompanionState =
  | "idle"
  | "clicked"
  | "hover_accept"
  | "processing"
  | "needs_clarification"
  | "success"
  | "confused"
  | "deadline_near"
  | "overdue"
  | "celebrating"
  | "sleeping";

export type PetAction =
  | "idle"
  | "drag"
  | "cling"
  | "walk"
  | "wake"
  | "study"
  | "eat"
  | "pet"
  | "play"
  | "cat"
  | "sleep";

export type PetActionCommand = {
  action: PetAction;
  mode: "enqueue" | "replace";
  requestedAt: string;
};

export type Importance = "high" | "medium" | "low";

export type ServiceState = "ready" | "limited" | "unavailable";

export type SourceExtractionStatus = "success" | "pending" | "failed" | "duplicate";

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
  automaticInspectionEnabled: boolean;
  useLlmPlanning: boolean;
};

export type AgentMemoryPatch = Partial<AgentMemory>;

export type AgentRiskLevel = "low" | "medium" | "high" | "critical";
export type AgentRunTrigger = "manual" | "startup" | "daily" | "task-change";
export type AgentPlannerSource = "rules" | "llm" | "rules-fallback";

export type AgentTaskAssessment = {
  taskId: string;
  nextStepId?: string;
  nextStepTitle?: string;
  nextStepMinutes?: number;
  title: string;
  dueAt: string;
  importance: Importance;
  riskLevel: AgentRiskLevel;
  score: number;
  estimatedMinutes: number;
  availableMinutesUntilDue?: number;
  slackMinutes?: number;
  actionable?: boolean;
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
  stepId?: string;
  title: string;
  startAt: string;
  endAt: string;
  allocatedMinutes: number;
};

export type AgentPlan = {
  blocks: AgentWorkBlock[];
  forecastBlocks?: AgentWorkBlock[];
  forecastHorizonDays?: number;
  requestedMinutes?: number;
  plannedMinutes: number;
  overflowMinutes: number;
  unplannedTaskIds: string[];
  plannerSource?: AgentPlannerSource;
  fallbackReason?: string;
  coverage?: AgentTaskCoverage[];
};

export type AgentTaskCoverage = {
  taskId: string;
  requiredMinutes: number;
  allocatedMinutes: number;
  coveragePercent: number;
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
  highRiskTaskIds?: string[];
  mitigatedHighRiskTaskIds?: string[];
  coveragePercent?: number;
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
  trigger?: AgentRunTrigger;
  plannerSource?: AgentPlannerSource;
};

export type AgentSnapshot = {
  memory: AgentMemory;
  behaviorMemory: AgentBehaviorMemory;
  recentPlanningFeedback: PlanningFeedbackEvent[];
  latestRun?: AgentRunResult;
  appliedPlan?: AgentPlan;
  lastAutomaticRunAt?: string;
};

export type AgentIcsExportResult = {
  path: string;
  itemCount: number;
};

export type DdlExtractionContext = {
  contextExcerpt: string;
  deliverables: string[];
  submissionMethod?: string;
  constraints: string[];
  risks: string[];
  uncertainties: string[];
  reminderSuggestions: string[];
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
  estimatedMinutes?: number;
  progressPercent?: number;
  extraction?: DdlExtractionContext;
};

export type ClarificationField =
  | "title"
  | "dueAt"
  | "dueTime"
  | "taskType"
  | "deliverables"
  | "estimatedMinutes"
  | "progressPercent"
  | "difficulty"
  | "other";

export type ClarificationOption = {
  id: string;
  label: string;
  value: string | number | string[];
  explanation?: string;
};

export type PendingClarification = {
  id: string;
  sourceId?: string;
  taskId?: string;
  draftId: string;
  field: ClarificationField;
  question: string;
  reason: string;
  options: ClarificationOption[];
  allowFreeText: boolean;
  required: boolean;
  status: "pending" | "answered" | "dismissed" | "expired";
  createdAt: string;
  answeredAt?: string;
  answer?: string | number | string[];
  resumeToken: string;
};

export type IntakeDraftCandidate = {
  title?: string;
  dueAt?: string;
  importance?: Importance;
  estimatedMinutes?: number;
  progressPercent?: number;
  deliverables?: string[];
  taskType?: string;
  sourceSummary?: string;
  extraction?: DdlExtractionContext;
};

export type IntakeDraft = {
  id: string;
  sourceId?: string;
  replacesTaskId?: string;
  sourceName: string;
  sourceType: string;
  candidate: IntakeDraftCandidate;
  confidence: Record<string, number>;
  pendingClarificationIds: string[];
  status: "needs-clarification" | "ready" | "applied" | "cancelled";
  createdAt: string;
  updatedAt: string;
  appliedTaskId?: string;
};

export type TaskStepStatus = "pending" | "in-progress" | "blocked" | "completed" | "skipped";

export type TaskPlanStep = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  order: number;
  dependsOn: string[];
  suggestedStartAt?: string;
  suggestedEndAt?: string;
  completionCriteria: string[];
  status: TaskStepStatus;
  origin: "agent" | "user";
  userModifiedFields: string[];
  memoryPreferenceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type TaskPlan = {
  id: string;
  taskId: string;
  version: number;
  goal: string;
  taskType?: string;
  deliverables: string[];
  constraints: string[];
  steps: TaskPlanStep[];
  estimatedTotalMinutes: number;
  bufferMinutes: number;
  latestSafeStartAt?: string;
  plannerSource: "rules" | "llm" | "personalized-llm" | "rules-fallback";
  memoryPreferenceIds: string[];
  summary: string;
  uncertainties: string[];
  status: "draft" | "active" | "superseded";
  createdAt: string;
  updatedAt: string;
};

export type PlanChange =
  | { type: "step-added"; stepId: string; afterStepId?: string }
  | { type: "step-removed"; stepId: string }
  | { type: "step-reordered"; stepId: string; fromOrder: number; toOrder: number }
  | { type: "duration-changed"; stepId: string; beforeMinutes: number; afterMinutes: number }
  | { type: "title-changed"; stepId: string; before: string; after: string }
  | { type: "buffer-changed"; beforeMinutes: number; afterMinutes: number };

export type TaskPlanRevision = {
  id: string;
  taskId: string;
  planId: string;
  fromVersion: number;
  toVersion: number;
  source: "user" | "agent";
  changes: PlanChange[];
  createdAt: string;
};

export type PlanningFeedbackEvent = {
  id: string;
  taskId: string;
  planId: string;
  planVersion: number;
  taskType?: string;
  source: "plan-edit" | "plan-accept" | "plan-reset";
  changes: PlanChange[];
  context: {
    dueWindowHours: number;
    importance: Importance;
    originalStepCount: number;
    finalStepCount: number;
    originalTotalMinutes: number;
    finalTotalMinutes: number;
    originalBufferMinutes: number;
    finalBufferMinutes: number;
  };
  createdAt: string;
};

export type PlanningPreferenceKey =
  | "preferredStepMinutes"
  | "preferredStepCount"
  | "bufferRatio"
  | "estimateMultiplier"
  | "preferReviewStep"
  | "preferResearchBeforeExecution"
  | "preferLongCoreWorkStep"
  | "preferEarlyStart"
  | "preferredPlanningGranularity";

export type PreferenceScope = {
  taskType?: string;
  importance?: Importance;
  dueWindowBucket?: "under-24h" | "1-3d" | "4-7d" | "over-7d";
};

export type PlanningPreference = {
  id: string;
  key: PlanningPreferenceKey;
  scope: PreferenceScope;
  value: number | boolean | string;
  confidence: number;
  evidenceCount: number;
  positiveEvidenceCount: number;
  negativeEvidenceCount: number;
  lastObservedAt: string;
  status: "candidate" | "active" | "disabled";
  source: "inferred" | "explicit";
  explanation: string;
};

export type AgentBehaviorMemory = {
  version: number;
  preferences: PlanningPreference[];
  recentFeedbackEvents: PlanningFeedbackEvent[];
  learningEnabled: boolean;
  autoApplyEnabled: boolean;
  lastUpdatedAt?: string;
};

export type ClarificationAnswerPayload = { optionId?: string; value?: string | number | string[] };
export type ClarificationResult = { ok: true; message: string; createdTaskId?: string; snapshot: ChroniSnapshot };
export type TaskPlanUpdatePayload = Pick<TaskPlan, "goal" | "deliverables" | "constraints" | "steps" | "bufferMinutes" | "summary" | "uncertainties"> & { baseVersion: number };
export type TaskPlanResult = { ok: true; plan: TaskPlan; snapshot: ChroniSnapshot; message: string };
export type BehaviorMemoryPatch = { learningEnabled?: boolean; autoApplyEnabled?: boolean };
export type ExplicitPreferenceInput = { key: PlanningPreferenceKey; value: number | boolean | string; scope?: PreferenceScope };

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
  storage: "ready" | "recovered" | "reset" | "read-only";
  storageDiagnostic?: string;
  modelEnvironmentConfigured: boolean;
  modelEnabledOverride?: boolean;
  storagePath: string;
  privacy: string;
  notes: string[];
};

export type ChroniSnapshot = {
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

export type PendingExtractedTask = {
  sourceName: string;
  sourceType: string;
  title: string;
  importance: Importance;
  taskType?: string;
  sourceSummary: string;
  extraction: DdlExtractionContext;
  question: string;
  reason: string;
};

export type ExtractResult =
  | { ok: true; extracted: ExtractedInput[]; failures: ExtractedFailure[]; items: DdlItem[]; pendingItems: PendingExtractedTask[]; message: string }
  | { ok: false; reason: string; extracted: ExtractedInput[]; failures: ExtractedFailure[]; items: []; pendingItems: [] };

export type IntakeResult =
  | { ok: true; created: DdlItem[]; message: string; snapshot: ChroniSnapshot }
  | { ok: false; reason: string; snapshot: ChroniSnapshot };

export type ItemPatch = Partial<Pick<DdlItem, "title" | "importance" | "dueAt" | "sourceSummary" | "completed">> & {
  /** `null` explicitly removes a previously stored snooze. */
  snoozedUntil?: string | null;
  /** `null` explicitly removes a previously stored estimate. */
  estimatedMinutes?: number | null;
  /** `null` explicitly removes a previously stored progress value. */
  progressPercent?: number | null;
};

export type ReplaceSourceItemsOptions = {
  /** Tasks represented by unresolved reprocessing drafts remain live until the user answers or cancels. */
  preserveTaskIds?: string[];
};
