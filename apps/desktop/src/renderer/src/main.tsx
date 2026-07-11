import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatOperationError } from "../../shared/errors";
import { fullScheduleSummary, isScheduleItemSnoozed, lightweightScheduleItems, scheduleBucket, snoozeUntil, visibleActiveScheduleItems, visibleScheduleSummary } from "../../shared/schedule";
import type { ScheduleBucket, SnoozePreset } from "../../shared/schedule";
import type { AgentMemory, CompanionState, CompanionStyle, DdlItem, ChroniInputFile, ChroniLlmSettings, ChroniPreferences, ChroniPreferencesPatch, ChroniSnapshot, ExtractResult, Importance, IntakePayload, ItemPatch, SourceRecord } from "../../shared/types";
import "./styles.css";

const api = window.chroni;
type PetAction = "idle" | "drag" | "wake" | "study" | "pet" | "cat" | "sleep";
const petFrameModules = import.meta.glob("./assets/tongluv/frames/*/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const petAnimationFrames: Record<PetAction, string[]> = {
  idle: collectPetFrames("idle"),
  drag: collectPetFrames("drag"),
  wake: collectPetFrames("wake"),
  study: collectPetFrames("study"),
  pet: collectPetFrames("pet"),
  cat: collectPetFrames("cat"),
  sleep: collectPetFrames("sleep"),
};
const petAnimationFps: Record<PetAction, number> = {
  idle: 1,
  drag: 1,
  wake: 12,
  study: 12,
  pet: 12,
  cat: 10,
  sleep: 10,
};
const petAnimationLoops: Record<PetAction, boolean> = {
  idle: true,
  drag: true,
  wake: false,
  study: true,
  pet: false,
  cat: false,
  sleep: false,
};

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
  const suppressClick = useRef(false);
  const [hovering, setHovering] = useState(false);
  const [movingPet, setMovingPet] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [localBubble, setLocalBubble] = useState("");
  const visualAction = movingPet ? "drag" : petAction(snapshot.companion.state);

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
    try {
      const droppedFiles = Array.from(event.dataTransfer.files);
      const droppedText = event.dataTransfer.getData("text/plain");
      const files = await filesFromFileList(droppedFiles);
      await api.companionHover(false).catch(() => undefined);
      const result = files.length
        ? await api.intake({ kind: "files", files })
        : await api.intake({ kind: "text", text: droppedText });
      setSnapshot(result.snapshot);
    } catch (error) {
      setLocalBubble(formatOperationError(error, "拖放处理失败"));
    }
  }

  return (
    <main
      className={`pet-shell state-${snapshot.companion.state} style-${snapshot.preferences.companionStyle}`}
      onDragOver={(event) => {
        event.preventDefault();
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
        void api.openPetMenu();
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        dragPointerId.current = event.pointerId;
        dragStartPoint.current = { x: event.screenX, y: event.screenY };
        event.currentTarget.setPointerCapture(event.pointerId);
        suppressClick.current = false;
        api.startWindowDrag(event.screenX, event.screenY);
      }}
      onPointerMove={(event) => {
        if (dragPointerId.current !== event.pointerId || (event.buttons & 1) === 0) return;
        const start = dragStartPoint.current;
        if (start && Math.abs(event.screenX - start.x) + Math.abs(event.screenY - start.y) > 2) {
          suppressClick.current = true;
          setMovingPet(true);
        }
        api.moveWindowDrag();
      }}
      onPointerUp={(event) => {
        if (dragPointerId.current !== event.pointerId) return;
        dragPointerId.current = null;
        dragStartPoint.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setMovingPet(false);
        api.endWindowDrag();
      }}
      onPointerCancel={(event) => {
        if (dragPointerId.current !== event.pointerId) return;
        dragPointerId.current = null;
        dragStartPoint.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        suppressClick.current = false;
        setMovingPet(false);
        api.endWindowDrag();
      }}
    >
      <button
        className="pet-body"
        type="button"
        onClick={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            suppressClick.current = false;
            return;
          }
          void api.companionClicked().then(setSnapshot).catch(() => setLocalBubble("暂时无法打开日程。"));
        }}
        aria-label="Chroni 桌宠"
      >
        <PetSprite action={visualAction} />
      </button>
      <div className={`bubble ${bubbleVisible ? "show" : ""}`} role="status" aria-live="polite">{localBubble || snapshot.companion.bubble}</div>
    </main>
  );
}

