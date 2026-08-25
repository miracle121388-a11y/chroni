import { rmSync } from "node:fs";
import { join } from "node:path";
import type { DdlExtractionContext, DdlItem, ExtractedInput, GoaiDemoScenario, IntakeDraft, PendingClarification } from "./shared/types.js";
import { ChroniStore, type SecretCodec } from "./store.js";

export const GOAI_DEMO_NAMESPACE = "goai-demo" as const;

export function createGoaiDemoStore(userDataPath: string, secretCodec: SecretCodec | undefined, scenario: GoaiDemoScenario, now = new Date()): ChroniStore {
  const demoPath = join(userDataPath, GOAI_DEMO_NAMESPACE);
  rmSync(demoPath, { force: true, recursive: true });
  const store = new ChroniStore(demoPath, secretCodec);
  store.updatePreferences({
    companionEnabled: true,
    remindersEnabled: false,
    llm: { enabled: false, apiKey: "" },
  });
  seedScenario(store, scenario, now);
  return store;
}

export function clearGoaiDemoStore(userDataPath: string): void {
  rmSync(join(userDataPath, GOAI_DEMO_NAMESPACE), { force: true, recursive: true });
}

function seedScenario(store: ChroniStore, scenario: GoaiDemoScenario, now: Date): void {
  if (scenario === "clear") {
    seedClearScenario(store, now);
    return;
  }
  seedClarificationScenario(store, scenario, now);
}

function seedClearScenario(store: ChroniStore, now: Date): void {
  const sourceName = "GOAI-A-数据库作业通知.txt";
  const text = "《数据库系统》课程作业三，请于本周日 20:00 前提交 PDF 报告和 SQL 文件。预计需要完成：关系模式设计、SQL 查询、实验截图、报告整理。";
  const dueAt = nextWeekdayAt(now, 0, 20, 0).toISOString();
  const extraction: DdlExtractionContext = {
    contextExcerpt: text,
    deliverables: ["PDF 报告", "SQL 文件"],
    submissionMethod: "课程平台",
    constraints: ["包含关系模式设计、SQL 查询和实验截图"],
    risks: ["报告整理依赖实验截图完成"],
    uncertainties: [],
    reminderSuggestions: ["截止前 24 小时复查两个提交物"],
  };
  const item: DdlItem = {
    id: "goai-a-database-assignment",
    title: "数据库系统课程作业三",
    importance: "high",
    dueAt,
    sourceSummary: `${sourceName}: ${text}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completed: false,
    estimatedMinutes: 300,
    progressPercent: 10,
    extraction,
  };
  const source: ExtractedInput = { sourceName, sourceType: "text/plain", text };
  store.addItems([item], "GOAI 场景 A 已载入。", [source]);
}

function seedClarificationScenario(store: ChroniStore, scenario: "clarification" | "conflict", now: Date): void {
  const isConflict = scenario === "conflict";
  const sourceName = isConflict ? "GOAI-C-多来源冲突.txt" : "GOAI-B-模糊通知.txt";
  const text = isConflict
    ? "课程平台通知：周五 18:00 提交。\n群公告截图：延期到周日 22:00。\n聊天补充：以群公告为准。"
    : "下周把创业比赛材料交了，记得准备演示视频。";
  const draftId = `goai-${scenario}-draft`;
  const clarificationId = `goai-${scenario}-due-at`;
  const options = isConflict ? [
    { id: "platform-friday", label: "课程平台：周五 18:00", value: nextWeekdayAt(now, 5, 18, 0).toISOString(), explanation: "采用课程平台原始通知" },
    { id: "announcement-sunday", label: "群公告：周日 22:00", value: nextWeekdayAt(now, 0, 22, 0).toISOString(), explanation: "采用明确写有延期的群公告" },
  ] : [];
  const candidateTitle = isConflict ? "课程项目最终提交" : "创业比赛材料提交";
  const draft: IntakeDraft = {
    id: draftId,
    sourceName,
    sourceType: "text/plain",
    candidate: {
      title: candidateTitle,
      importance: "high",
      estimatedMinutes: isConflict ? 180 : 240,
      deliverables: isConflict ? ["项目最终材料"] : ["比赛材料", "演示视频"],
      taskType: isConflict ? "课程项目" : "比赛材料",
      sourceSummary: `${sourceName}: ${text}`,
      extraction: {
        contextExcerpt: text,
        deliverables: isConflict ? ["项目最终材料"] : ["比赛材料", "演示视频"],
        constraints: isConflict ? ["必须由用户确认可信来源"] : [],
        risks: isConflict ? ["多个来源给出不同截止时间"] : ["通知没有给出具体日期和时间"],
        uncertainties: [isConflict ? "周五 18:00 与延期后的周日 22:00 冲突" : "“下周”没有对应具体日期"],
        reminderSuggestions: [],
      },
    },
    confidence: { title: 0.92, dueAt: isConflict ? 0.35 : 0.1, deliverables: 0.88 },
    pendingClarificationIds: [clarificationId],
    status: "needs-clarification",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const clarification: PendingClarification = {
    id: clarificationId,
    draftId,
    field: "dueAt",
    question: isConflict ? "两个来源的截止时间冲突，请确认采用哪一个？" : "创业比赛材料具体在下周哪一天、几点截止？",
    reason: isConflict ? "Chroni 不会自行覆盖原始截止时间，必须由你选择可信来源。" : "原文只有“下周”，不足以安全创建具体日程。",
    options,
    allowFreeText: true,
    required: true,
    status: "pending",
    createdAt: now.toISOString(),
    resumeToken: `resume-${scenario}`,
  };
  store.saveIntakeDraft(draft, [clarification], { sourceName, sourceType: "text/plain", text });
}

function nextWeekdayAt(reference: Date, weekday: number, hour: number, minute: number): Date {
  const result = new Date(reference);
  result.setSeconds(0, 0);
  let days = (weekday - result.getDay() + 7) % 7;
  const todayTargetPassed = days === 0 && (result.getHours() > hour || (result.getHours() === hour && result.getMinutes() >= minute));
  if (todayTargetPassed) days = 7;
  result.setDate(result.getDate() + days);
  result.setHours(hour, minute, 0, 0);
  return result;
}
