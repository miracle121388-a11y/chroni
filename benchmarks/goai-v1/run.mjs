import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { DeadlineAgent } from "../../apps/desktop/dist/agent/deadline-agent.js";
import { createAgentMemory } from "../../apps/desktop/dist/agent/agent-memory.js";
import { assessTaskRisks, planWorkBlocks } from "../../apps/desktop/dist/agent/agent-tools.js";
import { createRuleTaskPlan } from "../../apps/desktop/dist/agent/task-plan-agent.js";
import { validateTaskPlan } from "../../apps/desktop/dist/agent/task-plan-validator.js";
import { processIntake } from "../../apps/desktop/dist/intake.js";
import { ChroniStore } from "../../apps/desktop/dist/store.js";
import { cases as allCases, referenceNow, timezone } from "./cases/index.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repositoryState = gitState();
const smoke = process.argv.includes("--smoke");
const modelRequested = process.argv.includes("--model");
if (modelRequested && !process.env.CHRONI_LLM_API_KEY && !process.env.DEEPSEEK_API_KEY) {
  console.log("GOAI model benchmark skipped: set CHRONI_LLM_API_KEY or DEEPSEEK_API_KEY to opt in.");
  process.exit(0);
}
if (modelRequested) {
  console.log("GOAI model benchmark is not enabled in v1; no network request was made.");
  process.exit(0);
}

const selectedCases = smoke ? smokeCases(allCases) : allCases;
const fixedNow = new Date(referenceNow);
const taskStats = { tp: 0, fp: 0, fn: 0 };
const fields = {
  title: { correct: 0, total: 0 },
  dueDate: { correct: 0, total: 0 },
  dueTime: { correct: 0, total: 0 },
  timezone: { correct: 0, total: 0 },
  evidence: { correct: 0, total: 0 },
};
const deliverables = { tp: 0, fp: 0, fn: 0 };
const clarification = { expected: 0, triggered: 0, excessive: 0, notExpected: 0, fieldsExpected: 0, fieldsCovered: 0, recoveries: 0, recoveryAttempts: 0 };
const planning = { plans: 0, validPlans: 0 };
const noTask = { cases: 0, falsePositives: 0 };
const conflict = { cases: 0, safelyDeferred: 0 };
const learningMission = {
  expected: 0,
  created: 0,
  sourceExpected: 0,
  sourceLinked: 0,
  deliverablesExpected: 0,
  deliverablesGrounded: 0,
  criteriaExpected: 0,
  criteriaPresent: 0,
  planExpected: 0,
  milestoneAligned: 0,
  lifecycleAttempts: 0,
  evidencePersisted: 0,
  checkpointPersisted: 0,
  milestoneSynced: 0,
};
const intakeLatencies = [];
const missionLifecycleLatencies = [];
const latencies = [];
const results = [];
const collectedTasks = [];
let peakRssBytes = process.memoryUsage().rss;
let successfulExecutions = 0;

