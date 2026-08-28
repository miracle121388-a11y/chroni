import React, { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildAgentDashboard } from "../../shared/agent-dashboard";
import { formatOperationError, formatUserFacingMessage } from "../../shared/errors";
import { intakeProgressMessage, REPROCESS_PROGRESS_MESSAGE } from "../../shared/intake-copy";
import { attentionPetAction, basePetAction, isOneShotPetAction, petClickIntent, petMotionReducer, resolvedPetAction } from "../../shared/pet-actions";
import { fullScheduleSummary, isScheduleItemSnoozed, lightweightScheduleItems, scheduleBucket, snoozeUntil, visibleActiveScheduleItems, visibleScheduleSummary } from "../../shared/schedule";
import { hasCrossedDragThreshold } from "../../window-geometry";
import type { ScheduleBucket, SnoozePreset } from "../../shared/schedule";
import {
  CHRONI_CUSTOM_LLM_BASE_URL,
  CHRONI_CUSTOM_LLM_MODEL,
  CHRONI_MANAGED_LLM_BASE_URL,
  CHRONI_MANAGED_LLM_MODEL,
} from "../../shared/types";
import type { AgentMemory, CompanionState, DailyTask, DdlItem, ChroniInputFile, ChroniLlmSettings, ChroniPreferences, ChroniPreferencesPatch, ChroniSnapshot, ChroniUpdateStatus, Importance, IntakePayload, IntakeResult, ItemPatch, PetAction, PetActionCommand, SampleDataScenario, SampleDataStatus, ServiceStatus, SourceRecord, TaskPlan } from "../../shared/types";
import { BehaviorMemoryPane, ClarificationPanel, TaskDetailPane } from "./components/AgentWorkspace";
import { DailyPlanner } from "./components/DailyPlanner";
import { DailyReviewWorkspace } from "./components/DailyReviewWorkspace";
import { LearningMissionWorkspace } from "./components/LearningMissionWorkspace";
import { UiDateTimeField } from "./components/UiDateTimeField";
import { UiIcon } from "./components/UiIcon";
import { petAnimationFrames, petAssetMode, xiaotongDonationQr } from "virtual:chroni-pet-assets";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource-variable/source-sans-3/wght.css";
import "@fontsource-variable/source-serif-4/standard.css";
import "./styles.css";

const api = window.chroni;
document.documentElement.dataset.platform = api.platform;
const petAnimationFps: Record<PetAction, number> = {
  idle: 1,
  drag: 1,
  cling: 1,
  walk: 10,
  wake: 12,
  study: 12,
  eat: 10,
  pet: 12,
  play: 10,
  cat: 10,
  sleep: 10,
};
const petAnimationLoops: Record<PetAction, boolean> = {
  idle: true,
  drag: true,
  cling: false,
  walk: false,
  wake: false,
  study: true,
  eat: false,
  pet: false,
  play: false,
  cat: false,
  sleep: false,
};

function petCommand(action: PetAction, mode: PetActionCommand["mode"] = "enqueue"): PetActionCommand {
  return { action, mode, requestedAt: new Date().toISOString() };
}

