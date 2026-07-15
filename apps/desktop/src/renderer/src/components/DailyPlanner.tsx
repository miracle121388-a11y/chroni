import React, { useEffect, useMemo, useRef, useState } from "react";
import { layoutTimelineIntervals } from "../../../shared/daily-layout";
import type { ChroniSnapshot, DailyTask, DailyTaskColor, DailyTaskPatch, DailyTaskRecurrence, DailyTaskSubtask } from "../../../shared/types";

type DailyPlannerProps = {
  snapshot: ChroniSnapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<ChroniSnapshot | null>>;
};

type PlannerMode = "day" | "multi" | "week" | "month";
type TaskDraft = {
  title: string;
  notes: string;
  color: DailyTaskColor;
  scheduled: boolean;
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  recurrence: DailyTaskRecurrence;
  recurrenceEndsAt: string;
  subtasks: DailyTaskSubtask[];
};

const api = window.chroni;
const dayStartMinutes = 0;
const dayEndMinutes = 24 * 60;
const timelineBaseHeight = 1584;
const timelineLaneGap = 8;
const timelineZoomLevels = [1, 1.25, 1.5, 2] as const;
const timelineZoomStorageKey = "chroni.daily.timelineZoom";
const timelinePalette: DailyTaskColor[] = ["coral", "teal", "blue", "gold", "plum"];
const colors: Array<{ value: DailyTaskColor; label: string }> = [
  { value: "teal", label: "青绿" },
  { value: "coral", label: "珊瑚" },
  { value: "gold", label: "金色" },
  { value: "blue", label: "蓝色" },
  { value: "plum", label: "梅紫" },
];

type PlannerIconName = "add" | "check" | "chevron-left" | "chevron-right" | "circle" | "close" | "inbox" | "minus" | "spark";

function PlannerIcon({ name }: { name: PlannerIconName }) {
  return (
    <svg className="planner-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {name === "add" && <path d="M8 3v10M3 8h10" />}
      {name === "minus" && <path d="M3 8h10" />}
      {name === "close" && <path d="m4 4 8 8m0-8-8 8" />}
      {name === "chevron-left" && <path d="m10.5 3.5-4.5 4.5 4.5 4.5" />}
      {name === "chevron-right" && <path d="m5.5 3.5 4.5 4.5-4.5 4.5" />}
      {name === "check" && <path d="m3.5 8.2 2.8 2.8 6.2-6.2" />}
      {name === "circle" && <circle cx="8" cy="8" r="5" />}
      {name === "inbox" && <rect x="3" y="3" width="10" height="10" rx="1.8" />}
      {name === "spark" && <path className="planner-icon-fill" d="M8 1.8c.45 3.55 2.15 5.25 5.7 5.7C10.15 7.95 8.45 9.65 8 13.2 7.55 9.65 5.85 7.95 2.3 7.5 5.85 7.05 7.55 5.35 8 1.8Z" />}
    </svg>
  );
}

