# Chroni Hybrid Deadline Agent Design

## Goal

Upgrade Chroni's deterministic daily inspection into a complete hybrid Deadline Agent. The Agent must remain useful without an LLM, use an OpenAI-compatible model as an optional structured planner, execute only validated local tools, persist an actionable daily plan, run proactively, and produce truthful verification and audit data.

## Product Boundaries

- Chroni remains a deadline-management desktop utility rather than a chatbot.
- The Agent never changes task titles, deadlines, completion state, source records, or model settings without an explicit user action.
- LLM access is optional. Missing credentials, timeouts, malformed output, or unsupported model features fall back to the deterministic planner.
- Automatic inspection is enabled by default, runs once after the first application start of each local day, and runs after task data changes with a debounce. Users can disable it.
- Existing Windows-specific window geometry and interaction behavior are out of scope and must not be modified.

## Architecture

```text
Trigger
  manual | daily startup | debounced task change
    -> Observe
       tasks + current plan + memory + reminder history + current time
    -> Analyze
       deterministic risk scores + available capacity
    -> Plan
       optional structured LLM proposal
       -> validate task IDs, durations, ordering, and schema
       -> deterministic fallback when unavailable or invalid
    -> Act
       replan when mitigation can improve
       persist accepted work blocks
       request at most one eligible reminder
    -> Verify
       coverage + capacity + unmitigated high risk + action outcomes
    -> Persist and Publish
       result + plan + safe trace + planner source
```

The orchestrator remains dependency-injected and Electron-free. Model planning lives behind a dedicated `AgentPlanner` interface. Tool execution and verification are deterministic so model output cannot bypass product constraints.

## Data Model

### Task Effort

`DdlItem` gains optional `estimatedMinutes` and `progressPercent`. Existing tasks remain valid. When no estimate exists, the deterministic analyzer uses the current importance defaults. Runtime validation constrains estimates to 15–1440 minutes and progress to 0–100.

### Memory

`AgentMemory` contains:

- `maxDailyMinutes`
- `workdayStart`
- `workdayEnd`
- `reminderFrequency`
- `automaticInspectionEnabled`, default `true`
- `useLlmPlanning`, default `true`

These values are user preferences, not hidden behavioral learning.

### Plan And Run Result

Each `AgentPlan` records:

- work blocks and unplanned task IDs;
- planned, requested, and overflow minutes;
- planner source: `llm`, `rules`, or `rules-fallback`;
- an optional safe fallback reason;
- mitigation coverage for every priority task.

`AgentRunResult` records its trigger, planner source, action outcomes, verification metrics, suggestions, and trace. The latest applied plan is persisted separately from the latest run so it remains available after restart.

### Verification

Verification distinguishes objective deadline risk from planning coverage:

- `highRiskTaskIds`: all objectively high/critical tasks;
- `mitigatedHighRiskTaskIds`: high-risk tasks whose remaining effort is fully covered;
- `unresolvedHighRiskTaskIds`: high-risk tasks with insufficient coverage;
- `unplannedPriorityTaskIds`;
- capacity overflow and overall coverage percent.

`healthy` means there are no uncovered high-risk tasks or capacity gaps. `attention` means work remains but every high-risk task has at least partial mitigation, or low/medium-priority work exceeds capacity. `critical` means at least one high-risk task receives no useful coverage.

## Planning

### Deterministic Initial Plan

The local planner schedules tasks in risk order inside the configured daily window. It respects remaining effort (`estimatedMinutes * (1 - progressPercent / 100)`), daily capacity, and a 15-minute minimum useful block.

### Real Replanning

Replanning is a distinct algorithm. It reserves capacity for high/critical tasks first, uses smaller blocks when necessary, and only then allocates remaining capacity to medium/low-risk work. The Agent accepts a replan only when it improves high-risk covered minutes, reduces uncovered high-risk tasks, or reduces overflow without harming higher-risk coverage.

