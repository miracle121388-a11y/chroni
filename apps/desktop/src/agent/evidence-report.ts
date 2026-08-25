import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvidenceExportResult, AgentTraceEntry, ChroniSnapshot } from "../shared/types.js";

type EvidenceMetadata = {
  version: string;
  platform: string;
  architecture: string;
  petAssetMode: "original" | "xiaotong";
  demoScenario?: string;
};

export function exportRedactedAgentEvidence(snapshot: ChroniSnapshot, workflowTraces: AgentTraceEntry[][], directory: string, metadata: EvidenceMetadata, now = new Date()): AgentEvidenceExportResult {
  mkdirSync(directory, { recursive: true });
  const generatedAt = now.toISOString();
  const taskRefs = new Map(snapshot.items.map((item, index) => [item.id, `task-${index + 1}`]));
  const taskRef = (id: string) => taskRefs.get(id) ?? "task-unknown";
  const latest = snapshot.agent.latestRun;
  const report = {
    schemaVersion: "chroni-evidence-v1",
    product: "Chroni",
    version: metadata.version,
    generatedAt,
    privacy: {
      redacted: true,
      excluded: ["API keys", "access tokens", "raw source text", "source file paths", "task titles", "plan step titles", "evidence filenames", "evidence notes", "file hashes", "free-form Agent summaries"],
    },
    environment: {
      platform: metadata.platform,
      architecture: metadata.architecture,
      petAssetMode: metadata.petAssetMode,
      demo: metadata.demoScenario ? { active: true, scenario: metadata.demoScenario, synthetic: true } : { active: false },
    },
    inventory: {
      taskCount: snapshot.items.length,
      activeTaskCount: snapshot.items.filter((item) => !item.completed).length,
      sourceCount: snapshot.sources.length,
      clarificationCount: snapshot.clarifications.length,
      pendingRequiredClarificationCount: snapshot.clarifications.filter((item) => item.required && item.status === "pending").length,
      taskPlanCount: snapshot.taskPlans.length,
      dailyTaskCount: snapshot.dailyTasks.length,
      learningMissionCount: snapshot.learningMissions.length,
      missionEvidenceCount: snapshot.learningMissions.reduce((sum, mission) => sum + mission.evidence.length, 0),
      missionCheckpointCount: snapshot.learningMissions.reduce((sum, mission) => sum + mission.checkpoints.length, 0),
    },
    tasks: snapshot.items.map((item) => ({
      ref: taskRef(item.id),
      dueAt: item.dueAt,
      importance: item.importance,
      completed: item.completed,
      estimatedMinutes: item.estimatedMinutes ?? null,
      progressPercent: item.progressPercent ?? null,
      deliverableCount: item.extraction?.deliverables.length ?? 0,
      uncertaintyCount: item.extraction?.uncertainties.length ?? 0,
    })),
    taskPlans: snapshot.taskPlans.map((plan) => ({
      taskRef: taskRef(plan.taskId),
      version: plan.version,
      status: plan.status,
      plannerSource: plan.plannerSource,
      latestSafeStartAt: plan.latestSafeStartAt,
      steps: plan.steps.map((step, index) => ({
        ref: `step-${index + 1}`,
        estimatedMinutes: step.estimatedMinutes,
        status: step.status,
      })),
    })),
    learningMissions: snapshot.learningMissions.map((mission) => ({
      taskRef: taskRef(mission.taskId),
      status: mission.status,
      dueAt: mission.dueAt,
      plannerSource: mission.plannerSource ?? null,
      progressPercent: mission.progressPercent,
      evidenceCoveragePercent: mission.evidenceCoveragePercent,
      sourceEvidenceCount: mission.sourceEvidenceCount,
      deliverableCount: mission.deliverables.length,
      successCriteriaCount: mission.successCriteria.length,
      milestoneCount: mission.milestones.length,
      completedMilestoneCount: mission.milestones.filter((milestone) => milestone.status === "completed" || milestone.status === "skipped").length,
      evidenceCount: mission.evidence.length,
      checkpointCount: mission.checkpoints.length,
      blockedCheckpointCount: mission.checkpoints.filter((checkpoint) => checkpoint.status === "blocked").length,
    })),
    latestAgentRun: latest ? {
      id: latest.id,
      trigger: latest.trigger ?? "manual",
      startedAt: latest.startedAt,
      completedAt: latest.completedAt,
      plannerSource: latest.plannerSource ?? latest.plan.plannerSource ?? "rules",
      observation: {
        totalCount: latest.observation.totalCount,
        incompleteCount: latest.observation.incompleteCount,
        activeCount: latest.observation.activeCount,
        snoozedCount: latest.observation.snoozedCount,
        overdueCount: latest.observation.overdueCount,
      },
      priorities: latest.priorities.map((priority) => ({
        taskRef: taskRef(priority.taskId),
        riskLevel: priority.riskLevel,
        score: priority.score,
        estimatedMinutes: priority.estimatedMinutes,
        availableMinutesUntilDue: priority.availableMinutesUntilDue ?? null,
        slackMinutes: priority.slackMinutes ?? null,
        reasonCount: priority.reasons.length,
      })),
      plan: {
        plannedMinutes: latest.plan.plannedMinutes,
        overflowMinutes: latest.plan.overflowMinutes,
        blockCount: latest.plan.blocks.length,
        blocks: latest.plan.blocks.map((block) => ({
          taskRef: taskRef(block.taskId),
          startAt: block.startAt,
          endAt: block.endAt,
          allocatedMinutes: block.allocatedMinutes,
        })),
      },
      actions: latest.actions.map((action) => ({ tool: action.tool, status: action.status })),
      verification: {
        status: latest.verification.status,
        unresolvedHighRiskTaskRefs: latest.verification.unresolvedHighRiskTaskIds.map(taskRef),
        unplannedPriorityTaskRefs: latest.verification.unplannedPriorityTaskIds.map(taskRef),
        capacityOverflowMinutes: latest.verification.capacityOverflowMinutes,
        coveragePercent: latest.verification.coveragePercent ?? null,
      },
      trace: redactTrace(latest.trace, taskRef),
    } : null,
    workflowTraces: workflowTraces.map((trace, index) => ({ workflow: index + 1, trace: redactTrace(trace, taskRef) })),
  };
  const reportJson = JSON.stringify(report, null, 2);
  const integritySha256 = createHash("sha256").update(reportJson).digest("hex");
  const output = { ...report, integrity: { algorithm: "SHA-256", reportPayload: integritySha256 } };
  const stem = `chroni-evidence-${generatedAt.replace(/[:.]/g, "-")}`;
  const jsonPath = join(directory, `${stem}.json`);
  const markdownPath = join(directory, `${stem}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, evidenceMarkdown(output), "utf8");
  return { jsonPath, markdownPath, generatedAt, redacted: true, integritySha256 };
}

function redactTrace(trace: AgentTraceEntry[], taskRef: (id: string) => string) {
  return trace.map((entry) => ({
    sequence: entry.sequence,
    stage: entry.stage,
    timestamp: entry.timestamp,
    success: entry.success,
    data: Object.fromEntries(Object.entries(entry.data).map(([key, value]) => {
      if (/taskId$/i.test(key) && typeof value === "string") return [key.replace(/Id$/i, "Ref"), taskRef(value)];
      if (typeof value === "number" || typeof value === "boolean" || value === null) return [key, value];
      return [key, "[redacted]"];
    })),
  }));
}

function evidenceMarkdown(report: ReturnType<typeof reportWithIntegrity>): string {
  const latest = report.latestAgentRun;
  return `# Chroni redacted run evidence

- Generated: ${report.generatedAt}
- Version: ${report.version}
- Platform: ${report.environment.platform} / ${report.environment.architecture}
- Pet asset mode: ${report.environment.petAssetMode}
- Demo environment: ${report.environment.demo.active ? `yes (${report.environment.demo.scenario})` : "no"}
- Redacted: yes
- Integrity SHA-256: \`${report.integrity.reportPayload}\`

## Inventory

| Metric | Value |
| --- | ---: |
| Tasks | ${report.inventory.taskCount} |
| Active tasks | ${report.inventory.activeTaskCount} |
| Sources | ${report.inventory.sourceCount} |
| Pending required clarifications | ${report.inventory.pendingRequiredClarificationCount} |
| Task plans | ${report.inventory.taskPlanCount} |
| Learning missions | ${report.inventory.learningMissionCount} |
| Output evidence records | ${report.inventory.missionEvidenceCount} |
| Execution checkpoints | ${report.inventory.missionCheckpointCount} |

## Latest Agent run

${latest ? `- Run ID: \`${latest.id}\`
- Trigger: ${latest.trigger}
- Planner: ${latest.plannerSource}
- Verification: **${latest.verification.status}**
- Planned minutes: ${latest.plan.plannedMinutes}
- Coverage: ${latest.verification.coveragePercent ?? "n/a"}%
- Trace: ${latest.trace.map((entry) => `${entry.sequence}. ${entry.stage} (${entry.success ? "ok" : "failed"})`).join("; ")}` : "No Agent run is stored yet."}

## Privacy

This export excludes ${report.privacy.excluded.join(", ")}. Task references are local to this report and cannot be used to recover titles.
`;
}

function reportWithIntegrity() {
  return {} as ReturnType<typeof createReportShape>;
}

function createReportShape() {
  return {} as {
    generatedAt: string;
    version: string;
    environment: { platform: string; architecture: string; petAssetMode: string; demo: { active: boolean; scenario?: string } };
    inventory: { taskCount: number; activeTaskCount: number; sourceCount: number; pendingRequiredClarificationCount: number; taskPlanCount: number; learningMissionCount: number; missionEvidenceCount: number; missionCheckpointCount: number };
    latestAgentRun: null | { id: string; trigger: string; plannerSource: string; verification: { status: string; coveragePercent: number | null }; plan: { plannedMinutes: number }; trace: Array<{ sequence: number; stage: string; success: boolean }> };
    privacy: { excluded: string[] };
    integrity: { reportPayload: string };
  };
}