export function DailyPlanner({ snapshot, setSnapshot }: DailyPlannerProps) {
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [mode, setMode] = useState<PlannerMode>("day");
  const [inboxText, setInboxText] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [selectedOccurrenceDate, setSelectedOccurrenceDate] = useState(() => startOfDay(new Date()));
  const [newTaskDraft, setNewTaskDraft] = useState<DailyTask>();
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [timelineZoom, setTimelineZoom] = useState<number>(readTimelineZoom);
  const timelineRef = useRef<HTMLDivElement>(null);
  const operationLockRef = useRef(false);
  const activeTasks = useMemo(() => snapshot.dailyTasks.filter((task) => !task.dismissed), [snapshot.dailyTasks]);
  const inbox = activeTasks.filter((task) => !task.scheduledStartAt);
  const selectedTask = newTaskDraft ?? activeTasks.find((task) => task.id === selectedTaskId);
  const selectedKey = dateKey(selectedDate);
  const weekDays = useMemo(() => daysFrom(startOfWeek(selectedDate), 7), [selectedDate]);
  const selectedDayTasks = tasksForDate(snapshot.dailyTasks, selectedDate);
  const completedCount = selectedDayTasks.filter((task) => task.completedDates.includes(selectedKey)).length;
  const plannedMinutes = selectedDayTasks.reduce((sum, task) => sum + (task.allDay ? 0 : taskDuration(task)), 0);
  const completionPercent = selectedDayTasks.length ? Math.round(completedCount / selectedDayTasks.length * 100) : 0;
  const selectedDayRelation = compareDateKeys(selectedKey, dateKey(new Date()));

  useEffect(() => {
    if (selectedTaskId && !selectedTask && !newTaskDraft) setSelectedTaskId(undefined);
  }, [newTaskDraft, selectedTask, selectedTaskId]);

  useEffect(() => {
    window.localStorage.setItem(timelineZoomStorageKey, String(timelineZoom));
  }, [timelineZoom]);

  function openTask(taskId: string, occurrenceDate: Date): void {
    setNewTaskDraft(undefined);
    setSelectedTaskId(taskId);
    setSelectedOccurrenceDate(startOfDay(occurrenceDate));
  }

  function closeEditor(): void {
    setSelectedTaskId(undefined);
    setNewTaskDraft(undefined);
  }

  async function runExclusive(name: string, operation: () => Promise<void>): Promise<void> {
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setBusy(name);
    try {
      await operation();
    } finally {
      operationLockRef.current = false;
      setBusy("");
    }
  }

  async function createInbox(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const title = inboxText.trim();
    if (!title || operationLockRef.current) return;
    await runExclusive("inbox", async () => {
      try {
        setSnapshot(await api.createDailyTask({ title }));
        setInboxText("");
        setFeedback("已放入待安排，拖到时间轴即可排期。");
      } catch (error) {
        setFeedback(operationMessage(error, "未能添加任务。"));
      }
    });
  }

  function createScheduled(): void {
    if (operationLockRef.current) return;
    const start = defaultTaskStart(selectedDate);
    const end = new Date(start.getTime() + 45 * 60_000);
    const now = new Date().toISOString();
    setSelectedTaskId(undefined);
    setSelectedOccurrenceDate(startOfDay(selectedDate));
    setNewTaskDraft({
      id: `draft-${Date.now()}`,
      title: "",
      notes: "",
      color: "teal",
      allDay: false,
      scheduledStartAt: start.toISOString(),
      scheduledEndAt: end.toISOString(),
      recurrence: "none",
      subtasks: [],
      completedDates: [],
      origin: "manual",
      userAdjusted: false,
      dismissed: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function toggleComplete(task: DailyTask, occurrenceDate: Date): Promise<void> {
    if (operationLockRef.current) return;
    const key = dateKey(occurrenceDate);
    const completedDates = task.completedDates.includes(key)
      ? task.completedDates.filter((date) => date !== key)
      : [...task.completedDates, key];
    await runExclusive(`complete:${task.id}`, async () => {
      try {
        setSnapshot(await api.updateDailyTask(task.id, { completedDates }));
      } catch (error) {
        setFeedback(operationMessage(error, "未能更新完成状态。"));
      }
    });
  }

  async function scheduleTask(taskId: string, targetDate: Date, startMinutes: number): Promise<void> {
    const task = activeTasks.find((candidate) => candidate.id === taskId);
    if (!task || operationLockRef.current) return;
    if (task.recurrence !== "none" && !window.confirm("拖动会重新安排整个重复任务系列，是否继续？")) return;
    const normalizedStartMinutes = Math.max(dayStartMinutes, Math.min(dayEndMinutes - 30, startMinutes));
    const duration = Math.min(Math.max(15, taskDuration(task)), dayEndMinutes - 1 - normalizedStartMinutes);
    const start = atMinutes(targetDate, normalizedStartMinutes);
    const end = atMinutes(targetDate, normalizedStartMinutes + duration);
    await runExclusive(`schedule:${task.id}`, async () => {
      try {
        setSnapshot(await api.updateDailyTask(task.id, { scheduledStartAt: start.toISOString(), scheduledEndAt: end.toISOString(), allDay: false }));
        setFeedback(`已安排到 ${formatClock(start)}。`);
      } catch (error) {
        setFeedback(operationMessage(error, "未能调整任务时间。"));
      }
    });
  }

  async function runAgent(): Promise<void> {
    if (operationLockRef.current) return;
    await runExclusive("agent", async () => {
      setFeedback("Agent 正在结合任务规划安排今天...");
      try {
        setSnapshot(await api.runDeadlineAgent());
        setFeedback("今日规划已刷新，用户手动调整过的任务保持不变。");
      } catch (error) {
        setFeedback(operationMessage(error, "Agent 今日规划未完成。"));
      }
    });
  }

  function dropOnTimeline(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("application/x-chroni-daily-task");
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!taskId || !rect) return;
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const minutes = Math.round((dayStartMinutes + ratio * (dayEndMinutes - dayStartMinutes)) / 15) * 15;
    void scheduleTask(taskId, selectedDate, minutes);
  }

  return (
    <div className="daily-planner" aria-busy={!!busy}>
      <header className="daily-toolbar">
        <div className="daily-date-nav">
          <button className="daily-today-button" type="button" onClick={() => setSelectedDate(startOfDay(new Date()))}>今天</button>
          <button className="daily-icon-button" type="button" title="上一段日期" aria-label="上一段日期" onClick={() => setSelectedDate(navigateDate(selectedDate, mode, -1))}><PlannerIcon name="chevron-left" /></button>
          <button className="daily-icon-button" type="button" title="下一段日期" aria-label="下一段日期" onClick={() => setSelectedDate(navigateDate(selectedDate, mode, 1))}><PlannerIcon name="chevron-right" /></button>
          <div><h2>{formatMonth(selectedDate)}</h2><p>{formatLongDate(selectedDate)}</p></div>
        </div>
        <div className="daily-toolbar-actions">
          <div className="daily-mode-switch" role="tablist" aria-label="每日任务视图">
            {(["day", "multi", "week", "month"] as PlannerMode[]).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{modeLabel(value)}</button>
            ))}
          </div>
          <button className="daily-agent-button" type="button" disabled={!!busy} onClick={() => void runAgent()}><PlannerIcon name="spark" />{busy === "agent" ? "规划中" : "Agent 排今日"}</button>
        </div>
      </header>

      <div className="daily-week-strip" aria-label="选择日期">
        {weekDays.map((date) => {
          const key = dateKey(date);
          const count = tasksForDate(snapshot.dailyTasks, date).length;
          const active = key === selectedKey;
          return <button key={key} type="button" className={active ? "active" : ""} aria-pressed={active} onClick={() => setSelectedDate(date)}><span>{weekday(date)}</span><b>{date.getDate()}</b><i>{count ? `${count} 项` : "空闲"}</i></button>;
        })}
      </div>

      <div className="daily-summary-band">
        <p><b>{selectedDayTasks.length}</b> 项安排</p>
        <p><b>{completedCount}</b> 项完成</p>
        <p><b>{formatDuration(plannedMinutes)}</b> 已规划</p>
        <div className="daily-record-status" title="每天的计划与完成状态均保存在本机">
          <span>{selectedDayRelation < 0 ? `历史完成 ${completionPercent}%` : selectedDayRelation > 0 ? "未来计划已保存" : `今日进度 ${completionPercent}%`}</span>
          <i><b style={{ width: `${completionPercent}%` }} /></i>
        </div>
        {feedback && <span role="status">{feedback}</span>}
      </div>

      <div className={`daily-workspace mode-${mode}`}>
        {mode === "day" && (
          <>
            <InboxPanel tasks={inbox} text={inboxText} busy={!!busy} onText={setInboxText} onCreate={createInbox} onOpen={(id) => openTask(id, selectedDate)} />
            <DayTimeline
              date={selectedDate}
              tasks={selectedDayTasks}
              timelineRef={timelineRef}
              zoom={timelineZoom}
              onZoom={setTimelineZoom}
              onDrop={dropOnTimeline}
              disabled={!!busy}
              onOpen={openTask}
              onToggle={toggleComplete}
            />
          </>
        )}
        {(mode === "multi" || mode === "week") && (
          <CompactDays
            days={daysFrom(mode === "week" ? startOfWeek(selectedDate) : selectedDate, mode === "week" ? 7 : 3)}
            tasks={snapshot.dailyTasks}
            onSelectDate={(date) => { setSelectedDate(date); setMode("day"); }}
            disabled={!!busy}
            onOpen={openTask}
            onToggle={toggleComplete}
          />
        )}
        {mode === "month" && <MonthView date={selectedDate} tasks={snapshot.dailyTasks} onSelectDate={(date) => { setSelectedDate(date); setMode("day"); }} />}
        <button className="daily-floating-add" type="button" title="新建已排期任务" aria-label="新建已排期任务" disabled={!!busy} onClick={createScheduled}><PlannerIcon name="add" /></button>
      </div>

      {selectedTask && (
        <TaskEditor
          key={`${selectedTask.id}-${selectedTask.updatedAt}`}
          task={selectedTask}
          occurrenceDate={selectedOccurrenceDate}
          isNew={!!newTaskDraft}
          linkedTitle={snapshot.items.find((item) => item.id === selectedTask.linkedTaskId)?.title}
          onClose={closeEditor}
          onSave={async (patch) => {
            if (newTaskDraft) {
              setSnapshot(await api.createDailyTask({
                title: patch.title ?? newTaskDraft.title,
                notes: patch.notes ?? newTaskDraft.notes,
                color: patch.color ?? newTaskDraft.color,
                allDay: patch.allDay ?? newTaskDraft.allDay,
                scheduledStartAt: patch.scheduledStartAt ?? undefined,
                scheduledEndAt: patch.scheduledEndAt ?? undefined,
                recurrence: patch.recurrence ?? newTaskDraft.recurrence,
                recurrenceEndsAt: patch.recurrenceEndsAt ?? undefined,
                subtasks: patch.subtasks ?? newTaskDraft.subtasks,
              }));
            } else {
              setSnapshot(await api.updateDailyTask(selectedTask.id, patch));
            }
            closeEditor();
          }}
          onDelete={newTaskDraft ? undefined : async () => { setSnapshot(await api.deleteDailyTask(selectedTask.id)); closeEditor(); }}
        />
      )}
    </div>
  );
}

