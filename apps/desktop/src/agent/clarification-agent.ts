import { randomUUID } from "node:crypto";
import type { ExtractedInput, IntakeDraft, PendingClarification } from "../shared/types.js";
import type { ChroniLlmSettings } from "../shared/types.js";
import { requestChatCompletion } from "../llm-client.js";

export type CompletenessAnalysis = {
  status: "complete" | "needs-clarification";
  draft: IntakeDraft;
  clarifications: PendingClarification[];
};

export function analyzeCompleteness(input: ExtractedInput, now = new Date()): CompletenessAnalysis {
  const createdAt = now.toISOString();
  const draftId = `draft-${randomUUID()}`;
  const title = inferTitle(input.text);
  const dueAt = explicitDeadline(input.text, now);
  const ambiguousNextWeek = /下周(?![一二三四五六日天])/.test(input.text);
  const candidate: IntakeDraft["candidate"] = {
    ...(title ? { title } : {}),
    ...(dueAt && !ambiguousNextWeek ? { dueAt } : {}),
    importance: inferImportance(input.text),
    taskType: inferTaskType(input.text),
  };
  const clarifications: PendingClarification[] = [];
  if (!candidate.title) {
    clarifications.push(createClarification({
      id: `clarification-${randomUUID()}`,
      draftId,
      field: "title",
      question: "这项任务应该叫什么？",
      reason: "原始内容中没有可安全识别的任务标题。",
      options: [],
      now,
    }));
  }
  if (!candidate.dueAt) {
    clarifications.push(createClarification({
      id: `clarification-${randomUUID()}`,
      draftId,
      field: "dueAt",
      question: ambiguousNextWeek ? "“下周”具体是指哪一天截止？" : "这项任务的最终截止日期和时间是什么？",
      reason: ambiguousNextWeek ? "相对日期“下周”无法映射到唯一日期。" : "缺少明确且合法的截止时间。",
      options: ambiguousNextWeek ? nextWeekOptions(now) : [],
      now,
    }));
  }
  const draft: IntakeDraft = {
    id: draftId,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    candidate,
    confidence: {
      title: candidate.title ? 0.82 : 0,
      dueAt: candidate.dueAt ? 0.95 : 0,
      taskType: candidate.taskType ? 0.8 : 0.4,
    },
    pendingClarificationIds: clarifications.map((item) => item.id),
    status: clarifications.length ? "needs-clarification" : "ready",
    createdAt,
    updatedAt: createdAt,
  };
  return { status: clarifications.length ? "needs-clarification" : "complete", draft, clarifications };
}

export async function analyzeCompletenessWithLlm(input: ExtractedInput, settings?: ChroniLlmSettings, now = new Date()): Promise<CompletenessAnalysis> {
  const local = analyzeCompleteness(input, now);
  if (local.status === "complete" || !settings?.enabled || !settings.apiKey || !settings.model) return local;
  try {
    const content = await requestChatCompletion(settings, [
      {
        role: "system",
        content: [
          "你是 Chroni 的信息补全 Agent，只输出 JSON。",
          "本地系统已经决定缺失字段，你只能为这些字段提出简短问题和选项，不得增加事实或修改最终 DDL。",
          "输出 {\"missingFields\":[{\"field\":\"dueAt\",\"question\":\"...\",\"reason\":\"...\",\"options\":[{\"id\":\"...\",\"label\":\"...\",\"value\":\"...\"}]}]}。",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          now: now.toISOString(),
          sourceName: input.sourceName,
          excerpt: input.text.slice(0, 12_000),
          candidate: local.draft.candidate,
          requiredFields: local.clarifications.map((item) => item.field),
        }),
      },
    ], { body: { temperature: 0.1, max_tokens: 1_200, response_format: { type: "json_object" } } });
    const parsed = JSON.parse(content) as { missingFields?: unknown };
    if (!Array.isArray(parsed.missingFields)) return local;
    const proposals = parsed.missingFields as Array<Record<string, unknown>>;
    const clarifications = local.clarifications.map((item) => {
      const proposal = proposals.find((candidate) => candidate.field === item.field);
      if (!proposal) return item;
      const question = boundedProposalString(proposal.question, 160);
      const reason = boundedProposalString(proposal.reason, 240);
      const options = validateProposedOptions(proposal.options, item.field, item.options);
      return { ...item, question: question || item.question, reason: reason || item.reason, options: options.length ? options : item.options };
    });
    return { ...local, clarifications, draft: { ...local.draft, pendingClarificationIds: clarifications.map((item) => item.id) } };
  } catch {
    return local;
  }
}

