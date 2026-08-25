import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChroniSnapshot,
  LearningMission,
  LearningMissionCheckpointInput,
} from "../../../shared/types";
import { formatOperationError } from "../../../shared/errors";
import { UiIcon } from "./UiIcon";

type Props = {
  snapshot: ChroniSnapshot;
  setSnapshot: React.Dispatch<React.SetStateAction<ChroniSnapshot | null>>;
};

type MissionFilter = "current" | "risk" | "completed" | "all";

const api = window.chroni;

export function LearningMissionWorkspace({ snapshot, setSnapshot }: Props) {
  const [filter, setFilter] = useState<MissionFilter>("current");
  const [selectedId, setSelectedId] = useState(snapshot.learningMissions[0]?.id ?? "");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState("");
  const missions = useMemo(() => snapshot.learningMissions.filter((mission) => {
    if (filter === "risk") return mission.status === "at-risk";
    if (filter === "completed") return mission.status === "completed";
    if (filter === "current") return mission.status !== "completed";
    return true;
  }), [filter, snapshot.learningMissions]);
  const selected = snapshot.learningMissions.find((mission) => mission.id === selectedId)
    ?? missions[0]
    ?? snapshot.learningMissions[0];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const activeCount = snapshot.learningMissions.filter((mission) => mission.status === "active").length;
  const riskCount = snapshot.learningMissions.filter((mission) => mission.status === "at-risk").length;
  const completedCount = snapshot.learningMissions.filter((mission) => mission.status === "completed").length;

  return (
    <div className="pane mission-workspace">
      <header className="pane-head mission-head">
        <div>
          <p>Learning Mission</p>
          <h2>学习任务控制台</h2>
          <span>以真实产出推进课程目标</span>
        </div>
        <div className="mission-head-stats" aria-label="学习任务概览">
          <span><b>{activeCount}</b> 执行中</span>
          <span className={riskCount ? "risk" : ""}><b>{riskCount}</b> 有风险</span>
          <span><b>{completedCount}</b> 已完成</span>
        </div>
      </header>

      <div className="mission-filter" role="tablist" aria-label="筛选学习任务">
        {([
          ["current", "当前"],
          ["risk", "风险"],
          ["completed", "已完成"],
          ["all", "全部"],
        ] as Array<[MissionFilter, string]>).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      {feedback && <p className={`inline-feedback ${/失败|无法|找不到|请选择/.test(feedback) ? "warn" : "ok"}`} role="status">{feedback}</p>}

      {!snapshot.learningMissions.length ? (
        <section className="mission-empty" role="status">
          <div className="mission-empty-mark" aria-hidden="true"><UiIcon name="check" /></div>
          <h3>还没有学习任务</h3>
          <p>从课程通知、作业说明或项目材料建立第一条任务。</p>
          <button className="primary" type="button" onClick={() => void api.openControlCenter({ tab: "schedule" })}>导入课程要求</button>
        </section>
      ) : (
        <div className="mission-layout">
          <aside className="mission-list" aria-label="学习任务列表">
            {missions.length ? missions.map((mission) => (
              <MissionListItem key={mission.id} mission={mission} selected={mission.id === selected?.id} onSelect={() => setSelectedId(mission.id)} />
            )) : <p className="mission-list-empty">此筛选下暂无任务。</p>}
          </aside>
          {selected && (
            <MissionDetail
              mission={selected}
              busy={busy}
              setBusy={setBusy}
              setFeedback={setFeedback}
              setSnapshot={setSnapshot}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MissionListItem({ mission, selected, onSelect }: { mission: LearningMission; selected: boolean; onSelect(): void }) {
  return (
    <button className={`mission-list-item ${selected ? "selected" : ""} status-${mission.status}`} type="button" onClick={onSelect}>
      <span className="mission-list-topline">
        <span className="mission-status-dot" aria-hidden="true" />
        <span>{missionStatusLabel(mission.status)}</span>
        <time dateTime={mission.dueAt}>{formatMissionDue(mission.dueAt)}</time>
      </span>
      <strong>{mission.title}</strong>
      <span className="mission-next">下一步 · {mission.nextAction}</span>
      <span className="mission-list-progress" aria-label={`任务进度 ${mission.progressPercent}%`}>
        <i style={{ width: `${mission.progressPercent}%` }} />
      </span>
      <span className="mission-list-metrics">
        <span>{mission.progressPercent}% 进度</span>
        <span>{mission.evidenceCoveragePercent}% 证据覆盖</span>
      </span>
    </button>
  );
}

function MissionDetail({ mission, busy, setBusy, setFeedback, setSnapshot }: {
  mission: LearningMission;
  busy: string;
  setBusy(value: string): void;
  setFeedback(value: string): void;
  setSnapshot: Props["setSnapshot"];
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [deliverable, setDeliverable] = useState(mission.deliverables[0] ?? "");
  const [noteTitle, setNoteTitle] = useState("");
  const [note, setNote] = useState("");
  const [checkpoint, setCheckpoint] = useState<LearningMissionCheckpointInput>({ status: "on-track", summary: "", milestoneId: nextMilestoneId(mission) });

  useEffect(() => {
    setDeliverable(mission.deliverables[0] ?? "");
    setNoteTitle("");
    setNote("");
    setCheckpoint({ status: "on-track", summary: "", milestoneId: nextMilestoneId(mission) });
  }, [mission.id]);

  async function attachFile(file: File | undefined): Promise<void> {
    if (!file || busy) return;
    const path = api.filePath(file);
    if (!path) {
      setFeedback("当前文件没有可读取的本地路径，请从文件管理器重新选择。");
      return;
    }
    setBusy("file");
    setFeedback("");
    try {
      const next = await api.attachLearningMissionFile(mission.id, { path, ...(deliverable ? { linkedDeliverable: deliverable } : {}) });
      setSnapshot(next);
      setFeedback(`已登记产出证据：${file.name}`);
    } catch (error) {
      setFeedback(formatOperationError(error, "文件证据登记失败"));
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function addNote(): Promise<void> {
    if (!noteTitle.trim() || !note.trim() || busy) {
      setFeedback("请填写证据名称和内容。");
      return;
    }
    setBusy("note");
    setFeedback("");
    try {
      const next = await api.addLearningMissionNote(mission.id, {
        title: noteTitle.trim(),
        note: note.trim(),
        ...(deliverable ? { linkedDeliverable: deliverable } : {}),
      });
      setSnapshot(next);
      setNoteTitle("");
      setNote("");
      setFeedback("证据说明已写入本地任务档案。");
    } catch (error) {
      setFeedback(formatOperationError(error, "证据说明保存失败"));
    } finally {
      setBusy("");
    }
  }

  async function recordCheckpoint(): Promise<void> {
    if (!checkpoint.summary.trim() || busy) {
      setFeedback("请先写下本次进展。");
      return;
    }
    if (checkpoint.status === "blocked" && !checkpoint.blocker?.trim()) {
      setFeedback("请写明当前阻塞原因。");
      return;
    }
    setBusy("checkpoint");
    setFeedback("");
    try {
      const next = await api.recordLearningMissionCheckpoint(mission.id, {
        ...checkpoint,
        summary: checkpoint.summary.trim(),
        ...(checkpoint.blocker?.trim() ? { blocker: checkpoint.blocker.trim() } : {}),
        ...(checkpoint.reflection?.trim() ? { reflection: checkpoint.reflection.trim() } : {}),
      });
      setSnapshot(next);
      setCheckpoint({ status: "on-track", summary: "", milestoneId: nextMilestoneId(next.learningMissions.find((candidate) => candidate.id === mission.id) ?? mission) });
      setFeedback("执行检查点已记录，下一步已重新计算。");
    } catch (error) {
      setFeedback(formatOperationError(error, "执行检查点保存失败"));
    } finally {
      setBusy("");
    }
  }

  async function removeEvidence(evidenceId: string): Promise<void> {
    if (busy) return;
    setBusy(evidenceId);
    setFeedback("");
    try {
      const next = await api.removeLearningMissionEvidence(mission.id, evidenceId);
      setSnapshot(next);
      setFeedback("证据记录已移除。");
    } catch (error) {
      setFeedback(formatOperationError(error, "证据记录移除失败"));
    } finally {
      setBusy("");
    }
  }

  async function completeMission(): Promise<void> {
    if (busy) return;
    setBusy("complete");
    setFeedback("");
    try {
      const next = await api.updateItem(mission.taskId, { completed: true, progressPercent: 100 });
      setSnapshot(next);
      setFeedback("学习任务已完成，成果档案会继续保留。");
    } catch (error) {
      setFeedback(formatOperationError(error, "任务状态更新失败"));
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="mission-detail" aria-labelledby="mission-detail-title">
      <header className="mission-detail-head">
        <div>
          <span className={`mission-status status-${mission.status}`}>{missionStatusLabel(mission.status)}</span>
          <h3 id="mission-detail-title">{mission.title}</h3>
          <p>{mission.goal}</p>
        </div>
        <div className="mission-detail-actions">
          <button className="secondary slim" type="button" onClick={() => void api.openControlCenter({ tab: "schedule", taskId: mission.taskId })}>执行计划</button>
          {mission.status !== "completed" && <button className="primary slim" type="button" disabled={!!busy} onClick={() => void completeMission()}>{busy === "complete" ? "保存中" : "标记完成"}</button>}
        </div>
      </header>

      <section className={`mission-command ${mission.status === "at-risk" ? "risk" : ""}`}>
        <div>
          <span>当前行动</span>
          <strong>{mission.nextAction}</strong>
          {mission.riskSummary && <small>{mission.riskSummary}</small>}
        </div>
        <time dateTime={mission.dueAt}>截止 {formatMissionDue(mission.dueAt, true)}</time>
      </section>

      <div className="mission-metrics" aria-label="学习任务指标">
        <Metric label="任务进度" value={mission.progressPercent} />
        <Metric label="产出证据" value={mission.evidenceCoveragePercent} />
        <div><b>{mission.milestones.filter((item) => item.status === "completed" || item.status === "skipped").length}/{mission.milestones.length}</b><span>里程碑</span></div>
        <div><b>{mission.sourceEvidenceCount}</b><span>来源依据</span></div>
      </div>

      <section className="mission-section mission-deliverables">
        <header><div><span>01</span><h4>目标与交付物</h4></div><small>{mission.deliverables.length} 项</small></header>
        <div className="mission-chip-list">
          {mission.deliverables.map((item) => <span key={item}>{item}</span>)}
        </div>
        {mission.successCriteria.length > 0 && (
          <div className="mission-criteria">
            <b>完成标准</b>
            <ul>{mission.successCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="mission-section">
        <header><div><span>02</span><h4>执行里程碑</h4></div><small>{formatMinutes(mission.milestones.reduce((sum, item) => sum + item.estimatedMinutes, 0))}</small></header>
        <ol className="mission-milestones">
          {mission.milestones.map((milestone, index) => (
            <li className={`status-${milestone.status}`} key={milestone.id}>
              <span className="mission-milestone-index">{milestone.status === "completed" || milestone.status === "skipped" ? <UiIcon name="check" /> : index + 1}</span>
              <div><strong>{milestone.title}</strong>{milestone.description && <p>{milestone.description}</p>}</div>
              <time>{formatMinutes(milestone.estimatedMinutes)}</time>
            </li>
          ))}
        </ol>
      </section>

      <section className="mission-section">
        <header><div><span>03</span><h4>产出证据</h4></div><small>{mission.evidence.length} 条已登记</small></header>
        <div className="mission-evidence-tools">
          <label>
            <span>关联交付物</span>
            <select value={deliverable} onChange={(event) => setDeliverable(event.target.value)}>
              <option value="">暂不关联</option>
              {mission.deliverables.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <input ref={fileInput} className="visually-hidden" type="file" onChange={(event) => void attachFile(event.target.files?.[0])} />
          <button className="secondary" type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}>{busy === "file" ? "校验中" : "选择成果文件"}</button>
        </div>
        <div className="mission-note-form">
          <input value={noteTitle} maxLength={160} placeholder="证据名称" aria-label="证据名称" onChange={(event) => setNoteTitle(event.target.value)} />
          <textarea value={note} maxLength={4000} placeholder="记录阶段结论、链接或验收说明" aria-label="证据内容" onChange={(event) => setNote(event.target.value)} />
          <button className="secondary slim" type="button" disabled={!!busy} onClick={() => void addNote()}>{busy === "note" ? "保存中" : "登记说明"}</button>
        </div>
        {mission.evidence.length > 0 ? (
          <ul className="mission-evidence-list">
            {mission.evidence.map((evidence) => (
              <li key={evidence.id}>
                <span className={`evidence-kind ${evidence.kind}`}>{evidence.kind === "file" ? "文件" : "记录"}</span>
                <div>
                  <strong>{evidence.title}</strong>
                  <p>{evidence.linkedDeliverable ? `关联：${evidence.linkedDeliverable}` : "未关联交付物"}{evidence.bytes !== undefined ? ` · ${formatBytes(evidence.bytes)}` : ""}</p>
                  {evidence.sha256 && <code title={evidence.sha256}>SHA-256 {evidence.sha256.slice(0, 12)}…</code>}
                  {evidence.note && <blockquote>{evidence.note}</blockquote>}
                </div>
                <button className="mission-remove" title="移除证据" aria-label={`移除证据 ${evidence.title}`} type="button" disabled={!!busy} onClick={() => void removeEvidence(evidence.id)}><UiIcon name="close" /></button>
              </li>
            ))}
          </ul>
        ) : <p className="mission-inline-empty">尚未登记产出证据。来源材料不会被误算为学习成果。</p>}
      </section>

      <section className="mission-section">
        <header><div><span>04</span><h4>执行检查点</h4></div><small>{mission.checkpoints.length} 次复盘</small></header>
        <div className="checkpoint-form">
          <label className="checkpoint-target">
            <span>关联里程碑</span>
            <select value={checkpoint.milestoneId ?? ""} onChange={(event) => setCheckpoint((current) => ({ ...current, milestoneId: event.target.value || undefined }))}>
              <option value="">整体任务</option>
              {mission.milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
            </select>
          </label>
          <div className="checkpoint-status" role="group" aria-label="执行状态">
            {([
              ["on-track", "按计划"],
              ["blocked", "有阻塞"],
              ["completed", "完成阶段"],
            ] as const).map(([value, label]) => <button key={value} type="button" className={checkpoint.status === value ? "active" : ""} onClick={() => setCheckpoint((current) => ({ ...current, status: value }))}>{label}</button>)}
          </div>
          <textarea value={checkpoint.summary} maxLength={1000} placeholder="这次完成了什么？" aria-label="本次进展" onChange={(event) => setCheckpoint((current) => ({ ...current, summary: event.target.value }))} />
          <div className="checkpoint-fields">
            <label><span>实际投入</span><input type="number" min={1} max={1440} value={checkpoint.actualMinutes ?? ""} placeholder="分钟" onChange={(event) => setCheckpoint((current) => ({ ...current, actualMinutes: event.target.value ? Number(event.target.value) : undefined }))} /></label>
            {checkpoint.status === "blocked" && <label className="wide"><span>阻塞原因</span><input value={checkpoint.blocker ?? ""} maxLength={1000} placeholder="缺少资料、环境或反馈" onChange={(event) => setCheckpoint((current) => ({ ...current, blocker: event.target.value }))} /></label>}
          </div>
          <textarea value={checkpoint.reflection ?? ""} maxLength={2000} placeholder="可选：下次如何做得更好" aria-label="复盘" onChange={(event) => setCheckpoint((current) => ({ ...current, reflection: event.target.value }))} />
          <button className="primary slim" type="button" disabled={!!busy} onClick={() => void recordCheckpoint()}>{busy === "checkpoint" ? "记录中" : "记录检查点"}</button>
        </div>
        {mission.checkpoints.length > 0 && (
          <ol className="checkpoint-history">
            {mission.checkpoints.slice(0, 6).map((entry) => (
              <li key={entry.id}>
                <span className={`checkpoint-dot status-${entry.status}`} aria-hidden="true" />
                <div><strong>{checkpointStatusLabel(entry.status)} · {formatCheckpointTime(entry.createdAt)}</strong>{entry.milestoneId && <em>{mission.milestones.find((milestone) => milestone.id === entry.milestoneId)?.title ?? "历史里程碑"}</em>}<p>{entry.summary}</p>{entry.blocker && <small>阻塞：{entry.blocker}</small>}{entry.reflection && <blockquote>{entry.reflection}</blockquote>}</div>
                {entry.actualMinutes && <time>{entry.actualMinutes} 分钟</time>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {(mission.sourceName || mission.sourceExcerpt) && (
        <details className="mission-source">
          <summary>查看来源依据与规划方式</summary>
          {mission.sourceName && <b>{mission.sourceName}</b>}
          {mission.sourceExcerpt && <p>{mission.sourceExcerpt}</p>}
          <small>{mission.plannerSource ? `规划来源：${plannerLabel(mission.plannerSource)}` : "尚未生成详细规划"}</small>
        </details>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="mission-percent"><b>{value}%</b><span>{label}</span><i><em style={{ width: `${value}%` }} /></i></div>;
}

function nextMilestoneId(mission: LearningMission): string | undefined {
  return mission.milestones.find((milestone) => milestone.status !== "completed" && milestone.status !== "skipped")?.id
    ?? mission.milestones[0]?.id;
}

function missionStatusLabel(status: LearningMission["status"]): string {
  if (status === "at-risk") return "需要调整";
  if (status === "active") return "执行中";
  if (status === "completed") return "已完成";
  return "待规划";
}

function checkpointStatusLabel(status: LearningMissionCheckpointInput["status"]): string {
  if (status === "blocked") return "有阻塞";
  if (status === "completed") return "阶段完成";
  return "按计划推进";
}

function plannerLabel(source: NonNullable<LearningMission["plannerSource"]>): string {
  if (source === "llm") return "大模型";
  if (source === "personalized-llm") return "个性化大模型";
  if (source === "rules-fallback") return "本地规则回退";
  return "本地规则";
}

function formatMissionDue(value: string, full = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", full
    ? { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
    : { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatCheckpointTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
