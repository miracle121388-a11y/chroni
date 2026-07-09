import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { fullScheduleSummary, visibleScheduleSummary } from "../../shared/schedule";
import type { CompanionState, CompanionStyle, DdlItem, ChroniInputFile, ChroniPreferences, ChroniPreferencesPatch, ChroniSnapshot, ExtractResult, Importance, IntakePayload, SourceRecord } from "../../shared/types";
import "./styles.css";

const api = window.chroni;

function useSnapshot(): [ChroniSnapshot | null, React.Dispatch<React.SetStateAction<ChroniSnapshot | null>>] {
  const [snapshot, setSnapshot] = useState<ChroniSnapshot | null>(null);
  useEffect(() => {
    void api.getSnapshot().then(setSnapshot);
    return api.onSnapshotUpdated(setSnapshot);
  }, []);
  return [snapshot, setSnapshot];
}

function App() {
  const view = new URLSearchParams(window.location.search).get("view") ?? "control";
  const [snapshot, setSnapshot] = useSnapshot();
  if (!snapshot) return <div className="loading">Chroni</div>;
  if (view === "pet") return <PetView snapshot={snapshot} setSnapshot={setSnapshot} />;
  if (view === "schedule") return <ScheduleView snapshot={snapshot} setSnapshot={setSnapshot} />;
  return <ControlCenter snapshot={snapshot} setSnapshot={setSnapshot} />;
}

