import { randomUUID } from "node:crypto";
import type { ChroniStore } from "./store.js";
import type { ChroniSnapshot, DailyTask, DailyTaskCreateInput, IntakeResult, VoiceCommandExecution, VoiceCommandKind, VoiceCommandPreview } from "./shared/types.js";

const PREVIEW_TTL_MS = 5 * 60_000;

type VoiceAssistantOperations = {
  publish(snapshot: ChroniSnapshot): void;
  runPlanning(): Promise<ChroniSnapshot>;
  runIntake(text: string): Promise<IntakeResult>;
  startFocus(minutes: number): void;
  stopFocus(): boolean;
};

type PendingAction = {
  id: string;
  request: string;
  kind: VoiceCommandKind;
  title: string;
  createdAt: number;
  execute(): Promise<{ snapshot: ChroniSnapshot; message: string; spokenText: string }>;
};

type ParsedDateTime = {
  date?: Date;
  hasDate: boolean;
  hasTime: boolean;
  durationMinutes: number;
};

export class VoiceAssistant {
  #pending = new Map<string, PendingAction>();

  constructor(
    readonly getStore: () => ChroniStore,
    readonly operations: VoiceAssistantOperations,
  ) {}

  async preview(rawText: string, now = new Date()): Promise<VoiceCommandPreview> {
    const text = normalizeRequest(rawText);
    if (!text) return errorPreview("没有收到命令", "请说出或输入一句完整指令。");
    if (text.length > 500) return errorPreview("命令太长", "请把指令缩短到 500 个字符以内。");
    const store = this.getStore();
    const snapshot = store.snapshot();
    if (!snapshot.preferences.voiceAssistantEnabled) return errorPreview("语音助手已关闭", "请先在偏好设置中开启语音助手。");

    const navigation = navigationIntent(text);
    if (navigation) {
      const preview: VoiceCommandPreview = {
        kind: "navigate",
        state: "navigation",
        title: `打开${navigation.label}`,
        message: `已为你打开${navigation.label}。`,
        spokenText: `好的，已打开${navigation.label}。`,
        details: [],
        navigateTo: navigation.tab,
      };
      this.#record(text, "navigate", "answered", preview.message);
      return preview;
    }

    if (/(结束|停止|取消|退出).{0,4}(专注|番茄)|(?:专注|番茄).{0,4}(结束|停止|取消)/.test(text)) {
      const stopped = this.operations.stopFocus();
      const message = stopped ? "本次专注已结束。" : "当前没有正在进行的专注。";
      this.#record(text, "stop-focus", "answered", message);
      return {
        kind: "stop-focus",
        state: "answer",
        title: stopped ? "已结束专注" : "没有进行中的专注",
        message,
        spokenText: message,
        details: [],
      };
    }

    if (/(开始|进入|来个|开启).{0,5}(专注|番茄)|(?:专注|番茄).{0,5}(开始|计时)/.test(text)) {
      const minutes = parseDurationMinutes(text, 25);
      return this.#confirmation(text, "start-focus", `开始 ${minutes} 分钟专注`, ["期间继续保留关键截止提醒", "可随时说“结束专注”"], async () => {
        this.operations.startFocus(minutes);
        const next = store.setCompanion("processing", `专注 ${minutes} 分钟，现在只做眼前这一件事。`);
        return { snapshot: next, message: `已开始 ${minutes} 分钟专注。`, spokenText: `专注计时已开始，${minutes} 分钟后我会提醒你。` };
      });
    }

    if (/(重新|帮我|自动|智能).{0,5}(安排|规划|排一下)|(安排|规划).{0,4}(今天|今日|本周)/.test(text)) {
      return this.#confirmation(text, "run-planning", "重新整理今日计划", ["结合截止时间、风险和可用时间", "保留你手动调整过的时间块"], async () => ({
        snapshot: await this.operations.runPlanning(),
        message: "今日计划已重新整理。",
        spokenText: "今日计划已经重新整理，我保留了你手动调整过的安排。",
      }));
    }

    if (/(完成|做完|结束了|搞定)/.test(text)) {
      const target = matchTask(text, snapshot.dailyTasks);
      if (!target) return errorPreview("没有找到对应任务", "请在命令中说出任务名称，例如“完成实验报告初稿”。", "complete-task");
      const occurrence = taskOccurrenceDate(target, parseDateTime(text, now).date ?? now);
      const key = localDateKey(occurrence);
      if (target.completedDates.includes(key)) {
        const message = `${target.title} 已经标记为完成。`;
        this.#record(text, "complete-task", "answered", message);
        return { kind: "complete-task", state: "answer", title: "任务已经完成", message, spokenText: message, details: [] };
      }
      return this.#confirmation(text, "complete-task", `完成“${target.title}”`, [formatDateLabel(occurrence), "会同步更新关联的 Agent 计划步骤"], async () => {
        const next = store.updateDailyTask(target.id, { completedDates: [...target.completedDates, key] });
        return { snapshot: next, message: `${target.title} 已标记完成。`, spokenText: `做得好，${target.title} 已经完成。` };
      });
    }

    if (/(改到|挪到|调整到|推迟到|提前到|重新安排)/.test(text)) {
      const target = matchTask(text, snapshot.dailyTasks);
      const parsed = parseDateTime(text, now);
      if (!target) return errorPreview("没有找到要改期的任务", "请说出完整任务名和新时间。", "reschedule-task");
      if (!parsed.date || !parsed.hasTime) return errorPreview("没有识别到新的时间", "请加入具体时间，例如“改到明天下午三点”。", "reschedule-task");
      const duration = taskDurationMinutes(target);
      const end = new Date(parsed.date.getTime() + duration * 60_000);
      return this.#confirmation(text, "reschedule-task", `调整“${target.title}”`, [`新时间 ${formatDateTime(parsed.date)}`, `时长保持 ${duration} 分钟`], async () => {
        const next = store.updateDailyTask(target.id, { scheduledStartAt: parsed.date!.toISOString(), scheduledEndAt: end.toISOString(), allDay: false });
        return { snapshot: next, message: `${target.title} 已调整到 ${formatDateTime(parsed.date!)}。`, spokenText: `已经把${target.title}调整到${formatSpokenDateTime(parsed.date!)}。` };
      });
    }

    if (isCreateIntent(text)) {
      const parsed = parseDateTime(text, now);
      const title = extractTaskTitle(text) || "新任务";
      const input = dailyTaskInput(title, parsed, snapshot.dailyTasks.length);
      const details = input.scheduledStartAt
        ? [input.allDay ? `${formatDateLabel(new Date(input.scheduledStartAt))} 全天` : `${formatDateTime(new Date(input.scheduledStartAt))} · ${parsed.durationMinutes} 分钟`, "保存到每日任务并参与 Agent 规划"]
        : ["先放入待安排", "稍后可拖到时间轴或交给 Agent 安排"];
      return this.#confirmation(text, "create-task", `添加“${title}”`, details, async () => {
        const next = store.createDailyTask(input);
        return { snapshot: next, message: `${title} 已添加。`, spokenText: `好的，${title}已经添加。` };
      });
    }

    if (/(总结|复盘|回顾).{0,6}(今天|今日|一天)|(今天|今日).{0,6}(总结|复盘|回顾)/.test(text)) {
      const summary = summarizeDay(snapshot, now);
      this.#record(text, "summarize-day", "answered", summary.message);
      return { kind: "summarize-day", state: "answer", title: "今日总结", ...summary };
    }

    if (/(今天|今日|明天|明日|后天).{0,8}(安排|日程|任务|做什么)|(?:安排|日程|任务).{0,8}(今天|今日|明天|明日|后天)|接下来(做什么|有什么)/.test(text)) {
      const targetDate = parseDateTime(text, now).date ?? now;
      const summary = describeSchedule(snapshot, targetDate, now);
      this.#record(text, "get-schedule", "answered", summary.message);
      return { kind: "get-schedule", state: "answer", title: `${formatDateLabel(targetDate)}安排`, ...summary };
    }

    return this.#confirmation(text, "intake", "交给智能整理", [text, "识别任务、截止时间和来源后写入日程"], async () => {
      const result = await this.operations.runIntake(text);
      if (!result.ok) throw new Error(result.reason || "智能整理未完成。");
      return { snapshot: result.snapshot, message: result.message, spokenText: result.message };
    });
  }

  async confirm(id: string): Promise<VoiceCommandExecution> {
    const pending = this.#pending.get(id);
    if (!pending || Date.now() - pending.createdAt > PREVIEW_TTL_MS) {
      if (pending) this.#pending.delete(id);
      throw new Error("这条指令已经过期，请重新说一次。");
    }
    this.#pending.delete(id);
    try {
      const result = await pending.execute();
      let snapshot = this.getStore().recordVoiceInteraction({ request: pending.request, action: pending.kind, status: "confirmed", summary: result.message });
      snapshot = this.getStore().setCompanion("success", result.spokenText);
      this.operations.publish(snapshot);
      return { ok: true, title: pending.title, message: result.message, spokenText: result.spokenText, kind: pending.kind, snapshot };
    } catch (error) {
      const message = error instanceof Error ? error.message : "指令执行失败，请重试。";
      let snapshot = this.getStore().recordVoiceInteraction({ request: pending.request, action: pending.kind, status: "failed", summary: message });
      snapshot = this.getStore().setCompanion("confused", message);
      this.operations.publish(snapshot);
      return { ok: false, title: "没有完成", message, spokenText: message, kind: pending.kind, snapshot };
    }
  }

  cancel(id: string): ChroniSnapshot {
    const pending = this.#pending.get(id);
    this.#pending.delete(id);
    if (!pending) return this.getStore().snapshot();
    const snapshot = this.getStore().recordVoiceInteraction({ request: pending.request, action: pending.kind, status: "cancelled", summary: "用户取消了执行。" });
    this.operations.publish(snapshot);
    return snapshot;
  }

  #confirmation(request: string, kind: VoiceCommandKind, title: string, details: string[], execute: PendingAction["execute"]): VoiceCommandPreview {
    this.#prunePending();
    const id = randomUUID();
    this.#pending.set(id, { id, request, kind, title, createdAt: Date.now(), execute });
    return { id, kind, state: "confirmation", title, message: "确认后执行", spokenText: "请确认这项操作。", details };
  }

  #record(request: string, action: VoiceCommandKind, status: "answered" | "confirmed" | "cancelled" | "failed", summary: string): void {
    const snapshot = this.getStore().recordVoiceInteraction({ request, action, status, summary });
    this.operations.publish(snapshot);
  }

  #prunePending(): void {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [id, pending] of this.#pending) if (pending.createdAt < cutoff) this.#pending.delete(id);
  }
}