function useSnapshot(): [ChroniSnapshot | null, React.Dispatch<React.SetStateAction<ChroniSnapshot | null>>, string] {
  const [snapshot, setSnapshot] = useState<ChroniSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let active = true;
    const unsubscribe = api.onSnapshotUpdated(setSnapshot);
    void api.getSnapshot()
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch(() => {
        if (active) setLoadError("暂时无法读取本地日程，请重试。");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return [snapshot, setSnapshot, loadError];
}

function App() {
  const view = new URLSearchParams(window.location.search).get("view") ?? "control";
  const [snapshot, setSnapshot, loadError] = useSnapshot();
  if (!snapshot && loadError) {
    return (
      <div className="loading loading-error" role="alert">
        <b>{loadError}</b>
        <button type="button" onClick={() => window.location.reload()}>重新载入</button>
      </div>
    );
  }
  if (!snapshot) return <div className="loading" role="status" aria-live="polite">正在读取 Chroni…</div>;
  if (view === "pet") return <PetView snapshot={snapshot} setSnapshot={setSnapshot} />;
  if (view === "schedule") return <ScheduleView snapshot={snapshot} setSnapshot={setSnapshot} />;
  return <ControlCenter snapshot={snapshot} setSnapshot={setSnapshot} />;
}

function PetView({ snapshot, setSnapshot }: ViewProps) {
  const dragPointerId = useRef<number | null>(null);
  const dragStartPoint = useRef<{ x: number; y: number } | null>(null);
  const dragCaptureTarget = useRef<HTMLElement | null>(null);
  const dragSessionStarted = useRef(false);
  const suppressClick = useRef(false);
  const previousCompanionState = useRef(snapshot.companion.state);
  const previousCompletion = useRef(new Map(snapshot.items.map((item) => [item.id, item.completed])));
  const [hovering, setHovering] = useState(false);
  const [movingPet, setMovingPet] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [localBubble, setLocalBubble] = useState("");
  const dropBusyRef = useRef(false);
  const [motion, dispatchMotion] = useReducer(petMotionReducer, {
    active: snapshot.preferences.companionEnabled ? "wake" : undefined,
    queue: [],
  });
  const baseAction = basePetAction(snapshot.companion.state);
  const visualAction = resolvedPetAction({ moving: movingPet, base: baseAction, active: motion.active });

  useEffect(() => api.onPetAction((command) => dispatchMotion({ type: "command", command })), []);

  useEffect(() => {
    const previous = previousCompanionState.current;
    previousCompanionState.current = snapshot.companion.state;
    const action = attentionPetAction(previous, snapshot.companion.state);
    if (action) dispatchMotion({ type: "command", command: petCommand(action, "enqueue") });
  }, [snapshot.companion.state]);

  useEffect(() => {
    const previous = previousCompletion.current;
    const next = new Map(snapshot.items.map((item) => [item.id, item.completed]));
    const newlyCompleted = snapshot.items.some((item) => item.completed && previous.get(item.id) === false);
    previousCompletion.current = next;
    if (newlyCompleted) dispatchMotion({ type: "command", command: petCommand("play", "replace") });
  }, [snapshot.items]);

  useEffect(() => {
    if (snapshot.companion.state !== "idle" || motion.active || movingPet || hovering) return;
    const timeout = window.setTimeout(() => {
      dispatchMotion({ type: "command", command: petCommand("walk") });
    }, 20_000 + Math.round(Math.random() * 15_000));
    return () => window.clearTimeout(timeout);
  }, [hovering, motion.active, movingPet, snapshot.companion.state]);

  useEffect(() => {
    if (localBubble) {
      setBubbleVisible(true);
      const timeout = window.setTimeout(() => {
        setBubbleVisible(false);
        setLocalBubble("");
      }, 4200);
      return () => window.clearTimeout(timeout);
    }
    if (isPersistentPetFeedback(snapshot.companion.state)) {
      setBubbleVisible(true);
      return;
    }
    if (!isTransientPetFeedback(snapshot.companion.state)) {
      setBubbleVisible(false);
      return;
    }
    setBubbleVisible(true);
    const timeout = window.setTimeout(() => setBubbleVisible(false), 3600);
    return () => window.clearTimeout(timeout);
  }, [localBubble, snapshot.companion.bubble, snapshot.companion.state]);

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setHovering(false);
    if (dropBusyRef.current) {
      setLocalBubble("上一份内容还在处理中，请稍候再拖入。");
      void api.companionHover(false).then(setSnapshot).catch(() => undefined);
      return;
    }
    dropBusyRef.current = true;
    setLocalBubble("收到，正在读取内容…");
    try {
      const droppedFiles = Array.from(event.dataTransfer.files);
      const droppedText = event.dataTransfer.getData("text/plain").trim();
      const files = await filesFromFileList(droppedFiles);
      if (!files.length && !droppedText) throw new Error("没有收到可读取的文件或文字。");
      const payload: IntakePayload = files.length
        ? { kind: "files", files }
        : { kind: "text", text: droppedText };
      dispatchMotion({ type: "command", command: petCommand(files.length ? "study" : "eat", "replace") });
      setLocalBubble(intakeProgressMessage(payload));
      await api.companionHover(false).catch(() => undefined);
      const result = await api.intake(payload);
      setSnapshot(result.snapshot);
      setLocalBubble("");
    } catch (error) {
      setLocalBubble(formatOperationError(error, "拖放处理失败"));
    } finally {
      dropBusyRef.current = false;
      void api.companionHover(false).then(setSnapshot).catch(() => undefined);
    }
  }

  function runSingleClick(): void {
    dispatchMotion({ type: "command", command: petCommand(snapshot.companion.state === "sleeping" ? "wake" : "pet", "replace") });
    void api.companionClicked().then(setSnapshot).catch(() => setLocalBubble("暂时无法打开日程。"));
  }

  function handlePetClick(event: React.MouseEvent<HTMLButtonElement>): void {
    if (suppressClick.current) {
      event.preventDefault();
      suppressClick.current = false;
      return;
    }
    if (petClickIntent(event.detail) === "cat") {
      dispatchMotion({ type: "command", command: petCommand("cat", "replace") });
      return;
    }
    runSingleClick();
  }

  return (
    <main
      className={`pet-shell state-${snapshot.companion.state} ${movingPet ? "moving" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (dropBusyRef.current) {
          setLocalBubble("上一份内容还在处理中，请稍候再拖入。");
          return;
        }
        if (!hovering) {
          setHovering(true);
          void api.companionHover(true).then(setSnapshot).catch(() => setLocalBubble("暂时无法接收拖入。"));
        }
      }}
      onDragLeave={() => {
        setHovering(false);
        void api.companionHover(false).then(setSnapshot).catch(() => undefined);
      }}
      onDrop={(event) => void handleDrop(event)}
      onContextMenu={(event) => {
        event.preventDefault();
        void api.openPetMenu().catch((error) => setLocalBubble(formatOperationError(error, "暂时无法打开桌宠菜单")));
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        dragPointerId.current = event.pointerId;
        dragStartPoint.current = { x: event.screenX, y: event.screenY };
        const captureTarget = event.target instanceof HTMLElement ? event.target : event.currentTarget;
        dragCaptureTarget.current = captureTarget;
        captureTarget.setPointerCapture(event.pointerId);
        dragSessionStarted.current = false;
        suppressClick.current = false;
      }}
      onPointerMove={(event) => {
        if (dragPointerId.current !== event.pointerId || (event.buttons & 1) === 0) return;
        const start = dragStartPoint.current;
        if (start && !dragSessionStarted.current && hasCrossedDragThreshold(start, { x: event.screenX, y: event.screenY })) {
          if (!api.startWindowDrag()) return;
          dragSessionStarted.current = true;
          suppressClick.current = true;
          setMovingPet(true);
          dispatchMotion({ type: "command", command: petCommand("idle", "replace") });
        }
        if (dragSessionStarted.current) api.moveWindowDrag();
      }}
      onPointerUp={(event) => {
        if (dragPointerId.current !== event.pointerId) return;
        const wasMoved = dragSessionStarted.current;
        dragPointerId.current = null;
        dragStartPoint.current = null;
        dragSessionStarted.current = false;
        const captureTarget = dragCaptureTarget.current;
        dragCaptureTarget.current = null;
        if (captureTarget?.hasPointerCapture(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId);
        setMovingPet(false);
        if (wasMoved) api.endWindowDrag();
        if (wasMoved && baseAction !== "sleep") dispatchMotion({ type: "command", command: petCommand("cling", "replace") });
        if (wasMoved) window.setTimeout(() => { suppressClick.current = false; }, 0);
      }}
      onPointerCancel={(event) => {
        if (dragPointerId.current !== event.pointerId) return;
        dragPointerId.current = null;
        dragStartPoint.current = null;
        const wasDragging = dragSessionStarted.current;
        dragSessionStarted.current = false;
        const captureTarget = dragCaptureTarget.current;
        dragCaptureTarget.current = null;
        if (captureTarget?.hasPointerCapture(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId);
        suppressClick.current = false;
        setMovingPet(false);
        if (wasDragging) api.endWindowDrag();
      }}
      onLostPointerCapture={(event) => {
        if (dragPointerId.current !== event.pointerId) return;
        dragPointerId.current = null;
        dragStartPoint.current = null;
        const wasDragging = dragSessionStarted.current;
        dragSessionStarted.current = false;
        dragCaptureTarget.current = null;
        suppressClick.current = false;
        setMovingPet(false);
        if (wasDragging) api.endWindowDrag();
      }}
    >
      <button
        className="pet-body"
        type="button"
        onClick={handlePetClick}
        aria-label={`Chroni 桌宠，当前动作：${petActionLabel(visualAction)}`}
      >
        <PetSprite action={visualAction} onFinished={(action) => dispatchMotion({ type: "finished", action })} />
      </button>
      <div className={`bubble ${bubbleVisible ? "show" : ""}`} role="status" aria-live="polite">{localBubble || safeUserMessage(snapshot.companion.bubble, "我在这里。")}</div>
    </main>
  );
}

function ScheduleView({ snapshot, setSnapshot }: ViewProps) {
  const scheduleClock = useScheduleClock();
  const surface = useMemo(() => buildScheduleSurface(snapshot.items, new Date(scheduleClock)), [scheduleClock, snapshot.items]);
  const [quickText, setQuickText] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [feedback, setFeedback] = useState<ActionNotice | null>(null);
  const [feedbackHovered, setFeedbackHovered] = useState(false);
  const [feedbackFocused, setFeedbackFocused] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [undoing, setUndoing] = useState(false);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const quickAddInputRef = useRef<HTMLInputElement>(null);
  const scheduleDragPointerId = useRef<number | null>(null);
  const scheduleDragStart = useRef<{ x: number; y: number } | null>(null);
  const scheduleDragActive = useRef(false);
  const [movingSchedule, setMovingSchedule] = useState(false);
  const isBusy = !!busyMessage;
  const feedbackPaused = feedbackHovered || feedbackFocused;

  function closeQuickAdd(): void {
    setQuickAddOpen(false);
    setQuickText("");
  }

  function startScheduleDrag(event: React.PointerEvent<HTMLElement>): void {
    if (api.platform !== "win32" || !event.isPrimary || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a")) return;
    scheduleDragPointerId.current = event.pointerId;
    scheduleDragStart.current = { x: event.screenX, y: event.screenY };
    scheduleDragActive.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveScheduleDrag(event: React.PointerEvent<HTMLElement>): void {
    if (scheduleDragPointerId.current !== event.pointerId || (event.buttons & 1) === 0) return;
    const start = scheduleDragStart.current;
    if (start && !scheduleDragActive.current && hasCrossedDragThreshold(start, { x: event.screenX, y: event.screenY })) {
      if (!api.startWindowDrag()) return;
      scheduleDragActive.current = true;
      setMovingSchedule(true);
    }
    if (scheduleDragActive.current) api.moveWindowDrag();
  }

  function finishScheduleDrag(event: React.PointerEvent<HTMLElement>): void {
    if (scheduleDragPointerId.current !== event.pointerId) return;
    const wasDragging = scheduleDragActive.current;
    scheduleDragPointerId.current = null;
    scheduleDragStart.current = null;
    scheduleDragActive.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setMovingSchedule(false);
    if (wasDragging) api.endWindowDrag();
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || document.querySelector(".snooze-menu")) return;
      if (quickAddOpen) {
        if (!isBusy) closeQuickAdd();
        return;
      }
      void api.showSchedule(false).catch((error) => showFeedback({ message: formatOperationError(error, "暂时无法收起日程"), tone: "warn" }));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, quickAddOpen]);

  useEffect(() => {
    if (!quickAddOpen) return;
    const frame = window.requestAnimationFrame(() => quickAddInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [quickAddOpen]);

  useEffect(() => {
    if (!feedback || feedbackPaused) return;
    const timeout = window.setTimeout(() => setFeedback(null), feedback.undo ? 12000 : 5200);
    return () => window.clearTimeout(timeout);
  }, [feedback, feedbackPaused]);

  useEffect(() => {
    if (!feedback?.undo) return;
    const frame = window.requestAnimationFrame(() => undoButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [feedback]);

  function showFeedback(notice: ActionNotice | null): void {
    setFeedbackHovered(false);
    setFeedbackFocused(false);
    setFeedback(notice);
  }

  async function quickAdd() {
    if (!quickText.trim() || isBusy) return;
    setBusyMessage(intakeProgressMessage({ kind: "text", text: quickText }));
    showFeedback(null);
    try {
      const result = await api.quickAdd(quickText);
      setSnapshot(result.snapshot);
      showFeedback({ message: intakeResultMessage(result), tone: result.ok ? "ok" : "warn" });
      if (result.ok) {
        setQuickText("");
        setQuickAddOpen(false);
      }
    } catch (error) {
      showFeedback({ message: formatOperationError(error, "识别失败"), tone: "warn" });
    } finally {
      setBusyMessage("");
    }
  }

  async function undoLastAction(): Promise<void> {
    if (!feedback?.undo || undoing) return;
    setUndoing(true);
    try {
      await feedback.undo.run();
      showFeedback({ message: feedback.undo.doneMessage, tone: "ok" });
    } catch {
      showFeedback({ message: "撤销失败，请到控制中心检查事项。", tone: "warn" });
    } finally {
      setUndoing(false);
    }
  }

  const overviewParts = [
    surface.counts.overdue ? `${surface.counts.overdue} 项已逾期` : "",
    surface.counts.today ? `${surface.counts.today} 项今天截止` : "",
    surface.counts.upcoming + surface.counts.later ? `${surface.counts.upcoming + surface.counts.later} 项接下来` : "",
  ].filter(Boolean);

  return (
    <main className="schedule-shell popover-shell">
      <section className="schedule-panel" aria-busy={isBusy || undoing}>
        <header
          className={`panel-head ${api.platform === "win32" ? "schedule-drag-handle" : ""} ${movingSchedule ? "dragging" : ""}`}
          onPointerDown={startScheduleDrag}
          onPointerMove={moveScheduleDrag}
          onPointerUp={finishScheduleDrag}
          onPointerCancel={finishScheduleDrag}
          onLostPointerCapture={finishScheduleDrag}
        >
          <div>
            <p>Chroni</p>
            <h1>日程</h1>
          </div>
          <div className="panel-actions">
            <button className="schedule-manage" type="button" onClick={() => void api.openControlCenter({ tab: "schedule" }).catch((error) => showFeedback({ message: formatOperationError(error, "暂时无法打开控制中心"), tone: "warn" }))}>管理</button>
            <button className="icon-btn quiet" type="button" onClick={() => void api.showSchedule(false).catch((error) => showFeedback({ message: formatOperationError(error, "暂时无法收起日程"), tone: "warn" }))} title="收起日程" aria-label="收起日程"><UiIcon name="close" /></button>
          </div>
        </header>
        <p className={`schedule-overview ${surface.counts.overdue ? "urgent" : ""}`} aria-label="日程概览">
          {overviewParts.length ? overviewParts.join(" · ") : "当前没有待处理事项"}
        </p>
        {quickAddOpen ? (
          <form className="quick-add schedule-quick-add" onSubmit={(event) => { event.preventDefault(); void quickAdd(); }}>
            <input
              ref={quickAddInputRef}
              value={quickText}
              disabled={isBusy}
              aria-label="快速添加日程"
              onChange={(event) => setQuickText(event.target.value)}
              placeholder="例如：明晚 8 点交课程报告"
            />
            <button className="quick-add-submit" type="submit" disabled={isBusy || !quickText.trim()} aria-label="添加日程"><UiIcon name="add" /></button>
            <button className="quick-add-cancel" type="button" disabled={isBusy} onClick={closeQuickAdd} aria-label="取消添加"><UiIcon name="close" /></button>
          </form>
        ) : (
          <button className="schedule-add-trigger" type="button" onClick={() => setQuickAddOpen(true)}><span><UiIcon name="add" /></span>添加日程</button>
        )}
        {busyMessage && <p className="inline-feedback info" role="status" aria-live="polite">{busyMessage}</p>}
        {feedback && (
          <div
            className={`inline-feedback action-feedback ${feedback.tone}`}
            role={feedback.tone === "warn" ? "alert" : "status"}
            aria-live="polite"
            onMouseEnter={() => setFeedbackHovered(true)}
            onMouseLeave={() => setFeedbackHovered(false)}
            onFocusCapture={() => setFeedbackFocused(true)}
            onBlurCapture={() => setFeedbackFocused(false)}
          >
            <span>{feedback.message}</span>
            {feedback.undo && <button ref={undoButtonRef} type="button" disabled={undoing} onClick={() => void undoLastAction()}>{undoing ? "撤销中" : "撤销"}</button>}
          </div>
        )}
        {surface.groups.length ? (
          <div className="schedule-groups">
            {surface.groups.map((group) => (
              <section className={`schedule-group bucket-${group.key}`} key={group.key} aria-labelledby={`schedule-group-${group.key}`}>
                <header className="schedule-group-head" id={`schedule-group-${group.key}`}>
                  <span>{group.label}</span>
                  <b>{group.items.length}</b>
                </header>
              <DdlList items={group.items} plans={snapshot.taskPlans} setSnapshot={setSnapshot} compact minimal onAction={showFeedback} ariaLabel={`${group.label}日程`} />
              </section>
            ))}
          </div>
        ) : (
          <div className="empty schedule-empty" role="status">{surface.emptyMessage}</div>
        )}
        {surface.hiddenParts.length > 0 && (
          <button className="schedule-hidden-summary" type="button" onClick={() => void api.openControlCenter({ tab: "schedule" }).catch((error) => showFeedback({ message: formatOperationError(error, "暂时无法打开全部日程"), tone: "warn" }))}>
            <span>另有 {surface.hiddenParts.join(" · ")}</span>
            <b>查看全部</b>
          </button>
        )}
      </section>
    </main>
  );
}

function ControlCenter({ snapshot, setSnapshot }: ViewProps) {
  const [tab, setTab] = useState<ControlTab>("daily");
  const [plannerDate, setPlannerDate] = useState(() => dailyDateKey(new Date()));
  const [reviewDate, setReviewDate] = useState(() => dailyDateKey(new Date()));
  const [navigation, setNavigation] = useState<{ route: ChroniControlRoute; sequence: number }>({ route: {}, sequence: 0 });
  const pendingCount = snapshot.items.filter((item) => !item.completed).length;
  const today = new Date();
  const todayKey = dailyDateKey(today);
  const todayDailyCount = snapshot.dailyTasks.filter((task) => !task.dismissed && dailyTaskOccursOn(task, today) && !task.completedDates.includes(todayKey)).length;
  const clarificationCount = snapshot.clarifications.filter((item) => item.status === "pending" && item.required).length;
  useEffect(() => api.onControlNavigate((route) => {
    if (route.tab === "agent") setTab("schedule");
    else if (route.tab) setTab(route.tab);
    else if (route.taskId || route.focus === "clarifications") setTab("schedule");
    setNavigation((current) => ({ route, sequence: current.sequence + 1 }));
  }), []);
  function selectTab(next: ControlTab): void {
    setTab(next);
    if (next === "schedule") setNavigation((current) => ({ route: {}, sequence: current.sequence + 1 }));
  }
  return (
    <main className="control-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol" aria-hidden="true">
            <svg viewBox="0 0 36 36">
              <path className="brand-symbol-rails" d="M7 5.5h22M7 30.5h22" />
              <path className="brand-symbol-flow" d="M10 6c0 6.3 8 6.6 8 12s-8 5.7-8 12M26 6c0 6.3-8 6.6-8 12s8 5.7 8 12" />
              <circle className="brand-symbol-point" cx="18" cy="18" r="2.15" />
            </svg>
          </span>
          <div>
            <h1>Chroni</h1>
            <p>智能日程助手</p>
          </div>
        </div>
        <nav className="sidebar-primary" aria-label="主要功能">
          <button title="今日执行" className={tab === "daily" ? "active" : ""} aria-current={tab === "daily" ? "page" : undefined} onClick={() => selectTab("daily")}><UiIcon name="calendar" /><span>今日执行</span></button>
          <button title="每日回顾" className={tab === "review" ? "active" : ""} aria-current={tab === "review" ? "page" : undefined} onClick={() => selectTab("review")}><UiIcon name="review" /><span>每日回顾</span></button>
          <button title="学习任务" className={tab === "missions" ? "active" : ""} aria-current={tab === "missions" ? "page" : undefined} onClick={() => selectTab("missions")}><UiIcon name="tasks" /><span>学习任务</span></button>
          <button title="智能整理" className={tab === "schedule" ? "active" : ""} aria-current={tab === "schedule" ? "page" : undefined} onClick={() => selectTab("schedule")}><UiIcon name="spark" /><span>智能整理</span></button>
        </nav>
        <nav className="sidebar-utility" aria-label="设置与状态">
          <button title="偏好设置" className={tab === "preferences" ? "active" : ""} aria-current={tab === "preferences" ? "page" : undefined} onClick={() => selectTab("preferences")}><UiIcon name="settings" /><span>偏好设置</span></button>
          <button title="运行状态" className={tab === "services" ? "active" : ""} aria-current={tab === "services" ? "page" : undefined} onClick={() => selectTab("services")}><UiIcon name="clock" /><span>运行状态</span></button>
        </nav>
        <div className="sidebar-foot">
          <span>{todayDailyCount ? `今日 ${todayDailyCount} 项待完成` : "今日已清"}{pendingCount ? ` · ${pendingCount} 项进行中` : ""}{clarificationCount ? ` · ${clarificationCount} 项待确认` : ""}</span>
        </div>
      </aside>
      <section className="content">
        {tab === "missions" && <LearningMissionWorkspace snapshot={snapshot} setSnapshot={setSnapshot} />}
        {tab === "daily" && <DailyPlanner snapshot={snapshot} setSnapshot={setSnapshot} initialDate={plannerDate} onOpenSources={() => selectTab("schedule")} onOpenReview={(date) => { setPlannerDate(date); setReviewDate(date); selectTab("review"); }} />}
        {tab === "review" && <DailyReviewWorkspace snapshot={snapshot} setSnapshot={setSnapshot} initialDate={reviewDate} onOpenPlanner={(date) => { setPlannerDate(date); selectTab("daily"); }} />}
        {tab === "schedule" && <CorrectionPane snapshot={snapshot} setSnapshot={setSnapshot} navigation={navigation} />}
        {tab === "agent" && <AgentPane snapshot={snapshot} setSnapshot={setSnapshot} />}
        {tab === "preferences" && <PreferencesPane preferences={snapshot.preferences} services={snapshot.services} setSnapshot={setSnapshot} />}
        {tab === "services" && <ServicesPane snapshot={snapshot} setSnapshot={setSnapshot} />}
      </section>
    </main>
  );
}

function DemoDataTools({ setSnapshot }: Pick<ViewProps, "setSnapshot">) {
  const [status, setStatus] = useState<SampleDataStatus | null>(null);
  const [busy, setBusy] = useState<SampleDataScenario | "reset" | "clear" | "">("");
  const [feedback, setFeedback] = useState("");
  const scenarios: Array<{ id: SampleDataScenario; title: string; summary: string }> = [
    { id: "clear", title: "完整课程任务", summary: "载入包含交付物、里程碑、时间块与产出证据的示例。" },
    { id: "clarification", title: "待补充截止时间", summary: "载入仅需确认关键日期的示例，检查主动追问流程。" },
    { id: "conflict", title: "多来源时间冲突", summary: "载入存在不同截止时间证据的示例，检查人工确认边界。" },
  ];

  useEffect(() => {
    let active = true;
    void api.getSampleDataStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch((error) => { if (active) setFeedback(formatOperationError(error, "无法读取示例数据状态")); });
    return () => { active = false; };
  }, []);

  async function loadScenario(scenario: SampleDataScenario): Promise<void> {
    if (busy) return;
    setBusy(scenario);
    setFeedback("");
    try {
      const result = await api.loadSampleData(scenario);
      setStatus(result.status);
      setSnapshot(result.snapshot);
      setFeedback(result.message);
    } catch (error) {
      setFeedback(formatOperationError(error, "示例数据加载失败"));
    } finally {
      setBusy("");
    }
  }

  async function resetDemo(): Promise<void> {
    if (busy) return;
    setBusy("reset");
    setFeedback("");
    try {
      const result = await api.resetSampleData();
      setStatus(result.status);
      setSnapshot(result.snapshot);
      setFeedback("示例数据已恢复到初始状态。");
    } catch (error) {
      setFeedback(formatOperationError(error, "示例数据重置失败"));
    } finally {
      setBusy("");
    }
  }

  async function clearDemo(): Promise<void> {
    if (busy) return;
    setBusy("clear");
    setFeedback("");
    try {
      const result = await api.clearSampleData();
      setStatus(result.status);
      setSnapshot(result.snapshot);
      setFeedback(result.message);
    } catch (error) {
      setFeedback(formatOperationError(error, "无法清除示例数据"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="demo-data-tools">
      <p>用隔离的本地数据检查提取、确认、规划和回顾流程，不会覆盖正式数据。</p>
      <div className="demo-data-list">
        {scenarios.map((scenario) => {
          const selected = status?.active && status.scenario === scenario.id;
          return (
            <div className={selected ? "selected" : ""} key={scenario.id}>
              <span><b>{scenario.title}</b><small>{scenario.summary}</small></span>
              <button className="secondary slim" type="button" disabled={!!busy} onClick={() => void loadScenario(scenario.id)}>{busy === scenario.id ? "准备中" : selected ? "重新载入" : "载入"}</button>
            </div>
          );
        })}
      </div>
      {status?.active && (
        <div className="demo-data-actions">
          <button className="secondary slim" type="button" disabled={!!busy} onClick={() => void resetDemo()}>{busy === "reset" ? "重置中" : "重置示例"}</button>
          <button className="danger slim" type="button" disabled={!!busy} onClick={() => void clearDemo()}>{busy === "clear" ? "清除中" : "退出示例环境"}</button>
        </div>
      )}
      {feedback && <p className="inline-feedback" role="status">{feedback}</p>}
    </div>
  );
}

function AgentPane({ snapshot, setSnapshot }: ViewProps) {
  const latest = snapshot.agent.latestRun;
  const dashboard = buildAgentDashboard(latest);
  const [memoryDraft, setMemoryDraft] = useState<AgentMemory>({ ...snapshot.agent.memory });
  const [memoryDirty, setMemoryDirty] = useState(false);
  const [busyAction, setBusyAction] = useState<"run" | "memory" | "export" | "evidence" | "">("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!memoryDirty) setMemoryDraft({ ...snapshot.agent.memory });
  }, [memoryDirty, snapshot.agent.memory]);

  function patchMemory(patch: Partial<AgentMemory>): void {
    setMemoryDraft((current) => ({ ...current, ...patch }));
    setMemoryDirty(true);
    setFeedback("");
  }

  async function runInspection(): Promise<void> {
    if (busyAction) return;
    setBusyAction("run");
    setFeedback("");
    try {
      const next = await api.runDeadlineAgent();
      setSnapshot(next);
      setFeedback("已完成今日 Agent 巡检。");
    } catch (error) {
      setFeedback(formatOperationError(error, "Agent 巡检失败"));
    } finally {
      setBusyAction("");
    }
  }

  async function saveMemory(): Promise<void> {
    if (busyAction) return;
    setBusyAction("memory");
    setFeedback("");
    try {
      const next = await api.updateAgentMemory(memoryDraft);
      setSnapshot(next);
      setMemoryDirty(false);
      setFeedback("规划偏好已保存。");
    } catch (error) {
      setFeedback(formatOperationError(error, "规划偏好未能保存"));
    } finally {
      setBusyAction("");
    }
  }

  async function exportIcs(): Promise<void> {
    if (busyAction) return;
    setBusyAction("export");
    setFeedback("");
    try {
      const result = await api.exportAgentIcs();
      setFeedback(`已导出 ${result.itemCount} 条日程，文件保存在本地导出目录。`);
    } catch (error) {
      setFeedback(formatOperationError(error, "ICS 导出失败"));
    } finally {
      setBusyAction("");
    }
  }

  async function exportEvidence(): Promise<void> {
    if (busyAction) return;
    setBusyAction("evidence");
    setFeedback("");
    try {
      const result = await api.exportAgentEvidence();
      setFeedback(`脱敏证据已导出为 JSON 与 Markdown，校验值 ${result.integritySha256.slice(0, 12)}…`);
    } catch (error) {
      setFeedback(formatOperationError(error, "运行证据导出失败"));
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="pane agent-pane">
      <header className="pane-head agent-head">
        <div>
          <p>Learning Execution Agent</p>
          <h2>把目标推进到下一步</h2>
          <span className="agent-head-copy">结合里程碑、截止时间、风险和可用时间，形成今天能够落实的行动。</span>
        </div>
        {latest && <button className="agent-run" type="button" disabled={!!busyAction} onClick={() => void runInspection()}>
          {busyAction === "run" ? "正在安排…" : "更新今日安排"}
        </button>}
      </header>

      {feedback && <p className={`inline-feedback ${isPositiveFeedback(feedback) ? "ok" : "warn"}`} role="status" aria-live="polite">{feedback}</p>}
      <ClarificationPanel snapshot={snapshot} setSnapshot={setSnapshot} variant="agent" />

      {!latest ? (
        <section className="agent-welcome">
          <span className="agent-welcome-mark" aria-hidden="true">
            <svg viewBox="0 0 36 36">
              <path className="agent-welcome-rails" d="M7 5.5h22M7 30.5h22" />
              <path className="agent-welcome-flow" d="M10 6c0 6.3 8 6.6 8 12s-8 5.7-8 12M26 6c0 6.3-8 6.6-8 12s8 5.7 8 12" />
              <circle className="agent-welcome-point" cx="18" cy="18" r="2.15" />
            </svg>
          </span>
          <div>
            <h3>先看看今天最值得推进的事</h3>
            <p>Chroni 会检查学习任务、里程碑和风险，再把下一步行动安排进你的可用时间。</p>
          </div>
          <button className="primary" type="button" disabled={!!busyAction} onClick={() => void runInspection()}>{busyAction === "run" ? "正在安排…" : "帮我安排今天"}</button>
        </section>
      ) : (
        <>
          <section className={`agent-overview status-${latest.verification.status}`}>
            <div className="agent-overview-copy">
              <span className="agent-overview-kicker"><i aria-hidden="true" /> 已经替你看过一遍</span>
              <h3>{agentStatusLabel(latest.verification.status)}</h3>
              <p>{safeUserMessage(latest.verification.summary, "巡检已完成，请查看下面的任务安排。")}</p>
              <small>{agentTriggerLabel(latest.trigger)} · {formatAgentTime(latest.completedAt)}</small>
              {dashboard.suggestions[0] && <div className="agent-primary-advice"><b>下一步</b><span>{safeUserMessage(dashboard.suggestions[0], "请优先推进风险最高且临近截止的任务。")}</span></div>}
            </div>
            <div className="agent-overview-side">
              <div className="agent-overview-metrics">
                <div><span>高风险</span><b>{dashboard.highRiskCount}</b></div>
                <div><span>今日安排</span><b>{formatAgentMinutes(latest.plan.plannedMinutes)}</b></div>
                <div><span>已排入计划</span><b>{dashboard.coveragePercent}%</b></div>
              </div>
              <div className="agent-coverage" aria-label={`已排入计划 ${dashboard.coveragePercent}%`}>
                <span style={{ width: `${dashboard.coveragePercent}%` }} />
              </div>
            </div>
          </section>

          <div className="agent-focus-grid">
            <section className="agent-focus-card">
              <header><div><h3>今天先做这些</h3></div><p>{latest.plan.blocks.length} 个时间段</p></header>
              <div className="agent-block-list">
                {dashboard.todayBlocks.map((block) => (
                  <article className="agent-block-row" key={`${block.taskId}-${block.startAt}`}>
                    <time>{formatAgentClock(block.startAt)}–{formatAgentClock(block.endAt)}</time>
                    <div><b>{block.title}</b><span>{block.allocatedMinutes} 分钟</span></div>
                  </article>
                ))}
                {!dashboard.todayBlocks.length && (
                  dashboard.highRiskCount
                    ? <div className="agent-calm-state"><b>今天尚未排出可执行时间</b><span>高风险任务仍未获得工作时间，请调整今日可用时间或立即手动推进。</span></div>
                    : latest.observation.activeCount
                      ? <div className="agent-calm-state"><b>今天暂未安排工作块</b><span>现有任务暂不需要占用今天的工作时间，可按截止顺序继续推进。</span></div>
                      : <div className="agent-calm-state"><b>今天没有待安排任务</b><span>当前没有需要推进的学习任务。</span></div>
                )}
              </div>
              {latest.plan.blocks.length > dashboard.todayBlocks.length && <p className="agent-more-hint">另有 {latest.plan.blocks.length - dashboard.todayBlocks.length} 个时间段，可在巡检详情中查看。</p>}
            </section>

            <section className="agent-focus-card attention-card">
              <header><div><h3>需要留意</h3></div><p>{dashboard.highRiskCount} 个高风险</p></header>
              <div className="agent-risk-list">
                {dashboard.attentionTasks.map((item) => (
                  <article className={`agent-risk-row risk-${item.riskLevel}`} key={item.taskId}>
                    <div><b>{item.title}</b><span>{formatAgentTime(item.dueAt)} · {safeUserMessage(item.reasons[0], "需要优先处理")}{item.actionable === false ? " · 等待解除阻塞" : ""}</span></div>
                    <em>{agentRiskLabel(item.riskLevel)}</em>
                  </article>
                ))}
                {!dashboard.attentionTasks.length && <div className="agent-calm-state"><b>暂时没有高风险任务</b><span>当前安排处于可控范围。</span></div>}
              </div>
              {dashboard.highRiskCount > dashboard.attentionTasks.length && <p className="agent-more-hint">其余 {dashboard.highRiskCount - dashboard.attentionTasks.length} 项已收进巡检详情。</p>}
            </section>
          </div>

          <details className="agent-details">
            <summary><span>为什么这样安排</span><small>{latest.trace.length} 个审计步骤 · {dashboard.failedActionCount ? `${dashboard.failedActionCount} 项执行失败` : latest.verification.status === "healthy" ? "执行无异常" : "风险仍待处理"}</small></summary>
            <div className="agent-details-content">
              {dashboard.suggestions.length > 1 && (
                <section className="agent-section">
                  <header className="section-head"><div><h3>其他建议</h3><p>按优先级整理</p></div></header>
                  <ol className="agent-suggestions">{dashboard.suggestions.slice(1).map((suggestion) => <li key={suggestion}>{safeUserMessage(suggestion, "请结合当前剩余时间调整任务安排。")}</li>)}</ol>
                </section>
              )}

              {!!latest.plan.forecastBlocks?.length && (
                <section className="agent-section">
                  <header className="section-head"><div><h3>未来一周预排</h3><p>{latest.plan.forecastBlocks.length} 段 · 会随进度重算</p></div></header>
                  <div className="agent-block-list">
                    {latest.plan.forecastBlocks.map((block) => (
                      <article className="agent-block-row" key={`forecast-${block.taskId}-${block.startAt}`}>
                        <time>{formatAgentTime(block.startAt)}–{formatAgentClock(block.endAt)}</time>
                        <div><b>{block.title}</b><span>{block.allocatedMinutes} 分钟</span></div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <section className="agent-section">
                <header className="section-head"><div><h3>执行记录</h3><p>{dashboard.failedActionCount ? `${dashboard.failedActionCount} 项失败` : "执行步骤无异常"}</p></div></header>
                <div className="agent-action-list">
                  {latest.actions.map((action, index) => <p className={`agent-action action-${action.status}`} key={`${action.tool}-${index}`}><b>{agentToolLabel(action.tool)}</b><span>{agentActionSummary(action.summary, action.status, action.tool)}</span></p>)}
                </div>
              </section>

              <section className="agent-section">
                <header className="section-head"><div><h3>运行轨迹</h3><p>观察 → 规划 → 执行 → 验证</p></div></header>
                <div className="agent-trace">
                  {latest.trace.map((entry) => (
                    <article className={entry.success ? "" : "failed"} key={`${entry.sequence}-${entry.id}`}>
                      <span>{entry.sequence}</span>
                      <div><b>{agentStageLabel(entry.stage)}</b><p>{safeUserMessage(entry.summary, entry.success ? "该步骤已完成。" : "该步骤未完成，已使用安全方案继续。")}</p></div>
                      <time>{formatAgentClock(entry.timestamp)}</time>
                    </article>
                  ))}
                </div>
              </section>

              <div className="agent-run-meta">
                <span>规划方式：<b>{agentPlannerLabel(latest.plan.plannerSource)}</b></span>
                <span>待处理：<b>{latest.observation.activeCount}</b></span>
                <span>未安排：<b>{latest.plan.unplannedTaskIds.length}</b></span>
              </div>
            </div>
          </details>
        </>
      )}

      <details className="agent-details agent-settings advanced-settings">
        <summary><span>工作方式与导出</span><small>工作时间、容量、提醒和规划方式</small></summary>
        <div className="agent-details-content">
        <div className="agent-memory-grid">
          <label>每天可安排（分钟）<input type="number" min="30" max="720" step="30" value={memoryDraft.maxDailyMinutes} onChange={(event) => patchMemory({ maxDailyMinutes: Number(event.target.value) })} /></label>
          <label>开始时间<UiDateTimeField required type="time" value={memoryDraft.workdayStart} onChange={(workdayStart) => patchMemory({ workdayStart })} /></label>
          <label>结束时间<UiDateTimeField required type="time" value={memoryDraft.workdayEnd} onChange={(workdayEnd) => patchMemory({ workdayEnd })} /></label>
          <label>提醒频率<select value={memoryDraft.reminderFrequency} onChange={(event) => patchMemory({ reminderFrequency: event.target.value as AgentMemory["reminderFrequency"] })}><option value="important-only">仅高风险</option><option value="daily">每日</option><option value="off">关闭</option></select></label>
        </div>
        <div className="agent-setting-toggles">
          <Toggle label="自动巡检" checked={memoryDraft.automaticInspectionEnabled} onChange={(value) => patchMemory({ automaticInspectionEnabled: value })} />
          <Toggle label="Agent 规划使用大模型（不影响信息抽取）" checked={memoryDraft.useLlmPlanning} onChange={(value) => patchMemory({ useLlmPlanning: value })} />
        </div>
        <div className="agent-settings-actions">
          <button className="secondary" type="button" disabled={!!busyAction || !memoryDirty} onClick={() => void saveMemory()}>{busyAction === "memory" ? "保存中..." : "保存设置"}</button>
          <button className="secondary" type="button" disabled={!!busyAction} onClick={() => void exportIcs()}>{busyAction === "export" ? "导出中..." : "导出日历文件"}</button>
          <button className="secondary" type="button" disabled={!!busyAction} onClick={() => void exportEvidence()}>{busyAction === "evidence" ? "导出中..." : "导出脱敏运行证据"}</button>
        </div>
        </div>
      </details>
      <details className="agent-details agent-personalization">
        <summary><span>个性化规划</span><small>{snapshot.agent.behaviorMemory.preferences.filter((item) => item.status === "active").length} 条偏好生效</small></summary>
        <div className="agent-details-content"><BehaviorMemoryPane snapshot={snapshot} setSnapshot={setSnapshot} embedded /></div>
      </details>
    </div>
  );
}

function CorrectionPane({ snapshot, setSnapshot, navigation }: ViewProps & { navigation: { route: ChroniControlRoute; sequence: number } }) {
  const scheduleClock = useScheduleClock();
  const [manual, setManual] = useState("");
  const [feedback, setFeedback] = useState("");
  const [itemFilter, setItemFilter] = useState<"active" | "completed" | "all">("active");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const manualInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileOperationRef = useRef(false);
  const clarificationRef = useRef<HTMLDivElement>(null);
  const isBusy = !!busyMessage;
  const summary = useMemo(() => fullScheduleSummary(snapshot.items, new Date(scheduleClock)), [scheduleClock, snapshot.items]);
  const actionableSummary = useMemo(() => visibleScheduleSummary(snapshot.items, new Date(scheduleClock)), [scheduleClock, snapshot.items]);
  const snoozedCount = summary.active - actionableSummary.active;
  const itemGroups = useMemo(() => buildControlScheduleGroups(snapshot.items, itemFilter, new Date(scheduleClock)), [itemFilter, scheduleClock, snapshot.items]);
  const filteredCount = itemGroups.reduce((count, group) => count + group.items.length, 0);
  const selectedTask = snapshot.items.find((item) => item.id === selectedTaskId);
  const latest = snapshot.agent.latestRun;
  const dashboard = buildAgentDashboard(latest);

  useEffect(() => {
    if (!navigation.sequence) return;
    if (navigation.route.taskId) {
      const target = snapshot.items.find((item) => item.id === navigation.route.taskId);
      if (target) {
        setSelectedTaskId(target.id);
        setFeedback("");
      } else {
        setSelectedTaskId("");
        setFeedback("这条日程可能已经删除，已返回日程列表。");
      }
      return;
    }
    if (navigation.route.focus === "clarifications") {
      setSelectedTaskId("");
      window.requestAnimationFrame(() => {
        clarificationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        clarificationRef.current?.querySelector<HTMLElement>("input, button")?.focus();
      });
      return;
    }
    setSelectedTaskId("");
  }, [navigation.sequence]);

  async function addManual() {
    if (!manual.trim() || isBusy) return;
    setBusyMessage(intakeProgressMessage({ kind: "text", text: manual }));
    setFeedback("");
    try {
      const result = await api.quickAdd(manual);
      await finishIntake(result);
      if (result.ok) setManual("");
    } catch (error) {
      setFeedback(formatOperationError(error, "识别失败"));
    } finally {
      setBusyMessage("");
    }
  }

  async function finishIntake(result: IntakeResult): Promise<void> {
    setSnapshot(result.snapshot);
    const intakeMessage = intakeResultMessage(result);
    if (!result.ok || !result.created.length) {
      setFeedback(intakeMessage);
      return;
    }
    setBusyMessage("正在整理今日安排…");
    try {
      setSnapshot(await api.runDeadlineAgent());
      setFeedback(`${intakeMessage} 今日安排已同步更新。`);
    } catch (error) {
      setFeedback(`${intakeMessage} ${formatOperationError(error, "今日安排稍后会自动更新")}`);
    }
  }

  async function runOrganizer(): Promise<void> {
    if (isBusy) return;
    setBusyMessage("正在检查任务与可用时间…");
    setFeedback("");
    try {
      setSnapshot(await api.runDeadlineAgent());
      setFeedback("今日安排已更新，手动调整过的时间保持不变。");
    } catch (error) {
      setFeedback(formatOperationError(error, "暂时无法更新今日安排"));
    } finally {
      setBusyMessage("");
    }
  }

  async function extractFiles(fileList: FileList | null) {
    if (fileOperationRef.current) {
      setFeedback("上一批文件仍在处理中，请稍候。");
      return;
    }
    fileOperationRef.current = true;
    setBusyMessage("正在读取文件…");
    setFeedback("");
    try {
      const files = await filesFromFileList(fileList);
      if (!files.length) {
        setFeedback("没有收到可读取的文件。");
        return;
      }
      const payload: IntakePayload = { kind: "files", files };
      setBusyMessage(intakeProgressMessage(payload));
      await finishIntake(await api.intake(payload));
    } catch (error) {
      setFeedback(formatOperationError(error, "文件处理失败"));
    } finally {
      fileOperationRef.current = false;
      setBusyMessage("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function previewDroppedFiles(event: React.DragEvent) {
    event.preventDefault();
    setDraggingFiles(false);
    await extractFiles(event.dataTransfer.files);
  }

  if (selectedTask) return <TaskDetailPane task={selectedTask} snapshot={snapshot} setSnapshot={setSnapshot} onBack={() => setSelectedTaskId("")} />;

  return (
    <div className="pane smart-workspace">
      <header className="pane-head smart-workspace-head">
        <div>
          <p>智能整理 · {formatCalendarHeading(scheduleClock)}</p>
          <h2>收集与安排</h2>
        </div>
        <button className="smart-organize-button" type="button" disabled={isBusy} onClick={() => void runOrganizer()}><UiIcon name="spark" />{busyMessage.includes("今日安排") || busyMessage.includes("可用时间") ? "整理中" : "更新今日安排"}</button>
      </header>
      <div className="summary-line smart-summary-line">
        <span>{summary.active} 待处理</span>
        <span className={actionableSummary.overdue ? "alert" : ""}>{actionableSummary.overdue} 逾期</span>
        <span>{actionableSummary.today} 今日</span>
        {snoozedCount > 0 && <span>{snoozedCount} 稍后</span>}
      </div>
      <section className="smart-intake" aria-label="添加材料">
        <div className="manual-row smart-manual-row">
          <input
            ref={manualInputRef}
            value={manual}
            disabled={isBusy}
            aria-label="快速添加日程"
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addManual();
            }}
            placeholder="输入一句话，例如：明天 18:00 交实验报告"
          />
          <button type="button" disabled={isBusy || !manual.trim()} onClick={() => void addManual()}><UiIcon name="spark" />整理</button>
        </div>
        <div
          className={`upload-box smart-upload-box ${draggingFiles ? "dragging" : ""} ${isBusy ? "busy" : ""}`}
          aria-busy={isBusy}
          onDragOver={(event) => {
            event.preventDefault();
            if (!draggingFiles && !isBusy) setDraggingFiles(true);
          }}
          onDragLeave={() => setDraggingFiles(false)}
          onDrop={(event) => void previewDroppedFiles(event)}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            disabled={isBusy}
            onChange={(event) => {
              const input = event.currentTarget;
              void extractFiles(input.files).finally(() => { input.value = ""; });
            }}
            accept={acceptedFileTypes()}
          />
          <div className="upload-copy">
            <span className="smart-upload-icon" aria-hidden="true"><UiIcon name="inbox" /></span>
            <div><b>{draggingFiles ? "松开并自动整理" : "拖入材料"}</b><p>文档、表格、PDF 与图片</p></div>
          </div>
          <div className="upload-actions">
            <button type="button" disabled={isBusy} onClick={() => fileInputRef.current?.click()}>选择文件</button>
          </div>
        </div>
      </section>
      {busyMessage && <p className="inline-feedback info" role="status" aria-live="polite">{busyMessage}</p>}
      {feedback && <p className={`inline-feedback ${isPositiveFeedback(feedback) ? "ok" : "warn"}`} role={isPositiveFeedback(feedback) ? "status" : "alert"} aria-live="polite">{feedback}</p>}
      <div ref={clarificationRef}><ClarificationPanel snapshot={snapshot} setSnapshot={setSnapshot} /></div>
      <section className="smart-agent-result" aria-label="智能整理状态">
        <header><div><p>{latest ? `更新于 ${formatAgentTime(latest.completedAt)}` : "尚未生成今日安排"}</p><h3>{latest ? agentStatusLabel(latest.verification.status) : "准备就绪"}</h3></div>{latest && <span>{agentTriggerLabel(latest.trigger)}</span>}</header>
        {latest ? <><div className="smart-agent-metrics"><div><b>{dashboard.todayBlocks.length}</b><span>今日时间块</span></div><div><b>{formatAgentMinutes(latest.plan.plannedMinutes)}</b><span>已安排</span></div><div><b>{dashboard.highRiskCount}</b><span>高风险</span></div></div>{dashboard.suggestions[0] && <p className="smart-agent-advice"><UiIcon name="spark" /><span>{safeUserMessage(dashboard.suggestions[0], "优先推进临近截止且风险较高的任务。")}</span></p>}</> : <p className="smart-agent-empty">添加任务或材料后，今日安排会在这里更新。</p>}
      </section>
      <div className="list-toolbar">
        <div>
          <h3>已整理任务</h3>
          <p>{filteredCount} 条</p>
        </div>
        <div className="segmented">
          <button className={itemFilter === "active" ? "active" : ""} type="button" aria-pressed={itemFilter === "active"} onClick={() => setItemFilter("active")}>待处理</button>
          <button className={itemFilter === "completed" ? "active" : ""} type="button" aria-pressed={itemFilter === "completed"} onClick={() => setItemFilter("completed")}>已完成</button>
          <button className={itemFilter === "all" ? "active" : ""} type="button" aria-pressed={itemFilter === "all"} onClick={() => setItemFilter("all")}>全部</button>
        </div>
      </div>
      {itemGroups.length ? (
        <div className="control-schedule-groups">
          {itemGroups.map((group) => (
            <section className={`control-schedule-group group-${group.key}`} key={group.key} aria-labelledby={`control-group-${group.key}`}>
              <header className="control-group-head" id={`control-group-${group.key}`}>
                <div><h4>{group.label}</h4><span>{group.hint}</span></div>
                <b>{group.items.length}</b>
              </header>
              <DdlList
                items={group.items}
                plans={snapshot.taskPlans}
                sources={snapshot.sources}
                setSnapshot={setSnapshot}
                editable
                ariaLabel={`${group.label}日程`}
                onAction={(notice) => setFeedback(notice.message)}
                onOpenTask={setSelectedTaskId}
              />
            </section>
          ))}
        </div>
      ) : (
        <div className="empty">{itemFilter === "completed" ? "完成一件事情后，记录会留在这里。" : "眼下没有待处理的截止事项，可以安心做手头的事。"}</div>
      )}
      {!!snapshot.sources.length && <details className="smart-source-history"><summary><span>最近导入</span><b>{snapshot.sources.length}</b></summary><SourceHistory sources={snapshot.sources} setSnapshot={setSnapshot} /></details>}
    </div>
  );
}

function PreferencesPane({ preferences, services, setSnapshot }: { preferences: ChroniPreferences; services: ServiceStatus; setSnapshot: ViewProps["setSnapshot"] }) {
  const [llmDraft, setLlmDraft] = useState<Pick<ChroniLlmSettings, "mode" | "baseUrl" | "model" | "apiKey">>({
    mode: preferences.llm.mode,
    baseUrl: preferences.llm.baseUrl,
    model: preferences.llm.model,
    apiKey: "",
  });
  const [llmDirty, setLlmDirty] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmFeedback, setLlmFeedback] = useState<{ message: string; tone: "ok" | "warn" } | null>(null);
  const [hotkeyDraft, setHotkeyDraft] = useState(preferences.hotkey);
  const [hotkeyDirty, setHotkeyDirty] = useState(false);
  const [hotkeyBusy, setHotkeyBusy] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<{ message: string; tone: "ok" | "warn" } | null>(null);

  useEffect(() => {
    if (llmDirty) return;
    setLlmDraft({
      mode: preferences.llm.mode,
      baseUrl: preferences.llm.baseUrl,
      model: preferences.llm.model,
      apiKey: "",
    });
  }, [llmDirty, preferences.llm.baseUrl, preferences.llm.mode, preferences.llm.model]);

  useEffect(() => {
    if (!hotkeyDirty) setHotkeyDraft(preferences.hotkey);
  }, [hotkeyDirty, preferences.hotkey]);

  async function patch(next: ChroniPreferencesPatch, success = "设置已保存。"): Promise<ChroniSnapshot | null> {
    try {
      const updated = await api.updatePreferences(next);
      setSnapshot(updated);
      setSettingsFeedback({ message: success, tone: "ok" });
      return updated;
    } catch (error) {
      setSettingsFeedback({ message: formatOperationError(error, "设置未能保存"), tone: "warn" });
      return null;
    }
  }

  async function saveHotkey(): Promise<void> {
    if (hotkeyBusy || !hotkeyDirty) return;
    setHotkeyBusy(true);
    const updated = await patch({ hotkey: hotkeyDraft.trim() }, "快捷键已保存。");
    if (updated) {
      const registrationFailed = updated.companion.state === "confused" && updated.companion.bubble.includes("快捷键") && updated.companion.bubble.includes("注册失败");
      setSettingsFeedback(registrationFailed
        ? { message: updated.companion.bubble, tone: "warn" }
        : { message: hotkeyDraft.trim() ? "快捷键已保存并生效。" : "快捷键已关闭。", tone: "ok" });
      if (!registrationFailed) setHotkeyDirty(false);
    }
    setHotkeyBusy(false);
  }

  function updateLlmDraft(field: keyof typeof llmDraft, value: string): void {
    setLlmDraft((current) => ({ ...current, [field]: value }));
    setLlmDirty(true);
    setLlmFeedback(null);
  }

  function changeLlmMode(mode: ChroniLlmSettings["mode"]): void {
    setLlmDraft((current) => ({
      mode,
      baseUrl: mode === "managed" ? CHRONI_MANAGED_LLM_BASE_URL : CHRONI_CUSTOM_LLM_BASE_URL,
      model: mode === "managed" ? CHRONI_MANAGED_LLM_MODEL : CHRONI_CUSTOM_LLM_MODEL,
      apiKey: current.mode === mode ? current.apiKey : "",
    }));
    setLlmDirty(true);
    setLlmFeedback(null);
  }

  async function saveAndTestLlm(): Promise<void> {
    if (llmBusy) return;
    setLlmBusy(true);
    setLlmFeedback(null);
    try {
      const llmPatch = {
        mode: llmDraft.mode,
        baseUrl: llmDraft.baseUrl,
        model: llmDraft.model,
        ...(llmDraft.apiKey.trim()
          ? { apiKey: llmDraft.apiKey }
          : llmDraft.mode !== preferences.llm.mode ? { apiKey: "" } : {}),
      };
      const snapshot = await api.updatePreferences({ llm: llmPatch });
      setSnapshot(snapshot);
      setLlmDirty(false);
      const result = await api.testLlmConnection(snapshot.preferences.llm);
      setLlmFeedback({ message: safeUserMessage(result.message, result.ok ? "模型连接正常。" : "模型连接未通过，请检查配置。"), tone: result.ok ? "ok" : "warn" });
    } catch (error) {
      setLlmFeedback({ message: formatOperationError(error, "保存或连接测试失败"), tone: "warn" });
    } finally {
      setLlmBusy(false);
    }
  }
  const modelMode = services.model === "ready" ? "LLM 优先" : "本地规则";
  const effectiveLlmEnabled = services.modelEnabledOverride ?? preferences.llm.enabled;
  return (
    <div className="pane narrow settings-pane">
      <header className="pane-head">
        <div>
          <p>桌宠、提醒、快捷键与智能模型</p>
          <h2>偏好设置</h2>
        </div>
      </header>
      <section className="settings-group companion-settings-group">
        <div>
          <h3>桌宠</h3>
          <p>桌宠负责接收拖拽、短反馈和唤起日程。</p>
        </div>
        <Toggle label="显示桌宠" checked={preferences.companionEnabled} onChange={(value) => void patch({ companionEnabled: value }, value ? "桌宠已显示。" : "桌宠已隐藏。") } />
      </section>
      <section className="settings-group">
        <div>
          <h3>提醒</h3>
          <p>临近关键节点时提醒，勿扰期间只更新状态不打扰。</p>
        </div>
        <Toggle label="开启提醒" checked={preferences.remindersEnabled} onChange={(value) => void patch({ remindersEnabled: value }, value ? "提醒已开启。" : "提醒已关闭。") } />
        <Toggle label="勿扰时间" checked={preferences.quietHoursEnabled} onChange={(value) => void patch({ quietHoursEnabled: value }, value ? "勿扰时间已开启。" : "勿扰时间已关闭。") } />
        <div className="field-grid">
          <label>开始<UiDateTimeField required type="time" value={preferences.quietHoursStart} onChange={(quietHoursStart) => void patch({ quietHoursStart })} /></label>
          <label>结束<UiDateTimeField required type="time" value={preferences.quietHoursEnd} onChange={(quietHoursEnd) => void patch({ quietHoursEnd })} /></label>
        </div>
      </section>
      <section className="settings-group">
        <div>
          <h3>快捷键</h3>
          <p>用于快速唤起侧边日程，不影响系统其他输入。</p>
        </div>
        <label className="text-field compact-field">唤起日程<input value={hotkeyDraft} disabled={hotkeyBusy} onChange={(event) => { setHotkeyDraft(event.target.value); setHotkeyDirty(event.target.value !== preferences.hotkey); setSettingsFeedback(null); }} onKeyDown={(event) => {
          if (event.key === "Enter") void saveHotkey();
          if (event.key === "Escape") { setHotkeyDraft(preferences.hotkey); setHotkeyDirty(false); setSettingsFeedback(null); }
        }} /></label>
        <div className="hotkey-actions">
          <button className="primary" type="button" disabled={hotkeyBusy || !hotkeyDirty} onClick={() => void saveHotkey()}>{hotkeyBusy ? "保存中..." : "保存快捷键"}</button>
          {hotkeyDirty && <button className="secondary" type="button" disabled={hotkeyBusy} onClick={() => { setHotkeyDraft(preferences.hotkey); setHotkeyDirty(false); setSettingsFeedback(null); }}>取消修改</button>}
        </div>
      </section>
      <section className="settings-group">
        <div className="section-head">
          <div>
            <h3>高级</h3>
            <p>配置后，输入文字、文件解析与 OCR 结果会逐来源交给大模型理解；模型不可用时使用本地规则继续处理。</p>
          </div>
          <span className="mode-chip">{modelMode}</span>
        </div>
        <Toggle
          label={services.modelEnabledOverride === undefined
            ? "启用智能模型"
            : "启用智能模型（由环境变量控制）"}
          checked={effectiveLlmEnabled}
          disabled={services.modelEnabledOverride !== undefined}
          onChange={(value) => void patch({ llm: { enabled: value } }, value ? "智能模型已开启。" : "智能模型已关闭。")}
        />
        <details className="advanced-settings">
          <summary>智能模型服务</summary>
          <div className="llm-mode-picker" aria-label="模型连接方式">
            <button type="button" className={llmDraft.mode === "managed" ? "active" : ""} onClick={() => changeLlmMode("managed")}>Chroni 智能服务</button>
            <button type="button" className={llmDraft.mode === "custom" ? "active" : ""} onClick={() => changeLlmMode("custom")}>自定义 API</button>
          </div>
          {llmDraft.mode === "managed" ? (
            <>
              <div className="managed-llm-note">
                <strong>Chroni 托管智能服务 · DeepSeek V4 Flash</strong>
                <span>下载后默认可用，无需填写 API Key 或服务访问码。主密钥只保存在 Chroni 服务端，安装包不包含任何模型密钥。</span>
              </div>
            </>
          ) : (
            <>
              <label className="text-field">Base URL<input value={llmDraft.baseUrl} placeholder="https://api.deepseek.com" onChange={(event) => updateLlmDraft("baseUrl", event.target.value)} /></label>
              <label className="text-field">模型<input value={llmDraft.model} placeholder="deepseek-v4-flash" onChange={(event) => updateLlmDraft("model", event.target.value)} /></label>
              <label className="text-field">API Key<input type="password" value={llmDraft.apiKey} placeholder={services.model === "ready" && preferences.llm.mode === "custom" ? "已配置，输入新值可替换" : "sk-..."} autoComplete="off" onChange={(event) => updateLlmDraft("apiKey", event.target.value)} /></label>
            </>
          )}
          <div className="llm-settings-actions">
            <button className="primary" type="button" disabled={llmBusy} onClick={() => void saveAndTestLlm()}>
              {llmBusy ? "正在连接..." : llmDirty ? "保存并测试" : "测试连接"}
            </button>
            {llmDirty && <span>有未保存的修改</span>}
          </div>
          {llmFeedback && <p className={`llm-feedback ${llmFeedback.tone}`} role="status" aria-live="polite">{llmFeedback.message}</p>}
          {services.modelEnvironmentConfigured && <p className="llm-feedback ok" role="status">检测到 `.env` 或系统环境变量中的 LLM 配置；环境变量优先，API Key 不会回填到界面。</p>}
        </details>
      </section>
      {settingsFeedback && <p className={`inline-feedback ${settingsFeedback.tone}`} role={settingsFeedback.tone === "warn" ? "alert" : "status"} aria-live="polite">{settingsFeedback.message}</p>}
    </div>
  );
}

function ServicesPane({ snapshot, setSnapshot }: ViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ChroniUpdateStatus | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; tone: "ok" | "warn" } | null>(null);
  const unavailableCount = [snapshot.services.parser, snapshot.services.ocr, snapshot.services.model].filter((state) => state === "unavailable").length;
  const storageNeedsAttention = snapshot.services.storage !== "ready";
  const attentionCount = unavailableCount + (storageNeedsAttention ? 1 : 0);
  const storageSummary = snapshot.services.storage === "read-only"
    ? "本地数据已进入只读保护，本次修改不会写入；请打开数据位置检查磁盘权限和损坏文件备份。"
    : snapshot.services.storage === "reset"
      ? "本地状态文件无法恢复，已安全重建；请在数据位置检查保留的损坏文件副本。"
      : snapshot.services.storage === "recovered"
        ? "本地数据已安全恢复，建议检查诊断说明和自动备份。"
        : "";
  useEffect(() => {
    let active = true;
    void api.getUpdateStatus().then((status) => {
      if (active) setUpdateStatus(status);
    }).catch(() => undefined);
    const unsubscribe = api.onUpdateStatus((status) => {
      if (active) setUpdateStatus(status);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function checkForUpdates() {
    setFeedback(null);
    try {
      const status = await api.checkForUpdates();
      setUpdateStatus(status);
      if (status.phase === "error") setFeedback({ message: status.message, tone: "warn" });
    } catch (error) {
      setFeedback({ message: formatOperationError(error, "暂时无法检查更新"), tone: "warn" });
    }
  }

  async function installUpdate() {
    try {
      await api.installUpdate();
    } catch (error) {
      setFeedback({ message: formatOperationError(error, "暂时无法安装更新"), tone: "warn" });
    }
  }

  async function refreshServices() {
    if (refreshing) return;
    setRefreshing(true);
    setFeedback(null);
    try {
      setSnapshot(await api.getSnapshot());
      setFeedback({ message: "运行状态已更新。", tone: "ok" });
    } catch (error) {
      setFeedback({ message: formatOperationError(error, "暂时无法刷新运行状态"), tone: "warn" });
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <div className="pane narrow service-pane">
      <header className="pane-head">
        <div>
          <p>解析、模型、本地数据与版本</p>
          <h2>运行状态</h2>
        </div>
        <button className="secondary slim" type="button" disabled={refreshing} onClick={() => void refreshServices()}>{refreshing ? "检查中" : "重新检查"}</button>
      </header>
      <p className={`service-summary ${attentionCount ? "warn" : ""}`}>
        {attentionCount ? `${attentionCount} 项需要留意。${storageSummary || "其他可用能力不受影响。"}` : "核心本地能力可用。"}
      </p>
      {feedback && <p className={`inline-feedback ${feedback.tone}`} role={feedback.tone === "warn" ? "alert" : "status"} aria-live="polite">{feedback.message}</p>}
      <div className="service-list">
        <StatusRow label="文本解析" state={snapshot.services.parser} detail="TXT、MD、CSV、JSON、ICS、DOCX、PDF、XLSX 等本地解析" />
        <StatusRow label="图片 OCR" state={snapshot.services.ocr} detail="图片与扫描 PDF 先转为文字，再进入提取流程" />
        <StatusRow label="大模型理解" state={snapshot.services.model} detail="按输入内容理解日程、任务要求、交付物与截止信息，并保留来源证据" />
        <StatusRow label="本地数据" state={snapshot.services.storage} detail={snapshot.services.storageDiagnostic ? safeUserMessage(snapshot.services.storageDiagnostic, "本地数据已进入保护状态，请打开数据位置检查备份。") : "日程、任务、产出证据、来源和偏好保存到本机应用数据目录"} />
        <StatusRow label="隐私状态" state="ready" detail={safeUserMessage(snapshot.services.privacy, "敏感配置仅保存在本机。") } />
      </div>
      <p className="service-policy-links">
        <a href="https://getchroni.zeabur.app/privacy.html" target="_blank" rel="noreferrer">查看隐私说明</a>
        <a href="https://github.com/miracle121388-a11y/chroni/security" target="_blank" rel="noreferrer">安全与漏洞报告</a>
      </p>
      {updateStatus && (
        <section className="update-panel" aria-live="polite">
          <div className="update-panel-head">
            <div>
              <p>Chroni 桌面端</p>
              <h3>版本 {updateStatus.currentVersion}</h3>
            </div>
            <span className={`update-phase ${updateStatus.phase}`}>{updatePhaseLabel(updateStatus)}</span>
          </div>
          <p>{updateStatus.message}</p>
          {updateStatus.phase === "downloading" && (
            <progress max="100" value={updateStatus.progressPercent ?? 0} aria-label="更新下载进度" />
          )}
          {!updateStatus.managedByStore && (
            <div className="update-actions">
              <button className="secondary slim" type="button" disabled={updateStatus.phase === "checking" || updateStatus.phase === "downloading"} onClick={() => void checkForUpdates()}>
                {updateStatus.phase === "checking" ? "检查中" : updateStatus.phase === "downloading" ? "下载中" : "检查更新"}
              </button>
              <button className="secondary slim" type="button" onClick={() => void api.openReleases()}>查看 GitHub 发布页</button>
              {updateStatus.phase === "downloaded" && <button className="primary slim" type="button" onClick={() => void installUpdate()}>重启并安装</button>}
            </div>
          )}
        </section>
      )}
      <details className="advanced-settings">
        <summary>排错说明</summary>
        <ul className="notes">{snapshot.services.notes.map((note) => <li key={note}>{safeUserMessage(note, "请检查相关服务配置。")}</li>)}</ul>
      </details>
      <details className="advanced-settings">
        <summary>示例数据工具</summary>
        <DemoDataTools setSnapshot={setSnapshot} />
      </details>
      <details className="advanced-settings legal-notices">
        <summary>开源许可与素材信息</summary>
        <div className="about-project-links">
          <a href="https://github.com/miracle121388-a11y/chroni" target="_blank" rel="noreferrer">Chroni 项目仓库</a>
          <a href="https://github.com/miracle121388-a11y/chroni/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT License</a>
        </div>
        {petAssetMode === "xiaotong" && (
          <section className="third-party-credit" aria-labelledby="xiaotong-credit-heading">
            <h3 id="xiaotong-credit-heading">桌宠素材许可</h3>
            <p>当前桌宠形象基于 XIAOTONG Desktop Pet / 蓝色小嗵，以下原作信息依照素材附加条款保留。</p>
            <div className="xiaotong-about">
              <dl className="xiaotong-details">
                <div><dt>原作版本</dt><dd>v1.0.1</dd></div>
                <div><dt>原作者</dt><dd>WWW.没有COM</dd></div>
                <div><dt>微信 / WeChat</dt><dd>xy12981118</dd></div>
              </dl>
              <figure className="xiaotong-donation">
                <figcaption>支持原作者</figcaption>
                {xiaotongDonationQr && <img src={xiaotongDonationQr} alt="XIAOTONG 原作者捐赠二维码" />}
              </figure>
            </div>
            <p>二维码仅用于向素材原作者自愿赠与；Chroni 不参与收款，赠与不会解锁功能、数字内容或服务。</p>
            <div className="third-party-links">
              <a href="https://github.com/gildingmazzonimo621-design/XIAOTONG-Desktop-pet" target="_blank" rel="noreferrer">原始项目仓库</a>
              <a href="https://github.com/miracle121388-a11y/chroni/blob/main/apps/desktop/third_party/xiaotong/LICENSE" target="_blank" rel="noreferrer">Apache-2.0</a>
              <a href="https://github.com/miracle121388-a11y/chroni/blob/main/apps/desktop/third_party/xiaotong/ADDITIONAL_TERMS.md" target="_blank" rel="noreferrer">附加条款</a>
            </div>
          </section>
        )}
      </details>
      <button className="secondary" type="button" onClick={() => void api.openStorage().then(() => setFeedback({ message: "已在文件管理器中打开本地数据位置。", tone: "ok" })).catch((error) => setFeedback({ message: formatOperationError(error, "暂时无法打开本地数据位置"), tone: "warn" }))}>打开本地数据位置</button>
      <footer className="settings-product-footer">
        <span>Chroni{updateStatus ? ` ${updateStatus.currentVersion}` : ""}</span>
        <a href="https://github.com/miracle121388-a11y/chroni" target="_blank" rel="noreferrer">项目主页</a>
        <a href="https://github.com/miracle121388-a11y/chroni/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">开源许可</a>
      </footer>
    </div>
  );
}

function SourceHistory({ sources, setSnapshot }: { sources: SourceRecord[]; setSnapshot: ViewProps["setSnapshot"] }) {
  const [filter, setFilter] = useState<"all" | SourceRecord["extractionStatus"]>("all");
  const [visibleLimit, setVisibleLimit] = useState(16);
  const stats = sourceStats(sources);
  const filteredSources = sources.filter((source) => filter === "all" || source.extractionStatus === filter);
  const visibleSources = filteredSources.slice(0, visibleLimit);
  function chooseFilter(next: typeof filter): void {
    setFilter(next);
    setVisibleLimit(16);
  }
  if (!sources.length) {
    return (
      <details className="source-history">
        <summary className="section-head">
          <div>
            <h3>来源记录</h3>
            <p>拖拽、上传或文本输入后会保存在这里。</p>
          </div>
        </summary>
        <div className="empty compact-empty">暂无来源记录。</div>
      </details>
    );
  }
  return (
    <details className="source-history">
      <summary className="section-head">
        <div>
          <h3>来源记录</h3>
          <p>{sources.length} 条 · 成功 {stats.success} · 待确认 {stats.pending} · 已存在 {stats.duplicate} · 失败 {stats.failed}</p>
        </div>
      </summary>
      <div className="source-controls">
        <div className="segmented">
          <button className={filter === "all" ? "active" : ""} type="button" onClick={() => chooseFilter("all")}>全部</button>
          <button className={filter === "pending" ? "active" : ""} type="button" onClick={() => chooseFilter("pending")}>待确认</button>
          <button className={filter === "failed" ? "active" : ""} type="button" onClick={() => chooseFilter("failed")}>失败</button>
          <button className={filter === "success" ? "active" : ""} type="button" onClick={() => chooseFilter("success")}>已生成</button>
          <button className={filter === "duplicate" ? "active" : ""} type="button" onClick={() => chooseFilter("duplicate")}>已存在</button>
        </div>
      </div>
      <div className="source-list">
        {visibleSources.map((source) => <SourceRow key={source.id} source={source} setSnapshot={setSnapshot} />)}
      </div>
      {!visibleSources.length && <div className="empty compact-empty">没有符合条件的来源。</div>}
      {visibleSources.length < filteredSources.length && (
        <button className="source-load-more" type="button" onClick={() => setVisibleLimit((current) => current + 16)}>
          再显示 {Math.min(16, filteredSources.length - visibleSources.length)} 条
        </button>
      )}
    </details>
  );
}

function SourceRow({ source, setSnapshot }: { source: SourceRecord; setSnapshot: ViewProps["setSnapshot"] }) {
  const [draftText, setDraftText] = useState(source.text);
  const [feedback, setFeedback] = useState("");
  const [busyMessage, setBusyMessage] = useState("");
  const isBusy = !!busyMessage;
  useEffect(() => setDraftText(source.text), [source.text]);

  async function saveText() {
    if (isBusy) return;
    setBusyMessage("正在保存...");
    setFeedback("");
    try {
      const snapshot = await api.updateSourceText(source.id, draftText);
      setSnapshot(snapshot);
      setFeedback("原文已保存。");
    } catch (error) {
      setFeedback(formatOperationError(error, "保存失败"));
    } finally {
      setBusyMessage("");
    }
  }

  async function saveAndReprocess() {
    if (isBusy) return;
    setBusyMessage(REPROCESS_PROGRESS_MESSAGE);
    setFeedback("");
    try {
      const snapshot = await api.updateSourceText(source.id, draftText);
      setSnapshot(snapshot);
      const result = await api.reprocessSource(source.id);
      setSnapshot(result.snapshot);
      setFeedback(intakeResultMessage(result));
    } catch (error) {
      setFeedback(formatOperationError(error, "重新识别失败"));
    } finally {
      setBusyMessage("");
    }
  }

  async function reprocessOnly() {
    if (isBusy) return;
    setBusyMessage(REPROCESS_PROGRESS_MESSAGE);
    setFeedback("");
    try {
      const result = await api.reprocessSource(source.id);
      setSnapshot(result.snapshot);
      setFeedback(intakeResultMessage(result));
    } catch (error) {
      setFeedback(formatOperationError(error, "重新识别失败"));
    } finally {
      setBusyMessage("");
    }
  }

  return (
    <article className={`source-row ${isBusy ? "busy" : ""}`}>
      <div>
        <b>{source.sourceName}</b>
        <span>
          <em className={`source-status status-${source.extractionStatus}`}>{sourceStatusLabel(source.extractionStatus)}</em>
          {sourceTypeLabel(source.sourceType)} · {source.text.length} 字 · {source.itemIds.length} 条日程 · {formatSourceTime(source.lastExtractedAt)}
        </span>
        {source.lastError && <strong className={source.extractionStatus === "pending" ? "source-note" : "source-error"}>{safeUserMessage(source.lastError, source.extractionStatus === "pending" ? "等待补充必要信息，确认后会继续建立日程。" : "上次识别未完成，可检查原文后重新识别。")}</strong>}
        <details>
          <summary>{source.text.slice(0, 120) || "查看原文"}</summary>
          <textarea className="source-textarea" aria-label={`编辑 ${source.sourceName} 的抽取文本`} value={draftText} disabled={isBusy} onChange={(event) => setDraftText(event.target.value)} />
          <div className="source-detail-actions">
            <button type="button" disabled={isBusy} onClick={() => void saveText()}>{busyMessage === "正在保存..." ? "保存中" : "保存原文"}</button>
            <button type="button" disabled={isBusy} onClick={() => void saveAndReprocess()}>{busyMessage === REPROCESS_PROGRESS_MESSAGE ? "重新识别中…" : "保存并重新识别"}</button>
          </div>
          {(busyMessage || feedback) && <p className={`source-feedback ${busyMessage ? "busy" : ""}`} role={busyMessage || isPositiveFeedback(feedback) ? "status" : "alert"} aria-live="polite">{busyMessage || feedback}</p>}
        </details>
      </div>
      <button type="button" disabled={isBusy} onClick={() => void reprocessOnly()}>{busyMessage === REPROCESS_PROGRESS_MESSAGE ? "重新识别中…" : "重新识别"}</button>
    </article>
  );
}

function DdlList({ items, sources = [], plans = [], setSnapshot, compact = false, minimal = false, editable = false, emptyText = "暂时没有需要马上处理的截止事项。", onAction, onOpenTask, ariaLabel }: { items: DdlItem[]; sources?: SourceRecord[]; plans?: TaskPlan[]; setSnapshot: ViewProps["setSnapshot"]; compact?: boolean; minimal?: boolean; editable?: boolean; emptyText?: string; onAction?(notice: ActionNotice): void; onOpenTask?(taskId: string): void; ariaLabel?: string }) {
  if (!items.length) return <div className="empty">{emptyText}</div>;
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  return (
    <div className={`ddl-list ${compact ? "compact" : ""}`} role="list" aria-label={ariaLabel}>
      {items.map((item) => (
        <DdlRow key={item.id} item={item} plan={plans.filter((plan) => plan.taskId === item.id && plan.status !== "superseded").sort((left, right) => right.version - left.version)[0]} source={item.sourceId ? sourceMap.get(item.sourceId) : undefined} setSnapshot={setSnapshot} editable={editable} minimal={minimal} onAction={onAction} onOpenTask={onOpenTask} />
      ))}
    </div>
  );
}

function DdlRow({ item, source, plan, setSnapshot, editable, minimal = false, onAction, onOpenTask }: { item: DdlItem; source?: SourceRecord; plan?: TaskPlan; setSnapshot: ViewProps["setSnapshot"]; editable?: boolean; minimal?: boolean; onAction?(notice: ActionNotice): void; onOpenTask?(taskId: string): void }) {
  const urgency = urgencyTone(item);
  const [draft, setDraft] = useState(item);
  const [busyAction, setBusyAction] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const [rowError, setRowError] = useState("");
  const snoozeControlRef = useRef<HTMLDivElement>(null);
  const snoozeToggleRef = useRef<HTMLButtonElement>(null);
  const snoozeMenuId = useId();
  const fresh = isFreshItem(item);
  const snoozed = isScheduleItemSnoozed(item);
  const isBusy = !!busyAction;
  useEffect(() => {
    if (!editing) setDraft(item);
  }, [editing, item]);

  useEffect(() => {
    if (!snoozeMenuOpen) return;
    function closeOnPointerDown(event: PointerEvent): void {
      if (!snoozeControlRef.current?.contains(event.target as Node)) setSnoozeMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.stopPropagation();
        setSnoozeMenuOpen(false);
        window.requestAnimationFrame(() => snoozeToggleRef.current?.focus());
      }
    }
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [snoozeMenuOpen]);

  async function update(patch: ItemPatch): Promise<void> {
    const snapshot = await api.updateItem(item.id, patch);
    setSnapshot(snapshot);
  }

  async function runItemAction(message: string, action: () => Promise<void>, notice?: ActionNotice, failureMessage = "操作失败，请稍后重试。"): Promise<boolean> {
    if (isBusy) return false;
    setBusyAction(message);
    setRowError("");
    try {
      await action();
      if (notice) onAction?.(notice);
      return true;
    } catch (error) {
      const message = formatOperationError(error, failureMessage);
      setRowError(message);
      onAction?.({ message, tone: "warn" });
      return false;
    } finally {
      setBusyAction("");
    }
  }

  async function completeItem() {
    const nextCompleted = !item.completed;
    const message = nextCompleted ? `已完成「${item.title}」。` : `已恢复「${item.title}」。`;
    await runItemAction(
      nextCompleted ? "正在完成" : "正在恢复",
      () => update({ completed: nextCompleted }),
      {
        message,
        tone: "ok",
        ...(!editable ? {
          undo: {
            run: () => update({ completed: item.completed }),
            doneMessage: nextCompleted ? "已恢复为待处理。" : "已重新标记为完成。",
          },
        } : {}),
      },
      nextCompleted ? "没有成功完成事项，请重试。" : "没有成功恢复事项，请重试。",
    );
  }

  async function snoozeItem(preset: SnoozePreset) {
    const option = snoozeOptions.find((candidate) => candidate.value === preset)!;
    const snoozedUntil = snoozeUntil(preset).toISOString();
    setSnoozeMenuOpen(false);
    await runItemAction(
      "正在稍后",
      () => update({ snoozedUntil }),
      {
        message: `已稍后至 ${option.feedback}。`,
        tone: "ok",
        undo: {
          run: () => update({ snoozedUntil: item.snoozedUntil ?? null }),
          doneMessage: "已取消这次稍后提醒。",
        },
      },
      "稍后提醒设置失败，请重试。",
    );
  }

  async function cancelSnooze(): Promise<void> {
    await runItemAction(
      "正在取消",
      () => update({ snoozedUntil: null }),
      { message: "已取消稍后提醒。", tone: "ok" },
      "取消稍后提醒失败，请重试。",
    );
  }

  async function saveDraft(): Promise<void> {
    const title = draft.title.trim();
    const dueAt = new Date(draft.dueAt);
    if (!title) {
      setRowError("标题不能为空。");
      return;
    }
    if (Number.isNaN(dueAt.getTime())) {
      setRowError("请选择有效的截止时间。");
      return;
    }
    const success = await runItemAction(
      "正在保存",
      () => update({ title, importance: draft.importance, dueAt: dueAt.toISOString(), estimatedMinutes: draft.estimatedMinutes, progressPercent: draft.progressPercent }),
      { message: `已保存「${title}」。`, tone: "ok" },
      "保存失败，请检查内容后重试。",
    );
    if (success) {
      setEditing(false);
      setConfirmingDelete(false);
    }
  }

  async function deleteItem(): Promise<void> {
    const success = await runItemAction(
      "正在删除",
      async () => setSnapshot(await api.deleteItem(item.id)),
      { message: `已删除「${item.title}」。`, tone: "ok" },
      "删除失败，请稍后重试。",
    );
    if (success) setConfirmingDelete(false);
  }

  if (editable) {
    return (
      <article className={`ddl-row editor-row tone-${urgency} ${snoozed ? "snoozed" : ""} ${item.completed ? "completed" : ""} ${editing ? "editing" : ""} ${isBusy ? "busy" : ""}`} role="listitem" aria-busy={isBusy}>
        <div className="editor-summary">
          <button className={`completion-toggle ${item.completed ? "done" : ""}`} type="button" disabled={isBusy} onClick={() => void completeItem()} aria-label={item.completed ? `恢复 ${item.title}` : `完成 ${item.title}`}>
            {item.completed ? (
              <svg className="inline-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M6.3 3.2H2.8v3.5" />
                <path d="M3.1 6.3a5.3 5.3 0 1 1 .8 4.9" />
              </svg>
            ) : <UiIcon name="check" />}
          </button>
          <div className="editor-copy">
            <div className="editor-title-line">
              <strong>{item.title}</strong>
              <span className={`importance-chip importance-${item.importance}`}>{importanceLabel(item.importance)}</span>
              {fresh && <b className="new-chip">新</b>}
            </div>
            <div className="editor-meta">
              <time>{formatDue(item.dueAt)}</time>
              <span className={`remaining tone-${urgency}`}>{item.completed ? "已完成" : remainingText(item.dueAt)}</span>
              <span>{item.estimatedMinutes ?? (item.importance === "high" ? 90 : item.importance === "medium" ? 60 : 30)} 分钟 · {item.progressPercent ?? 0}%</span>
              <span className={`plan-chip ${plan?.status ?? "missing"}`}>{plan ? `${plan.steps.length} 步 · ${plan.status === "active" ? "已规划" : "待确认"}` : "待生成规划"}</span>
              <span className={`source-chip ${snoozed ? "snoozed-chip" : ""}`} title={item.sourceSummary}>
                {snoozed && item.snoozedUntil ? `稍后至 ${formatDue(item.snoozedUntil)}` : source?.sourceName ?? "手动录入"}
              </span>
            </div>
          </div>
          <div className="editor-actions">
            {onOpenTask && <button type="button" disabled={isBusy} onClick={() => onOpenTask(item.id)}>规划详情</button>}
            {snoozed && <button type="button" disabled={isBusy} onClick={() => void cancelSnooze()}>{busyAction === "正在取消" ? "取消中" : "取消稍后"}</button>}
            <button type="button" disabled={isBusy} aria-expanded={editing} onClick={() => {
              setEditing((current) => !current);
              setConfirmingDelete(false);
              setRowError("");
            }}>{editing ? "收起" : "编辑"}</button>
          </div>
        </div>
        {editing && (
          <form className="ddl-edit-form" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
            <div className="ddl-edit-fields">
              <label className="edit-field title-field">标题<input value={draft.title} disabled={isBusy} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label className="edit-field">重要性<select value={draft.importance} disabled={isBusy} onChange={(event) => setDraft({ ...draft, importance: event.target.value as Importance })}>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select></label>
              <label className="edit-field date-field">截止时间<UiDateTimeField required type="datetime-local" value={toInputDate(draft.dueAt)} disabled={isBusy} onChange={(value) => {
                const date = new Date(value);
                setDraft({ ...draft, dueAt: Number.isNaN(date.getTime()) ? "" : date.toISOString() });
              }} /></label>
              <label className="edit-field">预计工时<input type="number" min="15" max="1440" step="15" value={draft.estimatedMinutes ?? ""} placeholder="自动" disabled={isBusy} onChange={(event) => setDraft({ ...draft, estimatedMinutes: event.target.value ? Number(event.target.value) : undefined })} /></label>
              <label className="edit-field">完成进度<input type="number" min="0" max="100" step="5" value={draft.progressPercent ?? 0} disabled={isBusy} onChange={(event) => setDraft({ ...draft, progressPercent: Number(event.target.value) })} /></label>
            </div>
            <div className="ddl-edit-actions">
              <button className="save-edit" type="submit" disabled={isBusy || !draft.title.trim()}>保存</button>
              <button type="button" disabled={isBusy} onClick={() => {
                setDraft(item);
                setEditing(false);
                setConfirmingDelete(false);
                setRowError("");
              }}>取消</button>
              {!confirmingDelete ? (
                <button className="danger-link" type="button" disabled={isBusy} onClick={() => setConfirmingDelete(true)}>删除</button>
              ) : (
                <div className="delete-confirm" role="alert">
                  <span>确定删除？</span>
                  <button className="danger" type="button" disabled={isBusy} onClick={() => void deleteItem()}>{busyAction === "正在删除" ? "删除中" : "确认删除"}</button>
                  <button type="button" disabled={isBusy} onClick={() => setConfirmingDelete(false)}>保留</button>
                </div>
              )}
            </div>
          </form>
        )}
        {rowError && <p className="row-error" role="alert">{rowError}</p>}
      </article>
    );
  }

  return (
    <article className={`ddl-row compact-row tone-${urgency} ${snoozeMenuOpen ? "menu-open" : ""} ${isBusy ? "busy" : ""}`} role="listitem" aria-busy={isBusy}>
      <button className="check" type="button" title="完成" aria-label={`完成 ${item.title}`} disabled={isBusy} onClick={() => void completeItem()}><UiIcon name="check" /></button>
      <button className={`row-main ${minimal ? "minimal" : ""} ${minimal && item.importance === "high" ? "has-priority" : ""}`} type="button" onClick={() => void api.openControlCenter({ tab: "schedule", taskId: item.id }).catch((error) => onAction?.({ message: formatOperationError(error, "暂时无法打开任务详情"), tone: "warn" }))}>
        <span className="title-line">
          <strong>{item.title}</strong>
          {fresh && <b className="new-chip">新</b>}
        </span>
        {(!minimal || item.importance === "high") && <span className="importance-label">{minimal ? "高优先" : importanceLabel(item.importance)}</span>}
        <time className="due-time">{formatDue(item.dueAt)}</time>
        <em className="remaining-text">{remainingText(item.dueAt)}</em>
      </button>
      <div className="snooze-control" ref={snoozeControlRef}>
        <button ref={snoozeToggleRef} className="snooze" type="button" title="稍后提醒" aria-label={`稍后提醒 ${item.title}`} aria-expanded={snoozeMenuOpen} aria-controls={snoozeMenuId} disabled={isBusy} onClick={() => setSnoozeMenuOpen((current) => !current)}>
          <svg className="inline-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8.5" r="5.25" />
            <path d="M8 5.5v3.2l2.2 1.3M5.7 1.8h4.6" />
          </svg>
        </button>
        {snoozeMenuOpen && (
          <div className="snooze-menu" id={snoozeMenuId} role="group" aria-label="选择稍后提醒时间">
            {snoozeOptions.map((option) => (
              <button key={option.value} type="button" disabled={isBusy} onClick={() => void snoozeItem(option.value)}>{option.label}</button>
            ))}
          </div>
        )}
      </div>
      {rowError && <p className="row-error compact-error" role="alert">{rowError}</p>}
    </article>
  );
}

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function StatusRow({ label, state, detail }: { label: string; state: string; detail?: string }) {
  return (
    <div className="status-row">
      <span>
        <b>{label}</b>
        {detail && <em>{detail}</em>}
      </span>
      <b className={`service-${state}`}>{serviceStateLabel(state)}</b>
    </div>
  );
}

function serviceStateLabel(state: string): string {
  if (state === "ready") return "可用";
  if (state === "limited") return "基础可用";
  if (state === "recovered") return "已安全恢复";
  if (state === "reset") return "已重建";
  if (state === "read-only") return "只读保护";
  if (state === "unavailable") return "不可用";
  return "状态待确认";
}

function updatePhaseLabel(status: ChroniUpdateStatus): string {
  if (status.managedByStore) return "应用商店更新";
  if (status.phase === "checking") return "检查中";
  if (status.phase === "available" || status.phase === "downloading") return "正在更新";
  if (status.phase === "downloaded") return "可安装";
  if (status.phase === "up-to-date") return "最新版本";
  if (status.phase === "error") return "检查失败";
  if (status.phase === "unsupported") return "开发模式";
  return "自动检查";
}

type ViewProps = {
  snapshot: ChroniSnapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<ChroniSnapshot | null>>;
};

type ActionNotice = {
  message: string;
  tone: "ok" | "warn" | "info";
  undo?: {
    run: () => Promise<void>;
    doneMessage: string;
  };
};

const snoozeOptions: Array<{ value: SnoozePreset; label: string; feedback: string }> = [
  { value: "two-hours", label: "2 小时", feedback: "2 小时后" },
  { value: "tomorrow-morning", label: "明早 9 点", feedback: "明早 9 点" },
  { value: "one-day", label: "1 天", feedback: "1 天后" },
];

type ScheduleGroup = {
  key: ScheduleBucket;
  label: string;
  items: DdlItem[];
};

type ScheduleSurface = {
  groups: ScheduleGroup[];
  counts: Record<ScheduleBucket, number>;
  hiddenParts: string[];
  emptyMessage: string;
};

type ControlScheduleGroup = {
  key: string;
  label: string;
  hint: string;
  items: DdlItem[];
};

type ControlTab = "missions" | "daily" | "review" | "schedule" | "agent" | "preferences" | "services";

function agentStatusLabel(status: NonNullable<ChroniSnapshot["agent"]["latestRun"]>["verification"]["status"]): string {
  return status === "healthy" ? "安排正常" : status === "critical" ? "需要立即处理" : "需要关注";
}

function agentRiskLabel(level: NonNullable<ChroniSnapshot["agent"]["latestRun"]>["priorities"][number]["riskLevel"]): string {
  return level === "critical" ? "严重" : level === "high" ? "高" : level === "medium" ? "中" : "低";
}

function agentStageLabel(stage: NonNullable<ChroniSnapshot["agent"]["latestRun"]>["trace"][number]["stage"]): string {
  return stage === "observe" ? "观察" : stage === "plan" ? "规划" : stage === "act" ? "执行" : "验证";
}

function agentPlannerLabel(source: NonNullable<ChroniSnapshot["agent"]["latestRun"]>["plan"]["plannerSource"] | undefined): string {
  if (source === "llm") return "大模型规划";
  if (source === "rules-fallback") return "模型规划不可用 · 已使用本地规则";
  return "本地规划";
}

function agentToolLabel(tool: string): string {
  if (tool === "replan") return "重新排程";
  if (tool === "reminder") return "提醒";
  if (tool === "persist-plan") return "保存计划";
  return "Agent 操作";
}

function agentActionSummary(summary: string, status: "success" | "skipped" | "failed", tool: string): string {
  if (status === "failed") {
    if (tool === "replan") return "重新排程未完成，已保留原计划。";
    if (tool === "reminder") return "提醒未能发送，可在日程中继续查看任务。";
    if (tool === "persist-plan") return "本次计划未能保存，请稍后重新巡检。";
    return "这项操作未完成，其他巡检结果不受影响。";
  }
  return safeUserMessage(summary
    .replace(/未发送提醒：disabled\b/g, "未发送提醒：提醒功能已关闭")
    .replace(/未发送提醒：unsupported\b/g, "未发送提醒：当前系统不支持通知")
    .replace(/未发送提醒：quiet-hours\b/g, "未发送提醒：当前处于免打扰时段")
    .replace(/未发送提醒：duplicate\b/g, "未发送提醒：近期已提醒")
    .replace(/未发送提醒：not-needed\b/g, "未发送提醒：当前无需提醒"), "操作已完成。");
}

function agentTriggerLabel(trigger: NonNullable<ChroniSnapshot["agent"]["latestRun"]>["trigger"] | undefined): string {
  if (trigger === "startup") return "启动巡检";
  if (trigger === "daily") return "每日巡检";
  if (trigger === "task-change") return "变更巡检";
  return "手动巡检";
}

function formatAgentClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatAgentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatCalendarHeading(value: number | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "今天";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(date);
}

function formatAgentMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "暂未安排";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}小时${remainder}分` : `${hours}小时`;
}

function buildScheduleSurface(items: DdlItem[], now = new Date()): ScheduleSurface {
  const active = visibleActiveScheduleItems(items, now);
  const shown = lightweightScheduleItems(items, now, 6);
  const counts: Record<ScheduleBucket, number> = { overdue: 0, today: 0, upcoming: 0, later: 0 };
  for (const item of active) counts[scheduleBucket(item, now)] += 1;

  const labels: Record<ScheduleBucket, string> = {
    overdue: "已逾期",
    today: "今天",
    upcoming: "接下来 7 天",
    later: "下一项",
  };
  const groups = (["overdue", "today", "upcoming", "later"] as ScheduleBucket[])
    .map((key) => ({ key, label: labels[key], items: shown.filter((item) => scheduleBucket(item, now) === key) }))
    .filter((group) => group.items.length > 0);

  const shownIds = new Set(shown.map((item) => item.id));
  const hidden = active.filter((item) => !shownIds.has(item.id));
  const hiddenNearby = hidden.filter((item) => scheduleBucket(item, now) !== "later").length;
  const hiddenLater = hidden.length - hiddenNearby;
  const snoozedCount = items.filter((item) => !item.completed && isScheduleItemSnoozed(item, now)).length;
  const hiddenParts: string[] = [];
  if (hiddenNearby) hiddenParts.push(`${hiddenNearby} 条未展开`);
  if (hiddenLater) hiddenParts.push(`${hiddenLater} 条远期`);
  if (snoozedCount) hiddenParts.push(`${snoozedCount} 条稍后中`);

  const incompleteCount = items.filter((item) => !item.completed).length;
  const emptyMessage = snoozedCount
    ? `当前没有需要提醒的事项，${snoozedCount} 条会在稍后回来。`
    : items.length && !incompleteCount
      ? "待处理事项已全部完成。"
      : "暂无学习任务。把课程文件、截图或文字拖给桌宠，或在这里快速添加。";

  return { groups, counts, hiddenParts, emptyMessage };
}

function buildControlScheduleGroups(items: DdlItem[], filter: "active" | "completed" | "all", now = new Date()): ControlScheduleGroup[] {
  const labels: Record<ScheduleBucket, { label: string; hint: string }> = {
    overdue: { label: "已逾期", hint: "优先处理" },
    today: { label: "今天", hint: "今日截止" },
    upcoming: { label: "接下来 7 天", hint: "近期安排" },
    later: { label: "更晚", hint: "远期事项" },
  };
  const groups: ControlScheduleGroup[] = [];
  if (filter !== "completed") {
    const active = visibleActiveScheduleItems(items, now);
    for (const key of ["overdue", "today", "upcoming", "later"] as ScheduleBucket[]) {
      const bucketItems = active.filter((item) => scheduleBucket(item, now) === key);
      if (bucketItems.length) groups.push({ key, ...labels[key], items: bucketItems });
    }
    const snoozed = items
      .filter((item) => !item.completed && isScheduleItemSnoozed(item, now))
      .sort((left, right) => new Date(left.snoozedUntil!).getTime() - new Date(right.snoozedUntil!).getTime());
    if (snoozed.length) groups.push({ key: "snoozed", label: "稍后提醒", hint: "暂时隐藏", items: snoozed });
  }
  if (filter !== "active") {
    const completed = items
      .filter((item) => item.completed)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    if (completed.length) groups.push({ key: "completed", label: "已完成", hint: "可随时恢复", items: completed });
  }
  return groups;
}

function sourceStats(sources: SourceRecord[]) {
  return sources.reduce((stats, source) => {
    stats[source.extractionStatus] += 1;
    return stats;
  }, { success: 0, pending: 0, duplicate: 0, failed: 0 });
}

function useScheduleClock(): number {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setClock(Date.now());
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return clock;
}

function isFreshItem(item: DdlItem): boolean {
  const age = Date.now() - new Date(item.createdAt).getTime();
  return age >= 0 && age <= 10 * 60_000;
}

function urgencyTone(item: DdlItem): "red" | "orange" | "gray" {
  const hours = (new Date(item.dueAt).getTime() - Date.now()) / 3_600_000;
  if (hours <= 24) return "red";
  if (hours <= 72) return "orange";
  return "gray";
}

function importanceLabel(value: Importance): string {
  return value === "high" ? "重要" : value === "medium" ? "普通" : "低";
}

function sourceStatusLabel(value: SourceRecord["extractionStatus"]): string {
  if (value === "success") return "已生成";
  if (value === "pending") return "待确认";
  if (value === "duplicate") return "已存在";
  return "失败";
}

function sourceTypeLabel(value: string): string {
  if (value === "text") return "文字输入";
  if (value === "image") return "图片";
  if (!value.trim() || value.toLowerCase() === "unknown") return "未知格式文件";
  const normalized = value.replace(/^\./, "").trim().toUpperCase();
  return normalized && /^[A-Z0-9+-]{1,12}$/.test(normalized) ? `${normalized} 文件` : "本地文件";
}

function formatSourceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function formatDue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间无效";
  const year = date.getFullYear() === new Date().getFullYear() ? "" : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function remainingText(value: string): string {
  const remaining = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remaining)) return "时间无效";
  if (remaining < 0) return "已逾期";
  if (remaining < 3_600_000) return "剩余不到 1 小时";
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours <= 24) return `剩余 ${hours} 小时`;
  return `剩余 ${Math.ceil(hours / 24)} 天`;
}

function toInputDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isPositiveFeedback(message: string): boolean {
  return /^(已|成功|完成|模型已)/.test(message);
}

function safeUserMessage(message: string | undefined, fallback: string): string {
  return formatUserFacingMessage(message, fallback);
}

function intakeResultMessage(result: IntakeResult): string {
  return result.ok
    ? safeUserMessage(result.message, "日程处理完成。")
    : safeUserMessage(result.reason, "未能建立日程，请检查内容或补充必要信息。");
}

function acceptedFileTypes(): string {
  return ".txt,.md,.csv,.tsv,.json,.ics,.log,.html,.htm,.xml,.yaml,.yml,.rtf,.docx,.pdf,.xlsx,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff";
}

async function filesFromFileList(fileList: FileList | File[] | null): Promise<ChroniInputFile[]> {
  if (!fileList) return [];
  return Promise.all(Array.from(fileList).map(async (file) => {
    if (file.size > 18 * 1024 * 1024) throw new Error(`文件过大：${file.name}。请选择不超过 18 MB 的文件。`);
    const path = safeFilePath(file);
    if (path) return { path, name: file.name, type: file.type };
    const contentBase64 = await fileToBase64(file);
    return { name: file.name, type: file.type, contentBase64 };
  }));
}

function safeFilePath(file: File): string {
  if (api.storeManaged && api.platform === "darwin") return "";
  try {
    return api.filePath(file);
  } catch {
    return "";
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",", 2)[1] : result);
    };
    reader.readAsDataURL(file);
  });
}