function PetView({ snapshot, setSnapshot }: ViewProps) {
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [hovering, setHovering] = useState(false);
  const label = petLabel(snapshot.companion.state);

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const droppedFiles = Array.from(event.dataTransfer.files);
    const droppedText = event.dataTransfer.getData("text/plain");
    setHovering(false);
    const files = await filesFromFileList(droppedFiles);
    await api.companionHover(false);
    const result = files.length
      ? await api.intake({ kind: "files", files })
      : await api.intake({ kind: "text", text: droppedText });
    setSnapshot(result.snapshot);
  }

  return (
    <main
      className={`pet-shell state-${snapshot.companion.state} style-${snapshot.preferences.companionStyle}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!hovering) {
          setHovering(true);
          void api.companionHover(true).then(setSnapshot);
        }
      }}
      onDragLeave={() => {
        setHovering(false);
        void api.companionHover(false).then(setSnapshot);
      }}
      onDrop={(event) => void handleDrop(event)}
      onContextMenu={(event) => {
        event.preventDefault();
        void api.openPetMenu();
      }}
      onPointerDown={(event) => {
        dragStart.current = { x: event.screenX, y: event.screenY };
      }}
      onPointerMove={(event) => {
        if (!dragStart.current || event.buttons !== 1) return;
        const dx = event.screenX - dragStart.current.x;
        const dy = event.screenY - dragStart.current.y;
        dragStart.current = { x: event.screenX, y: event.screenY };
        api.dragWindow(dx, dy);
      }}
      onPointerUp={() => {
        dragStart.current = null;
        api.snapWindow();
      }}
    >
      <button className="pet-body" type="button" onClick={() => void api.companionClicked().then(setSnapshot)} aria-label="Chroni 桌宠">
        <span className="pet-face">
          <span className="pet-eye" />
          <span className="pet-eye" />
        </span>
        <span className="pet-mark">{label}</span>
      </button>
      <div className="bubble">{snapshot.companion.bubble}</div>
    </main>
  );
}

function ScheduleView({ snapshot, setSnapshot }: ViewProps) {
  const items = useMemo(() => topVisibleItems(snapshot.items), [snapshot.items]);
  const summary = useMemo(() => visibleScheduleSummary(snapshot.items), [snapshot.items]);
  const hiddenCount = activeVisibleCount(snapshot.items) - items.length;
  const emptyText = activeVisibleCount(snapshot.items)
    ? "近期没有需要提醒的 DDL，远期事项可在控制中心查看。"
    : "暂无 DDL。把文件、截图或文字拖给桌宠，或在这里快速添加。";
  const [quickText, setQuickText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busyMessage, setBusyMessage] = useState("");
  const isWindowsDrawer = api.platform === "win32";
  const isBusy = !!busyMessage;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") void api.showSchedule(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function quickAdd() {
    if (!quickText.trim() || isBusy) return;
    setBusyMessage("正在识别...");
    setFeedback("");
    try {
      const result = await api.quickAdd(quickText);
      setSnapshot(result.snapshot);
      setFeedback(result.ok ? result.message : result.reason);
      if (result.ok) setQuickText("");
    } finally {
      setBusyMessage("");
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
      <section className="schedule-panel">
        <header className="panel-head">
          <div>
            <p>Chroni</p>
            <h1>最近要注意</h1>
          </div>
          <div className="panel-actions">
            <button className="icon-btn" type="button" onClick={() => void api.openControlCenter()} title="控制中心">⚙</button>
            <button className="icon-btn quiet" type="button" onClick={() => void api.showSchedule(false)} title="收起日程">×</button>
          </div>
        </header>
        <div className="mini-stats">
          <span><b>{summary.overdue}</b> 逾期</span>
          <span><b>{summary.today}</b> 今日</span>
          <span><b>{summary.upcoming}</b> 近期</span>
        </div>
        <div className="quick-add">
          <input
            value={quickText}
            disabled={isBusy}
            onChange={(event) => setQuickText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void quickAdd();
            }}
            placeholder="快速添加：7月12日 23:59 课程报告"
          />
          <button type="button" disabled={isBusy} onClick={() => void quickAdd()}>＋</button>
        </div>
        {busyMessage && <p className="inline-feedback info">{busyMessage}</p>}
        {feedback && <p className={`inline-feedback ${feedback.includes("已加入") ? "ok" : "warn"}`}>{feedback}</p>}
        <DdlList items={items} setSnapshot={setSnapshot} compact emptyText={emptyText} onAction={setFeedback} />
        {hiddenCount > 0 && <button className="more-link" type="button" onClick={() => void api.openControlCenter()}>还有 {hiddenCount} 条，打开日程</button>}
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
          <button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}>日程</button>
          <button className={tab === "preferences" ? "active" : ""} onClick={() => setTab("preferences")}>偏好</button>
          <button className={tab === "services" ? "active" : ""} onClick={() => setTab("services")}>运行状态</button>
        </nav>
        <div className="sidebar-foot">
          <span>待处理 {pendingCount}</span>
          <b>{petLabel(snapshot.companion.state)}</b>
        </div>
      </aside>
      <section className="content">
        {tab === "schedule" && <CorrectionPane snapshot={snapshot} setSnapshot={setSnapshot} />}
        {tab === "preferences" && <PreferencesPane preferences={snapshot.preferences} setSnapshot={setSnapshot} />}
        {tab === "services" && <ServicesPane snapshot={snapshot} setSnapshot={setSnapshot} />}
      </section>
    </main>
  );
}

function CorrectionPane({ snapshot, setSnapshot }: ViewProps) {
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
  const summary = useMemo(() => fullScheduleSummary(snapshot.items), [snapshot.items]);
  const filteredItems = useMemo(() => {
    if (itemFilter === "completed") return snapshot.items.filter((item) => item.completed);
    if (itemFilter === "all") return snapshot.items;
    return snapshot.items.filter((item) => !item.completed);
  }, [itemFilter, snapshot.items]);

  async function addManual() {
    if (!manual.trim() || isBusy) return;
    setBusyMessage("正在识别...");
    setFeedback("");
    try {
      const result = await api.quickAdd(manual);
      setSnapshot(result.snapshot);
      setFeedback(result.ok ? result.message : result.reason);
      if (result.ok) setManual("");
    } finally {
      setBusyMessage("");
    }
  }

  async function extractFiles(fileList: FileList | null, fill: boolean) {
    if (isBusy) return;
    const files = await filesFromFileList(fileList);
    if (!files.length) return;
    const payload: IntakePayload = { kind: "files", files };
    setBusyMessage(fill ? "正在填入日程..." : "正在预览抽取...");
    setFeedback("");
    if (fill) {
      try {
        const result = await api.intake(payload);
        setSnapshot(result.snapshot);
        setFeedback(result.ok ? result.message : result.reason);
        setPreview(null);
        setPreviewPayload(null);
      } finally {
        setBusyMessage("");
      }
      return;
    }
    try {
      setPreview(await api.extract(payload));
      setPreviewPayload(payload);
    } finally {
      setBusyMessage("");
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
        <span className={summary.overdue ? "alert" : ""}>{summary.overdue} 逾期</span>
        <span>{summary.today} 今日</span>
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
          onChange={(event) => setManual(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addManual();
          }}
          placeholder="快速添加或重新识别：明天 18:00 交实验报告"
        />
        <button type="button" disabled={isBusy} onClick={() => void addManual()}>识别</button>
      </div>
      {busyMessage && <p className="inline-feedback info">{busyMessage}</p>}
      {feedback && <p className={`inline-feedback ${feedback.includes("已加入") ? "ok" : "warn"}`}>{feedback}</p>}
      <div
        className={`upload-box ${draggingFiles ? "dragging" : ""} ${isBusy ? "busy" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!draggingFiles && !isBusy) setDraggingFiles(true);
        }}
        onDragLeave={() => setDraggingFiles(false)}
        onDrop={(event) => void previewDroppedFiles(event)}
      >
        <input ref={fileInputRef} type="file" multiple hidden disabled={isBusy} onChange={(event) => void extractFiles(event.target.files, fileImportMode.current === "fill")} accept={acceptedFileTypes()} />
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
          <p>{filteredItems.length} 条</p>
        </div>
        <div className="segmented">
          <button className={itemFilter === "active" ? "active" : ""} type="button" onClick={() => setItemFilter("active")}>待处理</button>
          <button className={itemFilter === "completed" ? "active" : ""} type="button" onClick={() => setItemFilter("completed")}>已完成</button>
          <button className={itemFilter === "all" ? "active" : ""} type="button" onClick={() => setItemFilter("all")}>全部</button>
        </div>
      </div>
      <DdlList items={filteredItems} sources={snapshot.sources} setSnapshot={setSnapshot} editable emptyText={itemFilter === "completed" ? "还没有完成记录。" : "暂时没有需要处理的 DDL。"} onAction={setFeedback} />
      <SourceHistory sources={snapshot.sources} setSnapshot={setSnapshot} />
    </div>
  );
}