function InboxPanel({ tasks, text, busy, onText, onCreate, onOpen }: { tasks: DailyTask[]; text: string; busy: boolean; onText(value: string): void; onCreate(event: React.FormEvent): void; onOpen(id: string): void }) {
  return (
    <aside className="daily-inbox">
      <header><div><span className="daily-inbox-icon" aria-hidden="true"><PlannerIcon name="inbox" /></span><h3>待安排</h3></div><b>{tasks.length}</b></header>
      <form onSubmit={onCreate}><input value={text} disabled={busy} onChange={(event) => onText(event.target.value)} placeholder="记录一个还没决定时间的任务..." aria-label="添加待安排任务" /><button type="submit" disabled={busy || !text.trim()} title="添加到待安排" aria-label="添加到待安排"><PlannerIcon name="add" /></button></form>
      <div className="daily-inbox-list">
        {tasks.map((task) => <button className={`daily-inbox-task color-${task.color}`} draggable={!busy} disabled={busy} key={task.id} type="button" onDragStart={(event) => event.dataTransfer.setData("application/x-chroni-daily-task", task.id)} onClick={() => onOpen(task.id)}><i aria-hidden="true" /><span><b>{task.title}</b><small>{task.origin === "agent" ? "Agent 规划" : "拖到时间轴排期"}</small></span><em aria-hidden="true"><PlannerIcon name="chevron-right" /></em></button>)}
        {!tasks.length && <div className="daily-inbox-empty"><span aria-hidden="true"><svg className="inline-icon" viewBox="0 0 16 16" focusable="false"><path d="M2 8c2.1-3.4 3.8 3.4 6 0s3.9-3.4 6 0" /></svg></span><b>想法已经归位</b><p>新任务可以先留在这里，再拖到右侧安排。</p></div>}
      </div>
    </aside>
  );
}