function ScheduleView({ snapshot, setSnapshot }: ViewProps) {
  const scheduleClock = useScheduleClock();
  const surface = useMemo(() => buildScheduleSurface(snapshot.items, new Date(scheduleClock)), [scheduleClock, snapshot.items]);
  const [quickText, setQuickText] = useState("");
  const [feedback, setFeedback] = useState<ActionNotice | null>(null);
  const [feedbackHovered, setFeedbackHovered] = useState(false);
  const [feedbackFocused, setFeedbackFocused] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [undoing, setUndoing] = useState(false);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const isWindowsDrawer = api.platform === "win32";
  const isBusy = !!busyMessage;
  const feedbackPaused = feedbackHovered || feedbackFocused;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !document.querySelector(".snooze-menu")) void api.showSchedule(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
    setBusyMessage("正在识别...");
    showFeedback(null);
    try {
      const result = await api.quickAdd(quickText);
      setSnapshot(result.snapshot);
      showFeedback({ message: result.ok ? result.message : result.reason, tone: result.ok ? "ok" : "warn" });
      if (result.ok) setQuickText("");
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

  return (
    <main
      className={`schedule-shell ${isWindowsDrawer ? "drawer-shell" : "popover-shell"}`}
      onMouseEnter={() => {
        if (isWindowsDrawer) void api.showSchedule(true);
      }}
      onMouseLeave={() => {
        if (isWindowsDrawer) void api.showSchedule(false);
      }}
    >
      {isWindowsDrawer && <div className="drawer-handle"><span>DDL</span></div>}
      <section className="schedule-panel" aria-busy={isBusy || undoing}>
        <header className="panel-head">
          <div>
            <p>Chroni</p>
            <h1>最近要注意</h1>
          </div>
          <div className="panel-actions">
            <button className="icon-btn" type="button" onClick={() => void api.openControlCenter()} title="控制中心" aria-label="打开控制中心">⚙</button>
            <button className="icon-btn quiet" type="button" onClick={() => void api.showSchedule(false)} title="收起日程" aria-label="收起日程">×</button>
          </div>
        </header>
        <div className="mini-stats" aria-label="日程概览">
          <span className={surface.counts.overdue ? "alert" : ""}><b>{surface.counts.overdue}</b> 逾期</span>
          <span><b>{surface.counts.today}</b> 今天</span>
          <span><b>{surface.counts.upcoming + surface.counts.later}</b> 接下来</span>
        </div>
        <div className="quick-add">
          <input
            value={quickText}
            disabled={isBusy}
            aria-label="快速添加日程"
            onChange={(event) => setQuickText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void quickAdd();
            }}
            placeholder="快速添加：7月12日 23:59 课程报告"
          />
          <button type="button" disabled={isBusy || !quickText.trim()} onClick={() => void quickAdd()} aria-label="识别并添加日程">＋</button>
        </div>
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
                <DdlList items={group.items} setSnapshot={setSnapshot} compact onAction={showFeedback} ariaLabel={`${group.label}日程`} />
              </section>
            ))}
          </div>
        ) : (
          <div className="empty schedule-empty" role="status">{surface.emptyMessage}</div>
        )}
        {surface.hiddenParts.length > 0 && (
          <button className="schedule-hidden-summary" type="button" onClick={() => void api.openControlCenter()}>
            <span>另有 {surface.hiddenParts.join(" · ")}</span>
            <b>在控制中心查看</b>
          </button>
        )}
      </section>
    </main>
  );
}

function ControlCenter({ snapshot, setSnapshot }: ViewProps) {
  const [tab, setTab] = useState<ControlTab>("schedule");
  const pendingCount = snapshot.items.filter((item) => !item.completed).length;
  return (
    <main className="control-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">C</div>
          <div>
            <h1>Chroni</h1>
            <p>本地 DDL 日程助手</p>
          </div>
        </div>
        <nav aria-label="控制中心">
          <button className={tab === "schedule" ? "active" : ""} aria-current={tab === "schedule" ? "page" : undefined} onClick={() => setTab("schedule")}>日程</button>
          <button className={tab === "agent" ? "active" : ""} aria-current={tab === "agent" ? "page" : undefined} onClick={() => setTab("agent")}>Agent</button>
          <button className={tab === "preferences" ? "active" : ""} aria-current={tab === "preferences" ? "page" : undefined} onClick={() => setTab("preferences")}>偏好</button>
          <button className={tab === "services" ? "active" : ""} aria-current={tab === "services" ? "page" : undefined} onClick={() => setTab("services")}>运行状态</button>
        </nav>
        <div className="sidebar-foot">
          <span>待处理 {pendingCount}</span>
          <b>{petLabel(snapshot.companion.state)}</b>
        </div>
      </aside>
      <section className="content">
        {tab === "schedule" && <CorrectionPane snapshot={snapshot} setSnapshot={setSnapshot} />}
        {tab === "agent" && <AgentPane snapshot={snapshot} setSnapshot={setSnapshot} />}
        {tab === "preferences" && <PreferencesPane preferences={snapshot.preferences} setSnapshot={setSnapshot} />}
        {tab === "services" && <ServicesPane snapshot={snapshot} setSnapshot={setSnapshot} />}
      </section>
    </main>
  );
}

