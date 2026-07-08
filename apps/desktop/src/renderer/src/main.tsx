import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  const summary = useMemo(() => scheduleSummary(snapshot.items), [snapshot.items]);
  const hiddenCount = activeVisibleCount(snapshot.items) - items.length;
  const [quickText, setQuickText] = useState("");
  const [feedback, setFeedback] = useState("");
  const isWindowsDrawer = api.platform === "win32";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") void api.showSchedule(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function quickAdd() {
    if (!quickText.trim()) return;
    const result = await api.quickAdd(quickText);
    setSnapshot(result.snapshot);
    setFeedback(result.ok ? result.message : result.reason);
    if (result.ok) setQuickText("");
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
            onChange={(event) => setQuickText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void quickAdd();
            }}
            placeholder="快速添加：7月12日 23:59 课程报告"
          />
          <button type="button" onClick={() => void quickAdd()}>＋</button>
        </div>
        {feedback && <p className={`inline-feedback ${feedback.includes("已加入") ? "ok" : "warn"}`}>{feedback}</p>}
        <DdlList items={items} setSnapshot={setSnapshot} compact emptyText="暂无 DDL。把文件、截图或文字拖给桌宠，或在这里快速添加。" onAction={setFeedback} />
        {hiddenCount > 0 && <button className="more-link" type="button" onClick={() => void api.openControlCenter()}>还有 {hiddenCount} 条，打开轻量修正</button>}
      </section>
    </main>
  );
}

