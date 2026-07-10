import type { DdlItem } from "./types.js";

export type ScheduleSummary = {
  active: number;
  completed: number;
  overdue: number;
  today: number;
  upcoming: number;
};

export type ScheduleBucket = "overdue" | "today" | "upcoming" | "later";
export type SnoozePreset = "two-hours" | "tomorrow-morning" | "one-day";

const dayMs = 86_400_000;
const freshItemMs = 10 * 60_000;
const lightweightWindowMs = 7 * dayMs;

export function fullScheduleSummary(items: DdlItem[], now = new Date()): ScheduleSummary {
  return summarizeItems(items, now, false);
}

export function visibleScheduleSummary(items: DdlItem[], now = new Date()): ScheduleSummary {
  return summarizeItems(items, now, true);
}

export function isScheduleItemSnoozed(item: DdlItem, now = new Date()): boolean {
  return !!item.snoozedUntil && new Date(item.snoozedUntil).getTime() > now.getTime();
}

export function snoozeUntil(preset: SnoozePreset, now = new Date()): Date {
  if (preset === "two-hours") return new Date(now.getTime() + 2 * 3_600_000);
  const date = new Date(now);
  if (preset === "one-day") {
    date.setDate(date.getDate() + 1);
    return date;
  }
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

export function shouldRemindItem(item: Pick<DdlItem, "completed" | "dueAt" | "snoozedUntil" | "lastRemindedAt">, now = new Date()): boolean {
  if (item.completed) return false;
  const nowTime = now.getTime();
  const snoozedUntil = item.snoozedUntil ? new Date(item.snoozedUntil).getTime() : Number.NaN;
  const lastRemindedAt = item.lastRemindedAt ? new Date(item.lastRemindedAt).getTime() : Number.NaN;
  if (Number.isFinite(snoozedUntil)) {
    if (snoozedUntil > nowTime) return false;
    if (!Number.isFinite(lastRemindedAt) || snoozedUntil > lastRemindedAt) return true;
  }
  const dueAt = new Date(item.dueAt).getTime();
  if (!Number.isFinite(dueAt) || (dueAt - nowTime) / 3_600_000 > 24) return false;
  if (!Number.isFinite(lastRemindedAt)) return true;
  return nowTime - lastRemindedAt > 6 * 3_600_000;
}

export function visibleActiveScheduleItems(items: DdlItem[], now = new Date()): DdlItem[] {
  return items
    .filter((item) => !item.completed && !isScheduleItemSnoozed(item, now))
    .sort((a, b) => compareScheduleItems(a, b, now));
}

export function lightweightScheduleItems(items: DdlItem[], now = new Date(), limit = 6): DdlItem[] {
  const active = visibleActiveScheduleItems(items, now);
  const nowTime = now.getTime();
  const nearby = active.filter((item) => {
    const dueTime = new Date(item.dueAt).getTime();
    const createdTime = new Date(item.createdAt).getTime();
    const createdAge = nowTime - createdTime;
    const isFresh = Number.isFinite(createdTime) && createdAge >= 0 && createdAge <= freshItemMs;
    return Number.isFinite(dueTime) && (dueTime <= nowTime + lightweightWindowMs || isFresh);
  });
  if (nearby.length) return nearby.slice(0, limit);
  return active.slice(0, Math.min(1, limit));
}

export function scheduleBucket(item: DdlItem, now = new Date()): ScheduleBucket {
  const due = new Date(item.dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  if (sameLocalDay(due, now)) return "today";
  if (due.getTime() <= now.getTime() + lightweightWindowMs) return "upcoming";
  return "later";
}

export function compareScheduleItems(a: DdlItem, b: DdlItem, now = new Date()): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  const snoozedDiff = Number(isScheduleItemSnoozed(a, now)) - Number(isScheduleItemSnoozed(b, now));
  if (snoozedDiff) return snoozedDiff;
  const urgencyDiff = urgencyScore(b, now) - urgencyScore(a, now);
  if (urgencyDiff) return urgencyDiff;
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

function summarizeItems(items: DdlItem[], now: Date, visibleOnly: boolean): ScheduleSummary {
  const nowTime = now.getTime();
  return items.reduce<ScheduleSummary>((summary, item) => {
    if (item.completed) {
      summary.completed += 1;
      return summary;
    }
    if (visibleOnly && isScheduleItemSnoozed(item, now)) return summary;
    const due = new Date(item.dueAt);
    const dueTime = due.getTime();
    summary.active += 1;
    if (dueTime < nowTime) {
      summary.overdue += 1;
    } else if (sameLocalDay(due, now)) {
      summary.today += 1;
    } else if (dueTime <= nowTime + lightweightWindowMs) {
      summary.upcoming += 1;
    }
    return summary;
  }, { active: 0, completed: 0, overdue: 0, today: 0, upcoming: 0 });
}

function urgencyScore(item: DdlItem, now: Date): number {
  const hours = (new Date(item.dueAt).getTime() - now.getTime()) / 3_600_000;
  const timeScore = hours < 0 ? 500 : hours <= 24 ? 400 : hours <= 72 ? 250 : hours <= 168 ? 120 : 0;
  const importanceScore = item.importance === "high" ? 60 : item.importance === "medium" ? 30 : 10;
  return timeScore + importanceScore;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