function DayTimeline({ date, tasks, timelineRef, zoom, disabled, onZoom, onDrop, onOpen, onToggle }: { date: Date; tasks: DailyTask[]; timelineRef: React.RefObject<HTMLDivElement | null>; zoom: number; disabled: boolean; onZoom(value: number): void; onDrop(event: React.DragEvent<HTMLDivElement>): void; onOpen(id: string, date: Date): void; onToggle(task: DailyTask, date: Date): void }) {
  const timed = tasks.filter((task) => !task.allDay);
  const allDay = tasks.filter((task) => task.allDay);
  const [now, setNow] = useState(() => new Date());
  const timelineHeight = timelineBaseHeight * zoom;
  const zoomIndex = Math.max(0, timelineZoomLevels.findIndex((value) => value === zoom));
  const intervals = timed.map((task) => {
    const start = occurrenceStart(task, date);
    const rawStartMinutes = start.getHours() * 60 + start.getMinutes();
    return {
      id: task.id,
      startMinutes: Math.max(dayStartMinutes, rawStartMinutes),
      endMinutes: Math.min(dayEndMinutes, rawStartMinutes + taskDuration(task)),
    };
  });
  const placements = new Map(layoutTimelineIntervals(intervals).map((placement) => [placement.id, placement]));
  const displayColors = timelineDisplayColors(timed, date);
  const nowPosition = dateKey(now) === dateKey(date) ? timelinePosition(now.getHours() * 60 + now.getMinutes(), timelineHeight) : undefined;

  useEffect(() => {
    const refresh = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const timeline = timelineRef.current;
        const workspace = timeline?.closest<HTMLElement>(".daily-timeline-panel");
        if (!timeline || !workspace) return;
        const current = new Date();
        const focusMinutes = dateKey(date) === dateKey(current)
          ? Math.max(dayStartMinutes, current.getHours() * 60 + current.getMinutes() - 60)
          : 8 * 60;
        const workspaceRect = workspace.getBoundingClientRect();
        const timelineRect = timeline.getBoundingClientRect();
        const timelineOffset = timelineRect.top - workspaceRect.top + workspace.scrollTop;
        workspace.scrollTop = Math.max(0, timelineOffset + timelinePosition(focusMinutes, timelineHeight) - 72);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
    // Deliberately keyed only by the selected date: zoom keeps the user's current viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function changeZoom(nextZoom: number): void {
    if (nextZoom === zoom) return;
    const timeline = timelineRef.current;
    const workspace = timeline?.closest<HTMLElement>(".daily-timeline-panel");
    const workspaceRect = workspace?.getBoundingClientRect();
    const timelineRect = timeline?.getBoundingClientRect();
    const anchorY = workspaceRect ? workspaceRect.top + workspaceRect.height / 2 : 0;
    const anchorRatio = timelineRect ? Math.max(0, Math.min(1, (anchorY - timelineRect.top) / timelineHeight)) : 0;
    onZoom(nextZoom);
    if (!workspace || !workspaceRect || !timelineRect) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const nextTimelineRect = timelineRef.current?.getBoundingClientRect();
      if (!nextTimelineRect) return;
      workspace.scrollTop += nextTimelineRect.top + anchorRatio * timelineBaseHeight * nextZoom - anchorY;
    }));
  }

  return (
    <section className="daily-timeline-panel">
      <header><div><p>{weekday(date)}</p><h3><span className="daily-display-number">{date.getDate()}</span> 日的时间轴</h3></div><div className="daily-timeline-header-actions"><span>{tasks.length ? "拖动任务可重新排期" : "今天还没有安排"}</span><div className="daily-timeline-zoom" role="group" aria-label="时间轴缩放"><button type="button" title="缩小时间轴" aria-label="缩小时间轴" disabled={zoomIndex === 0} onClick={() => changeZoom(timelineZoomLevels[Math.max(0, zoomIndex - 1)])}><PlannerIcon name="minus" /></button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button type="button" title="放大时间轴" aria-label="放大时间轴" disabled={zoomIndex === timelineZoomLevels.length - 1} onClick={() => changeZoom(timelineZoomLevels[Math.min(timelineZoomLevels.length - 1, zoomIndex + 1)])}><PlannerIcon name="add" /></button></div></div></header>
      {allDay.length > 0 && <div className="daily-all-day"><b>全天</b>{allDay.map((task) => <TimelineTask key={task.id} task={task} date={date} compact disabled={disabled} onOpen={onOpen} onToggle={onToggle} />)}</div>}
      <div className="daily-timeline" ref={timelineRef} onDragOver={(event) => { if (!disabled) event.preventDefault(); }} onDrop={(event) => { if (!disabled) onDrop(event); }} style={{ height: timelineHeight }}>
        {Array.from({ length: 13 }, (_, index) => index * 2).map((hour) => <div className="daily-hour" key={hour} style={{ top: timelinePosition(hour * 60, timelineHeight) }}><time>{String(hour).padStart(2, "0")}:00</time><span /></div>)}
        <div className="daily-timeline-rail" />
        {nowPosition !== undefined && nowPosition >= 0 && nowPosition <= timelineHeight && <div className="daily-now" style={{ top: nowPosition }}><i /><span>现在 {formatClock(now)}</span></div>}
        <div className="daily-events-layer">
          {timed.map((task) => {
            const placement = placements.get(task.id);
            if (!placement) return null;
            const durationHeight = timelinePosition(placement.endMinutes, timelineHeight) - timelinePosition(placement.startMinutes, timelineHeight);
            const visualHeight = Math.max(14, durationHeight - 4);
            const density = visualHeight < 34 ? "micro" : visualHeight < 58 ? "short" : "regular";
            const left = `calc(${placement.lane * 100 / placement.laneCount}% + ${placement.lane * timelineLaneGap / placement.laneCount}px)`;
            const width = `calc(${100 / placement.laneCount}% - ${(placement.laneCount - 1) * timelineLaneGap / placement.laneCount}px)`;
            return (
              <div
                className="daily-timeline-task-wrap"
                data-lane={`${placement.lane + 1}/${placement.laneCount}`}
                key={task.id}
                style={{
                  top: timelinePosition(placement.startMinutes, timelineHeight) + 2,
                  height: visualHeight,
                  left,
                  width,
                }}
              >
                <TimelineTask task={task} date={date} density={density} displayColor={displayColors.get(task.id)} disabled={disabled} onOpen={onOpen} onToggle={onToggle} />
              </div>
            );
          })}
        </div>
        {!tasks.length && <div className="daily-timeline-empty"><span aria-hidden="true"><PlannerIcon name="spark" /></span><b>留一段专注时间给重要的事</b><p>运行 Agent，或从 Inbox 拖一项到时间轴。</p></div>}
      </div>
    </section>
  );
}