function AgentPane({ snapshot, setSnapshot }: ViewProps) {
  const latest = snapshot.agent.latestRun;
  const [memoryDraft, setMemoryDraft] = useState<AgentMemory>({ ...snapshot.agent.memory });
  const [memoryDirty, setMemoryDirty] = useState(false);
  const [busyAction, setBusyAction] = useState<"run" | "memory" | "export" | "">("");
  const [feedback, setFeedback] = useState("");
  const highRisk = latest?.priorities.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical") ?? [];

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
      setFeedback("今日 Agent 巡检已完成。");
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
      setFeedback("Agent Memory 已保存。");
    } catch (error) {
      setFeedback(formatOperationError(error, "Memory 保存失败"));
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
      setFeedback(`已导出 ${result.itemCount} 条日程：${result.path}`);
    } catch (error) {
      setFeedback(formatOperationError(error, "ICS 导出失败"));
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="pane agent-pane">
      <header className="pane-head agent-head">
        <div>
          <p>Observe · Plan · Act · Verify</p>
          <h2>今日 Agent 巡检</h2>
        </div>
        <button className="agent-run" type="button" disabled={!!busyAction} onClick={() => void runInspection()}>
          {busyAction === "run" ? "巡检中..." : "运行巡检"}
        </button>
      </header>

      {feedback && <p className={`inline-feedback ${isPositiveFeedback(feedback) ? "ok" : "warn"}`} role="status" aria-live="polite">{feedback}</p>}

      <section className={`agent-status status-${latest?.verification.status ?? "idle"}`}>
        <div>
          <span>当前状态</span>
          <b>{latest ? agentStatusLabel(latest.verification.status) : "尚未巡检"}</b>
        </div>
        <div>
          <span>高风险</span>
          <b>{highRisk.length}</b>
        </div>
        <div>
          <span>今日安排</span>
          <b>{latest?.plan.plannedMinutes ?? 0} 分钟</b>
        </div>
        <div>
          <span>最近运行</span>
          <b>{latest ? formatAgentTime(latest.completedAt) : "--"}</b>
        </div>
      </section>

      {!latest ? (
        <div className="empty agent-empty">运行巡检后，这里会显示今日优先级、工作块和 Agent Trace。</div>
      ) : (
        <>
          <section className="agent-section">
            <header className="section-head">
              <div><h3>今日建议</h3><p>{latest.verification.summary}</p></div>
            </header>
            <ol className="agent-suggestions">{latest.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ol>
          </section>

          <div className="agent-columns">
            <section className="agent-section">
              <header className="section-head"><div><h3>优先任务</h3><p>{highRisk.length} 条高风险</p></div></header>
              <div className="agent-risk-list">
                {latest.priorities.slice(0, 6).map((item) => (
                  <article className={`agent-risk-row risk-${item.riskLevel}`} key={item.taskId}>
                    <div><b>{item.title}</b><span>{item.reasons.join(" · ")}</span></div>
                    <em>{agentRiskLabel(item.riskLevel)}</em>
                  </article>
                ))}
                {!latest.priorities.length && <div className="empty compact-empty">没有待处理任务。</div>}
              </div>
            </section>

            <section className="agent-section">
              <header className="section-head"><div><h3>工作块</h3><p>{latest.plan.blocks.length} 段 · {latest.plan.plannedMinutes} 分钟</p></div></header>
              <div className="agent-block-list">
                {latest.plan.blocks.map((block) => (
                  <article className="agent-block-row" key={`${block.taskId}-${block.startAt}`}>
                    <time>{formatAgentClock(block.startAt)}–{formatAgentClock(block.endAt)}</time>
                    <div><b>{block.title}</b><span>{block.allocatedMinutes} 分钟</span></div>
                  </article>
                ))}
                {!latest.plan.blocks.length && <div className="empty compact-empty">今日没有生成工作块。</div>}
              </div>
            </section>
          </div>

          <section className="agent-section">
            <header className="section-head"><div><h3>Agent Trace</h3><p>{latest.trace.length} 个审计步骤</p></div></header>
            <div className="agent-trace">
              {latest.trace.map((entry) => (
                <article className={entry.success ? "" : "failed"} key={`${entry.sequence}-${entry.id}`}>
                  <span>{entry.sequence}</span>
                  <div><b>{agentStageLabel(entry.stage)}</b><p>{entry.summary}</p></div>
                  <time>{formatAgentClock(entry.timestamp)}</time>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <details className="agent-settings advanced-settings">
        <summary>Agent Memory 与导出</summary>
        <div className="agent-memory-grid">
          <label>每日容量（分钟）<input type="number" min="30" max="720" step="30" value={memoryDraft.maxDailyMinutes} onChange={(event) => patchMemory({ maxDailyMinutes: Number(event.target.value) })} /></label>
          <label>开始时间<input type="time" value={memoryDraft.workdayStart} onChange={(event) => patchMemory({ workdayStart: event.target.value })} /></label>
          <label>结束时间<input type="time" value={memoryDraft.workdayEnd} onChange={(event) => patchMemory({ workdayEnd: event.target.value })} /></label>
          <label>提醒频率<select value={memoryDraft.reminderFrequency} onChange={(event) => patchMemory({ reminderFrequency: event.target.value as AgentMemory["reminderFrequency"] })}><option value="important-only">仅高风险</option><option value="daily">每日</option><option value="off">关闭</option></select></label>
        </div>
        <div className="agent-settings-actions">
          <button className="secondary" type="button" disabled={!!busyAction || !memoryDirty} onClick={() => void saveMemory()}>{busyAction === "memory" ? "保存中..." : "保存 Memory"}</button>
          <button className="secondary" type="button" disabled={!!busyAction} onClick={() => void exportIcs()}>{busyAction === "export" ? "导出中..." : "导出 ICS"}</button>
        </div>
      </details>
    </div>
  );
}

function CorrectionPane({ snapshot, setSnapshot }: ViewProps) {
  const scheduleClock = useScheduleClock();
  const [manual, setManual] = useState("");
  const [preview, setPreview] = useState<ExtractResult | null>(null);
  const [previewPayload, setPreviewPayload] = useState<IntakePayload | null>(null);
  const [feedback, setFeedback] = useState("");
  const [itemFilter, setItemFilter] = useState<"active" | "completed" | "all">("active");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const manualInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileImportMode = useRef<"preview" | "fill">("preview");
  const isBusy = !!busyMessage;
  const isFirstRun = !snapshot.items.length && !snapshot.sources.length && !preview;
  const summary = useMemo(() => fullScheduleSummary(snapshot.items, new Date(scheduleClock)), [scheduleClock, snapshot.items]);
  const actionableSummary = useMemo(() => visibleScheduleSummary(snapshot.items, new Date(scheduleClock)), [scheduleClock, snapshot.items]);
  const snoozedCount = summary.active - actionableSummary.active;
  const itemGroups = useMemo(() => buildControlScheduleGroups(snapshot.items, itemFilter, new Date(scheduleClock)), [itemFilter, scheduleClock, snapshot.items]);
  const filteredCount = itemGroups.reduce((count, group) => count + group.items.length, 0);

  async function addManual() {
    if (!manual.trim() || isBusy) return;
    setBusyMessage("正在识别...");
    setFeedback("");
    try {
      const result = await api.quickAdd(manual);
      setSnapshot(result.snapshot);
      setFeedback(result.ok ? result.message : result.reason);
      if (result.ok) setManual("");
    } catch (error) {
      setFeedback(formatOperationError(error, "识别失败"));
    } finally {
      setBusyMessage("");
    }
  }

  async function extractFiles(fileList: FileList | null, fill: boolean) {
    if (isBusy) return;
    setBusyMessage("正在读取文件...");
    setFeedback("");
    try {
      const files = await filesFromFileList(fileList);
      if (!files.length) {
        setFeedback("没有收到可读取的文件。");
        return;
      }
      const payload: IntakePayload = { kind: "files", files };
      setBusyMessage(fill ? "正在填入日程..." : "正在预览抽取...");
      if (fill) {
        const result = await api.intake(payload);
        setSnapshot(result.snapshot);
        setFeedback(result.ok ? result.message : result.reason);
        setPreview(null);
        setPreviewPayload(null);
      } else {
        setPreview(await api.extract(payload));
        setPreviewPayload(payload);
      }
    } catch (error) {
      setFeedback(formatOperationError(error, "文件处理失败"));
    } finally {
      setBusyMessage("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function previewDroppedFiles(event: React.DragEvent) {
    event.preventDefault();
    setDraggingFiles(false);
    if (isBusy) return;
    await extractFiles(event.dataTransfer.files, false);
  }

  return (
    <div className="pane">
      <header className="pane-head">
        <div>
          <p>录入、抽取、核对</p>
          <h2>日程</h2>
        </div>
      </header>
      <div className="summary-line">
        <span>{summary.active} 待处理</span>
        <span className={actionableSummary.overdue ? "alert" : ""}>{actionableSummary.overdue} 逾期</span>
        <span>{actionableSummary.today} 今日</span>
        {snoozedCount > 0 && <span>{snoozedCount} 稍后</span>}
      </div>
      {isFirstRun && (
        <section className="start-panel">
          <div>
            <h3>先放进一个 DDL</h3>
            <p>粘贴一句截止时间，或选择课程通知、截图、PDF 等文件。</p>
          </div>
          <div className="start-actions">
            <button type="button" disabled={isBusy} onClick={() => manualInputRef.current?.focus()}>写一句</button>
            <button type="button" disabled={isBusy} onClick={() => { fileImportMode.current = "preview"; fileInputRef.current?.click(); }}>选择文件</button>
          </div>
        </section>
      )}
      <div className="manual-row">
        <input
          ref={manualInputRef}
          value={manual}
          disabled={isBusy}
          aria-label="快速添加日程"
          onChange={(event) => setManual(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addManual();
          }}
          placeholder="快速添加或重新识别：明天 18:00 交实验报告"
        />
        <button type="button" disabled={isBusy || !manual.trim()} onClick={() => void addManual()}>识别</button>
      </div>
      {busyMessage && <p className="inline-feedback info" role="status" aria-live="polite">{busyMessage}</p>}
      {feedback && <p className={`inline-feedback ${isPositiveFeedback(feedback) ? "ok" : "warn"}`} role={isPositiveFeedback(feedback) ? "status" : "alert"} aria-live="polite">{feedback}</p>}
      <div
        className={`upload-box ${draggingFiles ? "dragging" : ""} ${isBusy ? "busy" : ""}`}
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
            void extractFiles(input.files, fileImportMode.current === "fill").finally(() => { input.value = ""; });
          }}
          accept={acceptedFileTypes()}
        />
        <div className="upload-copy">
          <b>{draggingFiles ? "松开后开始预览" : "拖入文件或选择上传"}</b>
          <p>支持 TXT、MD、CSV、JSON、ICS、HTML、DOCX、PDF、XLSX、PNG/JPG/WEBP/TIFF；可先预览，也可直接填入日程。</p>
        </div>
        <div className="upload-actions">
          <button type="button" disabled={isBusy} onClick={() => { fileImportMode.current = "preview"; fileInputRef.current?.click(); }}>预览抽取</button>
          <button type="button" disabled={isBusy} onClick={() => { fileImportMode.current = "fill"; fileInputRef.current?.click(); }}>直接填入</button>
        </div>
      </div>
      {preview && (
        <div className="extract-preview">
          <h3>抽取预览</h3>
          {!preview.ok && <p className="preview-error">{preview.reason}</p>}
          {preview.extracted.map((input) => (
            <article key={`${input.sourceName}-${input.sourceType}`}>
              <b>{input.sourceName}</b>
              <span>{input.sourceType}，抽取 {input.text.length} 字</span>
            </article>
          ))}
          {preview.failures.map((failure) => (
            <article key={`${failure.sourceName}-${failure.sourceType}-failed`} className="preview-failure">
              <b>{failure.sourceName}</b>
              <span>{failure.reason}</span>
            </article>
          ))}
          {preview.items.map((item) => (
            <article key={item.id}>
              <b>{item.title}</b>
              <span>{importanceLabel(item.importance)} · {formatDue(item.dueAt)} · {remainingText(item.dueAt)}</span>
            </article>
          ))}
          {preview.ok && (
            <button type="button" disabled={isBusy} onClick={async () => {
              if (isBusy) return;
              setBusyMessage("正在填入日程...");
              setFeedback("");
              try {
                const result = await api.intake(previewPayload ?? { kind: "text", text: preview.extracted.map((input) => input.text).join("\n") });
                setSnapshot(result.snapshot);
                setFeedback(result.ok ? result.message : result.reason);
                setPreview(null);
                setPreviewPayload(null);
              } catch (error) {
                setFeedback(formatOperationError(error, "填入日程失败"));
              } finally {
                setBusyMessage("");
              }
            }}>填入日程</button>
          )}
        </div>
      )}
      <div className="list-toolbar">
        <div>
          <h3>日程列表</h3>
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
                sources={snapshot.sources}
                setSnapshot={setSnapshot}
                editable
                ariaLabel={`${group.label}日程`}
                onAction={(notice) => setFeedback(notice.message)}
              />
            </section>
          ))}
        </div>
      ) : (
        <div className="empty">{itemFilter === "completed" ? "还没有完成记录。" : "暂时没有需要处理的 DDL。"}</div>
      )}
      <SourceHistory sources={snapshot.sources} setSnapshot={setSnapshot} />
    </div>
  );
}