function ControlCenter({ snapshot, setSnapshot }: ViewProps) {
  const [tab, setTab] = useState<"correction" | "preferences" | "services">("correction");
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
        <nav>
          <button className={tab === "correction" ? "active" : ""} onClick={() => setTab("correction")}>轻量修正</button>
          <button className={tab === "preferences" ? "active" : ""} onClick={() => setTab("preferences")}>基础偏好</button>
          <button className={tab === "services" ? "active" : ""} onClick={() => setTab("services")}>服务状态</button>
        </nav>
      </aside>
      <section className="content">
        {tab === "correction" && <CorrectionPane snapshot={snapshot} setSnapshot={setSnapshot} />}
        {tab === "preferences" && <PreferencesPane preferences={snapshot.preferences} setSnapshot={setSnapshot} />}
        {tab === "services" && <ServicesPane snapshot={snapshot} />}
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileImportMode = useRef<"preview" | "fill">("preview");
  const summary = useMemo(() => scheduleSummary(snapshot.items), [snapshot.items]);
  const filteredItems = useMemo(() => {
    if (itemFilter === "completed") return snapshot.items.filter((item) => item.completed);
    if (itemFilter === "all") return snapshot.items;
    return snapshot.items.filter((item) => !item.completed);
  }, [itemFilter, snapshot.items]);

  async function addManual() {
    if (!manual.trim()) return;
    const result = await api.quickAdd(manual);
    setSnapshot(result.snapshot);
    setFeedback(result.ok ? result.message : result.reason);
    if (result.ok) setManual("");
  }

  async function extractFiles(fileList: FileList | null, fill: boolean) {
    const files = await filesFromFileList(fileList);
    if (!files.length) return;
    const payload: IntakePayload = { kind: "files", files };
    if (fill) {
      const result = await api.intake(payload);
      setSnapshot(result.snapshot);
      setFeedback(result.ok ? result.message : result.reason);
      setPreview(null);
      setPreviewPayload(null);
      return;
    }
    setPreview(await api.extract(payload));
    setPreviewPayload(payload);
    setFeedback("");
  }

  async function previewDroppedFiles(event: React.DragEvent) {
    event.preventDefault();
    setDraggingFiles(false);
    await extractFiles(event.dataTransfer.files, false);
  }

  return (
    <div className="pane">
      <header className="pane-head">
        <div>
          <p>自动结果不对时再来这里</p>
          <h2>轻量修正</h2>
        </div>
      </header>
      <div className="summary-line">
        <span>{summary.active} 待处理</span>
        <span className={summary.overdue ? "alert" : ""}>{summary.overdue} 逾期</span>
        <span>{summary.today} 今日</span>
      </div>
      <div className="manual-row">
        <input
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addManual();
          }}
          placeholder="快速添加或重新识别：明天 18:00 交实验报告"
        />
        <button type="button" onClick={() => void addManual()}>识别</button>
      </div>
      {feedback && <p className={`inline-feedback ${feedback.includes("已加入") ? "ok" : "warn"}`}>{feedback}</p>}
      <div
        className={`upload-box ${draggingFiles ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!draggingFiles) setDraggingFiles(true);
        }}
        onDragLeave={() => setDraggingFiles(false)}
        onDrop={(event) => void previewDroppedFiles(event)}
      >
        <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => void extractFiles(event.target.files, fileImportMode.current === "fill")} accept={acceptedFileTypes()} />
        <button type="button" onClick={() => { fileImportMode.current = "preview"; fileInputRef.current?.click(); }}>上传并预览抽取</button>
        <button type="button" onClick={() => { fileImportMode.current = "fill"; fileInputRef.current?.click(); }}>直接填入日程</button>
        <p>可把文件拖到这里预览。支持 TXT、MD、CSV、JSON、ICS、HTML、DOCX、PDF、XLSX、PNG/JPG/WEBP/TIFF。</p>
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
            <button type="button" onClick={async () => {
              const result = await api.intake(previewPayload ?? { kind: "text", text: preview.extracted.map((input) => input.text).join("\n") });
              setSnapshot(result.snapshot);
              setFeedback(result.ok ? result.message : result.reason);
              setPreview(null);
              setPreviewPayload(null);
            }}>填入日程</button>
          )}
        </div>
      )}
      <SourceHistory sources={snapshot.sources} setSnapshot={setSnapshot} />
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
      <DdlList items={filteredItems} sources={snapshot.sources} setSnapshot={setSnapshot} editable emptyText={itemFilter === "completed" ? "还没有完成记录。" : "暂时没有需要处理的 DDL。"} />
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
          <h2>基础偏好</h2>
        </div>
      </header>
      <section className="settings-group">
        <div>
          <h3>桌面入口</h3>
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
        <label className="text-field compact-field">唤起日程快捷键<input value={preferences.hotkey} onChange={(event) => void patch({ hotkey: event.target.value })} /></label>
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
        <div className="section-head">
          <div>
            <h3>智能抽取</h3>
            <p>默认使用本地规则；配置 API 后优先用 LLM 压缩标题和判断重要性。</p>
          </div>
          <span className="mode-chip">{modelMode}</span>
        </div>
        <Toggle label="启用 LLM 抽取" checked={preferences.llm.enabled} onChange={(value) => void patch({ llm: { enabled: value } })} />
        <details className="advanced-settings">
          <summary>API 设置</summary>
          <label className="text-field">Base URL<input value={preferences.llm.baseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => void patch({ llm: { baseUrl: event.target.value } })} /></label>
          <label className="text-field">模型<input value={preferences.llm.model} placeholder="gpt-4.1-mini" onChange={(event) => void patch({ llm: { model: event.target.value } })} /></label>
          <label className="text-field">API Key<input type="password" value={preferences.llm.apiKey} placeholder="sk-..." onChange={(event) => void patch({ llm: { apiKey: event.target.value } })} /></label>
        </details>
      </section>
    </div>
  );
}

function ServicesPane({ snapshot }: { snapshot: ChroniSnapshot }) {
  const unavailableCount = [snapshot.services.parser, snapshot.services.ocr, snapshot.services.model].filter((state) => state === "unavailable").length;
  return (
    <div className="pane narrow service-pane">
      <header className="pane-head">
        <div>
          <p>基础排错</p>
          <h2>服务状态</h2>
        </div>
      </header>
      <p className={`service-summary ${unavailableCount ? "warn" : ""}`}>
        {unavailableCount ? `${unavailableCount} 项能力不可用，仍可使用可用部分。` : "核心本地能力可用。"}
      </p>
      <div className="service-list">
        <StatusRow label="文本解析" state={snapshot.services.parser} />
        <StatusRow label="图片 OCR" state={snapshot.services.ocr} />
        <StatusRow label="大模型抽取" state={snapshot.services.model} />
      </div>
      <p className="privacy">{snapshot.services.privacy}</p>
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
      <section className="source-history">
        <div className="section-head">
          <div>
            <h3>来源记录</h3>
            <p>拖拽、上传或文本输入后会保存在这里。</p>
          </div>
        </div>
        <div className="empty compact-empty">暂无来源记录。</div>
      </section>
    );
  }
  return (
    <section className="source-history">
      <div className="section-head">
        <div>
          <h3>来源记录</h3>
          <p>{sources.length} 条 · 成功 {stats.success} · 已存在 {stats.duplicate} · 失败 {stats.failed}</p>
        </div>
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
    </section>
  );
}

function SourceRow({ source, setSnapshot }: { source: SourceRecord; setSnapshot: ViewProps["setSnapshot"] }) {
  const [draftText, setDraftText] = useState(source.text);
  const [feedback, setFeedback] = useState("");
  useEffect(() => setDraftText(source.text), [source.text]);

  async function saveText(): Promise<ChroniSnapshot> {
    const snapshot = await api.updateSourceText(source.id, draftText);
    setSnapshot(snapshot);
    setFeedback("原文已保存。");
    return snapshot;
  }

  async function saveAndReprocess() {
    await saveText();
    const result = await api.reprocessSource(source.id);
    setSnapshot(result.snapshot);
    setFeedback(result.ok ? result.message : result.reason);
  }

  return (
    <article className="source-row">
      <div>
        <b>{source.sourceName}</b>
        <span>
          <em className={`source-status status-${source.extractionStatus}`}>{sourceStatusLabel(source.extractionStatus)}</em>
          {source.sourceType} · {source.text.length} 字 · {source.itemIds.length} 条日程 · {formatSourceTime(source.lastExtractedAt)}
        </span>
        {source.lastError && <strong className="source-error">{source.lastError}</strong>}
        <details>
          <summary>{source.text.slice(0, 120) || "查看原文"}</summary>
          <textarea className="source-textarea" value={draftText} onChange={(event) => setDraftText(event.target.value)} />
          <div className="source-detail-actions">
            <button type="button" onClick={() => void saveText()}>保存原文</button>
            <button type="button" onClick={() => void saveAndReprocess()}>保存并重新识别</button>
          </div>
          {feedback && <p className="source-feedback">{feedback}</p>}
        </details>
      </div>
      <button type="button" onClick={() => void api.reprocessSource(source.id).then((result) => setSnapshot(result.snapshot))}>重新识别</button>
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
  const fresh = isFreshItem(item);
  const snoozed = isSnoozed(item);
  useEffect(() => setDraft(item), [item]);

  async function update(patch: Partial<DdlItem>) {
    const snapshot = await api.updateItem(item.id, patch);
    setSnapshot(snapshot);
  }

  function updateDueAt(value: string): void {
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    void update({ dueAt: date.toISOString() });
  }

  async function completeItem() {
    await update({ completed: true });
    onAction?.("已完成。");
  }

  async function snoozeItem() {
    await update({ snoozedUntil: new Date(Date.now() + 2 * 3_600_000).toISOString() });
    onAction?.("已稍后提醒 2 小时。");
  }

  if (editable) {
    return (
      <article className={`ddl-row edit tone-${urgency} ${snoozed ? "snoozed" : ""} ${item.completed ? "completed" : ""}`}>
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => void update({ title: draft.title })} />
        <select value={draft.importance} onChange={(event) => void update({ importance: event.target.value as Importance })}>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
        <input type="datetime-local" value={toInputDate(draft.dueAt)} onChange={(event) => void updateDueAt(event.target.value)} />
        <span className={`source-chip ${snoozed ? "snoozed-chip" : ""}`} title={item.sourceSummary}>{snoozed && item.snoozedUntil ? `稍后至 ${formatDue(item.snoozedUntil)}` : source?.sourceName ?? "手动"}</span>
        {snoozed && <button type="button" onClick={() => void update({ snoozedUntil: undefined })}>取消稍后</button>}
        <button type="button" onClick={() => void update({ completed: !item.completed })}>{item.completed ? "恢复" : "完成"}</button>
        <button type="button" onClick={() => void api.deleteItem(item.id).then(setSnapshot)}>删除</button>
      </article>
    );
  }

  return (
    <article className={`ddl-row tone-${urgency}`}>
      <button className="check" type="button" title="完成" onClick={() => void completeItem()}>✓</button>
      <button className="row-main" type="button" onClick={() => void api.openControlCenter()}>
        <span className="title-line">
          <strong>{item.title}</strong>
          {fresh && <b className="new-chip">新</b>}
        </span>
        <span>{importanceLabel(item.importance)}</span>
        <time>{formatDue(item.dueAt)}</time>
        <em>{remainingText(item.dueAt)}</em>
      </button>
      <button className="snooze" type="button" title="稍后提醒" onClick={() => void snoozeItem()}>⏱</button>
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

function StatusRow({ label, state }: { label: string; state: string }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <b className={`service-${state}`}>{state === "ready" ? "可用" : state === "limited" ? "基础可用" : "不可用"}</b>
    </div>
  );
}

type ViewProps = {
  snapshot: ChroniSnapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<ChroniSnapshot | null>>;
};

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

function scheduleSummary(items: DdlItem[]) {
  const now = Date.now();
  const today = new Date();
  return items.reduce((summary, item) => {
    const due = new Date(item.dueAt);
    const dueTime = due.getTime();
    if (item.completed) {
      summary.completed += 1;
      return summary;
    }
    summary.active += 1;
    if (dueTime < now) summary.overdue += 1;
    if (sameLocalDay(due, today)) summary.today += 1;
    if (dueTime >= now && dueTime <= now + 7 * 86_400_000) summary.upcoming += 1;
    return summary;
  }, { active: 0, completed: 0, overdue: 0, today: 0, upcoming: 0 });
}

function sourceStats(sources: SourceRecord[]) {
  return sources.reduce((stats, source) => {
    stats[source.extractionStatus] += 1;
    return stats;
  }, { success: 0, duplicate: 0, failed: 0 });
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isFreshItem(item: DdlItem): boolean {
  return Date.now() - new Date(item.createdAt).getTime() <= 10 * 60_000;
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
