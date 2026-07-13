import type { AgentMemory, AgentMemoryPatch, BehaviorMemoryPatch, ClarificationAnswerPayload, ChroniInputFile, ChroniLlmSettings, ExplicitPreferenceInput, ChroniPreferencesPatch, IntakePayload, ItemPatch, PlanningPreferenceKey, TaskPlanStep, TaskPlanUpdatePayload } from "./shared/types.js";

const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
const MAX_FILES = 32;
const MAX_FILE_BASE64_CHARS = 44 * 1024 * 1024;

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}

export function validateIntakePayload(value: unknown): IntakePayload {
  const payload = record(value, "payload");
  knownKeys(payload, ["kind", "text", "files"], "payload");
  if (payload.kind === "text") {
    return { kind: "text", text: boundedString(payload.text, "text", MAX_TEXT_LENGTH) };
  }
  if (payload.kind !== "files") fail("kind must be either text or files.");
  if (!Array.isArray(payload.files)) fail("files must be an array.");
  if (payload.files.length > MAX_FILES) fail(`files may contain at most ${MAX_FILES} entries.`);
  let encodedCharacters = 0;
  const files = payload.files.map((file, index) => {
    const validated = validateInputFile(file, index);
    encodedCharacters += validated.contentBase64?.length ?? 0;
    if (encodedCharacters > MAX_FILE_BASE64_CHARS) fail("files contain too much encoded content.");
    return validated;
  });
  return { kind: "files", files };
}

export function validateItemPatch(value: unknown): ItemPatch {
  const patch = record(value, "item patch");
  const allowed = ["title", "importance", "dueAt", "sourceSummary", "completed", "snoozedUntil", "estimatedMinutes", "progressPercent"];
  knownKeys(patch, allowed, "item patch");
  if (!Object.keys(patch).length) fail("item patch must contain at least one field.");
  const result: ItemPatch = {};
  if (patch.title !== undefined) result.title = nonEmptyString(patch.title, "title", 120);
  if (patch.importance !== undefined) {
    if (patch.importance !== "high" && patch.importance !== "medium" && patch.importance !== "low") fail("importance must be high, medium, or low.");
    result.importance = patch.importance;
  }
  if (patch.dueAt !== undefined) result.dueAt = dateString(patch.dueAt, "dueAt");
  if (patch.sourceSummary !== undefined) result.sourceSummary = boundedString(patch.sourceSummary, "sourceSummary", 500);
  if (patch.completed !== undefined) result.completed = booleanValue(patch.completed, "completed");
  if (patch.snoozedUntil !== undefined) result.snoozedUntil = dateString(patch.snoozedUntil, "snoozedUntil");
  if (patch.estimatedMinutes !== undefined) {
    if (!Number.isInteger(patch.estimatedMinutes) || (patch.estimatedMinutes as number) < 15 || (patch.estimatedMinutes as number) > 1_440) fail("estimatedMinutes must be an integer from 15 to 1440.");
    result.estimatedMinutes = patch.estimatedMinutes as number;
  }
  if (patch.progressPercent !== undefined) {
    if (!Number.isInteger(patch.progressPercent) || (patch.progressPercent as number) < 0 || (patch.progressPercent as number) > 100) fail("progressPercent must be an integer from 0 to 100.");
    result.progressPercent = patch.progressPercent as number;
  }
  return result;
}