function TimelineTask({ task, date, compact = false, density = "regular", displayColor, disabled = false, onOpen, onToggle }: { task: DailyTask; date: Date; compact?: boolean; density?: "micro" | "short" | "regular"; displayColor?: DailyTaskColor; disabled?: boolean; onOpen(id: string, date: Date): void; onToggle(task: DailyTask, date: Date): void }) {
  const complete = task.completedDates.includes(dateKey(date));
  const start = occurrenceStart(task, date);
  const end = new Date(start.getTime() + taskDuration(task) * 60_000);
  const archived = task.dismissed;
  const interactive = !archived && !disabled;
  const scheduleLabel = task.allDay ? "全天" : `${formatClock(start)} 至 ${formatClock(end)}`;
  return (
    <article
      className={`daily-task-card color-${displayColor ?? task.color} density-${density} ${complete ? "completed" : ""} ${compact ? "compact" : ""} ${archived ? "archived" : ""}`}
      draggable={interactive}
      onDragStart={(event) => event.dataTransfer.setData("application/x-chroni-daily-task", task.id)}
    >
      <button type="button" className="daily-check" disabled={!interactive} aria-label={complete ? `恢复 ${task.title}` : `完成 ${task.title}`} onClick={() => { if (interactive) onToggle(task, date); }}>{complete ? <PlannerIcon name="check" /> : null}</button>
      <button type="button" className="daily-task-open" disabled={!interactive} aria-label={`${task.title}，${scheduleLabel}${interactive ? "，编辑任务" : "，历史保留"}`} onClick={() => { if (interactive) onOpen(task.id, date); }}>
        <span className="daily-task-copy"><time>{task.allDay ? "全天" : `${formatClock(start)} – ${formatClock(end)}`}</time><b>{task.title}</b><span>{archived ? "历史保留" : task.origin === "agent" ? "✦ Agent 规划" : task.recurrence !== "none" ? recurrenceLabel(task.recurrence) : formatDuration(taskDuration(task))}</span></span>
        <i aria-hidden="true" />
      </button>
    </article>
  );
}

function CompactDays({ days, tasks, disabled, onSelectDate, onOpen, onToggle }: { days: Date[]; tasks: DailyTask[]; disabled: boolean; onSelectDate(date: Date): void; onOpen(id: string, date: Date): void; onToggle(task: DailyTask, date: Date): void }) {
  return <section className="daily-compact-days">{days.map((date) => { const daily = tasksForDate(tasks, date); return <article className={dateKey(date) === dateKey(new Date()) ? "today" : ""} key={dateKey(date)}><button className="daily-column-head" type="button" onClick={() => onSelectDate(date)}><span>{weekday(date)}</span><b>{date.getDate()}</b><small>{daily.length} 项</small></button><div>{daily.sort(compareDailyTasks).map((task) => <TimelineTask key={task.id} task={task} date={date} compact disabled={disabled} onOpen={onOpen} onToggle={onToggle} />)}{!daily.length && <p className="daily-column-empty">暂无安排</p>}</div></article>; })}</section>;
}

