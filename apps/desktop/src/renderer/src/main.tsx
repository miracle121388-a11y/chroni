import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CompanionState, DdlItem, ChroniInputFile, ChroniPreferences, ChroniPreferencesPatch, ChroniSnapshot, ExtractResult, Importance, SourceRecord } from "../../shared/types";
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
      className={`pet-shell state-${snapshot.companion.state}`}
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
        void api.openControlCenter();
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
  const hiddenCount = activeVisibleCount(snapshot.items) - items.length;
  const [quickText, setQuickText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isWindowsDrawer = navigator.userAgent.includes("Windows");

  async function quickAdd() {
    if (!quickText.trim()) return;
    const result = await api.quickAdd(quickText);
    setSnapshot(result.snapshot);
    if (result.ok) setQuickText("");
  }

  async function importFiles(fileList: FileList | null) {
    const files = await filesFromFileList(fileList);
    if (!files.length) return;
    const result = await api.intake({ kind: "files", files });
    setSnapshot(result.snapshot);
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
          <button className="icon-btn" type="button" onClick={() => void api.openControlCenter()} title="控制中心">⚙</button>
        </header>
        <div className="quick-add">
          <input value={quickText} onChange={(event) => setQuickText(event.target.value)} placeholder="快速添加：7月12日 23:59 课程报告" />
          <button type="button" onClick={() => void quickAdd()}>＋</button>
        </div>
        <div className="file-actions">
          <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => void importFiles(event.target.files)} accept={acceptedFileTypes()} />
          <button type="button" onClick={() => fileInputRef.current?.click()}>选择文件识别</button>
          <span>PDF / DOCX / XLSX / 图片 / 文本</span>
        </div>
        <DdlList items={items} setSnapshot={setSnapshot} compact />
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileImportMode = useRef<"preview" | "fill">("preview");
  const activeItems = snapshot.items.filter((item) => !item.completed);

  async function addManual() {
    if (!manual.trim()) return;
    const result = await api.quickAdd(manual);
    setSnapshot(result.snapshot);
    if (result.ok) setManual("");
  }

  async function extractFiles(fileList: FileList | null, fill: boolean) {
    const files = await filesFromFileList(fileList);
    if (!files.length) return;
    if (fill) {
      const result = await api.intake({ kind: "files", files });
      setSnapshot(result.snapshot);
      setPreview(null);
      return;
    }
    setPreview(await api.extract({ kind: "files", files }));
  }

  return (
    <div className="pane">
      <header className="pane-head">
        <div>
          <p>自动结果不对时再来这里</p>
          <h2>轻量修正</h2>
        </div>
      </header>
      <div className="manual-row">
        <input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="快速添加或重新识别：明天 18:00 交实验报告" />
        <button type="button" onClick={() => void addManual()}>识别</button>
      </div>
      <div className="upload-box">
        <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => void extractFiles(event.target.files, fileImportMode.current === "fill")} accept={acceptedFileTypes()} />
        <button type="button" onClick={() => { fileImportMode.current = "preview"; fileInputRef.current?.click(); }}>上传并预览抽取</button>
        <button type="button" onClick={() => { fileImportMode.current = "fill"; fileInputRef.current?.click(); }}>直接填入日程</button>
        <p>支持 TXT、MD、CSV、JSON、ICS、HTML、DOCX、PDF、XLSX、PNG/JPG/WEBP/TIFF。预览用于检查抽取字段，直接填入会跳过确认。</p>
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
          {preview.items.map((item) => (
            <article key={item.id}>
              <b>{item.title}</b>
              <span>{importanceLabel(item.importance)} · {formatDue(item.dueAt)} · {remainingText(item.dueAt)}</span>
            </article>
          ))}
          {preview.ok && (
            <button type="button" onClick={async () => {
              const text = preview.extracted.map((input) => input.text).join("\n");
              const result = await api.intake({ kind: "text", text });
              setSnapshot(result.snapshot);
              setPreview(null);
            }}>填入日程</button>
          )}
        </div>
      )}
      <SourceHistory sources={snapshot.sources} setSnapshot={setSnapshot} />
      <DdlList items={activeItems} sources={snapshot.sources} setSnapshot={setSnapshot} editable />
    </div>
  );
}