function PreferencesPane({ preferences, setSnapshot }: { preferences: ChroniPreferences; setSnapshot: ViewProps["setSnapshot"] }) {
  async function patch(next: ChroniPreferencesPatch) {
    setSnapshot(await api.updatePreferences(next));
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
          <label className="text-field">Base URL<input value={preferences.llm.baseUrl} placeholder="https://api.deepseek.com/v1" onChange={(event) => void patch({ llm: { baseUrl: event.target.value } })} /></label>
          <label className="text-field">模型<input value={preferences.llm.model} placeholder="deepseek-chat" onChange={(event) => void patch({ llm: { model: event.target.value } })} /></label>
          <label className="text-field">API Key<input type="password" value={preferences.llm.apiKey} placeholder="sk-..." onChange={(event) => void patch({ llm: { apiKey: event.target.value } })} /></label>
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
          <textarea className="source-textarea" value={draftText} disabled={isBusy} onChange={(event) => setDraftText(event.target.value)} />
          <div className="source-detail-actions">
            <button type="button" disabled={isBusy} onClick={() => void saveText()}>{busyMessage === "正在保存..." ? "保存中" : "保存原文"}</button>
            <button type="button" disabled={isBusy} onClick={() => void saveAndReprocess()}>{busyMessage === "正在重新识别..." ? "识别中" : "保存并重新识别"}</button>
          </div>
          {(busyMessage || feedback) && <p className={`source-feedback ${busyMessage ? "busy" : ""}`}>{busyMessage || feedback}</p>}
        </details>
      </div>
      <button type="button" disabled={isBusy} onClick={() => void reprocessOnly()}>{busyMessage === "正在重新识别..." ? "识别中" : "重新识别"}</button>
    </article>
  );
}