export function validatePreferencesPatch(value: unknown): ChroniPreferencesPatch {
  const patch = record(value, "preferences patch");
  const allowed = ["companionEnabled", "companionStyle", "remindersEnabled", "quietHoursEnabled", "quietHoursStart", "quietHoursEnd", "hotkey", "llm"];
  knownKeys(patch, allowed, "preferences patch");
  const result: ChroniPreferencesPatch = {};
  for (const field of ["companionEnabled", "remindersEnabled", "quietHoursEnabled"] as const) {
    if (patch[field] !== undefined) result[field] = booleanValue(patch[field], field);
  }
  if (patch.companionStyle !== undefined) {
    if (patch.companionStyle !== "classic" && patch.companionStyle !== "mint" && patch.companionStyle !== "sunrise") fail("companionStyle is not supported.");
    result.companionStyle = patch.companionStyle;
  }
  if (patch.quietHoursStart !== undefined) result.quietHoursStart = clockTime(patch.quietHoursStart, "quietHoursStart");
  if (patch.quietHoursEnd !== undefined) result.quietHoursEnd = clockTime(patch.quietHoursEnd, "quietHoursEnd");
  if (patch.hotkey !== undefined) result.hotkey = boundedString(patch.hotkey, "hotkey", 100);
  if (patch.llm !== undefined) {
    const llm = record(patch.llm, "llm");
    knownKeys(llm, ["enabled", "provider", "baseUrl", "apiKey", "model"], "llm");
    result.llm = {};
    if (llm.enabled !== undefined) result.llm.enabled = booleanValue(llm.enabled, "llm.enabled");
    if (llm.provider !== undefined) {
      if (llm.provider !== "openai-compatible") fail("llm.provider must be openai-compatible.");
      result.llm.provider = llm.provider;
    }
    if (llm.baseUrl !== undefined) result.llm.baseUrl = boundedString(llm.baseUrl, "llm.baseUrl", 2_048);
    if (llm.apiKey !== undefined) result.llm.apiKey = boundedString(llm.apiKey, "llm.apiKey", 8_192);
    if (llm.model !== undefined) result.llm.model = boundedString(llm.model, "llm.model", 200);
  }
  return result;
}

export function validateLlmSettings(value: unknown): ChroniLlmSettings {
  const llm = validatePreferencesPatch({ llm: value }).llm;
  if (!llm || typeof llm.enabled !== "boolean" || llm.provider !== "openai-compatible"
    || typeof llm.baseUrl !== "string" || typeof llm.apiKey !== "string" || typeof llm.model !== "string") {
    fail("llm settings must include enabled, provider, baseUrl, apiKey, and model.");
  }
  return llm as ChroniLlmSettings;
}

export function validateAgentMemoryPatch(value: unknown, current?: AgentMemory): AgentMemoryPatch {
  const patch = record(value, "agent memory");
  knownKeys(patch, ["maxDailyMinutes", "workdayStart", "workdayEnd", "reminderFrequency", "automaticInspectionEnabled", "useLlmPlanning"], "agent memory");
  const result: AgentMemoryPatch = {};
  if (patch.maxDailyMinutes !== undefined) {
    if (!Number.isInteger(patch.maxDailyMinutes) || (patch.maxDailyMinutes as number) < 30 || (patch.maxDailyMinutes as number) > 720) {
      fail("agent memory.maxDailyMinutes must be an integer from 30 to 720.");
    }
    result.maxDailyMinutes = patch.maxDailyMinutes as number;
  }
  if (patch.workdayStart !== undefined) result.workdayStart = clockTime(patch.workdayStart, "agent memory.workdayStart");
  if (patch.workdayEnd !== undefined) result.workdayEnd = clockTime(patch.workdayEnd, "agent memory.workdayEnd");
  if (patch.reminderFrequency !== undefined) {
    if (patch.reminderFrequency !== "important-only" && patch.reminderFrequency !== "daily" && patch.reminderFrequency !== "off") {
      fail("agent memory.reminderFrequency is not supported.");
    }
    result.reminderFrequency = patch.reminderFrequency;
  }
  if (patch.automaticInspectionEnabled !== undefined) result.automaticInspectionEnabled = booleanValue(patch.automaticInspectionEnabled, "agent memory.automaticInspectionEnabled");
  if (patch.useLlmPlanning !== undefined) result.useLlmPlanning = booleanValue(patch.useLlmPlanning, "agent memory.useLlmPlanning");
  const start = result.workdayStart ?? current?.workdayStart ?? "09:00";
  const end = result.workdayEnd ?? current?.workdayEnd ?? "18:00";
  if (minutesOfClock(start) >= minutesOfClock(end)) fail("agent memory.workdayStart must be before workdayEnd.");
  return result;
}