function PreferencesPane({ preferences, setSnapshot }: { preferences: ChroniPreferences; setSnapshot: ViewProps["setSnapshot"] }) {
  const [llmDraft, setLlmDraft] = useState<Pick<ChroniLlmSettings, "baseUrl" | "model" | "apiKey">>({
    baseUrl: preferences.llm.baseUrl,
    model: preferences.llm.model,
    apiKey: preferences.llm.apiKey,
  });
  const [llmDirty, setLlmDirty] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmFeedback, setLlmFeedback] = useState<{ message: string; tone: "ok" | "warn" } | null>(null);

  useEffect(() => {
    if (llmDirty) return;
    setLlmDraft({
      baseUrl: preferences.llm.baseUrl,
      model: preferences.llm.model,
      apiKey: preferences.llm.apiKey,
    });
  }, [llmDirty, preferences.llm.apiKey, preferences.llm.baseUrl, preferences.llm.model]);

  async function patch(next: ChroniPreferencesPatch) {
    setSnapshot(await api.updatePreferences(next));
  }

  function updateLlmDraft(field: keyof typeof llmDraft, value: string): void {
    setLlmDraft((current) => ({ ...current, [field]: value }));
    setLlmDirty(true);
    setLlmFeedback(null);
  }

  async function saveAndTestLlm(): Promise<void> {
    if (llmBusy) return;
    setLlmBusy(true);
    setLlmFeedback(null);
    try {
      const snapshot = await api.updatePreferences({ llm: llmDraft });
      setSnapshot(snapshot);
      setLlmDirty(false);
      const result = await api.testLlmConnection(snapshot.preferences.llm);
      setLlmFeedback({ message: result.message, tone: result.ok ? "ok" : "warn" });
    } catch (error) {
      setLlmFeedback({ message: formatOperationError(error, "保存或连接测试失败"), tone: "warn" });
    } finally {
      setLlmBusy(false);
    }
  }
  const modelMode = preferences.llm.enabled && preferences.llm.apiKey ? "LLM 优先" : "本地规则";
  return (
    <div className="pane narrow settings-pane">
      <header className="pane-head">
        <div>
          <p>少而清晰</p>
          <h2>偏好</h2>
        </div>
      </header>
      <section className="settings-group">
        <div>
          <h3>桌宠</h3>
          <p>桌宠负责接收拖拽、短反馈和唤起日程。</p>
        </div>
        <Toggle label="显示桌宠" checked={preferences.companionEnabled} onChange={(value) => void patch({ companionEnabled: value })} />
        <div className="style-picker" role="group" aria-label="桌宠色调">
          {companionStyleOptions.map((option) => (
            <button
              key={option.value}
              className={preferences.companionStyle === option.value ? "active" : ""}
              type="button"
              onClick={() => void patch({ companionStyle: option.value })}
            >
              <span className={`style-swatch swatch-${option.value}`} />
              {option.label}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-group">
        <div>
          <h3>提醒</h3>
          <p>临近 DDL 时提醒，勿扰期间只更新状态不打扰。</p>
        </div>
        <Toggle label="开启提醒" checked={preferences.remindersEnabled} onChange={(value) => void patch({ remindersEnabled: value })} />
        <Toggle label="勿扰时间" checked={preferences.quietHoursEnabled} onChange={(value) => void patch({ quietHoursEnabled: value })} />
        <div className="field-grid">
          <label>开始<input type="time" value={preferences.quietHoursStart} onChange={(event) => void patch({ quietHoursStart: event.target.value })} /></label>
          <label>结束<input type="time" value={preferences.quietHoursEnd} onChange={(event) => void patch({ quietHoursEnd: event.target.value })} /></label>
        </div>
      </section>
      <section className="settings-group">
        <div>
          <h3>快捷键</h3>
          <p>用于快速唤起侧边日程，不影响系统其他输入。</p>
        </div>
        <label className="text-field compact-field">唤起日程<input value={preferences.hotkey} onChange={(event) => void patch({ hotkey: event.target.value })} /></label>
      </section>
      <section className="settings-group">
        <div className="section-head">
          <div>
            <h3>高级</h3>
            <p>默认使用本地规则；配置 API 后优先用 LLM 压缩标题和判断重要性。</p>
          </div>
          <span className="mode-chip">{modelMode}</span>
        </div>
        <Toggle label="启用 LLM 抽取" checked={preferences.llm.enabled} onChange={(value) => void patch({ llm: { enabled: value } })} />
        <details className="advanced-settings">
          <summary>大模型 API</summary>
          <label className="text-field">Base URL<input value={llmDraft.baseUrl} placeholder="https://api.deepseek.com" onChange={(event) => updateLlmDraft("baseUrl", event.target.value)} /></label>
          <label className="text-field">模型<input value={llmDraft.model} placeholder="deepseek-v4-flash" onChange={(event) => updateLlmDraft("model", event.target.value)} /></label>
          <label className="text-field">API Key<input type="password" value={llmDraft.apiKey} placeholder="sk-..." autoComplete="off" onChange={(event) => updateLlmDraft("apiKey", event.target.value)} /></label>
          <div className="llm-settings-actions">
            <button className="secondary" type="button" disabled={llmBusy} onClick={() => void saveAndTestLlm()}>
              {llmBusy ? "正在连接..." : llmDirty ? "保存并测试" : "测试连接"}
            </button>
            {llmDirty && <span>有未保存的修改</span>}
          </div>
          {llmFeedback && <p className={`llm-feedback ${llmFeedback.tone}`} role="status" aria-live="polite">{llmFeedback.message}</p>}
        </details>
      </section>
    </div>
  );
}

function ServicesPane({ snapshot, setSnapshot }: ViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const unavailableCount = [snapshot.services.parser, snapshot.services.ocr, snapshot.services.model].filter((state) => state === "unavailable").length;
  async function refreshServices() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      setSnapshot(await api.getSnapshot());
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <div className="pane narrow service-pane">
      <header className="pane-head">
        <div>
          <p>基础排错</p>
          <h2>运行状态</h2>
        </div>
        <button className="secondary slim" type="button" disabled={refreshing} onClick={() => void refreshServices()}>{refreshing ? "检查中" : "重新检查"}</button>
      </header>
      <p className={`service-summary ${unavailableCount ? "warn" : ""}`}>
        {unavailableCount ? `${unavailableCount} 项能力不可用，仍可使用可用部分。` : "核心本地能力可用。"}
      </p>
      <div className="service-list">
        <StatusRow label="文本解析" state={snapshot.services.parser} detail="TXT、MD、CSV、JSON、ICS、DOCX、PDF、XLSX 等本地解析" />
        <StatusRow label="图片 OCR" state={snapshot.services.ocr} detail="截图和图片中的截止时间识别" />
        <StatusRow label="大模型抽取" state={snapshot.services.model} detail="配置 API 后用于标题压缩、重要性判断和复杂语句整理" />
        <StatusRow label="本地数据" state="ready" detail="日程、来源和偏好保存到本机应用数据目录" />
        <StatusRow label="隐私状态" state="ready" detail={snapshot.services.privacy} />
      </div>
      <section className="third-party-credit">
        <h3>桌宠形象</h3>
        <p>当前桌宠形象基于开源项目 XIAOTONG Desktop Pet / 蓝色小嗵，Chroni 已保留其许可证和附加条款副本。</p>
        <a href="https://github.com/gildingmazzonimo621-design/XIAOTONG-Desktop-pet" target="_blank" rel="noreferrer">原始项目仓库</a>
      </section>
      <details className="advanced-settings">
        <summary>排错说明</summary>
        <ul className="notes">{snapshot.services.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      </details>
      <button className="secondary" type="button" onClick={() => void api.openStorage()}>打开本地数据位置</button>
    </div>
  );
}

function SourceHistory({ sources, setSnapshot }: { sources: SourceRecord[]; setSnapshot: ViewProps["setSnapshot"] }) {
  const [filter, setFilter] = useState<"all" | SourceRecord["extractionStatus"]>("all");
  const stats = sourceStats(sources);
  const visibleSources = sources.filter((source) => filter === "all" || source.extractionStatus === filter).slice(0, 16);
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
          <p>{sources.length} 条 · 成功 {stats.success} · 已存在 {stats.duplicate} · 失败 {stats.failed}</p>
        </div>
      </summary>
      <div className="source-controls">
        <div className="segmented">
          <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>全部</button>
          <button className={filter === "failed" ? "active" : ""} type="button" onClick={() => setFilter("failed")}>失败</button>
          <button className={filter === "success" ? "active" : ""} type="button" onClick={() => setFilter("success")}>已生成</button>
          <button className={filter === "duplicate" ? "active" : ""} type="button" onClick={() => setFilter("duplicate")}>已存在</button>
        </div>
      </div>
      <div className="source-list">
        {visibleSources.map((source) => <SourceRow key={source.id} source={source} setSnapshot={setSnapshot} />)}
      </div>
      {!visibleSources.length && <div className="empty compact-empty">没有符合条件的来源。</div>}
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
    setBusyMessage("正在重新识别...");
    setFeedback("");
    try {
      const snapshot = await api.updateSourceText(source.id, draftText);
      setSnapshot(snapshot);
      const result = await api.reprocessSource(source.id);
      setSnapshot(result.snapshot);
      setFeedback(result.ok ? result.message : result.reason);
    } catch (error) {
      setFeedback(formatOperationError(error, "重新识别失败"));
    } finally {
      setBusyMessage("");
    }
  }

  async function reprocessOnly() {
    if (isBusy) return;
    setBusyMessage("正在重新识别...");
    setFeedback("");
    try {
      const result = await api.reprocessSource(source.id);
      setSnapshot(result.snapshot);
      setFeedback(result.ok ? result.message : result.reason);
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
          {source.sourceType} · {source.text.length} 字 · {source.itemIds.length} 条日程 · {formatSourceTime(source.lastExtractedAt)}
        </span>
        {source.lastError && <strong className="source-error">{source.lastError}</strong>}
        <details>
          <summary>{source.text.slice(0, 120) || "查看原文"}</summary>
          <textarea className="source-textarea" aria-label={`编辑 ${source.sourceName} 的抽取文本`} value={draftText} disabled={isBusy} onChange={(event) => setDraftText(event.target.value)} />
          <div className="source-detail-actions">
            <button type="button" disabled={isBusy} onClick={() => void saveText()}>{busyMessage === "正在保存..." ? "保存中" : "保存原文"}</button>
            <button type="button" disabled={isBusy} onClick={() => void saveAndReprocess()}>{busyMessage === "正在重新识别..." ? "识别中" : "保存并重新识别"}</button>
          </div>
          {(busyMessage || feedback) && <p className={`source-feedback ${busyMessage ? "busy" : ""}`} role={busyMessage ? "status" : feedback.includes("失败") ? "alert" : "status"} aria-live="polite">{busyMessage || feedback}</p>}
        </details>
      </div>
      <button type="button" disabled={isBusy} onClick={() => void reprocessOnly()}>{busyMessage === "正在重新识别..." ? "识别中" : "重新识别"}</button>
    </article>
  );
}

function DdlList({ items, sources = [], setSnapshot, compact = false, editable = false, emptyText = "暂时没有需要马上处理的 DDL。", onAction, ariaLabel }: { items: DdlItem[]; sources?: SourceRecord[]; setSnapshot: ViewProps["setSnapshot"]; compact?: boolean; editable?: boolean; emptyText?: string; onAction?(notice: ActionNotice): void; ariaLabel?: string }) {
  if (!items.length) return <div className="empty">{emptyText}</div>;
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  return (
    <div className={`ddl-list ${compact ? "compact" : ""}`} role="list" aria-label={ariaLabel}>
      {items.map((item) => (
        <DdlRow key={item.id} item={item} source={item.sourceId ? sourceMap.get(item.sourceId) : undefined} setSnapshot={setSnapshot} editable={editable} onAction={onAction} />
      ))}
    </div>
  );
}

function DdlRow({ item, source, setSnapshot, editable, onAction }: { item: DdlItem; source?: SourceRecord; setSnapshot: ViewProps["setSnapshot"]; editable?: boolean; onAction?(notice: ActionNotice): void }) {
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
          run: () => update({ snoozedUntil: item.snoozedUntil }),
          doneMessage: "已取消这次稍后提醒。",
        },
      },
      "稍后提醒设置失败，请重试。",
    );
  }

  async function cancelSnooze(): Promise<void> {
    await runItemAction(
      "正在取消",
      () => update({ snoozedUntil: undefined }),
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
      () => update({ title, importance: draft.importance, dueAt: dueAt.toISOString() }),
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
            {item.completed ? "↶" : "✓"}
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
              <span className={`source-chip ${snoozed ? "snoozed-chip" : ""}`} title={item.sourceSummary}>
                {snoozed && item.snoozedUntil ? `稍后至 ${formatDue(item.snoozedUntil)}` : source?.sourceName ?? "手动录入"}
              </span>
            </div>
          </div>
          <div className="editor-actions">
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
              <label className="edit-field date-field">截止时间<input type="datetime-local" value={toInputDate(draft.dueAt)} disabled={isBusy} onChange={(event) => {
                const date = new Date(event.target.value);
                setDraft({ ...draft, dueAt: Number.isNaN(date.getTime()) ? "" : date.toISOString() });
              }} /></label>
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
      <button className="check" type="button" title="完成" aria-label={`完成 ${item.title}`} disabled={isBusy} onClick={() => void completeItem()}>✓</button>
      <button className="row-main" type="button" onClick={() => void api.openControlCenter().catch(() => onAction?.({ message: "暂时无法打开控制中心。", tone: "warn" }))}>
        <span className="title-line">
          <strong>{item.title}</strong>
          {fresh && <b className="new-chip">新</b>}
        </span>
        <span>{importanceLabel(item.importance)}</span>
        <time>{formatDue(item.dueAt)}</time>
        <em>{remainingText(item.dueAt)}</em>
      </button>
      <div className="snooze-control" ref={snoozeControlRef}>
        <button ref={snoozeToggleRef} className="snooze" type="button" title="稍后提醒" aria-label={`稍后提醒 ${item.title}`} aria-expanded={snoozeMenuOpen} aria-controls={snoozeMenuId} disabled={isBusy} onClick={() => setSnoozeMenuOpen((current) => !current)}>⏱</button>
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
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
      <b className={`service-${state}`}>{state === "ready" ? "可用" : state === "limited" ? "基础可用" : "不可用"}</b>
    </div>
  );
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

type ControlTab = "schedule" | "agent" | "preferences" | "services";

function agentStatusLabel(status: NonNullable<ChroniSnapshot["agent"]["latestRun"]>["verification"]["status"]): string {
  return status === "healthy" ? "安排正常" : status === "critical" ? "需要立即处理" : "需要关注";
}

function agentRiskLabel(level: NonNullable<ChroniSnapshot["agent"]["latestRun"]>["priorities"][number]["riskLevel"]): string {
  return level === "critical" ? "严重" : level === "high" ? "高" : level === "medium" ? "中" : "低";
}

function agentStageLabel(stage: NonNullable<ChroniSnapshot["agent"]["latestRun"]>["trace"][number]["stage"]): string {
  return stage === "observe" ? "观察" : stage === "plan" ? "规划" : stage === "act" ? "执行" : "验证";
}

function formatAgentClock(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatAgentTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

const companionStyleOptions: { value: CompanionStyle; label: string }[] = [
  { value: "classic", label: "经典" },
  { value: "mint", label: "清新" },
  { value: "sunrise", label: "晨光" },
];

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
      : "暂无 DDL。把文件、截图或文字拖给桌宠，或在这里快速添加。";

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
  }, { success: 0, duplicate: 0, failed: 0 });
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
  if (value === "duplicate") return "已存在";
  return "失败";
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
  return /^(已|成功|完成)/.test(message);
}

