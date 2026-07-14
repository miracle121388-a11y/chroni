import React, { useEffect, useState } from "react";
import type { ChroniSnapshot, DdlItem, PendingClarification, PlanningPreference, TaskPlan, TaskPlanStep, TaskPlanUpdatePayload } from "../../../shared/types";
import { formatOperationError, formatUserFacingMessage } from "../../../shared/errors";

const api = window.chroni;

type SnapshotSetter = React.Dispatch<React.SetStateAction<ChroniSnapshot | null>>;

export function ClarificationPanel({ snapshot, setSnapshot, variant = "default" }: { snapshot: ChroniSnapshot; setSnapshot: SnapshotSetter; variant?: "default" | "agent" }) {
  const pending = snapshot.clarifications.filter((item) => item.status === "pending");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState("");
  if (!pending.length) return null;

  async function answer(item: PendingClarification, optionId?: string) {
    if (busyId) return;
    setBusyId(item.id);
    setFeedback("");
    try {
      const raw = answers[item.id]?.trim();
      const value = optionId ? undefined : clarificationValue(item, raw);
      const result = await api.answerClarification(item.id, optionId ? { optionId } : { value });
      setSnapshot(result.snapshot);
      setFeedback(safeWorkspaceMessage(result.message, "回答已保存。"));
    } catch (error) {
      setFeedback(formatOperationError(error, "回答未保存"));
    } finally {
      setBusyId("");
    }
  }

  async function reprocess(item: PendingClarification) {
    const draft = snapshot.intakeDrafts.find((candidate) => candidate.id === item.draftId);
    const sourceId = item.sourceId ?? draft?.sourceId;
    if (!sourceId || busyId) return;
    setBusyId(item.id);
    setFeedback("");
    try {
      const result = await api.reprocessSource(sourceId);
      setSnapshot(result.snapshot);
      setFeedback(result.ok ? safeWorkspaceMessage(result.message, "重新识别已完成。") : safeWorkspaceMessage(result.reason, "重新识别未完成，请检查原内容。"));
    } catch (error) {
      setFeedback(formatOperationError(error, "重新识别失败"));
    } finally {
      setBusyId("");
    }
  }

  async function cancelDraft(item: PendingClarification) {
    if (busyId) return;
    setBusyId(item.id);
    setFeedback("");
    try {
      setSnapshot(await api.cancelIntakeDraft(item.draftId));
      setFeedback("已放弃这条待确认草稿。");
    } catch (error) {
      setFeedback(formatOperationError(error, "无法放弃草稿"));
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className={`clarification-panel ${variant === "agent" ? "agent-clarification-panel" : ""}`} aria-labelledby={`clarification-heading-${variant}`}>
      <header className="clarification-head">
        <div className="clarification-head-main">
          {variant === "agent" && <span className="clarification-mark" aria-hidden="true">?</span>}
          <div><p>需要你的确认</p><h3 id={`clarification-heading-${variant}`}>有 {pending.length} 条信息需要补充</h3></div>
        </div>
        <span className="clarification-count">{pending.length}</span>
      </header>
      {variant === "agent" && <p className="clarification-intro">只在标题或截止时间确实无法确定时询问；补充后会继续创建日程和执行规划。</p>}
      {pending.map((item) => {
        const draft = snapshot.intakeDrafts.find((candidate) => candidate.id === item.draftId);
        const sourceId = item.sourceId ?? draft?.sourceId;
        return (
          <article className="clarification-row" key={item.id}>
            <div className="clarification-meta">
              <span>{clarificationFieldLabel(item.field)}</span>
              {draft?.candidate.title && <em>草稿 · {draft.candidate.title}</em>}
            </div>
            <div className="clarification-copy">
              <b>{safeWorkspaceMessage(item.question, "请补充这条任务的必要信息。")}</b>
              <p>{safeWorkspaceMessage(item.reason, "原文信息不足，补充后才能建立准确日程。")}</p>
            </div>
            {!!item.options.length && <div className="clarification-options">{item.options.map((option) => <button type="button" key={option.id} disabled={!!busyId} onClick={() => void answer(item, option.id)}>{option.label}</button>)}</div>}
            {item.allowFreeText && (
              <div className="clarification-input">
                <input
                  type={item.field === "dueAt" || item.field === "dueTime" ? "datetime-local" : item.field === "estimatedMinutes" || item.field === "progressPercent" ? "number" : "text"}
                  value={answers[item.id] ?? ""}
                  aria-label={safeWorkspaceMessage(item.question, "补充任务信息")}
                  placeholder={clarificationPlaceholder(item.field)}
                  onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))}
                  disabled={!!busyId}
                />
                <button type="button" disabled={!!busyId || !answers[item.id]?.trim()} onClick={() => void answer(item)}>{busyId === item.id ? "保存中" : "确认"}</button>
              </div>
            )}
            <div className="clarification-actions">
              {sourceId && <button type="button" className="text-action reprocess-action" disabled={!!busyId} onClick={() => void reprocess(item)}>{busyId === item.id ? "处理中..." : "重新识别原内容"}</button>}
              <button type="button" className="text-action discard-action" disabled={!!busyId} onClick={() => void cancelDraft(item)}>放弃草稿</button>
            </div>
          </article>
        );
      })}
      {feedback && <p className={`inline-feedback ${isClarificationPositiveFeedback(feedback) ? "ok" : "warn"}`} aria-live="polite">{feedback}</p>}
    </section>
  );
}