for (const benchmarkCase of selectedCases) {
  const directory = mkdtempSync(join(tmpdir(), `chroni-eval-${benchmarkCase.id}-`));
  const started = performance.now();
  let executionError = "";
  try {
    const store = new ChroniStore(directory);
    store.updatePreferences({ remindersEnabled: false, llm: { enabled: false, apiKey: "" } });
    const intake = await processIntake({ kind: "text", text: benchmarkCase.text }, store, { referenceNow: fixedNow });
    intakeLatencies.push(performance.now() - started);
    const snapshot = store.snapshot();
    const predictedTasks = snapshot.items;
    const matches = matchTasks(predictedTasks, benchmarkCase.gold.tasks);
    const matchedPredicted = new Set(matches.map((match) => match.predictedIndex));
    const matchedGold = new Set(matches.map((match) => match.goldIndex));
    taskStats.tp += matches.length;
    taskStats.fp += predictedTasks.length - matchedPredicted.size;
    taskStats.fn += benchmarkCase.gold.tasks.length - matchedGold.size;

    for (const match of matches) {
      const predicted = predictedTasks[match.predictedIndex];
      const gold = benchmarkCase.gold.tasks[match.goldIndex];
      fields.title.total += 1;
      if (gold.titleTokens.every((token) => normalize(predicted.title).includes(normalize(token)))) fields.title.correct += 1;
      const actual = localDateTime(predicted.dueAt);
      fields.dueDate.total += 1;
      fields.dueTime.total += 1;
      if (actual.date === gold.date) fields.dueDate.correct += 1;
      if (actual.time === gold.time) fields.dueTime.correct += 1;
      if (benchmarkCase.category === "relative-timezone") {
        fields.timezone.total += 1;
        if (actual.date === gold.date && actual.time === gold.time) fields.timezone.correct += 1;
      }
      fields.evidence.total += 1;
      if (sourceEvidenceMatches(predicted.sourceSummary, benchmarkCase.text)) fields.evidence.correct += 1;
      scoreDeliverables(predicted.extraction?.deliverables ?? [], gold.deliverables, deliverables);
    }
    for (const goldIndex of benchmarkCase.gold.tasks.keys()) {
      if (!matchedGold.has(goldIndex)) deliverables.fn += benchmarkCase.gold.tasks[goldIndex].deliverables.length;
    }

    const pending = snapshot.clarifications.filter((item) => item.status === "pending" && item.required);
    const predictedClarification = pending.length > 0;
    if (benchmarkCase.gold.shouldClarify) {
      clarification.expected += 1;
      clarification.fieldsExpected += benchmarkCase.gold.missingFields.length;
      if (predictedClarification) clarification.triggered += 1;
      const predictedFields = new Set(pending.map((item) => item.field));
      clarification.fieldsCovered += benchmarkCase.gold.missingFields.filter((field) => predictedFields.has(field)).length;
      if (predictedClarification) {
        clarification.recoveryAttempts += 1;
        let created = false;
        for (const question of pending) {
          const answer = question.field === "title" ? { value: `Recovered ${benchmarkCase.id}` } : { value: "2026-08-30T18:00:00+08:00" };
          const recovered = store.answerClarification(question.id, answer);
          created ||= !!recovered.createdTaskId;
        }
        if (created || store.snapshot().items.length > predictedTasks.length) clarification.recoveries += 1;
      }
    } else {
      clarification.notExpected += 1;
      if (predictedClarification) clarification.excessive += 1;
    }
    if (benchmarkCase.gold.conflict) {
      conflict.cases += 1;
      if (predictedClarification && predictedTasks.length === 0) conflict.safelyDeferred += 1;
    }
    if (benchmarkCase.gold.noTask) {
      noTask.cases += 1;
      if (predictedTasks.length > 0) noTask.falsePositives += 1;
    }

    planning.plans += snapshot.taskPlans.length;
    planning.validPlans += snapshot.taskPlans.filter(validTaskPlan).length;
    const missionStarted = performance.now();
    const missionOutcome = evaluateLearningMissions(store, snapshot, predictedTasks, learningMission);
    if (snapshot.learningMissions.length) missionLifecycleLatencies.push(performance.now() - missionStarted);
    collectedTasks.push(...predictedTasks.map((item) => ({ ...item, id: `${benchmarkCase.id}-${item.id}` })));
    successfulExecutions += 1;
    results.push({
      id: benchmarkCase.id,
      category: benchmarkCase.category,
      expectedTasks: benchmarkCase.gold.tasks.length,
      predictedTasks: predictedTasks.length,
      matchedTasks: matches.length,
      expectedClarification: benchmarkCase.gold.shouldClarify,
      predictedClarification,
      passedTaskCount: predictedTasks.length === benchmarkCase.gold.tasks.length,
      passedTaskMatch: matches.length === benchmarkCase.gold.tasks.length && predictedTasks.length === benchmarkCase.gold.tasks.length,
      learningMissionReady: missionOutcome.ready,
      learningMissionLifecycle: missionOutcome.lifecycle,
      intakeOk: intake.ok,
    });
  } catch (error) {
    executionError = error instanceof Error ? error.message : String(error);
    results.push({ id: benchmarkCase.id, category: benchmarkCase.category, error: executionError });
  } finally {
    latencies.push(performance.now() - started);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    rmSync(directory, { recursive: true, force: true });
  }
}