function acceptedFileTypes(): string {
  return ".txt,.md,.csv,.tsv,.json,.ics,.log,.html,.htm,.xml,.yaml,.yml,.rtf,.docx,.pdf,.xlsx,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff";
}

async function filesFromFileList(fileList: FileList | File[] | null): Promise<ChroniInputFile[]> {
  if (!fileList) return [];
  return Promise.all(Array.from(fileList).map(async (file) => {
    const path = safeFilePath(file);
    if (path) return { path, name: file.name, type: file.type };
    const contentBase64 = await fileToBase64(file);
    return { name: file.name, type: file.type, contentBase64 };
  }));
}

function safeFilePath(file: File): string {
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

function PetSprite({ action }: { action: PetAction }) {
  const frames = petAnimationFrames[action].length ? petAnimationFrames[action] : petAnimationFrames.idle;
  const [frameIndex, setFrameIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    setFrameIndex(0);
    setFinished(false);
    if (frames.length <= 1) return;
    const loop = petAnimationLoops[action];
    const interval = window.setInterval(() => {
      setFrameIndex((current) => {
        const next = current + 1;
        if (next < frames.length) return next;
        if (loop) return 0;
        window.clearInterval(interval);
        setFinished(true);
        return current;
      });
    }, 1000 / petAnimationFps[action]);
    return () => window.clearInterval(interval);
  }, [action, frames]);

  const displayFrames = finished && action !== "sleep" ? petAnimationFrames.idle : frames;
  return <img className="pet-art" src={displayFrames[Math.min(frameIndex, displayFrames.length - 1)]} alt="" draggable={false} />;
}

