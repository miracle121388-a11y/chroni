# Chroni Agent: Clarification, Task Planning, and Behavior Memory

## Data flow

```text
intake -> extraction -> completeness analysis
  -> complete: create DdlItem -> generate TaskPlan draft
  -> incomplete: persist IntakeDraft + PendingClarification

clarification answer -> merge validated value -> completeness check
  -> create task once -> generate plan draft

plan save -> validate baseVersion and dependencies -> structured diff
  -> TaskPlanRevision -> PlanningFeedbackEvent -> Behavior Memory

source reprocess -> preserve matching task identity and active plan
  -> prune orphan Agent state -> generate a reviewable replacement draft

DeadlineAgent -> capacity-aware risk/slack -> ready-step selection
  -> today blocks + seven-day forecast -> reminder/persistence -> verify
```

## Permission boundaries

- LLM output is a proposal. Local validators decide whether it is accepted and require extracted deliverables, submission method, constraints, and uncertainties to remain present.
- The clarification model may improve questions and options only for locally detected missing fields.
- A generated task plan remains a draft until the user activates it.
- Regeneration never replaces an active user plan.
- The Agent cannot modify the final DDL, delete a task, delete user steps, or complete the whole task.
- The renderer cannot set preference confidence/evidence or impersonate `origin: agent`.

## Behavior Memory

Planning edits produce deterministic signals. Duration edits create a scoped `preferredStepMinutes` candidate; buffer edits create `bufferRatio`; step additions create `preferredStepCount`. Confidence is:

```text
clamp(0.30 + 0.12 * positiveEvidence - 0.15 * negativeEvidence, 0, 0.95)
```

A preference becomes active at three or more independent feedback events and confidence of at least 0.65. Multiple edits of the same signal type in one save are aggregated into one evidence point. Explicit preferences have confidence 1 and take precedence. Selection matches task type, importance, and due-window scope, then returns at most eight preferences.

## Persistence and privacy

All drafts, questions, plans, revisions, preferences, and at most 100 recent feedback events are stored atomically in Electron `userData/chroni-state.json`. Old state files receive empty collections during normalization. HTTP snapshots blank source text and omit recent feedback; API Keys remain protected by Electron `safeStorage`.

Trace entries contain only stage summaries, IDs, counts, planner source, versions, and preference IDs. Full prompts, source text, model JSON, API Keys, and hidden reasoning are not recorded.

## Fallbacks

- Clarification LLM unavailable: deterministic local completeness rules create a manual question.
- Task planning LLM unavailable or invalid: a three-stage rules fallback creates an editable draft.
- Multi-task intake: when LLM planning is enabled, task plans are generated with at most three concurrent model requests; individual failures fall back to local rule drafts. With LLM disabled, rule drafts are created immediately.
- Behavior Memory is fully local and does not require an LLM.
- Tasks without an active TaskPlan continue using `DdlItem.estimatedMinutes`.