export function validateClarificationAnswer(value: unknown): ClarificationAnswerPayload {
  const payload = record(value, "clarification answer");
  knownKeys(payload, ["optionId", "value"], "clarification answer");
  if (payload.optionId === undefined && payload.value === undefined) fail("clarification answer must include optionId or value.");
  const result: ClarificationAnswerPayload = {};
  if (payload.optionId !== undefined) result.optionId = nonEmptyString(payload.optionId, "clarification answer.optionId", 200);
  if (payload.value !== undefined) {
    if (typeof payload.value === "string") result.value = boundedString(payload.value, "clarification answer.value", 500);
    else if (typeof payload.value === "number" && Number.isFinite(payload.value)) result.value = payload.value;
    else if (Array.isArray(payload.value) && payload.value.length <= 12 && payload.value.every((item) => typeof item === "string" && item.length <= 200)) result.value = [...payload.value];
    else fail("clarification answer.value is invalid.");
  }
  return result;
}

export function validateTaskPlanUpdate(value: unknown): TaskPlanUpdatePayload {
  const payload = record(value, "task plan update");
  knownKeys(payload, ["baseVersion", "goal", "deliverables", "constraints", "steps", "bufferMinutes", "summary", "uncertainties"], "task plan update");
  if (!Number.isInteger(payload.baseVersion) || (payload.baseVersion as number) < 1) fail("task plan update.baseVersion must be a positive integer.");
  if (!Array.isArray(payload.steps) || payload.steps.length < 1 || payload.steps.length > 12) fail("task plan update.steps must contain 1 to 12 steps.");
  const steps = payload.steps.map((step, index) => validateTaskPlanStep(step, index));
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) fail("task plan step ids must be unique.");
  if (steps.some((step) => step.dependsOn.some((id) => !ids.has(id) || id === step.id))) fail("task plan step dependency is invalid.");
  if (!Number.isInteger(payload.bufferMinutes) || (payload.bufferMinutes as number) < 0 || (payload.bufferMinutes as number) > 1_440) fail("task plan update.bufferMinutes must be from 0 to 1440.");
  return {
    baseVersion: payload.baseVersion as number,
    goal: nonEmptyString(payload.goal, "task plan update.goal", 200),
    deliverables: stringArray(payload.deliverables, "task plan update.deliverables", 12, 200),
    constraints: stringArray(payload.constraints, "task plan update.constraints", 16, 300),
    steps,
    bufferMinutes: payload.bufferMinutes as number,
    summary: boundedString(payload.summary, "task plan update.summary", 500),
    uncertainties: stringArray(payload.uncertainties, "task plan update.uncertainties", 12, 300),
  };
}

export function validateBehaviorMemoryPatch(value: unknown): BehaviorMemoryPatch {
  const patch = record(value, "behavior memory patch");
  knownKeys(patch, ["learningEnabled", "autoApplyEnabled"], "behavior memory patch");
  if (!Object.keys(patch).length) fail("behavior memory patch must contain at least one field.");
  const result: BehaviorMemoryPatch = {};
  if (patch.learningEnabled !== undefined) result.learningEnabled = booleanValue(patch.learningEnabled, "behavior memory patch.learningEnabled");
  if (patch.autoApplyEnabled !== undefined) result.autoApplyEnabled = booleanValue(patch.autoApplyEnabled, "behavior memory patch.autoApplyEnabled");
  return result;
}