function clarificationFieldLabel(field: PendingClarification["field"]): string {
  if (field === "title") return "缺少标题";
  if (field === "dueAt" || field === "dueTime") return "缺少截止时间";
  if (field === "estimatedMinutes") return "缺少预计用时";
  if (field === "progressPercent") return "缺少当前进度";
  return "需要补充";
}

function clarificationPlaceholder(field: PendingClarification["field"]): string {
  if (field === "title") return "输入任务名称";
  if (field === "estimatedMinutes") return "例如：90";
  if (field === "progressPercent") return "例如：50";
  return "选择日期和时间";
}

function isClarificationPositiveFeedback(message: string): boolean {
  return /已|成功|完成|加入|生成|识别/.test(message) && !/失败|无法|错误/.test(message);
}

export function TaskDetailPane({ task, snapshot, setSnapshot, onBack }: { task: DdlItem; snapshot: ChroniSnapshot; setSnapshot: SnapshotSetter; onBack(): void }) {
  const storedPlan = latestPlan(snapshot, task.id);
  const [draft, setDraft] = useState<TaskPlan | null>(storedPlan ? structuredClone(storedPlan) : null);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [draggedId, setDraggedId] = useState("");
  useEffect(() => {
    document.querySelector<HTMLElement>(".content")?.scrollTo({ top: 0, left: 0 });
  }, [task.id]);
  useEffect(() => setDraft(storedPlan ? structuredClone(storedPlan) : null), [storedPlan?.id, storedPlan?.version]);
  const revisions = snapshot.taskPlanRevisions.filter((item) => item.taskId === task.id).sort((a, b) => b.toVersion - a.toVersion);
  const safeStartAt = draft ? calculatedLatestSafeStart(task, draft) : undefined;
  const safeStartPassed = safeStartAt ? new Date(safeStartAt).getTime() < Date.now() : false;

  async function generate(regenerate = false) {
    setBusy(regenerate ? "regenerate" : "generate");
    setFeedback("");
    try {
      const result = await api.generateTaskPlan(task.id, regenerate);
      setSnapshot(result.snapshot);
      setDraft(structuredClone(result.plan));
      setFeedback(safeWorkspaceMessage(result.message, "规划草案已生成。"));
    } catch (error) {
      setFeedback(formatOperationError(error, "规划生成失败"));
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    setFeedback("");
    try {
      const payload: TaskPlanUpdatePayload = {
        baseVersion: draft.version,
        goal: draft.goal,
        deliverables: draft.deliverables,
        constraints: draft.constraints,
        steps: draft.steps,
        bufferMinutes: draft.bufferMinutes,
        summary: draft.summary,
        uncertainties: draft.uncertainties,
      };
      const result = await api.updateTaskPlan(task.id, payload);
      setSnapshot(result.snapshot);
      setDraft(structuredClone(result.plan));
      setFeedback(safeWorkspaceMessage(result.message, "规划修改已保存。"));
    } catch (error) {
      setFeedback(formatOperationError(error, "规划保存失败"));
    } finally {
      setBusy("");
    }
  }

  async function activate() {
    if (!draft) return;
    setBusy("activate");
    setFeedback("");
    try {
      const result = await api.activateTaskPlan(task.id, draft.id);
      setSnapshot(result.snapshot);
      setDraft(structuredClone(result.plan));
      setFeedback(safeWorkspaceMessage(result.message, "规划已确认并启用。"));
    } catch (error) {
      setFeedback(formatOperationError(error, "规划确认失败"));
    } finally {
      setBusy("");
    }
  }

  function updateStep(id: string, patch: Partial<TaskPlanStep>) {
    setDraft((current) => current ? { ...current, steps: current.steps.map((step) => step.id === id ? { ...step, ...patch } : step) } : current);
  }

  function moveStep(id: string, direction: -1 | 1) {
    setDraft((current) => current ? { ...current, steps: reorder(current.steps, id, Math.max(0, Math.min(current.steps.length - 1, current.steps.findIndex((step) => step.id === id) + direction))) } : current);
  }

  function removeStep(id: string) {
    setDraft((current) => current && current.steps.length > 1 ? { ...current, steps: current.steps.filter((step) => step.id !== id).map((step) => ({ ...step, dependsOn: step.dependsOn.filter((dependency) => dependency !== id) })) } : current);
  }

  function addStep() {
    const now = new Date().toISOString();
    const step: TaskPlanStep = { id: `step-user-${crypto.randomUUID()}`, taskId: task.id, title: "新步骤", description: "", estimatedMinutes: 30, order: (draft?.steps.length ?? 0) + 1, dependsOn: [], completionCriteria: [], status: "pending", origin: "user", userModifiedFields: ["createdByUser"], memoryPreferenceIds: [], createdAt: now, updatedAt: now };
    setDraft((current) => current ? { ...current, steps: [...current.steps, step] } : current);
  }

  return (
    <div className="task-detail-pane">
      <header className="task-detail-head">
        <button type="button" className="back-button" onClick={onBack} aria-label="返回日程列表">←</button>
        <div><p>任务详情</p><h2>{task.title}</h2></div>
        <span className={`plan-status ${draft?.status ?? "missing"}`}>{planStatus(draft)}</span>
      </header>
      <div className="task-facts"><span>DDL {formatDate(task.dueAt)}</span><span>{taskImportanceLabel(task.importance)}</span><span>{task.progressPercent ?? 0}% 完成</span><span>{safeWorkspaceMessage(task.sourceSummary, "手动录入")}</span></div>
      {task.extraction && (
        <section className="extracted-requirements" aria-label="原文提取要求">
          <header><h3>原文要求</h3><span>已校验来源</span></header>
          {!!task.extraction.deliverables.length && <div><b>提交物</b><ul>{task.extraction.deliverables.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {task.extraction.submissionMethod && <p><b>提交方式</b><span>{task.extraction.submissionMethod}</span></p>}
          {!!task.extraction.constraints.length && <div><b>限制</b><ul>{task.extraction.constraints.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {!!task.extraction.risks.length && <div><b>风险</b><ul>{task.extraction.risks.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {!!task.extraction.uncertainties.length && <div><b>待确认</b><ul>{task.extraction.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        </section>
      )}
      {!draft ? (
        <section className="plan-empty"><h3>尚未生成任务规划</h3><p>生成后可先检查草案，再由你确认是否启用。</p><button type="button" disabled={!!busy} onClick={() => void generate()}>{busy ? "生成中..." : "生成规划草案"}</button></section>
      ) : (
        <>
          <section className="plan-overview">
            <label>目标<input value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} /></label>
            <div className="plan-metrics"><span>{draft.steps.length} 个步骤</span><span>{draft.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0)} 分钟</span><label>缓冲 <input type="number" min="0" max="1440" value={draft.bufferMinutes} onChange={(event) => setDraft({ ...draft, bufferMinutes: Number(event.target.value) })} /> 分钟</label><span>{plannerLabel(draft)}</span></div>
            <p>{safeWorkspaceMessage(draft.summary, "任务规划草案已生成，请核对执行步骤。")}</p>
            {safeStartAt && <p className={safeStartPassed ? "plan-warning" : "memory-applied"}>建议最晚开始：{formatDate(safeStartAt)}{safeStartPassed ? "（已超过，建议立即调整计划）" : ""}</p>}
            {!!draft.memoryPreferenceIds.length && <p className="memory-applied">已使用 {draft.memoryPreferenceIds.length} 条个性化偏好</p>}
            {draft.uncertainties.map((uncertainty) => <p className="plan-warning" key={uncertainty}>{safeWorkspaceMessage(uncertainty, "这项信息仍需确认。")}</p>)}
            <details className="plan-revisions"><summary>计划依据 · {draft.deliverables.length} 项交付物</summary><div><b>交付物</b><ul>{draft.deliverables.map((item) => <li key={item}>{item}</li>)}</ul></div><div><b>约束</b><ul>{draft.constraints.map((item) => <li key={item}>{item}</li>)}</ul></div></details>
          </section>
          <section className="plan-steps" aria-label="任务步骤">
            <header><h3>执行步骤</h3><button type="button" className="secondary" onClick={addStep}>新增步骤</button></header>
            {draft.steps.map((step, index) => (
              <article
                className={`plan-step status-${step.status}`}
                key={step.id}
                draggable
                onDragStart={() => setDraggedId(step.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => { if (draggedId) setDraft({ ...draft, steps: reorder(draft.steps, draggedId, index) }); setDraggedId(""); }}
              >
                <div className="step-order"><b>{index + 1}</b><button type="button" title="上移" aria-label="上移步骤" disabled={index === 0} onClick={() => moveStep(step.id, -1)}>↑</button><button type="button" title="下移" aria-label="下移步骤" disabled={index === draft.steps.length - 1} onClick={() => moveStep(step.id, 1)}>↓</button></div>
                <div className="step-fields">
                  <input className="step-title" value={step.title} aria-label={`步骤 ${index + 1} 标题`} onChange={(event) => updateStep(step.id, { title: event.target.value })} />
                  <textarea value={step.description} aria-label={`步骤 ${index + 1} 说明`} onChange={(event) => updateStep(step.id, { description: event.target.value })} />
                  <div className="step-meta"><label>耗时 <input type="number" min="15" max="480" step="5" value={step.estimatedMinutes} onChange={(event) => updateStep(step.id, { estimatedMinutes: Number(event.target.value) })} /> 分钟</label><select value={step.status} aria-label={`步骤 ${index + 1} 状态`} onChange={(event) => updateStep(step.id, { status: event.target.value as TaskPlanStep["status"] })}><option value="pending">待开始</option><option value="in-progress">进行中</option><option value="blocked">受阻</option><option value="completed">已完成</option><option value="skipped">跳过</option></select><span>{step.origin === "user" ? "用户步骤" : step.userModifiedFields.length ? "已修改" : "Agent 建议"}</span></div>
                </div>
                <button type="button" className="remove-step" aria-label={`删除步骤 ${step.title}`} disabled={draft.steps.length === 1} onClick={() => removeStep(step.id)}>×</button>
              </article>
            ))}
          </section>
          <div className="plan-actions"><button type="button" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? "保存中..." : "保存修改"}</button>{draft.status === "draft" && <button type="button" disabled={!!busy} onClick={() => void activate()}>{busy === "activate" ? "确认中..." : "确认并启用"}</button>}<button type="button" className="secondary" disabled={!!busy} onClick={() => void generate(true)}>{busy === "regenerate" ? "生成中..." : snapshot.agent.memory.useLlmPlanning && snapshot.services.model === "ready" ? "用大模型重新生成" : "重新生成本地草案"}</button></div>
          {!!revisions.length && <details className="plan-revisions"><summary>版本记录 · {revisions.length}</summary>{revisions.map((revision) => <p key={revision.id}>v{revision.fromVersion} → v{revision.toVersion} · {revision.changes.length} 项修改</p>)}</details>}
        </>
      )}
      {feedback && <p className="inline-feedback" role="status" aria-live="polite">{feedback}</p>}
    </div>
  );
}

export function BehaviorMemoryPane({ snapshot, setSnapshot, embedded = false }: { snapshot: ChroniSnapshot; setSnapshot: SnapshotSetter; embedded?: boolean }) {
  const memory = snapshot.agent.behaviorMemory;
  const [stepMinutes, setStepMinutes] = useState("45");
  const [confirmClear, setConfirmClear] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<ChroniSnapshot>, success: string) {
    if (busy) return;
    setBusy(true);
    setFeedback("正在保存规划偏好...");
    try { setSnapshot(await action()); setFeedback(success); } catch (error) { setFeedback(formatOperationError(error, "规划偏好未能保存")); } finally { setBusy(false); }
  }
  return (
    <section className="behavior-memory" aria-busy={busy} aria-labelledby={embedded ? undefined : "behavior-memory-heading"} aria-label={embedded ? "个性化规划偏好" : undefined}>
      {!embedded && <header><div><p>个性化规划</p><h3 id="behavior-memory-heading">规划偏好记忆</h3></div><span>{memory.preferences.filter((item) => item.status === "active").length} 条生效</span></header>}
      <div className="memory-controls"><label><input type="checkbox" disabled={busy} checked={memory.learningEnabled} onChange={(event) => void run(() => api.updateBehaviorMemory({ learningEnabled: event.target.checked }), "学习设置已更新。" )} /> 从保存的规划修改中学习</label><label><input type="checkbox" disabled={busy} checked={memory.autoApplyEnabled} onChange={(event) => void run(() => api.updateBehaviorMemory({ autoApplyEnabled: event.target.checked }), "自动应用设置已更新。" )} /> 自动应用高置信度偏好</label></div>
      <div className="explicit-preference"><label>默认步骤时长 <input type="number" min="15" max="180" step="5" value={stepMinutes} disabled={busy} onChange={(event) => setStepMinutes(event.target.value)} /> 分钟</label><button type="button" disabled={busy} onClick={() => void run(() => api.upsertPlanningPreference({ key: "preferredStepMinutes", value: Number(stepMinutes) }), "明确偏好已保存。")}>设为明确偏好</button></div>
      <div className="preference-list">{memory.preferences.length ? memory.preferences.map((preference) => <PreferenceRow key={preference.id} preference={preference} disabled={busy} onStatus={(status) => run(() => api.setPlanningPreferenceStatus(preference.id, status), "偏好状态已更新。") } onDelete={() => run(() => api.deletePlanningPreference(preference.id), "偏好已删除。") } />) : <p className="empty">尚未形成规划偏好。保存任务规划修改后会在这里显示。</p>}</div>
      {!!snapshot.agent.recentPlanningFeedback.length && <details className="recent-learning"><summary>最近学习 · {snapshot.agent.recentPlanningFeedback.length}</summary>{snapshot.agent.recentPlanningFeedback.slice(0, 5).map((event) => <p key={event.id}>{taskTypeLabel(event.taskType)} · 规划 v{event.planVersion} · {event.changes.length} 项结构化修改</p>)}</details>}
      <div className="memory-danger">{confirmClear ? <><span>确认清除全部行为偏好和学习记录？</span><button type="button" disabled={busy} onClick={() => void run(() => api.clearBehaviorMemory(), "规划偏好记忆已清除。").finally(() => setConfirmClear(false))}>确认清除</button><button type="button" className="secondary" disabled={busy} onClick={() => setConfirmClear(false)}>取消</button></> : <button type="button" className="text-action" disabled={busy} onClick={() => setConfirmClear(true)}>清除规划偏好记忆</button>}</div>
      {feedback && <p className="inline-feedback" role="status" aria-live="polite">{feedback}</p>}
    </section>
  );
}

function PreferenceRow({ preference, disabled, onStatus, onDelete }: { preference: PlanningPreference; disabled?: boolean; onStatus(status: "active" | "disabled"): Promise<void>; onDelete(): Promise<void> }) {
  return <article className="preference-row"><div><b>{safeWorkspaceMessage(preference.explanation, "已学习一条规划偏好")}</b><p>{preference.source === "explicit" ? "明确设置" : `${Math.round(preference.confidence * 100)}% 置信度 · ${preference.evidenceCount} 次证据`} · {preference.status === "candidate" ? "正在学习" : preference.status === "disabled" ? "已停用" : "已生效"}</p></div><div>{preference.status === "disabled" ? <button type="button" disabled={disabled} onClick={() => void onStatus("active")}>启用</button> : <button type="button" className="secondary" disabled={disabled} onClick={() => void onStatus("disabled")}>停用</button>}<button type="button" className="text-action" disabled={disabled} onClick={() => void onDelete()}>删除</button></div></article>;
}

function clarificationValue(item: PendingClarification, raw = ""): string | number {
  if (item.field === "dueAt" || item.field === "dueTime") {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw new Error("请选择有效日期和时间。");
    return date.toISOString();
  }
  if (item.field === "estimatedMinutes" || item.field === "progressPercent") return Number(raw);
  return raw;
}

function latestPlan(snapshot: ChroniSnapshot, taskId: string): TaskPlan | undefined {
  const plans = snapshot.taskPlans.filter((plan) => plan.taskId === taskId && plan.status !== "superseded");
  return plans.sort((left, right) => right.version - left.version)[0];
}

function reorder(steps: TaskPlanStep[], id: string, target: number): TaskPlanStep[] {
  const next = [...steps];
  const index = next.findIndex((step) => step.id === id);
  if (index < 0 || index === target) return next;
  const [step] = next.splice(index, 1);
  next.splice(target, 0, step);
  return next.map((item, order) => ({ ...item, order: order + 1 }));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function calculatedLatestSafeStart(task: DdlItem, plan: TaskPlan): string | undefined {
  const totalMinutes = plan.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0) + plan.bufferMinutes;
  const result = new Date(task.dueAt).getTime() - totalMinutes * 60_000;
  return Number.isFinite(result) ? new Date(result).toISOString() : undefined;
}

function planStatus(plan: TaskPlan | null): string {
  if (!plan) return "待规划";
  return plan.status === "active" ? "已启用" : plan.status === "draft" ? "待确认" : "历史版本";
}

function plannerLabel(plan: TaskPlan): string {
  if (plan.plannerSource === "personalized-llm") return "个性化 LLM";
  if (plan.plannerSource === "llm") return "LLM";
  if (plan.plannerSource === "rules-fallback") return "本地规则（模型不可用）";
  return "本地规则";
}

function safeWorkspaceMessage(message: string | undefined, fallback: string): string {
  return formatUserFacingMessage(message, fallback);
}

function taskImportanceLabel(value: DdlItem["importance"]): string {
  return value === "high" ? "高重要性" : value === "medium" ? "中等重要性" : "低重要性";
}

function taskTypeLabel(value: string | undefined): string {
  if (!value || value === "general") return "通用任务";
  const labels: Record<string, string> = { report: "报告", exam: "考试", project: "项目", assignment: "作业", presentation: "展示" };
  return labels[value] ?? safeWorkspaceMessage(value, "其他任务");
}
