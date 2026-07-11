import type { AgentMemory, AgentMemoryPatch, ChroniInputFile, ChroniLlmSettings, ChroniPreferencesPatch, IntakePayload, ItemPatch } from "./shared/types.js";

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
  const allowed = ["title", "importance", "dueAt", "sourceSummary", "completed", "snoozedUntil"];
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
  knownKeys(patch, ["maxDailyMinutes", "workdayStart", "workdayEnd", "reminderFrequency"], "agent memory");
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
  const start = result.workdayStart ?? current?.workdayStart ?? "09:00";
  const end = result.workdayEnd ?? current?.workdayEnd ?? "18:00";
  if (minutesOfClock(start) >= minutesOfClock(end)) fail("agent memory.workdayStart must be before workdayEnd.");
  return result;
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