function MonthView({ date, tasks, onSelectDate }: { date: Date; tasks: DailyTask[]; onSelectDate(date: Date): void }) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const days = daysFrom(gridStart, 42);
  return <section className="daily-month"><header>{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label) => <b key={label}>{label}</b>)}</header><div>{days.map((day) => { const daily = tasksForDate(tasks, day); return <button type="button" key={dateKey(day)} className={`${day.getMonth() === date.getMonth() ? "" : "outside"} ${dateKey(day) === dateKey(new Date()) ? "today" : ""}`} onClick={() => onSelectDate(day)}><span>{day.getDate()}</span><small>{daily.slice(0, 3).map((task) => <i className={`color-${task.color}`} key={task.id}>{task.title}</i>)}</small>{daily.length > 3 && <em>还有 {daily.length - 3} 项</em>}</button>; })}</div></section>;
}

function TaskEditor({ task, occurrenceDate, isNew, linkedTitle, onClose, onSave, onDelete }: { task: DailyTask; occurrenceDate: Date; isNew: boolean; linkedTitle?: string; onClose(): void; onSave(patch: DailyTaskPatch): Promise<void>; onDelete?: () => Promise<void> }) {
  const initialDraftRef = useRef<TaskDraft>(taskDraft(task, occurrenceDate));
  const [draft, setDraft] = useState<TaskDraft>(initialDraftRef.current);
  const [subtaskText, setSubtaskText] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "delete">("");
  const [error, setError] = useState("");
  const recurringSeries = !isNew && task.recurrence !== "none";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!draft.title.trim() || busy) return;
    setBusy("save");
    setError("");
    try {
      const patch: DailyTaskPatch = {
        title: draft.title.trim(),
        notes: draft.notes,
        color: draft.color,
        allDay: draft.scheduled ? draft.allDay : false,
        recurrence: draft.scheduled ? draft.recurrence : "none",
        recurrenceEndsAt: draft.scheduled && draft.recurrence !== "none" && draft.recurrenceEndsAt
          ? endOfLocalDay(fromDateKey(draft.recurrenceEndsAt)).toISOString()
          : null,
        subtasks: draft.subtasks,
      };

      if (!draft.scheduled) {
        patch.scheduledStartAt = null;
        patch.scheduledEndAt = null;
      } else {
        if (!draft.date) throw new Error("请选择任务日期。");
        if (draft.recurrenceEndsAt && draft.recurrenceEndsAt < draft.date) throw new Error("重复结束日期不能早于任务日期。");
        const start = draft.allDay ? atLocalTime(fromDateKey(draft.date), "00:00") : atLocalTime(fromDateKey(draft.date), draft.start);
        const end = draft.allDay ? atLocalTime(fromDateKey(draft.date), "23:59") : atLocalTime(fromDateKey(draft.date), draft.end);
        if (!draft.allDay && (!draft.start || !draft.end)) throw new Error("请填写完整的开始和结束时间。");
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error("日期或时间格式不正确。");
        if (end <= start) throw new Error("结束时间必须晚于开始时间，且与开始时间在同一天。");

        const initial = initialDraftRef.current;
        const scheduleChanged = isNew
          || !initial.scheduled
          || draft.date !== initial.date
          || draft.start !== initial.start
          || draft.end !== initial.end
          || draft.allDay !== initial.allDay;
        if (scheduleChanged) {
          patch.scheduledStartAt = start.toISOString();
          patch.scheduledEndAt = end.toISOString();
        }
      }
      if (recurringSeries && !window.confirm("这会更新整个重复任务系列，是否继续？")) {
        setBusy("");
        return;
      }
      await onSave(patch);
      setBusy("");
    } catch (reason) {
      setError(operationMessage(reason, "任务没有保存，请检查时间。"));
      setBusy("");
    }
  }

  async function remove(): Promise<void> {
    if (!onDelete || busy) return;
    const message = recurringSeries ? "确定删除整个重复任务系列吗？" : "确定删除这条每日任务吗？";
    if (!window.confirm(message)) return;
    setBusy("delete");
    setError("");
    try {
      await onDelete();
    } catch (reason) {
      setError(operationMessage(reason, "任务没有删除，请稍后再试。"));
      setBusy("");
    }
  }

  function addSubtask(): void {
    const title = subtaskText.trim();
    if (!title) return;
    setDraft((current) => ({ ...current, subtasks: [...current.subtasks, { id: `subtask-${Date.now()}`, title, completed: false }] }));
    setSubtaskText("");
  }

  return (
    <div className="daily-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <aside className={`daily-editor color-${draft.color}`} role="dialog" aria-modal="true" aria-labelledby="daily-editor-title" aria-describedby={recurringSeries ? "daily-series-notice" : undefined}>
        <header>
          <div className="daily-editor-mark" aria-hidden="true"><PlannerIcon name={task.origin === "agent" ? "spark" : "circle"} /></div>
          <div>
            <p>{isNew ? "新建每日任务" : task.origin === "agent" ? "Agent 规划任务" : recurringSeries ? "重复任务 · 编辑整个系列" : "每日任务"}</p>
            <h2 id="daily-editor-title">{draft.title || "未命名任务"}</h2>
            {linkedTitle && <span>关联：{linkedTitle}</span>}
            {recurringSeries && <span id="daily-series-notice">正在查看 {formatLongDate(occurrenceDate)}，保存会更新整个系列</span>}
          </div>
          <button className="daily-editor-close" type="button" disabled={!!busy} onClick={onClose} aria-label="关闭任务编辑" title="关闭"><PlannerIcon name="close" /></button>
        </header>
        <form onSubmit={(event) => void save(event)}>
          <label className="daily-editor-title-field">任务名称<input autoFocus value={draft.title} disabled={!!busy} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <div className="daily-editor-row">
            <label>安排状态<select value={draft.scheduled ? "scheduled" : "inbox"} disabled={!!busy} onChange={(event) => setDraft({ ...draft, scheduled: event.target.value === "scheduled" })}><option value="inbox">待安排</option><option value="scheduled">已排期</option></select></label>
            {draft.scheduled && <label>日期<input required type="date" value={draft.date} disabled={!!busy} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>}
          </div>
          {draft.scheduled && !draft.allDay && <div className="daily-editor-row"><label>开始<input required type="time" value={draft.start} disabled={!!busy} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label><label>结束<input required type="time" value={draft.end} disabled={!!busy} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label></div>}
          {draft.scheduled && <div className="daily-editor-row"><label>重复<select value={draft.recurrence} disabled={!!busy} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as DailyTaskRecurrence })}><option value="none">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option></select></label><label className="daily-all-day-toggle"><span>全天</span><input type="checkbox" checked={draft.allDay} disabled={!!busy} onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })} /></label></div>}
          {draft.scheduled && draft.recurrence !== "none" && <div className="daily-editor-row"><label>重复结束日期（可选）<input type="date" min={draft.date} value={draft.recurrenceEndsAt} disabled={!!busy} onChange={(event) => setDraft({ ...draft, recurrenceEndsAt: event.target.value })} /></label></div>}
          <div className="daily-editor-row"><fieldset disabled={!!busy}><legend>颜色</legend><div className="daily-color-picker">{colors.map((color) => <button key={color.value} className={`color-${color.value} ${draft.color === color.value ? "active" : ""}`} type="button" onClick={() => setDraft({ ...draft, color: color.value })} title={color.label} aria-label={color.label} aria-pressed={draft.color === color.value} />)}</div></fieldset></div>
          <section className="daily-editor-subtasks"><h3>子任务 <span>{draft.subtasks.filter((item) => item.completed).length}/{draft.subtasks.length}</span></h3>{draft.subtasks.map((subtask) => <div key={subtask.id}><input type="checkbox" checked={subtask.completed} disabled={!!busy} aria-label={`完成 ${subtask.title}`} onChange={(event) => setDraft({ ...draft, subtasks: draft.subtasks.map((item) => item.id === subtask.id ? { ...item, completed: event.target.checked } : item) })} /><input value={subtask.title} disabled={!!busy} aria-label="子任务名称" onChange={(event) => setDraft({ ...draft, subtasks: draft.subtasks.map((item) => item.id === subtask.id ? { ...item, title: event.target.value } : item) })} /><button type="button" disabled={!!busy} aria-label={`删除 ${subtask.title}`} title="删除子任务" onClick={() => setDraft({ ...draft, subtasks: draft.subtasks.filter((item) => item.id !== subtask.id) })}><PlannerIcon name="close" /></button></div>)}<div className="daily-subtask-add"><input value={subtaskText} disabled={!!busy} placeholder="添加子任务" onChange={(event) => setSubtaskText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSubtask(); } }} /><button type="button" onClick={addSubtask} disabled={!!busy || !subtaskText.trim()} aria-label="添加子任务"><PlannerIcon name="add" /></button></div></section>
          <label className="daily-editor-notes">备注<textarea rows={4} value={draft.notes} disabled={!!busy} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="补充上下文、链接或执行提示..." /></label>
          {error && <p className="daily-editor-error" role="alert">{error}</p>}
          <footer>
            {onDelete ? <button className="daily-delete-button" type="button" disabled={!!busy} onClick={() => void remove()} aria-label={recurringSeries ? "删除整个重复任务系列" : "删除任务"} title={recurringSeries ? "删除整个重复任务系列" : "删除任务"}>{busy === "delete" ? "删除中..." : recurringSeries ? "删除整个系列" : "删除任务"}</button> : <span />}
            <button className="daily-save-button" type="submit" disabled={!!busy || !draft.title.trim()}>{busy === "save" ? "保存中..." : isNew ? "创建任务" : recurringSeries ? "保存整个系列" : "保存任务"}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function tasksForDate(tasks: DailyTask[], date: Date): DailyTask[] {
  const targetKey = dateKey(date);
  const todayKey = dateKey(new Date());
  return tasks
    .filter((task) => occursOn(task, date) && (!task.dismissed || targetKey < todayKey))
    .sort(compareDailyTasks);
}