function PreferencesPane({ preferences, setSnapshot }: { preferences: ChroniPreferences; setSnapshot: ViewProps["setSnapshot"] }) {
  async function patch(next: ChroniPreferencesPatch) {
    setSnapshot(await api.updatePreferences(next));
  }
  return (
    <div className="pane narrow">
      <header className="pane-head">
        <div>
          <p>少而清晰</p>
          <h2>基础偏好</h2>
        </div>
      </header>
      <Toggle label="桌宠入口" checked={preferences.companionEnabled} onChange={(value) => void patch({ companionEnabled: value })} />
      <Toggle label="提醒" checked={preferences.remindersEnabled} onChange={(value) => void patch({ remindersEnabled: value })} />
      <Toggle label="勿扰时间" checked={preferences.quietHoursEnabled} onChange={(value) => void patch({ quietHoursEnabled: value })} />
      <div className="field-grid">
        <label>开始<input type="time" value={preferences.quietHoursStart} onChange={(event) => void patch({ quietHoursStart: event.target.value })} /></label>
        <label>结束<input type="time" value={preferences.quietHoursEnd} onChange={(event) => void patch({ quietHoursEnd: event.target.value })} /></label>
      </div>
      <label className="text-field">快捷键<input value={preferences.hotkey} onChange={(event) => void patch({ hotkey: event.target.value })} /></label>
      <section className="settings-section">
        <div className="section-head">
          <h3>智能抽取</h3>
          <p>配置 OpenAI-compatible API 后，拖拽、上传和本地 API 会优先使用 LLM 抽取，失败时自动回退规则引擎。</p>
        </div>
        <Toggle label="启用 LLM 抽取" checked={preferences.llm.enabled} onChange={(value) => void patch({ llm: { enabled: value } })} />
        <label className="text-field">Base URL<input value={preferences.llm.baseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => void patch({ llm: { baseUrl: event.target.value } })} /></label>
        <label className="text-field">模型<input value={preferences.llm.model} placeholder="gpt-4.1-mini" onChange={(event) => void patch({ llm: { model: event.target.value } })} /></label>
        <label className="text-field">API Key<input type="password" value={preferences.llm.apiKey} placeholder="sk-..." onChange={(event) => void patch({ llm: { apiKey: event.target.value } })} /></label>
      </section>
    </div>
  );
}

function ServicesPane({ snapshot }: { snapshot: ChroniSnapshot }) {
  return (
    <div className="pane narrow">
      <header className="pane-head">
        <div>
          <p>基础排错</p>
          <h2>服务状态</h2>
        </div>
      </header>
      <StatusRow label="文本解析" state={snapshot.services.parser} />
      <StatusRow label="图片 OCR" state={snapshot.services.ocr} />
      <StatusRow label="大模型抽取" state={snapshot.services.model} />
      <p className="privacy">{snapshot.services.privacy}</p>
      <ul className="notes">{snapshot.services.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      <button className="secondary" type="button" onClick={() => void api.openStorage()}>打开本地数据位置</button>
    </div>
  );
}

function SourceHistory({ sources, setSnapshot }: { sources: SourceRecord[]; setSnapshot: ViewProps["setSnapshot"] }) {
  if (!sources.length) return null;
  return (
    <section className="source-history">
      <div className="section-head">
        <h3>来源记录</h3>
        <p>用于查看原始输入摘要和重新识别。</p>
      </div>
      <div className="source-list">
        {sources.slice(0, 8).map((source) => (
          <article key={source.id} className="source-row">
            <div>
              <b>{source.sourceName}</b>
              <span>{source.sourceType} · {source.text.length} 字 · {source.itemIds.length} 条日程</span>
              <details>
                <summary>{source.text.slice(0, 120)}</summary>
                <pre>{source.text}</pre>
              </details>
            </div>
            <button type="button" onClick={() => void api.reprocessSource(source.id).then((result) => setSnapshot(result.snapshot))}>重新识别</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function DdlList({ items, sources = [], setSnapshot, compact = false, editable = false }: { items: DdlItem[]; sources?: SourceRecord[]; setSnapshot: ViewProps["setSnapshot"]; compact?: boolean; editable?: boolean }) {
  if (!items.length) return <div className="empty">暂时没有需要马上处理的 DDL。</div>;
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  return (
    <div className={`ddl-list ${compact ? "compact" : ""}`}>
      {items.map((item) => (
        <DdlRow key={item.id} item={item} source={item.sourceId ? sourceMap.get(item.sourceId) : undefined} setSnapshot={setSnapshot} editable={editable} />
      ))}
    </div>
  );
}

function DdlRow({ item, source, setSnapshot, editable }: { item: DdlItem; source?: SourceRecord; setSnapshot: ViewProps["setSnapshot"]; editable?: boolean }) {
  const urgency = urgencyTone(item);
  const [draft, setDraft] = useState(item);
  useEffect(() => setDraft(item), [item]);

  async function update(patch: Partial<DdlItem>) {
    const snapshot = await api.updateItem(item.id, patch);
    setSnapshot(snapshot);
  }

  if (editable) {
    return (
      <article className={`ddl-row edit tone-${urgency}`}>
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => void update({ title: draft.title })} />
        <select value={draft.importance} onChange={(event) => void update({ importance: event.target.value as Importance })}>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
        <input type="datetime-local" value={toInputDate(draft.dueAt)} onChange={(event) => void update({ dueAt: new Date(event.target.value).toISOString() })} />
        <span className="source-chip" title={item.sourceSummary}>{source?.sourceName ?? "手动"}</span>
        <button type="button" onClick={() => void api.deleteItem(item.id).then(setSnapshot)}>删除</button>
      </article>
    );
  }

  return (
    <article className={`ddl-row tone-${urgency}`}>
      <button className="check" type="button" title="完成" onClick={() => void update({ completed: true })}>✓</button>
      <button className="row-main" type="button" onClick={() => void api.openControlCenter()}>
        <strong>{item.title}</strong>
        <span>{importanceLabel(item.importance)}</span>
        <time>{formatDue(item.dueAt)}</time>
        <em>{remainingText(item.dueAt)}</em>
      </button>
      <button className="snooze" type="button" title="稍后提醒" onClick={() => void update({ snoozedUntil: new Date(Date.now() + 2 * 3_600_000).toISOString() })}>⏱</button>
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
