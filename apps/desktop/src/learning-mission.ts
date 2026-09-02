import type {
  DdlItem,
  LearningMission,
  LearningMissionCheckpoint,
  LearningMissionEvidence,
  LearningMissionMilestone,
  SourceRecord,
  TaskPlan,
} from "./shared/types.js";
import { normalizeCompatibleDateTime } from "./shared/date-time.js";

export type NormalizedLearningMissions = {
  values: LearningMission[];
  dropped: number;
  repaired: number;
};

export function synchronizeLearningMissions(
  items: DdlItem[],
  taskPlans: TaskPlan[],
  sources: SourceRecord[],
  previous: LearningMission[],
): LearningMission[] {
  const previousByTaskId = new Map(previous.map((mission) => [mission.taskId, mission]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const plansByTaskId = new Map<string, TaskPlan[]>();
  for (const plan of taskPlans) {
    const plans = plansByTaskId.get(plan.taskId) ?? [];
    plans.push(plan);
    plansByTaskId.set(plan.taskId, plans);
  }

  return items.map((item) => {
    const existing = previousByTaskId.get(item.id);
    const plan = preferredPlan(plansByTaskId.get(item.id) ?? []);
    const source = item.sourceId ? sourceById.get(item.sourceId) : undefined;
    const deliverables = uniqueStrings([
      ...(plan?.deliverables ?? []),
      ...(item.extraction?.deliverables ?? []),
    ]);
    if (!deliverables.length) deliverables.push(item.title);

    const milestones = missionMilestones(item, plan, deliverables);
    const evidence = structuredClone(existing?.evidence ?? []);
    const checkpoints = structuredClone(existing?.checkpoints ?? []);
    const successCriteria = uniqueStrings([
      ...(plan?.steps.flatMap((step) => step.completionCriteria) ?? []),
      ...(item.extraction?.constraints ?? []),
      ...(item.extraction?.submissionMethod ? [`按要求通过${item.extraction.submissionMethod}提交`] : []),
    ]).slice(0, 24);
    const progressPercent = missionProgress(item, milestones);
    const evidenceCoveragePercent = evidenceCoverage(deliverables, evidence);
    const riskSummary = missionRisk(item, plan, checkpoints, progressPercent);
    const status = missionStatus(item, plan, checkpoints, evidence, progressPercent, riskSummary);
    const nextAction = missionNextAction(item, plan, milestones, checkpoints, evidenceCoveragePercent);
    const createdAt = existing?.createdAt ?? item.createdAt;
    const updatedAt = latestTimestamp([
      item.updatedAt,
      plan?.updatedAt,
      ...evidence.map((entry) => entry.createdAt),
      ...checkpoints.map((entry) => entry.createdAt),
    ], createdAt);

    return {
      id: existing?.id ?? `learning-mission-${item.id}`,
      taskId: item.id,
      title: item.title,
      goal: plan?.goal ?? `完成「${item.title}」并形成可核验的学习产出`,
      dueAt: item.dueAt,
      deliverables,
      successCriteria,
      milestones,
      evidence,
      checkpoints,
      sourceEvidenceCount: source || item.extraction?.contextExcerpt ? 1 : 0,
      ...(source ? { sourceName: source.sourceName } : {}),
      ...(item.extraction?.contextExcerpt ? { sourceExcerpt: item.extraction.contextExcerpt.slice(0, 600) } : {}),
      ...(plan ? { plannerSource: plan.plannerSource } : {}),
      evidenceCoveragePercent,
      progressPercent,
      status,
      ...(riskSummary ? { riskSummary } : {}),
      nextAction,
      createdAt,
      updatedAt,
    };
  }).sort((left, right) => {
    const statusOrder: Record<LearningMission["status"], number> = { "at-risk": 0, active: 1, planning: 2, completed: 3 };
    return statusOrder[left.status] - statusOrder[right.status]
      || new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime();
  });
}

export function normalizeLearningMissions(value: unknown, validTaskIds: Set<string>): NormalizedLearningMissions {
  if (!Array.isArray(value)) return { values: [], dropped: value === undefined ? 0 : 1, repaired: 0 };
  const values: LearningMission[] = [];
  const missionIds = new Set<string>();
  const taskIds = new Set<string>();
  let dropped = 0;
  let repaired = 0;

  for (const entry of value.slice(0, 2_000)) {
    const input = record(entry);
    const id = safeString(input?.id, 240);
    const taskId = safeString(input?.taskId, 240);
    if (!input || !id || !taskId || !validTaskIds.has(taskId) || missionIds.has(id) || taskIds.has(taskId)) {
      dropped += 1;
      continue;
    }
    const evidenceResult = normalizeEvidence(input.evidence);
    const checkpointResult = normalizeCheckpoints(input.checkpoints);
    repaired += evidenceResult.repaired + checkpointResult.repaired;
    const createdAt = safeDate(input.createdAt) ?? new Date().toISOString();
    if (!safeDate(input.createdAt)) repaired += 1;
    missionIds.add(id);
    taskIds.add(taskId);
    values.push({
      id,
      taskId,
      title: safeString(input.title, 160) ?? "学习任务",
      goal: safeString(input.goal, 500) ?? "形成可核验的学习产出",
      dueAt: safeDate(input.dueAt) ?? createdAt,
      deliverables: safeStringList(input.deliverables, 40, 300),
      successCriteria: safeStringList(input.successCriteria, 40, 300),
      milestones: [],
      evidence: evidenceResult.values,
      checkpoints: checkpointResult.values,
      sourceEvidenceCount: boundedInteger(input.sourceEvidenceCount, 0, 100) ?? 0,
      evidenceCoveragePercent: boundedInteger(input.evidenceCoveragePercent, 0, 100) ?? 0,
      progressPercent: boundedInteger(input.progressPercent, 0, 100) ?? 0,
      status: isMissionStatus(input.status) ? input.status : "planning",
      nextAction: safeString(input.nextAction, 500) ?? "确认下一步行动",
      createdAt,
      updatedAt: safeDate(input.updatedAt) ?? createdAt,
    });
  }
  dropped += Math.max(0, value.length - 2_000);
  return { values, dropped, repaired };
}

function preferredPlan(plans: TaskPlan[]): TaskPlan | undefined {
  return [...plans]
    .filter((plan) => plan.status !== "superseded")
    .sort((left, right) => Number(right.status === "active") - Number(left.status === "active") || right.version - left.version)[0];
}

function missionMilestones(item: DdlItem, plan: TaskPlan | undefined, deliverables: string[]): LearningMissionMilestone[] {
  if (plan?.steps.length) {
    return [...plan.steps]
      .sort((left, right) => left.order - right.order)
      .map((step) => ({
        id: step.id,
        title: step.title,
        description: step.description,
        estimatedMinutes: step.estimatedMinutes,
        completionCriteria: [...step.completionCriteria],
        status: step.status,
      }));
  }
  const totalMinutes = item.estimatedMinutes ?? Math.max(60, deliverables.length * 45);
  const minutesPerDeliverable = Math.max(15, Math.round(totalMinutes / deliverables.length / 15) * 15);
  return deliverables.slice(0, 8).map((deliverable, index) => ({
    id: `mission-${item.id}-deliverable-${index + 1}`,
    title: `完成${deliverable}`,
    description: "等待生成或确认详细执行计划。",
    estimatedMinutes: minutesPerDeliverable,
    completionCriteria: [],
    status: item.completed ? "completed" : "pending",
  }));
}

function missionProgress(item: DdlItem, milestones: LearningMissionMilestone[]): number {
  if (item.completed) return 100;
  const milestoneProgress = milestones.length
    ? Math.round(milestones.reduce((sum, milestone) => sum + (milestone.status === "completed" || milestone.status === "skipped" ? 1 : milestone.status === "in-progress" ? 0.5 : 0), 0) / milestones.length * 100)
    : 0;
  return Math.min(99, Math.max(item.progressPercent ?? 0, milestoneProgress));
}

function evidenceCoverage(deliverables: string[], evidence: LearningMissionEvidence[]): number {
  if (!deliverables.length) return evidence.length ? 100 : 0;
  const covered = new Set(evidence.flatMap((entry) => entry.linkedDeliverable ? [entry.linkedDeliverable] : []));
  return Math.round(deliverables.filter((deliverable) => covered.has(deliverable)).length / deliverables.length * 100);
}

function missionRisk(
  item: DdlItem,
  plan: TaskPlan | undefined,
  checkpoints: LearningMissionCheckpoint[],
  progressPercent: number,
): string | undefined {
  if (item.completed) return undefined;
  const latestCheckpoint = checkpoints[0];
  if (latestCheckpoint?.status === "blocked") return latestCheckpoint.blocker ? `存在阻塞：${latestCheckpoint.blocker}` : "最近一次检查记录为阻塞状态";
  const now = Date.now();
  const dueAt = new Date(item.dueAt).getTime();
  if (dueAt <= now) return "已超过截止时间，需要立即重规划";
  if (plan?.latestSafeStartAt && new Date(plan.latestSafeStartAt).getTime() <= now && progressPercent < 100) return "已到最晚安全开始时间";
  const hours = (dueAt - now) / 3_600_000;
  if (hours <= 48 && progressPercent < 50) return "截止时间在 48 小时内，当前进度不足一半";
  return undefined;
}

function missionStatus(
  item: DdlItem,
  plan: TaskPlan | undefined,
  checkpoints: LearningMissionCheckpoint[],
  evidence: LearningMissionEvidence[],
  progressPercent: number,
  riskSummary: string | undefined,
): LearningMission["status"] {
  if (item.completed || progressPercent === 100) return "completed";
  if (riskSummary) return "at-risk";
  if (plan?.status === "active" || progressPercent > 0 || checkpoints.length > 0 || evidence.length > 0) return "active";
  return "planning";
}

function missionNextAction(
  item: DdlItem,
  plan: TaskPlan | undefined,
  milestones: LearningMissionMilestone[],
  checkpoints: LearningMissionCheckpoint[],
  evidenceCoveragePercent: number,
): string {
  if (item.completed) return "回顾成果与复盘记录";
  const latestCheckpoint = checkpoints[0];
  if (latestCheckpoint?.status === "blocked") return latestCheckpoint.blocker ? `处理阻塞：${latestCheckpoint.blocker}` : "澄清阻塞原因并重新安排下一步";
  const completedIds = new Set(milestones.filter((milestone) => milestone.status === "completed" || milestone.status === "skipped").map((milestone) => milestone.id));
  const planStepById = new Map(plan?.steps.map((step) => [step.id, step]) ?? []);
  const next = milestones.find((milestone) => milestone.status === "in-progress")
    ?? milestones.find((milestone) => {
      if (milestone.status !== "pending") return false;
      return (planStepById.get(milestone.id)?.dependsOn ?? []).every((dependency) => completedIds.has(dependency));
    });
  if (next) return next.title;
  if (evidenceCoveragePercent < 100) return "补充产出证据并逐项核对交付物";
  if (!plan) return "生成并确认执行计划";
  return "核对完成标准并提交最终成果";
}

function normalizeEvidence(value: unknown): { values: LearningMissionEvidence[]; repaired: number } {
  if (!Array.isArray(value)) return { values: [], repaired: value === undefined ? 0 : 1 };
  const values: LearningMissionEvidence[] = [];
  const ids = new Set<string>();
  let repaired = 0;
  for (const entry of value.slice(0, 200)) {
    const input = record(entry);
    const id = safeString(input?.id, 240);
    const title = safeString(input?.title, 160);
    const createdAt = safeDate(input?.createdAt);
    if (!input || !id || !title || !createdAt || ids.has(id) || (input.kind !== "file" && input.kind !== "note")) {
      repaired += 1;
      continue;
    }
    ids.add(id);
    const evidence: LearningMissionEvidence = { id, kind: input.kind, title, createdAt };
    const linkedDeliverable = safeString(input.linkedDeliverable, 300);
    const note = safeString(input.note, 4_000);
    const modifiedAt = safeDate(input.modifiedAt);
    const bytes = boundedInteger(input.bytes, 0, Number.MAX_SAFE_INTEGER);
    const sha256 = typeof input.sha256 === "string" && /^[a-f0-9]{64}$/i.test(input.sha256) ? input.sha256.toLowerCase() : undefined;
    if (linkedDeliverable) evidence.linkedDeliverable = linkedDeliverable;
    if (note) evidence.note = note;
    if (modifiedAt) evidence.modifiedAt = modifiedAt;
    if (bytes !== undefined) evidence.bytes = bytes;
    if (sha256) evidence.sha256 = sha256;
    values.push(evidence);
  }
  repaired += Math.max(0, value.length - 200);
  return { values: values.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()), repaired };
}

function normalizeCheckpoints(value: unknown): { values: LearningMissionCheckpoint[]; repaired: number } {
  if (!Array.isArray(value)) return { values: [], repaired: value === undefined ? 0 : 1 };
  const values: LearningMissionCheckpoint[] = [];
  const ids = new Set<string>();
  let repaired = 0;
  for (const entry of value.slice(0, 500)) {
    const input = record(entry);
    const id = safeString(input?.id, 240);
    const summary = safeString(input?.summary, 1_000);
    const createdAt = safeDate(input?.createdAt);
    if (!input || !id || !summary || !createdAt || ids.has(id) || (input.status !== "on-track" && input.status !== "blocked" && input.status !== "completed")) {
      repaired += 1;
      continue;
    }
    ids.add(id);
    const checkpoint: LearningMissionCheckpoint = { id, status: input.status, summary, createdAt };
    const milestoneId = safeString(input.milestoneId, 240);
    const actualMinutes = boundedInteger(input.actualMinutes, 1, 1_440);
    const blocker = safeString(input.blocker, 1_000);
    const reflection = safeString(input.reflection, 2_000);
    if (actualMinutes !== undefined) checkpoint.actualMinutes = actualMinutes;
    if (milestoneId) checkpoint.milestoneId = milestoneId;
    if (blocker) checkpoint.blocker = blocker;
    if (reflection) checkpoint.reflection = reflection;
    values.push(checkpoint);
  }
  repaired += Math.max(0, value.length - 500);
  return { values: values.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()), repaired };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = value.trim().replace(/\s+/g, " ");
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function latestTimestamp(values: Array<string | undefined>, fallback: string): string {
  let latest = new Date(fallback).getTime();
  for (const value of values) {
    const timestamp = value ? new Date(value).getTime() : Number.NaN;
    if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp;
  }
  return new Date(latest).toISOString();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim().slice(0, maxLength);
  return result || undefined;
}

function safeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value) ? uniqueStrings(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.slice(0, maxLength))).slice(0, maxItems) : [];
}

function safeDate(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeCompatibleDateTime(value) : undefined;
}

function boundedInteger(value: unknown, min: number, max: number): number | undefined {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : undefined;
}

function isMissionStatus(value: unknown): value is LearningMission["status"] {
  return value === "planning" || value === "active" || value === "at-risk" || value === "completed";
}