export function validateExplicitPreference(value: unknown): ExplicitPreferenceInput {
  const payload = record(value, "explicit preference");
  knownKeys(payload, ["key", "value", "scope"], "explicit preference");
  const key = planningPreferenceKey(payload.key);
  const scopeValue = payload.scope === undefined ? {} : record(payload.scope, "explicit preference.scope");
  knownKeys(scopeValue, ["taskType", "importance", "dueWindowBucket"], "explicit preference.scope");
  const scope: ExplicitPreferenceInput["scope"] = {};
  if (scopeValue.taskType !== undefined) scope.taskType = nonEmptyString(scopeValue.taskType, "explicit preference.scope.taskType", 80);
  if (scopeValue.importance !== undefined) {
    if (!(["high", "medium", "low"] as unknown[]).includes(scopeValue.importance)) fail("explicit preference.scope.importance is invalid.");
    scope.importance = scopeValue.importance as "high" | "medium" | "low";
  }
  if (scopeValue.dueWindowBucket !== undefined) {
    if (!(["under-24h", "1-3d", "4-7d", "over-7d"] as unknown[]).includes(scopeValue.dueWindowBucket)) fail("explicit preference.scope.dueWindowBucket is invalid.");
    scope.dueWindowBucket = scopeValue.dueWindowBucket as NonNullable<ExplicitPreferenceInput["scope"]>["dueWindowBucket"];
  }
  const result: ExplicitPreferenceInput = { key, value: validatePreferenceValue(key, payload.value) };
  if (Object.keys(scope).length) result.scope = scope;
  return result;
}

export function validatePreferenceStatus(value: unknown): "active" | "disabled" {
  if (value !== "active" && value !== "disabled") fail("preference status must be active or disabled.");
  return value;
}

export function validatePlanActivation(value: unknown): string {
  const payload = record(value, "plan activation");
  knownKeys(payload, ["planId"], "plan activation");
  return nonEmptyString(payload.planId, "plan activation.planId", 200);
}

export function validatePreferenceStatusPatch(value: unknown): "active" | "disabled" {
  const payload = record(value, "preference status patch");
  knownKeys(payload, ["status"], "preference status patch");
  return validatePreferenceStatus(payload.status);
}

export function validateIdentifier(value: unknown, field = "id"): string {
  return nonEmptyString(value, field, 500);
}

export function validateSourceText(value: unknown): string {
  return boundedString(value, "source text", MAX_TEXT_LENGTH);
}

export function validateBoolean(value: unknown, field: string): boolean {
  return booleanValue(value, field);
}

function validateInputFile(value: unknown, index: number): ChroniInputFile {
  const file = record(value, `files[${index}]`);
  knownKeys(file, ["path", "name", "type", "contentBase64"], `files[${index}]`);
  const result: ChroniInputFile = { name: nonEmptyString(file.name, `files[${index}].name`, 260) };
  if (file.path !== undefined) result.path = boundedString(file.path, `files[${index}].path`, 4_096);
  if (file.type !== undefined) result.type = boundedString(file.type, `files[${index}].type`, 200);
  if (file.contentBase64 !== undefined) result.contentBase64 = boundedString(file.contentBase64, `files[${index}].contentBase64`, MAX_FILE_BASE64_CHARS);
  if (!result.path && result.contentBase64 === undefined) fail(`files[${index}] must include path or contentBase64.`);
  return result;
}