function timelineDisplayColors(tasks: DailyTask[], date: Date): Map<string, DailyTaskColor> {
  const assignments = new Map<string, DailyTaskColor>();
  const active: Array<{ endMinutes: number; color: DailyTaskColor }> = [];
  let previousColor: DailyTaskColor | undefined;
  const sorted = [...tasks].sort(compareDailyTasks);

  sorted.forEach((task, index) => {
    const start = occurrenceStart(task, date);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const forbidden = new Set(active.filter((item) => item.endMinutes > startMinutes).map((item) => item.color));
    if (previousColor) forbidden.add(previousColor);
    const candidates = [task.color, ...timelinePalette].filter((color, candidateIndex, values) => values.indexOf(color) === candidateIndex);
    const color = candidates.find((candidate) => !forbidden.has(candidate)) ?? timelinePalette[index % timelinePalette.length];
    assignments.set(task.id, color);
    active.push({ endMinutes: startMinutes + taskDuration(task), color });
    previousColor = color;
  });
  return assignments;
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

function occurrenceStart(task: DailyTask, date: Date): Date {
  const source = task.scheduledStartAt ? new Date(task.scheduledStartAt) : date;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), source.getHours(), source.getMinutes());
}

function taskDuration(task: DailyTask): number {
  if (!task.scheduledStartAt || !task.scheduledEndAt) return 30;
  return Math.max(15, Math.round((new Date(task.scheduledEndAt).getTime() - new Date(task.scheduledStartAt).getTime()) / 60_000));
}

