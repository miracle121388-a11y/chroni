import { rmSync } from "node:fs";
import { join } from "node:path";
import type { DdlExtractionContext, DdlItem, ExtractedInput, IntakeDraft, PendingClarification, SampleDataScenario } from "./shared/types.js";
import { ChroniStore, type SecretCodec } from "./store.js";

export const SAMPLE_DATA_NAMESPACE = "sample-data" as const;

export function createSampleDataStore(userDataPath: string, secretCodec: SecretCodec | undefined, scenario: SampleDataScenario, now = new Date()): ChroniStore {
  const demoPath = join(userDataPath, SAMPLE_DATA_NAMESPACE);
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

export function clearSampleDataStore(userDataPath: string): void {
  rmSync(join(userDataPath, SAMPLE_DATA_NAMESPACE), { force: true, recursive: true });
}

function seedScenario(store: ChroniStore, scenario: SampleDataScenario, now: Date): void {
  if (scenario === "clear") {
    seedClearScenario(store, now);
    return;
  }
  if (scenario === "adaptive") {
    seedAdaptiveScenario(store, now);
    return;
  }
  seedClarificationScenario(store, scenario, now);
}

function seedClearScenario(store: ChroniStore, now: Date): void {
  const sourceName = "示例-A-数据库作业通知.txt";
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
    id: "sample-a-database-assignment",
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
  store.addItems([item], "完整课程任务示例已载入。", [source]);
}

function seedAdaptiveScenario(store: ChroniStore, now: Date): void {
  const sourceName = "示例-D-连续学习记录.txt";
  const text = "聊天记录：社团汇报 PPT 初稿明天 9:00 在群里收；期末作业明天 9:30 前发给老师。目前期末作业完成 20%，PPT 初稿完成 70%。";
  const createdAt = now.toISOString();
  const finalTask: DdlItem = {
    id: "sample-adaptive-final",
    title: "期末作业",
    importance: "high",
    dueAt: tomorrowAt(now, 9, 30).toISOString(),
    sourceSummary: `${sourceName}: 期末作业明天 9:30 前发给老师。目前完成 20%。`,
    createdAt,
    updatedAt: createdAt,
    completed: false,
    estimatedMinutes: 180,
    progressPercent: 20,
    extraction: {
      contextExcerpt: "期末作业明天 9:30 前发给老师。目前完成 20%。",
      deliverables: ["期末作业"],
      submissionMethod: "发给老师",
      constraints: [],
      risks: ["截止时间接近且完成度较低"],
      uncertainties: [],
      reminderSuggestions: [],
    },
  };
  const clubTask: DdlItem = {
    id: "sample-adaptive-club",
    title: "社团汇报PPT初稿",
    importance: "medium",
    dueAt: tomorrowAt(now, 9, 0).toISOString(),
    sourceSummary: `${sourceName}: 社团汇报 PPT 初稿明天 9:00 在群里收。目前完成 70%。`,
    createdAt,
    updatedAt: createdAt,
    completed: false,
    estimatedMinutes: 45,
    progressPercent: 70,
    extraction: {
      contextExcerpt: "社团汇报 PPT 初稿明天 9:00 在群里收。目前完成 70%。",
      deliverables: ["PPT 初稿"],
      submissionMethod: "群聊",
      constraints: [],
      risks: [],
      uncertainties: [],
      reminderSuggestions: [],
    },
  };
  store.addItems([clubTask, finalTask], "动态个性化示例已载入。", [{ sourceName, sourceType: "text/plain", text }]);
  seedReviewHistory(store, now);
  const missedBlocks = [2, 1].map((daysAgo, index) => {
    const start = dayAt(now, -daysAgo, 15, 0);
    const end = new Date(start.getTime() + 30 * 60_000);
    return { taskId: finalTask.id, title: `期末作业 · 第 ${index + 1} 次推进`, startAt: start.toISOString(), endAt: end.toISOString(), allocatedMinutes: 30 };
  });
  store.saveAppliedAgentPlan({
    blocks: missedBlocks,
    plannedMinutes: 60,
    requestedMinutes: 180,
    overflowMinutes: 120,
    unplannedTaskIds: [finalTask.id],
    plannerSource: "rules",
  });
}

function seedReviewHistory(store: ChroniStore, now: Date): void {
  const completedByDay = [2, 2, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
  const taskNames = ["整理课堂笔记", "推进课程作业", "复习知识点", "准备第二天材料"];
  for (let index = 0; index < completedByDay.length; index += 1) {
    const date = dayAt(now, index - 13, 0, 0);
    const key = localDateKey(date);
    const completed = completedByDay[index];
    for (const [taskIndex, title] of taskNames.entries()) {
      const start = dayAt(date, 0, 9 + taskIndex, 0);
      const end = new Date(start.getTime() + 45 * 60_000);
      const snapshot = store.createDailyTask({ title: `${title} · ${key}`, scheduledStartAt: start.toISOString(), scheduledEndAt: end.toISOString(), color: taskIndex % 2 ? "teal" : "blue" });
      const created = snapshot.dailyTasks.find((task) => task.title === `${title} · ${key}` && task.scheduledStartAt === start.toISOString());
      if (created && taskIndex < completed) store.updateDailyTask(created.id, { completedDates: [key] });
    }
    const unfinished = taskNames.slice(completed);
    store.saveDailyReview({
      date: key,
      summary: `合成连续使用案例：完成 ${completed}/4 项。`,
      note: "仅用于比赛演示，不代表真实用户效果或因果结论。",
      totalTasks: 4,
      completedTasks: completed,
      plannedMinutes: 180,
      completedMinutes: completed * 45,
      unfinishedTaskTitles: unfinished,
    });
  }
}

function seedClarificationScenario(store: ChroniStore, scenario: "clarification" | "conflict", now: Date): void {
  const isConflict = scenario === "conflict";
  const sourceName = isConflict ? "示例-C-多来源冲突.txt" : "示例-B-模糊通知.txt";
  const text = isConflict
    ? "课程平台通知：周五 18:00 提交。\n群公告截图：延期到周日 22:00。\n聊天补充：以群公告为准。"
    : "下周把课程展示材料交了，记得准备演示视频。";
  const draftId = `sample-${scenario}-draft`;
  const clarificationId = `sample-${scenario}-due-at`;
  const options = isConflict ? [
    { id: "platform-friday", label: "课程平台：周五 18:00", value: nextWeekdayAt(now, 5, 18, 0).toISOString(), explanation: "采用课程平台原始通知" },
    { id: "announcement-sunday", label: "群公告：周日 22:00", value: nextWeekdayAt(now, 0, 22, 0).toISOString(), explanation: "采用明确写有延期的群公告" },
  ] : [];
  const candidateTitle = isConflict ? "课程项目最终提交" : "课程展示材料提交";
  const draft: IntakeDraft = {
    id: draftId,
    sourceName,
    sourceType: "text/plain",
    candidate: {
      title: candidateTitle,
      importance: "high",
      estimatedMinutes: isConflict ? 180 : 240,
      deliverables: isConflict ? ["项目最终材料"] : ["展示材料", "演示视频"],
      taskType: isConflict ? "课程项目" : "课程材料",
      sourceSummary: `${sourceName}: ${text}`,
      extraction: {
        contextExcerpt: text,
        deliverables: isConflict ? ["项目最终材料"] : ["展示材料", "演示视频"],
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
    question: isConflict ? "两个来源的截止时间冲突，请确认采用哪一个？" : "课程展示材料具体在下周哪一天、几点截止？",
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

function tomorrowAt(reference: Date, hour: number, minute: number): Date {
  return dayAt(reference, 1, hour, minute);
}

function dayAt(reference: Date, dayOffset: number, hour: number, minute: number): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + dayOffset, hour, minute, 0, 0);
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