function normalizeRequest(value: string): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").replace(/[。！？!?]+$/g, "");
}

function errorPreview(title: string, message: string, kind: VoiceCommandKind = "intake"): VoiceCommandPreview {
  return { kind, state: "error", title, message, spokenText: message, details: [] };
}

function navigationIntent(text: string): { tab: NonNullable<VoiceCommandPreview["navigateTo"]>; label: string } | undefined {
  if (!/(打开|进入|看看|查看|切到|切换)/.test(text)) return undefined;
  if (/(每日回顾|今日回顾|复盘)/.test(text)) return { tab: "review", label: "每日回顾" };
  if (/(学习任务|学习档案)/.test(text)) return { tab: "missions", label: "学习任务" };
  if (/(智能整理|任务来源|整理任务)/.test(text)) return { tab: "schedule", label: "智能整理" };
  if (/(偏好|设置)/.test(text)) return { tab: "preferences", label: "偏好设置" };
  if (/(运行状态|服务状态)/.test(text)) return { tab: "services", label: "运行状态" };
  if (/(今日执行|日历|日程|今天)/.test(text)) return { tab: "daily", label: "今日执行" };
  return undefined;
}

function isCreateIntent(text: string): boolean {
  return /(提醒我|帮我记|添加|新建|创建|安排一个|记下|加入待办)/.test(text);
}