function collectPetFrames(action: PetAction): string[] {
  const needle = `/frames/${action}/`;
  return Object.entries(petFrameModules)
    .filter(([path]) => path.includes(needle))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, url]) => url);
}

function petAction(state: CompanionState): PetAction {
  const map: Record<CompanionState, PetAction> = {
    idle: "idle",
    clicked: "wake",
    hover_accept: "drag",
    processing: "study",
    success: "pet",
    confused: "cat",
    deadline_near: "study",
    overdue: "study",
    celebrating: "pet",
    sleeping: "sleep",
  };
  return map[state];
}

function isPersistentPetFeedback(state: CompanionState): boolean {
  return state === "hover_accept" || state === "processing" || state === "deadline_near" || state === "overdue";
}

function isTransientPetFeedback(state: CompanionState): boolean {
  return state === "clicked" || state === "success" || state === "confused" || state === "celebrating";
}

function petLabel(state: CompanionState): string {
  const map: Record<CompanionState, string> = {
    idle: "DDL",
    clicked: "Hi",
    hover_accept: "Drop",
    processing: "...",
    success: "OK",
    confused: "?",
    deadline_near: "!",
    overdue: "!!",
    celebrating: "✓",
    sleeping: "Z",
  };
  return map[state];
}

createRoot(document.getElementById("root")!).render(<App />);