const agentMetrics = await evaluateAgentPlanning(collectedTasks, fixedNow);
const dependencyCycleMetrics = evaluateDependencyCycleDetection(collectedTasks[0], fixedNow);
const precision = ratio(taskStats.tp, taskStats.tp + taskStats.fp);
const recall = ratio(taskStats.tp, taskStats.tp + taskStats.fn);
const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
const report = {
  schemaVersion: "chroni-goai-eval-v1",
  generatedAt: new Date().toISOString(),
  commitSha: repositoryState.commitSha,
  repository: repositoryState,
  dataset: {
    name: "goai-v1",
    synthetic: true,
    caseCount: selectedCases.length,
    fullCaseCount: allCases.length,
    smoke,
    referenceNow,
    timezone,
    sha256: createHash("sha256").update(JSON.stringify(selectedCases)).digest("hex"),
    categories: Object.fromEntries([...new Set(selectedCases.map((item) => item.category))].map((category) => [category, selectedCases.filter((item) => item.category === category).length])),
  },
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    modelCalls: 0,
    networkRequired: false,
  },
  extraction: {
    taskPrecision: precision,
    taskRecall: recall,
    taskF1: f1,
    titleNormalizationAccuracy: ratio(fields.title.correct, fields.title.total),
    dueDateExactMatch: ratio(fields.dueDate.correct, fields.dueDate.total),
    dueTimeExactMatch: ratio(fields.dueTime.correct, fields.dueTime.total),
    timezoneAccuracy: ratio(fields.timezone.correct, fields.timezone.total),
    deliverablePrecision: ratio(deliverables.tp, deliverables.tp + deliverables.fp),
    deliverableRecall: ratio(deliverables.tp, deliverables.tp + deliverables.fn),
    deliverableF1: fScore(deliverables.tp, deliverables.fp, deliverables.fn),
    sourceEvidenceHitRate: ratio(fields.evidence.correct, fields.evidence.total),
    noTaskFalsePositiveRate: ratio(noTask.falsePositives, noTask.cases),
    hallucinatedTaskRate: ratio(taskStats.fp, taskStats.tp + taskStats.fp),
  },
  clarification: {
    triggerRateWhenRequired: ratio(clarification.triggered, clarification.expected),
    excessiveQuestionRate: ratio(clarification.excessive, clarification.notExpected),
    missingFieldCoverage: ratio(clarification.fieldsCovered, clarification.fieldsExpected),
    recoverySuccessRate: ratio(clarification.recoveries, clarification.recoveryAttempts),
    conflictSafeDeferralRate: ratio(conflict.safelyDeferred, conflict.cases),
  },
  planning: {
    taskPlanLocalValidationPassRate: ratio(planning.validPlans, planning.plans),
    dependencyCycleDetectionRate: dependencyCycleMetrics.rate,
    capacityConstraintPassRate: agentMetrics.capacityConstraintPassRate,
    highRiskTaskCoverageRate: agentMetrics.highRiskTaskCoverageRate,
    scheduleConflictRate: agentMetrics.scheduleConflictRate,
    invalidModelFallbackSuccessRate: agentMetrics.invalidModelFallbackSuccessRate,
  },
  learningMission: {
    creationRate: ratio(learningMission.created, learningMission.expected),
    sourceLinkRate: ratio(learningMission.sourceLinked, learningMission.sourceExpected),
    deliverableGroundingRate: ratio(learningMission.deliverablesGrounded, learningMission.deliverablesExpected),
    successCriteriaPresenceRate: ratio(learningMission.criteriaPresent, learningMission.criteriaExpected),
    milestonePlanAlignmentRate: ratio(learningMission.milestoneAligned, learningMission.planExpected),
    evidencePersistenceRate: ratio(learningMission.evidencePersisted, learningMission.lifecycleAttempts),
    checkpointPersistenceRate: ratio(learningMission.checkpointPersisted, learningMission.lifecycleAttempts),
    milestoneCheckpointSyncRate: ratio(learningMission.milestoneSynced, learningMission.lifecycleAttempts),
  },
  engineering: {
    localRulesLatencyP50Ms: percentile(intakeLatencies, 50),
    localRulesLatencyP95Ms: percentile(intakeLatencies, 95),
    learningMissionLifecycleP50Ms: percentile(missionLifecycleLatencies, 50),
    learningMissionLifecycleP95Ms: percentile(missionLifecycleLatencies, 95),
    offlineCaseP50Ms: percentile(latencies, 50),
    offlineCaseP95Ms: percentile(latencies, 95),
    modelLatencyP50Ms: "尚未完成测量：model benchmark is opt-in and was not run",
    modelLatencyP95Ms: "尚未完成测量：model benchmark is opt-in and was not run",
    modelCallsPerCase: 0,
    tokenOrCostEstimate: "0 for this offline benchmark",
    sampledPeakRssMiB: Math.round((peakRssBytes / 1024 / 1024) * 10) / 10,
    offlineSuccessRate: ratio(successfulExecutions, selectedCases.length),
    continuousRunStability: "尚未完成测量：v1 runs each case once",
  },
  counts: { task: taskStats, fields, deliverables, clarification, planning, learningMission, dependencyCycle: dependencyCycleMetrics, noTask, conflict },
  cases: results,
};