function extractTaskTitle(text: string): string {
  return text
    .replace(/^(请|可以|麻烦|小?Chroni[,， ]*)+/i, "")
    .replace(/提醒我|帮我记(?:一下)?|添加(?:一个|一项)?|新建(?:一个|一项)?|创建(?:一个|一项)?|安排(?:一个|一项)?|记下|加入待办/g, " ")
    .replace(/今天|今日|明天|明日|后天|大后天|下周[一二三四五六日天]|本周[一二三四五六日天]|这周[一二三四五六日天]|周[一二三四五六日天]|星期[一二三四五六日天]/g, " ")
    .replace(/(?:上午|早上|清晨|中午|下午|傍晚|晚上|今晚|凌晨)?\s*(?:[01]?\d|2[0-3])\s*[:：]\s*[0-5]\d/g, " ")
    .replace(/(?:上午|早上|清晨|中午|下午|傍晚|晚上|今晚|凌晨)?\s*[一二三四五六七八九十两\d]{1,3}点(?:半|一刻|三刻|[一二三四五六七八九十两\d]{1,3}分)?/g, " ")
    .replace(/(?:持续|时长|专注)?\s*[一二三四五六七八九十两\d.]+\s*(?:个)?(?:小时|分钟)/g, " ")
    .replace(/(?:^|\s)(?:在|到|于|的|一个|一项|任务|日程)(?=\s|$)/g, " ")
    .replace(/[，,。；;：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function parseDateTime(text: string, now: Date): ParsedDateTime {
  const date = parseDate(text, now);
  const time = parseClock(text);
  const result = date ? new Date(date) : time ? new Date(now) : undefined;
  if (result && time) result.setHours(time.hours, time.minutes, 0, 0);
  if (result && !time) result.setHours(0, 0, 0, 0);
  return { date: result, hasDate: !!date, hasTime: !!time, durationMinutes: parseDurationMinutes(text, 45) };
}

function parseDate(text: string, now: Date): Date | undefined {
  const base = startOfDay(now);
  const relative = text.match(/(大后天|后天|明天|明日|今天|今日)/)?.[1];
  if (relative) {
    const offset = relative === "明天" || relative === "明日" ? 1 : relative === "后天" ? 2 : relative === "大后天" ? 3 : 0;
    base.setDate(base.getDate() + offset);
    return base;
  }
  const iso = text.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/);
  if (iso) return validLocalDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const monthDay = text.match(/(?<!\d)(\d{1,2})月(\d{1,2})日?/);
  if (monthDay) {
    let year = now.getFullYear();
    let value = validLocalDate(year, Number(monthDay[1]), Number(monthDay[2]));
    if (value && value.getTime() < base.getTime() - 86_400_000) value = validLocalDate(++year, Number(monthDay[1]), Number(monthDay[2]));
    return value;
  }
  const weekdayMatch = text.match(/(下周|本周|这周|周|星期)([一二三四五六日天])/);
  if (weekdayMatch) {
    const weekday = "日一二三四五六".indexOf(weekdayMatch[2] === "天" ? "日" : weekdayMatch[2]);
    const current = base.getDay();
    let offset = (weekday - current + 7) % 7;
    if (weekdayMatch[1] === "下周") offset += 7;
    else if ((weekdayMatch[1] === "周" || weekdayMatch[1] === "星期") && offset === 0) offset = 7;
    base.setDate(base.getDate() + offset);
    return base;
  }
  return undefined;
}

function parseClock(text: string): { hours: number; minutes: number } | undefined {
  const digital = text.match(/(?:上午|早上|清晨|中午|下午|傍晚|晚上|今晚|凌晨)?\s*([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)/);
  if (digital) return applyPeriod(Number(digital[1]), Number(digital[2]), digital[0]);
  const chinese = text.match(/(?:上午|早上|清晨|中午|下午|傍晚|晚上|今晚|凌晨)?\s*([一二三四五六七八九十两\d]{1,3})点(半|一刻|三刻|[一二三四五六七八九十两\d]{1,3}分)?/);
  if (!chinese) return undefined;
  const hours = chineseNumber(chinese[1]);
  if (hours === undefined || hours > 23) return undefined;
  const minuteToken = chinese[2] ?? "";
  const minutes = minuteToken === "半" ? 30 : minuteToken === "一刻" ? 15 : minuteToken === "三刻" ? 45 : chineseNumber(minuteToken.replace("分", "")) ?? 0;
  if (minutes > 59) return undefined;
  return applyPeriod(hours, minutes, chinese[0]);
}

function applyPeriod(hours: number, minutes: number, context: string): { hours: number; minutes: number } {
  if (/(下午|傍晚|晚上|今晚)/.test(context) && hours < 12) hours += 12;
  if (/中午/.test(context) && hours < 11) hours += 12;
  if (/凌晨/.test(context) && hours === 12) hours = 0;
  if (/(上午|早上|清晨)/.test(context) && hours === 12) hours = 0;
  return { hours, minutes };
}

function parseDurationMinutes(text: string, fallback: number): number {
  const hours = text.match(/([一二三四五六七八九十两\d.]+)\s*(?:个)?小时/);
  if (hours) {
    const value = chineseNumber(hours[1]);
    if (value !== undefined) return Math.max(5, Math.min(240, Math.round(value * 60)));
  }
  const minutes = text.match(/([一二三四五六七八九十两\d]+)\s*分钟/);
  if (minutes) {
    const value = chineseNumber(minutes[1]);
    if (value !== undefined) return Math.max(5, Math.min(240, Math.round(value)));
  }
  return fallback;
}

function chineseNumber(value: string): number | undefined {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [left, right] = value.split("十");
    return (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0);
  }
  if ([...value].every((char) => char in digits)) return Number([...value].map((char) => digits[char]).join(""));
  return undefined;
}

function dailyTaskInput(title: string, parsed: ParsedDateTime, existingCount: number): DailyTaskCreateInput {
  const colors: NonNullable<DailyTaskCreateInput["color"]>[] = ["teal", "coral", "blue", "gold", "plum"];
  if (!parsed.date) return { title, color: colors[existingCount % colors.length] };
  if (!parsed.hasTime) {
    const end = new Date(parsed.date);
    end.setHours(23, 59, 0, 0);
    return { title, color: colors[existingCount % colors.length], allDay: true, scheduledStartAt: parsed.date.toISOString(), scheduledEndAt: end.toISOString() };
  }
  const end = new Date(parsed.date.getTime() + parsed.durationMinutes * 60_000);
  return { title, color: colors[existingCount % colors.length], scheduledStartAt: parsed.date.toISOString(), scheduledEndAt: end.toISOString() };
}

function matchTask(text: string, tasks: DailyTask[]): DailyTask | undefined {
  const normalized = comparable(text);
  return tasks
    .filter((task) => !task.dismissed && normalized.includes(comparable(task.title)))
    .sort((a, b) => b.title.length - a.title.length)[0];
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[\s，,。.!！?？、：:;；“”"']/g, "");
}

function taskOccurrenceDate(task: DailyTask, fallback: Date): Date {
  if (!task.scheduledStartAt) return startOfDay(fallback);
  if (task.recurrence === "none") return new Date(task.scheduledStartAt);
  const occurrence = new Date(fallback);
  const start = new Date(task.scheduledStartAt);
  occurrence.setHours(start.getHours(), start.getMinutes(), 0, 0);
  return occurrence;
}

function taskDurationMinutes(task: DailyTask): number {
  if (!task.scheduledStartAt || !task.scheduledEndAt) return 45;
  return Math.max(15, Math.round((new Date(task.scheduledEndAt).getTime() - new Date(task.scheduledStartAt).getTime()) / 60_000));
}

function describeSchedule(snapshot: ChroniSnapshot, date: Date, now: Date): Pick<VoiceCommandPreview, "message" | "spokenText" | "details"> {
  const tasks = tasksForDate(snapshot.dailyTasks, date).sort((a, b) => (a.scheduledStartAt ?? "").localeCompare(b.scheduledStartAt ?? ""));
  const due = snapshot.items.filter((item) => !item.completed && localDateKey(new Date(item.dueAt)) === localDateKey(date));
  if (!tasks.length && !due.length) {
    const message = `${formatDateLabel(date)}暂时没有已安排事项。`;
    return { message, spokenText: message, details: ["可以说“安排一个任务”快速添加"] };
  }
  const unfinished = tasks.filter((task) => !task.completedDates.includes(localDateKey(date)));
  const next = unfinished.find((task) => !task.scheduledEndAt || new Date(task.scheduledEndAt).getTime() >= now.getTime()) ?? unfinished[0];
  const message = `${formatDateLabel(date)}有 ${tasks.length} 项安排${due.length ? `，另有 ${due.length} 项截止` : ""}，${unfinished.length} 项尚未完成。`;
  const spokenText = next ? `${message}接下来是${next.title}${next.scheduledStartAt ? `，${formatSpokenTime(new Date(next.scheduledStartAt))}开始` : ""}。` : `${message}今天的安排已经完成。`;
  const details = tasks.slice(0, 4).map((task) => `${task.scheduledStartAt ? formatClock(new Date(task.scheduledStartAt)) : "待安排"}  ${task.title}`);
  if (tasks.length > 4) details.push(`还有 ${tasks.length - 4} 项`);
  return { message, spokenText, details };
}

function summarizeDay(snapshot: ChroniSnapshot, now: Date): Pick<VoiceCommandPreview, "message" | "spokenText" | "details"> {
  const tasks = tasksForDate(snapshot.dailyTasks, now);
  const key = localDateKey(now);
  const completed = tasks.filter((task) => task.completedDates.includes(key));
  const unfinished = tasks.filter((task) => !task.completedDates.includes(key));
  const plannedMinutes = tasks.reduce((total, task) => total + taskDurationMinutes(task), 0);
  if (!tasks.length) {
    const message = "今天还没有形成日程记录。";
    return { message, spokenText: `${message}你可以先添加一项安排。`, details: [] };
  }
  const percent = Math.round(completed.length / tasks.length * 100);
  const message = `今天完成 ${completed.length}/${tasks.length} 项，完成率 ${percent}%，共规划 ${formatMinutes(plannedMinutes)}。`;
  const spokenText = unfinished.length
    ? `${message}尚未完成的重点是${unfinished.slice(0, 2).map((task) => task.title).join("和")}。`
    : `${message}今天的计划已经全部完成。`;
  const details = [
    completed.length ? `已完成：${completed.slice(0, 3).map((task) => task.title).join("、")}` : "还没有标记完成的事项",
    unfinished.length ? `待继续：${unfinished.slice(0, 3).map((task) => task.title).join("、")}` : "没有遗留事项",
  ];
  return { message, spokenText, details };
}

function tasksForDate(tasks: DailyTask[], date: Date): DailyTask[] {
  return tasks.filter((task) => !task.dismissed && taskOccursOn(task, date));
}

function taskOccursOn(task: DailyTask, date: Date): boolean {
  if (!task.scheduledStartAt) return false;
  const start = new Date(task.scheduledStartAt);
  const startKey = localDateKey(start);
  const targetKey = localDateKey(date);
  if (targetKey < startKey) return false;
  if (task.recurrenceEndsAt && targetKey > localDateKey(new Date(task.recurrenceEndsAt))) return false;
  if (task.recurrence === "none") return targetKey === startKey;
  if (task.recurrence === "daily") return true;
  if (task.recurrence === "weekdays") return date.getDay() >= 1 && date.getDay() <= 5;
  const elapsedDays = Math.round((startOfDay(date).getTime() - startOfDay(start).getTime()) / 86_400_000);
  return elapsedDays % 7 === 0;
}

function validLocalDate(year: number, month: number, day: number): Date | undefined {
  const value = new Date(year, month - 1, day);
  return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day ? startOfDay(value) : undefined;
}

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: Date): string {
  const today = startOfDay(new Date());
  const offset = Math.round((startOfDay(value).getTime() - today.getTime()) / 86_400_000);
  if (offset === 0) return "今天";
  if (offset === 1) return "明天";
  if (offset === 2) return "后天";
  return `${value.getMonth() + 1}月${value.getDate()}日`;
}

function formatDateTime(value: Date): string {
  return `${formatDateLabel(value)} ${formatClock(value)}`;
}

function formatSpokenDateTime(value: Date): string {
  return `${formatDateLabel(value)}${formatSpokenTime(value)}`;
}

function formatClock(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function formatSpokenTime(value: Date): string {
  const minute = value.getMinutes();
  return `${value.getHours()}点${minute ? `${minute}分` : ""}`;
}

function formatMinutes(value: number): string {
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours} 小时${minutes ? ` ${minutes} 分钟` : ""}`;
}