function taskDraft(task: DailyTask, occurrenceDate: Date): TaskDraft {
  const scheduled = !!task.scheduledStartAt;
  const start = scheduled ? occurrenceStart(task, occurrenceDate) : atLocalTime(occurrenceDate, "09:00");
  const end = new Date(start.getTime() + taskDuration(task) * 60_000);
  return {
    title: task.title,
    notes: task.notes,
    color: task.color,
    scheduled,
    date: dateKey(occurrenceDate),
    start: inputClock(start),
    end: inputClock(end),
    allDay: scheduled && task.allDay,
    recurrence: scheduled ? task.recurrence : "none",
    recurrenceEndsAt: task.recurrenceEndsAt ? dateKey(new Date(task.recurrenceEndsAt)) : "",
    subtasks: structuredClone(task.subtasks),
  };
}

function timelinePosition(minutes: number, height: number): number { return (minutes - dayStartMinutes) / (dayEndMinutes - dayStartMinutes) * height; }
function startOfDay(value: Date): Date { return new Date(value.getFullYear(), value.getMonth(), value.getDate()); }
function startOfWeek(value: Date): Date { const result = startOfDay(value); result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result; }
function addDays(value: Date, amount: number): Date { const result = startOfDay(value); result.setDate(result.getDate() + amount); return result; }
function addMonths(value: Date, amount: number): Date {
  const source = startOfDay(value);
  const result = new Date(source.getFullYear(), source.getMonth() + amount, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(source.getDate(), lastDay));
  return result;
}
function navigateDate(value: Date, mode: PlannerMode, direction: -1 | 1): Date {
  if (mode === "month") return addMonths(value, direction);
  return addDays(value, direction * (mode === "week" ? 7 : mode === "multi" ? 3 : 1));
}
function daysFrom(value: Date, count: number): Date[] { return Array.from({ length: count }, (_, index) => addDays(value, index)); }
function dateKey(value: Date): string { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
function compareDateKeys(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function fromDateKey(value: string): Date { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function atMinutes(date: Date, minutes: number): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minutes / 60), minutes % 60); }
function atLocalTime(date: Date, clock: string): Date { const [hour, minute] = clock.split(":").map(Number); return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute); }
function endOfLocalDay(value: Date): Date { return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999); }
function defaultTaskStart(date: Date): Date {
  const today = new Date();
  const minutes = dateKey(date) === dateKey(today)
    ? Math.ceil((today.getHours() * 60 + today.getMinutes()) / 30) * 30
    : 9 * 60;
  return atMinutes(date, Math.max(dayStartMinutes, Math.min(dayEndMinutes - 60, minutes)));
}
function inputClock(value: Date): string { return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`; }
function formatClock(value: Date): string { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value); }
function formatMonth(value: Date): string { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(value); }
function formatLongDate(value: Date): string { return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(value); }
function weekday(value: Date): string { return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(value); }
function formatDuration(minutes: number): string { if (minutes < 60) return `${minutes} 分钟`; const hours = Math.floor(minutes / 60); const rest = minutes % 60; return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`; }
function modeLabel(mode: PlannerMode): string { return mode === "day" ? "日" : mode === "multi" ? "多日" : mode === "week" ? "周" : "月"; }
function recurrenceLabel(value: DailyTaskRecurrence): string { return value === "daily" ? "每天重复" : value === "weekdays" ? "工作日重复" : value === "weekly" ? "每周重复" : "不重复"; }
function operationMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
function readTimelineZoom(): number { const stored = Number(window.localStorage.getItem(timelineZoomStorageKey)); return timelineZoomLevels.includes(stored as typeof timelineZoomLevels[number]) ? stored : 1.25; }