const reports = join(root, "reports");
mkdirSync(reports, { recursive: true });
const baseName = smoke ? "smoke" : "latest";
const jsonPath = join(reports, `${baseName}.json`);
const markdownPath = join(reports, `${baseName}.md`);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, markdownReport(report), "utf8");
if (!smoke) writeFileSync(join(root, "../../docs/goai/07-evaluation-report.md"), markdownReport(report), "utf8");
console.log(`GOAI ${smoke ? "smoke" : "full"} evaluation: ${selectedCases.length} cases, F1 ${percent(f1)}, offline success ${percent(report.engineering.offlineSuccessRate)}.`);
console.log(`Reports: ${jsonPath} and ${markdownPath}`);
if (successfulExecutions !== selectedCases.length
  || report.learningMission.creationRate !== 1
  || report.learningMission.evidencePersistenceRate !== 1
  || report.learningMission.checkpointPersistenceRate !== 1
  || report.learningMission.milestoneCheckpointSyncRate !== 1) process.exitCode = 1;

function smokeCases(input) {
  const seen = new Set();
  return input.filter((item) => {
    if (seen.has(item.category)) return false;
    seen.add(item.category);
    return true;
  });
}

function matchTasks(predicted, gold) {
  const scores = [];
  predicted.forEach((item, predictedIndex) => gold.forEach((expected, goldIndex) => {
    const title = normalize(item.title);
    const tokenScore = expected.titleTokens.filter((token) => title.includes(normalize(token))).length / Math.max(1, expected.titleTokens.length);
    if (tokenScore >= 0.5) scores.push({ predictedIndex, goldIndex, score: tokenScore });
  }));
  scores.sort((left, right) => right.score - left.score);
  const usedPredicted = new Set();
  const usedGold = new Set();
  return scores.filter((entry) => {
    if (usedPredicted.has(entry.predictedIndex) || usedGold.has(entry.goldIndex)) return false;
    usedPredicted.add(entry.predictedIndex);
    usedGold.add(entry.goldIndex);
    return true;
  });
}

function scoreDeliverables(predicted, gold, counts) {
  const remaining = [...gold];
  for (const value of predicted) {
    const index = remaining.findIndex((expected) => normalize(value).includes(normalize(expected)) || normalize(expected).includes(normalize(value)));
    if (index >= 0) {
      counts.tp += 1;
      remaining.splice(index, 1);
    } else counts.fp += 1;
  }
  counts.fn += remaining.length;
}

function validTaskPlan(plan) {
  if (!plan.steps.length || new Set(plan.steps.map((step) => step.id)).size !== plan.steps.length) return false;
  return plan.steps.every((step) => Number.isFinite(step.estimatedMinutes) && step.estimatedMinutes > 0)
    && !Number.isNaN(new Date(plan.latestSafeStartAt).getTime());
}