function DdlList({ items, sources = [], setSnapshot, compact = false, editable = false, emptyText = "暂时没有需要马上处理的 DDL。", onAction }: { items: DdlItem[]; sources?: SourceRecord[]; setSnapshot: ViewProps["setSnapshot"]; compact?: boolean; editable?: boolean; emptyText?: string; onAction?(message: string): void }) {
  if (!items.length) return <div className="empty">{emptyText}</div>;
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  return (
    <div className={`ddl-list ${compact ? "compact" : ""}`}>
      {items.map((item) => (
        <DdlRow key={item.id} item={item} source={item.sourceId ? sourceMap.get(item.sourceId) : undefined} setSnapshot={setSnapshot} editable={editable} onAction={onAction} />
      ))}
    </div>
  );
}

function DdlRow({ item, source, setSnapshot, editable, onAction }: { item: DdlItem; source?: SourceRecord; setSnapshot: ViewProps["setSnapshot"]; editable?: boolean; onAction?(message: string): void }) {
  const urgency = urgencyTone(item);
  const [draft, setDraft] = useState(item);
  const [busyAction, setBusyAction] = useState("");
  const fresh = isFreshItem(item);
  const snoozed = isSnoozed(item);
  const isBusy = !!busyAction;
  useEffect(() => setDraft(item), [item]);

  async function update(patch: Partial<DdlItem>) {
    if (isBusy) return;
    const snapshot = await api.updateItem(item.id, patch);
    setSnapshot(snapshot);
  }

  function updateDueAt(value: string): void {
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    void update({ dueAt: date.toISOString() });
  }

  async function runItemAction(message: string, action: () => Promise<void>, doneMessage?: string) {
    if (isBusy) return;
    setBusyAction(message);
    try {
      await action();
      if (doneMessage) onAction?.(doneMessage);
    } finally {
      setBusyAction("");
    }
  }

  async function completeItem() {
    await runItemAction("正在完成", () => update({ completed: true }), "已完成。");
  }

  async function snoozeItem() {
    await runItemAction("正在稍后", () => update({ snoozedUntil: new Date(Date.now() + 2 * 3_600_000).toISOString() }), "已稍后提醒 2 小时。");
  }

  if (editable) {
    return (
      <article className={`ddl-row edit tone-${urgency} ${snoozed ? "snoozed" : ""} ${item.completed ? "completed" : ""} ${isBusy ? "busy" : ""}`}>
        <input value={draft.title} disabled={isBusy} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => void update({ title: draft.title })} />
        <select value={draft.importance} disabled={isBusy} onChange={(event) => void update({ importance: event.target.value as Importance })}>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
        <input type="datetime-local" value={toInputDate(draft.dueAt)} disabled={isBusy} onChange={(event) => void updateDueAt(event.target.value)} />
        <span className={`source-chip ${snoozed ? "snoozed-chip" : ""}`} title={item.sourceSummary}>{snoozed && item.snoozedUntil ? `稍后至 ${formatDue(item.snoozedUntil)}` : source?.sourceName ?? "手动"}</span>
        {snoozed && <button type="button" disabled={isBusy} onClick={() => void runItemAction("正在取消", () => update({ snoozedUntil: undefined }), "已取消稍后提醒。")}>{busyAction === "正在取消" ? "取消中" : "取消稍后"}</button>}
        <button type="button" disabled={isBusy} onClick={() => void runItemAction("正在更新", () => update({ completed: !item.completed }), item.completed ? "已恢复为待处理。" : "已完成。")}>{busyAction === "正在更新" ? "处理中" : item.completed ? "恢复" : "完成"}</button>
        <button type="button" disabled={isBusy} onClick={() => void runItemAction("正在删除", async () => setSnapshot(await api.deleteItem(item.id)), "已删除误识别事项。")}>{busyAction === "正在删除" ? "删除中" : "删除"}</button>
      </article>
    );
  }

  return (
    <article className={`ddl-row tone-${urgency} ${isBusy ? "busy" : ""}`}>
      <button className="check" type="button" title="完成" disabled={isBusy} onClick={() => void completeItem()}>✓</button>
      <button className="row-main" type="button" onClick={() => void api.openControlCenter()}>
        <span className="title-line">
          <strong>{item.title}</strong>
          {fresh && <b className="new-chip">新</b>}
        </span>
        <span>{importanceLabel(item.importance)}</span>
        <time>{formatDue(item.dueAt)}</time>
        <em>{remainingText(item.dueAt)}</em>
      </button>
      <button className="snooze" type="button" title="稍后提醒" disabled={isBusy} onClick={() => void snoozeItem()}>⏱</button>
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

type ControlTab = "schedule" | "preferences" | "services";

const companionStyleOptions: { value: CompanionStyle; label: string }[] = [
  { value: "classic", label: "经典" },
  { value: "mint", label: "清新" },
  { value: "sunrise", label: "晨光" },
];

function topVisibleItems(items: DdlItem[]): DdlItem[] {
  const now = Date.now();
  return [...items]
    .filter((item) => !item.completed)
    .filter((item) => !item.snoozedUntil || new Date(item.snoozedUntil).getTime() <= now)
    .filter((item) => isSchedulePopoverItem(item, now))
    .sort(compareItems)
    .slice(0, 6);
}

function activeVisibleCount(items: DdlItem[]): number {
  const now = Date.now();
  return items
    .filter((item) => !item.completed)
    .filter((item) => !item.snoozedUntil || new Date(item.snoozedUntil).getTime() <= now)
    .length;
}

function sourceStats(sources: SourceRecord[]) {
  return sources.reduce((stats, source) => {
    stats[source.extractionStatus] += 1;
    return stats;
  }, { success: 0, duplicate: 0, failed: 0 });
}

function isFreshItem(item: DdlItem): boolean {
  return Date.now() - new Date(item.createdAt).getTime() <= 10 * 60_000;
}

function isSchedulePopoverItem(item: DdlItem, now: number): boolean {
  const dueTime = new Date(item.dueAt).getTime();
  if (Number.isNaN(dueTime)) return false;
  return dueTime <= now + 7 * 86_400_000 || isFreshItem(item);
}

function isSnoozed(item: DdlItem): boolean {
  return !!item.snoozedUntil && new Date(item.snoozedUntil).getTime() > Date.now();
}

function compareItems(a: DdlItem, b: DdlItem): number {
  const toneOrder = { red: 3, orange: 2, gray: 1 };
  const toneDiff = toneOrder[urgencyTone(b)] - toneOrder[urgencyTone(a)];
  if (toneDiff) return toneDiff;
  const importanceDiff = importanceScore(b.importance) - importanceScore(a.importance);
  if (importanceDiff) return importanceDiff;
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

function urgencyTone(item: DdlItem): "red" | "orange" | "gray" {
  const hours = (new Date(item.dueAt).getTime() - Date.now()) / 3_600_000;
  if (hours <= 24) return "red";
  if (hours <= 72) return "orange";
  return "gray";
}

function importanceScore(value: Importance): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
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
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function remainingText(value: string): string {
  const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3_600_000);
  if (hours < 0) return "已逾期";
  if (hours <= 24) return `剩余 ${hours} 小时`;
  return `剩余 ${Math.ceil(hours / 24)} 天`;
}

function toInputDate(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
