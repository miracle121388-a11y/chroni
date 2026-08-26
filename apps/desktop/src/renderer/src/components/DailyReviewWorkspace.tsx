import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ChroniSnapshot, DailyReview, DailyReviewInput, DailyTask } from "../../../shared/types";
import { UiIcon } from "./UiIcon";

type DailyReviewWorkspaceProps = {
  snapshot: ChroniSnapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<ChroniSnapshot | null>>;
  initialDate: string;
  onOpenPlanner(date: string): void;
};

const api = window.chroni;

export function DailyReviewWorkspace({ snapshot, setSnapshot, initialDate, onOpenPlanner }: DailyReviewWorkspaceProps) {
  const [selectedDate, setSelectedDate] = useState(() => fromDateKey(initialDate));
  const [draft, setDraft] = useState<DailyReviewInput>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "warn"; message: string }>();
  const unsavedDrafts = useRef(new Map<string, Pick<DailyReviewInput, "summary" | "note">>());
  const selectedKey = dateKey(selectedDate);
  const todayKey = dateKey(new Date());
  const relation = compareDateKeys(selectedKey, todayKey);
  const tasks = useMemo(() => tasksForDate(snapshot.dailyTasks, selectedDate), [selectedDate, snapshot.dailyTasks]);
  const existing = useMemo(() => snapshot.dailyReviews.find((review) => review.date === selectedKey), [selectedKey, snapshot.dailyReviews]);
  const generated = useMemo(() => buildDailyReviewDraft(selectedDate, tasks), [selectedDate, tasks]);
  const history = useMemo(() => [...snapshot.dailyReviews].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 8), [snapshot.dailyReviews]);
  const monthDays = useMemo(() => calendarDays(selectedDate), [selectedDate]);
  const monthReviews = useMemo(() => snapshot.dailyReviews.filter((review) => sameMonth(fromDateKey(review.date), selectedDate)), [selectedDate, snapshot.dailyReviews]);
  const completedTasks = tasks.filter((task) => task.completedDates.includes(selectedKey));
  const unfinishedTasks = tasks.filter((task) => !task.completedDates.includes(selectedKey));
  const currentDraft = draft ?? generated;
  const completionPercent = currentDraft.totalTasks ? Math.round(currentDraft.completedTasks / currentDraft.totalTasks * 100) : 0;
  const savedSummary = existing?.summary ?? generated.summary;
  const savedNote = existing?.note ?? "";
  const savedMetricsChanged = !!existing && (
    existing.totalTasks !== generated.totalTasks
    || existing.completedTasks !== generated.completedTasks
    || existing.plannedMinutes !== generated.plannedMinutes
    || existing.completedMinutes !== generated.completedMinutes
    || [...existing.unfinishedTaskTitles].sort((left, right) => left.localeCompare(right, "zh-CN")).join("\0")
      !== [...generated.unfinishedTaskTitles].sort((left, right) => left.localeCompare(right, "zh-CN")).join("\0")
  );
  const dirty = currentDraft.summary !== savedSummary || currentDraft.note !== savedNote
    || savedMetricsChanged;

  useEffect(() => {
    setSelectedDate(fromDateKey(initialDate));
  }, [initialDate]);

  useEffect(() => {
    const cached = unsavedDrafts.current.get(selectedKey);
    setDraft({
      ...generated,
      summary: cached?.summary ?? existing?.summary ?? generated.summary,
      note: cached?.note ?? existing?.note ?? "",
    });
    setFeedback(undefined);
  }, [existing?.updatedAt, generated, selectedKey]);

  function updateWriting(patch: Partial<Pick<DailyReviewInput, "summary" | "note">>): void {
    setDraft((current) => {
      const next = { ...(current ?? generated), ...patch };
      unsavedDrafts.current.set(selectedKey, { summary: next.summary, note: next.note });
      return next;
    });
  }

  function chooseDate(date: Date): void {
    setSelectedDate(startOfDay(date));
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !currentDraft.summary.trim()) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const input: DailyReviewInput = {
        ...generated,
        summary: currentDraft.summary.trim(),
        note: currentDraft.note.trim(),
      };
      setSnapshot(await api.saveDailyReview(input));
      unsavedDrafts.current.delete(selectedKey);
      setDraft(input);
      setFeedback({ tone: "ok", message: `${formatLongDate(selectedDate)}的回顾已保存。` });
    } catch (error) {
      setFeedback({ tone: "warn", message: operationMessage(error, "回顾暂时未能保存，请稍后重试。") });
    } finally {
      setBusy(false);
    }
  }

  function regenerate(): void {
    const next = { ...generated, note: currentDraft.note };
    unsavedDrafts.current.set(selectedKey, { summary: next.summary, note: next.note });
    setDraft(next);
    setFeedback({ tone: "ok", message: "已按当前活动状态重新整理。" });
  }

  const monthCompleted = monthReviews.reduce((sum, review) => sum + review.completedTasks, 0);
  const monthMinutes = monthReviews.reduce((sum, review) => sum + review.completedMinutes, 0);

  return (
    <div className="daily-review-workspace" aria-busy={busy}>
      <header className="review-workspace-head">
        <div>
          <p className="review-kicker">每日回顾</p>
          <h2>{relation === 0 ? "收好今天，再轻松开始明天" : formatLongDate(selectedDate)}</h2>
          <p>{relation > 0 ? "提前查看计划，写下这一天想完成的重点。" : "活动、完成情况和补充记录都保存在对应日期，随时可以回来查看。"}</p>
        </div>
        <div className="review-date-actions" aria-label="回顾日期导航">
          <button className="review-today-button" type="button" onClick={() => chooseDate(new Date())}>今天</button>
          <button className="review-icon-button" type="button" title="前一天" aria-label="前一天" onClick={() => chooseDate(addDays(selectedDate, -1))}><UiIcon name="arrow-left" /></button>
          <button className="review-icon-button" type="button" title="后一天" aria-label="后一天" onClick={() => chooseDate(addDays(selectedDate, 1))}><UiIcon name="arrow-right" /></button>
          <button className="review-planner-button" type="button" onClick={() => onOpenPlanner(selectedKey)}><UiIcon name="calendar" />查看日程</button>
        </div>
      </header>

      <div className="review-workspace-body">
        <aside className="review-history-panel">
          <section className="review-month">
            <header><div><span>回顾日历</span><b>{formatMonth(selectedDate)}</b></div><div><button type="button" title="上个月" aria-label="上个月" onClick={() => chooseDate(addMonths(selectedDate, -1))}><UiIcon name="arrow-left" /></button><button type="button" title="下个月" aria-label="下个月" onClick={() => chooseDate(addMonths(selectedDate, 1))}><UiIcon name="arrow-right" /></button></div></header>
            <div className="review-month-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((label) => <span key={label}>{label}</span>)}</div>
            <div className="review-month-days">
              {monthDays.map((day) => {
                const key = dateKey(day);
                const review = snapshot.dailyReviews.find((candidate) => candidate.date === key);
                const taskCount = tasksForDate(snapshot.dailyTasks, day).length;
                const className = [!sameMonth(day, selectedDate) ? "outside" : "", key === selectedKey ? "selected" : "", key === todayKey ? "today" : "", review ? "reviewed" : taskCount ? "planned" : ""].filter(Boolean).join(" ");
                return <button key={key} className={className} type="button" aria-label={`${formatLongDate(day)}${review ? "，已保存回顾" : taskCount ? `，${taskCount} 项安排` : ""}`} aria-pressed={key === selectedKey} onClick={() => chooseDate(day)}><span>{day.getDate()}</span>{(review || taskCount > 0) && <i aria-hidden="true" />}</button>;
              })}
            </div>
          </section>

          <section className="review-month-stats" aria-label="本月回顾概览">
            <div><b>{monthReviews.length}</b><span>回顾天数</span></div>
            <div><b>{monthCompleted}</b><span>完成事项</span></div>
            <div><b>{formatDuration(monthMinutes)}</b><span>完成时长</span></div>
          </section>

          <section className="review-history-list">
            <header><h3>最近回顾</h3><span>{snapshot.dailyReviews.length ? `${snapshot.dailyReviews.length} 天已记录` : "尚未记录"}</span></header>
            {history.map((review) => <HistoryButton key={review.date} review={review} active={review.date === selectedKey} onSelect={() => chooseDate(fromDateKey(review.date))} />)}
            {!history.length && <div className="review-history-empty"><UiIcon name="review" /><b>第一篇回顾从今天开始</b><p>系统已经整理好活动，你只需要补充真正想留下的内容。</p></div>}
          </section>
        </aside>

        <main className="review-day-panel">
          <section className="review-day-overview">
            <div className="review-day-title"><div><span>{relation === 0 ? "今天" : relation < 0 ? "历史回顾" : "未来计划"}</span><h3>{formatLongDate(selectedDate)}</h3></div><em className={dirty ? "draft" : existing ? "saved" : "generated"}>{dirty ? "有变化 · 待保存" : existing ? `已保存 · ${formatClock(new Date(existing.updatedAt))}` : "等待保存"}</em></div>
            <p>{reviewHeadline(tasks.length, completedTasks.length, currentDraft.plannedMinutes, unfinishedTasks.length, relation)}</p>
            <div className="review-progress-track" aria-label={`完成率 ${completionPercent}%`}><i style={{ width: `${completionPercent}%` }} /></div>
            <div className="review-metrics" aria-label="当天完成情况">
              <div><b>{completionPercent}%</b><span>完成率</span></div>
              <div><b>{currentDraft.completedTasks}/{currentDraft.totalTasks}</b><span>完成事项</span></div>
              <div><b>{formatDuration(currentDraft.completedMinutes)}</b><span>完成时长</span></div>
              <div><b>{formatDuration(currentDraft.plannedMinutes)}</b><span>规划时长</span></div>
            </div>
          </section>

          <div className="review-main-grid">
            <section className="review-activity-panel">
              <header><div><p>活动轨迹</p><h3>这一天安排了什么</h3></div><span>{completedTasks.length} 完成 · {unfinishedTasks.length} 待延续</span></header>
              <div className="review-activity-list">
                {tasks.map((task) => <ActivityRow key={task.id} task={task} dateKey={selectedKey} />)}
                {!tasks.length && <div className="review-activity-empty"><span><UiIcon name="calendar" /></span><h4>这一天没有固定日程</h4><p>休息、临时活动或没有写入日历的收获，也可以记录在右侧。</p><button type="button" onClick={() => onOpenPlanner(selectedKey)}>添加日程</button></div>}
              </div>
            </section>

            <section className="review-writing-panel">
              <header><div><p>整理与反思</p><h3>{relation > 0 ? "为这一天写下重点" : "把值得记住的内容留下"}</h3></div>{dirty && <span>有修改</span>}</header>
              <form id="daily-review-workspace-form" onSubmit={(event) => void save(event)}>
                <label><span>活动总结</span><textarea value={currentDraft.summary} maxLength={2_000} onChange={(event) => updateWriting({ summary: event.target.value })} /></label>
                <label><span>补充记录 <small>可选</small></span><textarea value={currentDraft.note} maxLength={4_000} placeholder="今天的收获、临时变化、精力状态或明天需要记住的事情" onChange={(event) => updateWriting({ note: event.target.value })} /></label>
                {!!currentDraft.unfinishedTaskTitles.length && <div className="review-carry"><span>待延续到后续计划</span><div>{currentDraft.unfinishedTaskTitles.map((title) => <p key={title}>{title}</p>)}</div></div>}
                {feedback && <p className={`review-feedback ${feedback.tone}`} role={feedback.tone === "warn" ? "alert" : "status"}>{feedback.message}</p>}
              </form>
              <footer><button className="review-regenerate-button" type="button" disabled={busy} onClick={regenerate}><UiIcon name="spark" />按当前状态整理</button><button className="review-save-button" form="daily-review-workspace-form" type="submit" disabled={busy || !currentDraft.summary.trim() || (!!existing && !dirty)}>{busy ? "保存中" : existing && !dirty ? "已保存" : "保存回顾"}</button></footer>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function HistoryButton({ review, active, onSelect }: { review: DailyReview; active: boolean; onSelect(): void }) {
  const percent = review.totalTasks ? Math.round(review.completedTasks / review.totalTasks * 100) : 0;
  const date = fromDateKey(review.date);
  return <button className={active ? "active" : ""} type="button" onClick={onSelect}><time>{formatHistoryDate(date)}</time><span><b>{review.completedTasks}/{review.totalTasks} 项完成</b><small>{formatDuration(review.completedMinutes)} · 完成率 {percent}%</small></span><UiIcon name="arrow-right" /></button>;
}

function ActivityRow({ task, dateKey: selectedKey }: { task: DailyTask; dateKey: string }) {
  const completed = task.completedDates.includes(selectedKey);
  return (
    <article className={`review-activity-row color-${task.color} ${completed ? "completed" : "unfinished"}`}>
      <time>{task.allDay ? "全天" : taskTime(task)}</time>
      <span className="review-activity-state" aria-hidden="true">{completed ? <UiIcon name="check" /> : <i />}</span>
      <div><h4>{task.title}</h4><p>{task.notes || (task.origin === "agent" ? "由智能规划安排" : "手动安排")}</p></div>
      <em>{completed ? "已完成" : "待延续"}</em>
    </article>
  );
}

export function buildDailyReviewDraft(date: Date, tasks: DailyTask[]): DailyReviewInput {
  const key = dateKey(date);
  const completed = tasks.filter((task) => task.completedDates.includes(key));
  const unfinished = tasks.filter((task) => !task.completedDates.includes(key));
  const plannedMinutes = tasks.reduce((sum, task) => sum + (task.allDay ? 0 : taskDuration(task)), 0);
  const completedMinutes = completed.reduce((sum, task) => sum + (task.allDay ? 0 : taskDuration(task)), 0);
  const completedNames = completed.slice(0, 3).map((task) => `“${task.title}”`).join("、");
  const unfinishedNames = unfinished.slice(0, 3).map((task) => `“${task.title}”`).join("、");
  let summary: string;
  if (!tasks.length) summary = `${formatLongDate(date)}没有安排固定日程。可以记录当天的临时事项、休息或收获。`;
  else if (!unfinished.length) summary = `${formatLongDate(date)}共安排 ${tasks.length} 项，已全部完成${completedMinutes ? `，完成约 ${formatDuration(completedMinutes)}` : ""}。${completedNames ? `完成内容包括${completedNames}。` : ""}`;
  else if (completed.length) summary = `${formatLongDate(date)}完成 ${completed.length}/${tasks.length} 项${completedMinutes ? `，投入约 ${formatDuration(completedMinutes)}` : ""}。${completedNames ? `已完成${completedNames}；` : ""}${unfinishedNames ? `${unfinishedNames}需要继续安排。` : "其余事项需要继续安排。"}`;
  else summary = `${formatLongDate(date)}原计划 ${tasks.length} 项${plannedMinutes ? `、约 ${formatDuration(plannedMinutes)}` : ""}，当前尚未标记完成。${unfinishedNames ? `建议优先处理${unfinishedNames}。` : ""}`;
  return { date: key, summary, note: "", totalTasks: tasks.length, completedTasks: completed.length, plannedMinutes, completedMinutes, unfinishedTaskTitles: unfinished.map((task) => task.title) };
}

function tasksForDate(tasks: DailyTask[], date: Date): DailyTask[] {
  const targetKey = dateKey(date);
  const todayKey = dateKey(new Date());
  return tasks.filter((task) => occursOn(task, date) && (!task.dismissed || targetKey < todayKey)).sort(compareDailyTasks);
}

function occursOn(task: DailyTask, date: Date): boolean {
  if (!task.scheduledStartAt) return false;
  const base = startOfDay(new Date(task.scheduledStartAt));
  const target = startOfDay(date);
  if (target < base) return false;
  if (task.recurrenceEndsAt && target > startOfDay(new Date(task.recurrenceEndsAt))) return false;
  if (task.recurrence === "daily") return true;
  if (task.recurrence === "weekdays") return target.getDay() !== 0 && target.getDay() !== 6;
  if (task.recurrence === "weekly") return target.getDay() === base.getDay();
  return dateKey(base) === dateKey(target);
}

function compareDailyTasks(left: DailyTask, right: DailyTask): number {
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
  return taskClockMinutes(left) - taskClockMinutes(right) || left.title.localeCompare(right.title, "zh-CN");
}

function taskClockMinutes(task: DailyTask): number {
  if (!task.scheduledStartAt) return Number.MAX_SAFE_INTEGER;
  const date = new Date(task.scheduledStartAt);
  return date.getHours() * 60 + date.getMinutes();
}

function taskDuration(task: DailyTask): number {
  if (!task.scheduledStartAt || !task.scheduledEndAt) return 30;
  return Math.max(15, Math.round((new Date(task.scheduledEndAt).getTime() - new Date(task.scheduledStartAt).getTime()) / 60_000));
}

function taskTime(task: DailyTask): string {
  if (!task.scheduledStartAt) return "待安排";
  const start = formatClock(new Date(task.scheduledStartAt));
  return task.scheduledEndAt ? `${start}–${formatClock(new Date(task.scheduledEndAt))}` : start;
}

function reviewHeadline(total: number, completed: number, plannedMinutes: number, unfinished: number, relation: number): string {
  if (relation > 0) return total ? `已经为这一天安排 ${total} 项活动，预计需要 ${formatDuration(plannedMinutes)}；可以先写下最重要的目标。` : "这一天还没有固定安排，可以先写下想完成的重点。";
  if (!total) return "没有固定日程并不等于没有收获，临时活动和休息也值得记录。";
  if (completed === total) return `计划中的 ${total} 项活动已经全部完成，今天可以安心收尾。`;
  if (completed) return `已经完成 ${completed} 项，${unfinished} 项尚待延续；先记录实际发生的事情，再决定明天做什么。`;
  return `当天安排了 ${total} 项活动，目前还没有标记完成；可以补充实际变化并保留真实记录。`;
}

function calendarDays(date: Date): Date[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const weekday = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => addDays(first, index - weekday));
}

function dateKey(value: Date): string { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
function fromDateKey(value: string): Date { const [year, month, day] = value.split("-").map(Number); return startOfDay(new Date(year, month - 1, day)); }
function compareDateKeys(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function startOfDay(value: Date): Date { return new Date(value.getFullYear(), value.getMonth(), value.getDate()); }
function addDays(value: Date, amount: number): Date { return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount); }
function addMonths(value: Date, amount: number): Date { return new Date(value.getFullYear(), value.getMonth() + amount, Math.min(value.getDate(), 28)); }
function sameMonth(left: Date, right: Date): boolean { return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth(); }
function formatMonth(value: Date): string { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(value); }
function formatLongDate(value: Date): string { return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(value); }
function formatHistoryDate(value: Date): string { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).format(value); }
function formatClock(value: Date): string { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value); }
function formatDuration(minutes: number): string { if (minutes <= 0) return "0 分钟"; if (minutes < 60) return `${minutes} 分钟`; const hours = Math.floor(minutes / 60); const rest = minutes % 60; return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`; }
function operationMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
