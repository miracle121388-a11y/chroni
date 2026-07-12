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
```

## Permission boundaries

- LLM output is a proposal. Local validators decide whether it is accepted.
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

A preference becomes active at three or more evidence points and confidence of at least 0.65. Explicit preferences have confidence 1 and take precedence. Selection matches task type, importance, and due-window scope, then returns at most eight preferences.

## Persistence and privacy

All drafts, questions, plans, revisions, preferences, and at most 100 recent feedback events are stored atomically in Electron `userData/chroni-state.json`. Old state files receive empty collections during normalization. HTTP snapshots blank source text and omit recent feedback; API Keys remain protected by Electron `safeStorage`.

Trace entries contain only stage summaries, IDs, counts, planner source, versions, and preference IDs. Full prompts, source text, model JSON, API Keys, and hidden reasoning are not recorded.

## Fallbacks

- Clarification LLM unavailable: deterministic local completeness rules create a manual question.
- Task planning LLM unavailable or invalid: a three-stage rules fallback creates an editable draft.
- Behavior Memory is fully local and does not require an LLM.
- Tasks without an active TaskPlan continue using `DdlItem.estimatedMinutes`.
