import type { DdlItem } from "./types.js";

export type ScheduleSummary = {
  active: number;
  completed: number;
  overdue: number;
  today: number;
  upcoming: number;
};

export function fullScheduleSummary(items: DdlItem[], now = new Date()): ScheduleSummary {
  return summarizeItems(items, now, false);
}

export function visibleScheduleSummary(items: DdlItem[], now = new Date()): ScheduleSummary {
  return summarizeItems(items, now, true);
}

function summarizeItems(items: DdlItem[], now: Date, visibleOnly: boolean): ScheduleSummary {
  const nowTime = now.getTime();
  return items.reduce<ScheduleSummary>((summary, item) => {
    if (item.completed) {
      summary.completed += 1;
      return summary;
    }
    if (visibleOnly && item.snoozedUntil && new Date(item.snoozedUntil).getTime() > nowTime) return summary;
    const due = new Date(item.dueAt);
    const dueTime = due.getTime();
    summary.active += 1;
    if (dueTime < nowTime) summary.overdue += 1;
    if (sameLocalDay(due, now)) summary.today += 1;
    if (dueTime >= nowTime && dueTime <= nowTime + 7 * 86_400_000) summary.upcoming += 1;
    return summary;
  }, { active: 0, completed: 0, overdue: 0, today: 0, upcoming: 0 });
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