### Optional LLM Planner

The model receives a bounded JSON-like task summary, memory, and local initial plan. It returns JSON containing ordered task allocations and concise user-facing suggestions. It cannot invent tasks or tools. The validator rejects unknown IDs, duplicate allocations, invalid minutes, excessive total capacity, prose outside the schema, and ungrounded suggestions.

Validated allocations are converted to local work blocks by deterministic code. If model planning fails, the run records `rules-fallback` and a sanitized failure category while continuing successfully.

## Actions And Tools

The allowlisted tools are:

- read tasks;
- deterministic risk assessment;
- initial planning;
- risk-first replanning;
- persist the applied plan;
- request a reminder;
- intake text and export ICS through explicit user commands.

Reminder execution returns `{ sent, reason }`, where reason is `sent`, `disabled`, `unsupported`, `quiet-hours`, `duplicate`, or `not-needed`. Only `sent` is recorded as a successful notification. Reminder policy observes global reminder settings, quiet hours, and `lastRemindedAt`; a successful Agent reminder updates the task reminder timestamp.

## Automatic Triggers

- On startup, run once if automatic inspection is enabled and the last automatic run is not from the current local day.
- After a successful task intake, edit, completion, deletion, or source reprocessing, schedule a debounced run.
- Coalesce triggers while a run is in flight. A dirty flag schedules one follow-up run after the current run completes.
- Automatic runs may use LLM planning only when enabled and configured. They never display blocking dialogs.

## Trace And Failure Handling

Trace entries remain safe structured summaries and add planner source, trigger, coverage metrics, tool result reason, and fallback category. Raw source text, API keys, model chain-of-thought, and unrestricted model responses are never persisted.

Failures in observation or initial planning produce a persisted failed run with a failure action and trace when enough state exists to do so. Failures in model planning, replanning, reminders, or plan persistence are isolated, recorded, and followed by deterministic verification where possible.

## User Interface

The Agent tab adds:

- planner badge: `大模型规划`, `本地规划`, or `模型失败·已回退`;
- trigger and latest-run time;
- coverage, capacity gap, and mitigated-risk metrics;
- applied work blocks and unresolved tasks;
- clear action results rather than claiming skipped notifications succeeded;
- settings for automatic inspection and LLM-assisted planning;
- editable task effort and progress in the existing schedule editor.

No chat interface is added. The current Trace timeline remains and surfaces safe tool/fallback details.

## API And Persistence

Existing Agent IPC and HTTP routes remain backward-compatible. Manual runs use trigger `manual`; internal automatic runs use `startup` or `task-change`. Snapshot normalization supplies defaults for older state files. API responses continue to remove LLM credentials and raw source text.

## Testing

Tests must demonstrate red-green coverage for:

- a distinct risk-first replan that improves high-risk coverage;
- verification based on actual plan coverage;
- valid LLM planning and every fallback class;
- rejection of invented task IDs and excessive allocations;
- reminder disabled, quiet-hours, duplicate, unsupported, and sent outcomes;
- startup once-per-day and debounced/coalesced task-change triggers;
- persistence and migration of new memory, plan, task effort, and run fields;
- failure traces for model/tool failures;
- existing API, extraction, renderer build, and platform behavior.

## Acceptance Criteria

- The Agent completes Observe, Analyze, Plan, Act, Verify, and Persist without an LLM.
- When configured, the model materially participates in structured planning and its participation is visible.
- Model failure never prevents a usable deterministic plan.
- Replanning is behaviorally distinct and measurably improves mitigation when possible.
- Verification never labels every objectively high-risk task as unresolved by definition.
- Persisted work blocks survive restart and correspond to current task IDs.
- Automatic inspection is enabled by default, user-controllable, once-per-day on startup, and debounced after task changes.
- Reminder traces reflect what actually happened and respect quiet hours and deduplication.
- Existing Windows-specific code is unchanged.