function validateTaskPlanStep(value: unknown, index: number): TaskPlanStep {
  const step = record(value, `task plan step[${index}]`);
  knownKeys(step, ["id", "taskId", "title", "description", "estimatedMinutes", "order", "dependsOn", "suggestedStartAt", "suggestedEndAt", "completionCriteria", "status", "origin", "userModifiedFields", "memoryPreferenceIds", "createdAt", "updatedAt"], `task plan step[${index}]`);
  if (!Number.isInteger(step.estimatedMinutes) || (step.estimatedMinutes as number) < 15 || (step.estimatedMinutes as number) > 480) fail(`task plan step[${index}].estimatedMinutes must be from 15 to 480.`);
  if (!(["pending", "in-progress", "blocked", "completed", "skipped"] as unknown[]).includes(step.status)) fail(`task plan step[${index}].status is invalid.`);
  const result: TaskPlanStep = {
    id: nonEmptyString(step.id, `task plan step[${index}].id`, 200),
    taskId: nonEmptyString(step.taskId, `task plan step[${index}].taskId`, 200),
    title: nonEmptyString(step.title, `task plan step[${index}].title`, 80),
    description: boundedString(step.description, `task plan step[${index}].description`, 500),
    estimatedMinutes: step.estimatedMinutes as number,
    order: index + 1,
    dependsOn: stringArray(step.dependsOn, `task plan step[${index}].dependsOn`, 12, 200),
    completionCriteria: stringArray(step.completionCriteria, `task plan step[${index}].completionCriteria`, 8, 200),
    status: step.status as TaskPlanStep["status"],
    origin: "user",
    userModifiedFields: stringArray(step.userModifiedFields ?? [], `task plan step[${index}].userModifiedFields`, 20, 80),
    memoryPreferenceIds: stringArray(step.memoryPreferenceIds ?? [], `task plan step[${index}].memoryPreferenceIds`, 8, 200),
    createdAt: dateString(step.createdAt, `task plan step[${index}].createdAt`),
    updatedAt: dateString(step.updatedAt, `task plan step[${index}].updatedAt`),
  };
  if (step.suggestedStartAt !== undefined) result.suggestedStartAt = dateString(step.suggestedStartAt, `task plan step[${index}].suggestedStartAt`);
  if (step.suggestedEndAt !== undefined) result.suggestedEndAt = dateString(step.suggestedEndAt, `task plan step[${index}].suggestedEndAt`);
  return result;
}

function stringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${field} must be an array with at most ${maxItems} entries.`);
  return value.map((item, index) => boundedString(item, `${field}[${index}]`, maxLength));
}

function planningPreferenceKey(value: unknown): PlanningPreferenceKey {
  const keys: PlanningPreferenceKey[] = ["preferredStepMinutes", "preferredStepCount", "bufferRatio", "estimateMultiplier", "preferReviewStep", "preferResearchBeforeExecution", "preferLongCoreWorkStep", "preferEarlyStart", "preferredPlanningGranularity"];
  if (!keys.includes(value as PlanningPreferenceKey)) fail("explicit preference.key is invalid.");
  return value as PlanningPreferenceKey;
}

function validatePreferenceValue(key: PlanningPreferenceKey, value: unknown): number | boolean | string {
  if (key === "preferredStepMinutes") return boundedNumber(value, 15, 180, key);
  if (key === "preferredStepCount") return boundedNumber(value, 1, 12, key, true);
  if (key === "bufferRatio") return boundedNumber(value, 0, 0.5, key);
  if (key === "estimateMultiplier") return boundedNumber(value, 0.5, 3, key);
  if (key === "preferredPlanningGranularity") return nonEmptyString(value, key, 40);
  if (typeof value !== "boolean") fail(`${key} must be a boolean.`);
  return value;
}

function boundedNumber(value: unknown, min: number, max: number, field: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`${field} must be from ${min} to ${max}.`);
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function knownKeys(value: Record<string, unknown>, allowed: string[], field: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail(`${field}.${unknown} is not supported.`);
}

function nonEmptyString(value: unknown, field: string, maxLength: number): string {
  const result = boundedString(value, field, maxLength);
  if (!result.trim()) fail(`${field} must not be empty.`);
  return result;
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") fail(`${field} must be a string.`);
  if (value.length > maxLength) fail(`${field} exceeds ${maxLength} characters.`);
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(`${field} must be a boolean.`);
  return value;
}

function dateString(value: unknown, field: string): string {
  const result = nonEmptyString(value, field, 100);
  if (Number.isNaN(new Date(result).getTime())) fail(`${field} must be a valid date string.`);
  return result;
}

function clockTime(value: unknown, field: string): string {
  const result = boundedString(value, field, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) fail(`${field} must use HH:MM.`);
  return result;
}

function minutesOfClock(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function fail(message: string): never {
  throw new InputValidationError(message);
}