function evaluateLearningMissions(store, snapshot, tasks, counts) {
  let ready = true;
  for (const task of tasks) {
    counts.expected += 1;
    const mission = snapshot.learningMissions.find((entry) => entry.taskId === task.id);
    if (!mission) {
      ready = false;
      continue;
    }
    counts.created += 1;
    if (task.sourceId || task.extraction?.contextExcerpt) {
      counts.sourceExpected += 1;
      if (mission.sourceEvidenceCount > 0) counts.sourceLinked += 1;
    }
    for (const deliverable of task.extraction?.deliverables ?? []) {
      counts.deliverablesExpected += 1;
      if (mission.deliverables.some((value) => normalize(value).includes(normalize(deliverable)) || normalize(deliverable).includes(normalize(value)))) {
        counts.deliverablesGrounded += 1;
      } else ready = false;
    }
    counts.criteriaExpected += 1;
    if (mission.successCriteria.length > 0) counts.criteriaPresent += 1;
    else ready = false;
    const plan = [...snapshot.taskPlans]
      .filter((entry) => entry.taskId === task.id && entry.status !== "superseded")
      .sort((left, right) => Number(right.status === "active") - Number(left.status === "active") || right.version - left.version)[0];
    if (plan) {
      counts.planExpected += 1;
      if (mission.milestones.length === plan.steps.length
        && plan.steps.every((step) => mission.milestones.some((milestone) => milestone.id === step.id))) counts.milestoneAligned += 1;
      else ready = false;
    }
  }

  const target = snapshot.learningMissions[0];
  if (!target) return { ready, lifecycle: tasks.length === 0 };
  counts.lifecycleAttempts += 1;
  const withEvidence = store.addLearningMissionEvidence(target.id, {
    kind: "note",
    title: "Synthetic benchmark evidence",
    note: "Synthetic benchmark record used only to verify local Mission persistence.",
    ...(target.deliverables[0] ? { linkedDeliverable: target.deliverables[0] } : {}),
  });
  const evidenceMission = withEvidence.learningMissions.find((entry) => entry.id === target.id);
  const evidencePersisted = (evidenceMission?.evidence.length ?? 0) === target.evidence.length + 1;
  if (evidencePersisted) counts.evidencePersisted += 1;

  const milestoneId = evidenceMission?.milestones[0]?.id;
  const withCheckpoint = store.recordLearningMissionCheckpoint(target.id, {
    status: "completed",
    summary: "Synthetic benchmark milestone checkpoint",
    actualMinutes: 15,
    ...(milestoneId ? { milestoneId } : {}),
  });
  const checkpointMission = withCheckpoint.learningMissions.find((entry) => entry.id === target.id);
  const checkpointPersisted = (checkpointMission?.checkpoints.length ?? 0) === (evidenceMission?.checkpoints.length ?? 0) + 1;
  if (checkpointPersisted) counts.checkpointPersisted += 1;
  const milestoneSynced = !!milestoneId && checkpointMission?.milestones.find((entry) => entry.id === milestoneId)?.status === "completed";
  if (milestoneSynced) counts.milestoneSynced += 1;
  return { ready, lifecycle: evidencePersisted && checkpointPersisted && milestoneSynced };
}

function evaluateDependencyCycleDetection(task, now) {
  if (!task) return { attempts: 0, detected: 0, rate: 0 };
  const plan = createRuleTaskPlan(task, [], now);
  if (plan.steps.length < 2) return { attempts: 0, detected: 0, rate: 0 };
  plan.steps[0].dependsOn = [plan.steps.at(-1).id];
  try {
    validateTaskPlan(plan, task);
    return { attempts: 1, detected: 0, rate: 0 };
  } catch (error) {
    const detected = error instanceof Error && /循环依赖/.test(error.message) ? 1 : 0;
    return { attempts: 1, detected, rate: detected };
  }
}

async function evaluateAgentPlanning(tasks, now) {
  const memory = createAgentMemory({ maxDailyMinutes: 360, workdayStart: "08:00", workdayEnd: "22:00", useLlmPlanning: true, reminderFrequency: "off" });
  const tools = {
    async readTasks() { return tasks; },
    assessRisks: assessTaskRisks,
    plan: (risks, inputMemory, inputNow) => planWorkBlocks(risks, inputMemory, inputNow),
    replan: (risks, inputMemory, inputNow) => planWorkBlocks(risks, inputMemory, inputNow),
    async sendReminder() { return { sent: false, reason: "disabled" }; },
    async persistPlan() {},
  };
  const agent = new DeadlineAgent({ tools, getMemory: () => memory, saveRun() {}, now: () => now });
  const result = await agent.run("manual");
  const perDay = new Map();
  for (const block of result.plan.blocks) {
    const day = localDateTime(block.startAt).date;
    perDay.set(day, (perDay.get(day) ?? 0) + block.allocatedMinutes);
  }
  const capacityPass = [...perDay.values()].every((minutes) => minutes <= memory.maxDailyMinutes);
  const conflicts = overlappingBlocks(result.plan.blocks);
  const highRisk = result.priorities.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical");
  const coveredHighRisk = highRisk.filter((item) => (result.plan.coverage?.find((entry) => entry.taskId === item.taskId)?.allocatedMinutes ?? 0) > 0).length;

  const fallbackAgent = new DeadlineAgent({
    tools: { ...tools, async readTasks() { return tasks.slice(0, 1); } },
    getMemory: () => memory,
    saveRun() {},
    now: () => now,
    planner: { async propose() { return { fallbackReason: "invalid-response" }; } },
  });
  const fallback = await fallbackAgent.run("manual");
  return {
    capacityConstraintPassRate: capacityPass ? 1 : 0,
    highRiskTaskCoverageRate: ratio(coveredHighRisk, highRisk.length),
    scheduleConflictRate: ratio(conflicts, result.plan.blocks.length),
    invalidModelFallbackSuccessRate: fallback.plan.plannerSource === "rules-fallback" && fallback.trace.some((entry) => entry.data.fallbackReason === "invalid-response") ? 1 : 0,
  };
}