function PetSprite({ action, onFinished }: { action: PetAction; onFinished(action: PetAction): void }) {
  const frames = petAnimationFrames[action].length ? petAnimationFrames[action] : petAnimationFrames.idle;
  const [frameIndex, setFrameIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    setFrameIndex(0);
    setFinished(false);
    if (frames.length <= 1) {
      if (!isOneShotPetAction(action)) return;
      const timeout = window.setTimeout(() => {
        setFinished(true);
        onFinishedRef.current(action);
      }, 650);
      return () => window.clearTimeout(timeout);
    }
    const loop = petAnimationLoops[action];
    const interval = window.setInterval(() => {
      setFrameIndex((current) => {
        const next = current + 1;
        if (next < frames.length) return next;
        if (loop) return 0;
        window.clearInterval(interval);
        setFinished(true);
        window.setTimeout(() => onFinishedRef.current(action), 0);
        return current;
      });
    }, 1000 / petAnimationFps[action]);
    return () => window.clearInterval(interval);
  }, [action, frames]);

  const displayFrames = finished && action !== "sleep" ? petAnimationFrames.idle : frames;
  return <img className="pet-art" src={displayFrames[Math.min(frameIndex, displayFrames.length - 1)]} alt="" draggable={false} />;
}

function petActionLabel(action: PetAction): string {
  const labels: Record<PetAction, string> = {
    idle: "待机",
    drag: "被提起",
    cling: "落地缓冲",
    walk: "散步",
    wake: "醒来",
    study: "读书",
    eat: "吃汉堡",
    pet: "摸头",
    play: "打羽毛球",
    cat: "和猫猫玩",
    sleep: "睡觉",
  };
  return labels[action];
}