function boundedProposalString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validateProposedOptions(value: unknown, field: PendingClarification["field"], localOptions: PendingClarification["options"]): PendingClarification["options"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const option = entry as Record<string, unknown>;
    const label = boundedProposalString(option.label, 40);
    if (!label) return [];
    const raw = option.value;
    if (field === "dueAt" || field === "dueTime") {
      if (typeof raw !== "string" || Number.isNaN(new Date(raw).getTime())) return [];
      const localDates = localOptions.map((option) => typeof option.value === "string" ? new Date(option.value).getTime() : Number.NaN).filter(Number.isFinite);
      if (localDates.length && (new Date(raw).getTime() < Math.min(...localDates) || new Date(raw).getTime() > Math.max(...localDates))) return [];
    } else if (typeof raw !== "string" && typeof raw !== "number" && !Array.isArray(raw)) return [];
    return [{ id: boundedProposalString(option.id, 80) || `option-${index + 1}`, label, value: structuredClone(raw) as string | number | string[] }];
  });
}

function createClarification(input: {
  id: string;
  draftId: string;
  field: PendingClarification["field"];
  question: string;
  reason: string;
  options: PendingClarification["options"];
  now: Date;
}): PendingClarification {
  return {
    id: input.id,
    draftId: input.draftId,
    field: input.field,
    question: input.question,
    reason: input.reason,
    options: input.options,
    allowFreeText: true,
    required: true,
    status: "pending",
    createdAt: input.now.toISOString(),
    resumeToken: randomUUID(),
  };
}

function nextWeekOptions(now: Date): PendingClarification["options"] {
  const monday = startOfNextWeek(now);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  return [
    { id: "next-monday", label: "下周一", value: atDeadline(monday).toISOString() },
    { id: "next-friday", label: "下周五", value: atDeadline(friday).toISOString() },
  ];
}

function startOfNextWeek(now: Date): Date {
  const result = new Date(now);
  const daysUntilMonday = ((8 - result.getDay()) % 7) || 7;
  result.setDate(result.getDate() + daysUntilMonday);
  result.setHours(0, 0, 0, 0);
  return result;
}

function atDeadline(value: Date): Date {
  const result = new Date(value);
  result.setHours(23, 59, 0, 0);
  return result;
}

function explicitDeadline(text: string, now: Date): string | undefined {
  const full = text.match(/(20\d{2})[年\/.\-](\d{1,2})[月\/.\-](\d{1,2})日?(?:\s*(\d{1,2})[:：点](\d{2})?)?/);
  if (full) return localDate(Number(full[1]), Number(full[2]), Number(full[3]), Number(full[4] ?? 23), Number(full[5] ?? 59));
  const partial = text.match(/(\d{1,2})[月\/.\-](\d{1,2})日?(?:\s*(\d{1,2})[:：点](\d{2})?)?/);
  if (partial) {
    const month = Number(partial[1]);
    const day = Number(partial[2]);
    let year = now.getFullYear();
    if (new Date(year, month - 1, day, 23, 59).getTime() < now.getTime()) year += 1;
    return localDate(year, month, day, Number(partial[3] ?? 23), Number(partial[4] ?? 59));
  }
  return undefined;
}

function localDate(year: number, month: number, day: number, hour: number, minute: number): string | undefined {
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.toISOString();
}

function inferTitle(text: string): string | undefined {
  const cleaned = text
    .replace(/20\d{2}[年\/.\-]\d{1,2}[月\/.\-]\d{1,2}日?/g, " ")
    .replace(/\d{1,2}[月\/.\-]\d{1,2}日?/g, " ")
    .replace(/\d{1,2}[:：点]\d{0,2}/g, " ")
    .replace(/(今天|明天|后天|下周|本周|周[一二三四五六日天]|星期[一二三四五六日天]|截止|截至|之前|完成|提交|上交|请|需要|记得)/g, " ")
    .replace(/[。！!，,：:\s]+/g, " ")
    .trim();
  if (!cleaned || !/(作业|报告|论文|项目|实验|考试|答辩|汇报|任务|presentation|assignment|report)/i.test(cleaned)) return undefined;
  return cleaned.slice(0, 40);
}

function inferTaskType(text: string): string {
  if (/(作业|课程|实验|论文|考试|答辩)/.test(text)) return "coursework";
  if (/(会议|汇报|presentation)/i.test(text)) return "meeting";
  return "general";
}

function inferImportance(text: string): "high" | "medium" | "low" {
  if (/(紧急|重要|期末|考试|答辩|必须)/.test(text)) return "high";
  if (/(作业|报告|提交|项目|实验)/.test(text)) return "medium";
  return "low";
}