function overlappingBlocks(blocks) {
  let conflicts = 0;
  const sorted = [...blocks].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
  for (let index = 1; index < sorted.length; index += 1) {
    if (new Date(sorted[index].startAt).getTime() < new Date(sorted[index - 1].endAt).getTime()) conflicts += 1;
  }
  return conflicts;
}

function sourceEvidenceMatches(summary, text) {
  const separator = summary.indexOf(":");
  const evidence = normalize(separator >= 0 ? summary.slice(separator + 1) : summary).slice(0, 16);
  return evidence.length >= 6 && normalize(text).includes(evidence);
}

function localDateTime(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function fScore(tp, fp, fn) {
  const p = ratio(tp, tp + fp);
  const r = ratio(tp, tp + fn);
  return p + r ? (2 * p * r) / (p + r) : 0;
}

function percentile(values, target) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.ceil((target / 100) * sorted.length) - 1] * 100) / 100;
}

function gitState() {
  try {
    const cwd = join(root, "../..");
    const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
    const trackedPatch = execFileSync("git", ["diff", "--binary", "HEAD"], { cwd });
    return {
      commitSha,
      workingTreeDirty: status.length > 0,
      statusEntryCount: status.length,
      trackedPatchSha256: createHash("sha256").update(trackedPatch).digest("hex"),
    };
  } catch {
    return { commitSha: "unavailable", workingTreeDirty: true, statusEntryCount: -1, trackedPatchSha256: "unavailable" };
  }
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function markdownReport(report) {
  const failures = report.cases.filter((item) => item.error
    || !item.passedTaskMatch
    || item.expectedClarification !== item.predictedClarification
    || item.learningMissionReady === false
    || item.learningMissionLifecycle === false);
  return `# Chroni GOAI v1 evaluation

This report was generated by the repository evaluator. The dataset is synthetic, the clock is fixed, and no model or network was used.

- Cases: ${report.dataset.caseCount}${report.dataset.smoke ? " (smoke subset)" : ""}
- Generated: ${report.generatedAt}
- Commit: \`${report.commitSha}\`
- Working tree: ${report.repository.workingTreeDirty ? `dirty (${report.repository.statusEntryCount} status entries; tracked patch \`${report.repository.trackedPatchSha256}\`)` : "clean"}
- Dataset SHA-256: \`${report.dataset.sha256}\`
- Reference clock: ${report.dataset.referenceNow} (${report.dataset.timezone})
- Environment: ${report.environment.platform} ${report.environment.architecture}, ${report.environment.node}
- Model and parameters: not used; deterministic local rules path
- Network: disabled / not required
- Repetitions: 1 per case (sample size ${report.dataset.caseCount})

## Extraction

| Metric | Result |
| --- | ---: |
| Task precision | ${percent(report.extraction.taskPrecision)} |
| Task recall | ${percent(report.extraction.taskRecall)} |
| Task F1 | ${percent(report.extraction.taskF1)} |
| Title normalization accuracy | ${percent(report.extraction.titleNormalizationAccuracy)} |
| Due date exact match | ${percent(report.extraction.dueDateExactMatch)} |
| Due time exact match | ${percent(report.extraction.dueTimeExactMatch)} |
| Timezone accuracy | ${percent(report.extraction.timezoneAccuracy)} |
| Deliverable F1 | ${percent(report.extraction.deliverableF1)} |
| Source evidence hit rate | ${percent(report.extraction.sourceEvidenceHitRate)} |
| No-task false-positive rate | ${percent(report.extraction.noTaskFalsePositiveRate)} |
| Hallucinated-task rate | ${percent(report.extraction.hallucinatedTaskRate)} |

## Learning Mission closed loop

| Metric | Result |
| --- | ---: |
| Mission creation per grounded task | ${percent(report.learningMission.creationRate)} |
| Source linked to Mission | ${percent(report.learningMission.sourceLinkRate)} |
| Extracted deliverable retained | ${percent(report.learningMission.deliverableGroundingRate)} |
| Success criteria present | ${percent(report.learningMission.successCriteriaPresenceRate)} |
| Mission milestones aligned with TaskPlan | ${percent(report.learningMission.milestonePlanAlignmentRate)} |
| Synthetic note evidence persisted | ${percent(report.learningMission.evidencePersistenceRate)} |
| Synthetic checkpoint persisted | ${percent(report.learningMission.checkpointPersistenceRate)} |
| Checkpoint synchronized to milestone | ${percent(report.learningMission.milestoneCheckpointSyncRate)} |

## Clarification

| Metric | Result |
| --- | ---: |
| Trigger when required | ${percent(report.clarification.triggerRateWhenRequired)} |
| Excessive question rate | ${percent(report.clarification.excessiveQuestionRate)} |
| Missing-field coverage | ${percent(report.clarification.missingFieldCoverage)} |
| Resume after answer | ${percent(report.clarification.recoverySuccessRate)} |
| Conflict safe deferral | ${percent(report.clarification.conflictSafeDeferralRate)} |

## Planning and engineering

| Metric | Result |
| --- | ---: |
| Local TaskPlan validation | ${percent(report.planning.taskPlanLocalValidationPassRate)} |
| Dependency-cycle detection | ${percent(report.planning.dependencyCycleDetectionRate)} |
| Capacity constraint pass | ${percent(report.planning.capacityConstraintPassRate)} |
| High-risk task coverage | ${percent(report.planning.highRiskTaskCoverageRate)} |
| Schedule conflict rate | ${percent(report.planning.scheduleConflictRate)} |
| Invalid model fallback | ${percent(report.planning.invalidModelFallbackSuccessRate)} |
| Intake path p50 | ${report.engineering.localRulesLatencyP50Ms} ms |
| Intake path p95 | ${report.engineering.localRulesLatencyP95Ms} ms |
| Mission evidence/checkpoint lifecycle p50 | ${report.engineering.learningMissionLifecycleP50Ms} ms |
| Mission evidence/checkpoint lifecycle p95 | ${report.engineering.learningMissionLifecycleP95Ms} ms |
| Full offline case p50 | ${report.engineering.offlineCaseP50Ms} ms |
| Full offline case p95 | ${report.engineering.offlineCaseP95Ms} ms |
| Sampled peak RSS | ${report.engineering.sampledPeakRssMiB} MiB |
| Offline success | ${percent(report.engineering.offlineSuccessRate)} |

## Explicitly unmeasured

- Model p50/p95 and model cost: ${report.engineering.modelLatencyP50Ms}
- Continuous-run stability: ${report.engineering.continuousRunStability}
- Image OCR recognition accuracy is outside this transcript-noise benchmark.
- Learning outcome, academic quality, and real-user behavior are not inferred from Mission lifecycle checks.

## Failure cases

${failures.length ? `| Case | Category | Expected tasks | Predicted / matched | Clarification expected / predicted | Mission ready / lifecycle |
| --- | --- | ---: | ---: | --- | --- |
${failures.map((item) => `| ${item.id} | ${item.category} | ${item.expectedTasks ?? "n/a"} | ${item.predictedTasks ?? "n/a"} / ${item.matchedTasks ?? "n/a"} | ${item.expectedClarification ?? "n/a"} / ${item.predictedClarification ?? "n/a"} | ${item.learningMissionReady ?? "n/a"} / ${item.learningMissionLifecycle ?? "n/a"} |`).join("\n")}` : "No case-level task-match, clarification-decision, or Learning Mission lifecycle mismatch was observed."}

Confidence intervals are not reported for this single deterministic 60-case run. Case counts and raw counters are available in the adjacent JSON report.

Case-level outcomes and raw counters are available in the adjacent JSON report. Do not cite figures from this report as model-enhanced results.
`;
}