function isPersistentPetFeedback(state: CompanionState): boolean {
  return state === "hover_accept" || state === "processing" || state === "needs_clarification" || state === "deadline_near" || state === "overdue";
}

function isTransientPetFeedback(state: CompanionState): boolean {
  return state === "clicked" || state === "success" || state === "confused" || state === "celebrating";
}

function dailyTaskOccursOn(task: DailyTask, date: Date): boolean {
  if (!task.scheduledStartAt) return false;
  const start = new Date(task.scheduledStartAt);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const first = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (target < first) return false;
  if (task.recurrenceEndsAt) {
    const end = new Date(task.recurrenceEndsAt);
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (target > last) return false;
  }
  if (task.recurrence === "daily") return true;
  if (task.recurrence === "weekdays") return target.getDay() !== 0 && target.getDay() !== 6;
  if (task.recurrence === "weekly") return target.getDay() === first.getDay();
  return dailyDateKey(target) === dailyDateKey(first);
}

function dailyDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

async function waitForRendererFonts(): Promise<void> {
  if (!document.fonts) return;
  const faces = [
    ["400 14px \"Source Sans 3 Variable\"", "Chroni 0123456789"],
    ["500 26px \"Source Serif 4 Variable\"", "Chroni 0123456789"],
    ["400 14px \"Noto Sans SC Variable\"", "日程任务偏好"],
    ["500 21px \"Noto Serif SC Variable\"", "日程任务偏好"],
  ] as const;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, 1_800);
    void Promise.all(faces.map(([font, sample]) => document.fonts.load(font, sample))).then(finish, finish);
  });
}

async function mountApp(): Promise<void> {
  document.documentElement.dataset.fonts = "loading";
  await waitForRendererFonts();
  if (rendererDisposed) return;
  rendererRoot.render(<App />);
  document.documentElement.dataset.fonts = "ready";
}

const rendererRoot = createRoot(document.getElementById("root")!);
let rendererDisposed = false;
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    rendererDisposed = true;
    rendererRoot.unmount();
  });
}

void mountApp();
