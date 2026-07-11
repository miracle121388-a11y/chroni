# Chroni DeadlineAgent Design

## Goal

Add a real Agent loop to Chroni without turning the product into a chatbot or replacing its lightweight pet, schedule, extraction, and control-center workflows. A user runs a daily inspection, DeadlineAgent observes current work, plans priorities, invokes existing capabilities, verifies the result, persists simple preferences, and produces an auditable trace.

## Repository Adaptation

The source prompt describes a Python and SQLite application with existing `planner.py`, `risk_checker.py`, `extractors.py`, and `calendar_exporter.py`. Chroni is currently an Electron and TypeScript application backed by `ChroniStore`; none of those Python modules exists. The required files are therefore implemented as native TypeScript modules under `apps/desktop/src/agent/`:

- `deadline-agent.ts`
- `agent-state.ts`
- `agent-tools.ts`
- `agent-memory.ts`
- `agent-trace.ts`

This keeps the Agent inside the packaged application and lets it reuse Chroni's actual store, extraction, schedule, reminders, and API boundaries. No Python runtime or disconnected demonstration service is introduced.

## Agent Loop

### Observe

Read all incomplete tasks from `ChroniStore`, including due time, importance, completion, snooze state, and source metadata. Capture the current local time and the user's Agent memory. Summarize overdue, due-today, due-soon, snoozed, and unscheduled work-block counts.

### Plan

Assign each active task a deterministic risk score based on overdue state, remaining time, importance, and estimated work capacity. Select today's priority tasks and produce work blocks inside the user's preferred working window without changing task deadlines.

Default estimates are intentionally conservative: high importance receives 90 minutes, medium 60 minutes, and low 30 minutes. Memory can override daily capacity and working hours, but the first release does not add per-task duration editing.

### Act

Invoke typed tools rather than mutating state directly:

- Read current tasks.
- Run risk analysis.
- Generate or regenerate today's work blocks.
- Reuse Chroni extraction for text intake.
- Export active tasks as an ICS calendar.
- Request a desktop reminder for the highest-risk task.

The minimum daily loop always records risk analysis and planning tool calls. It invokes replanning when high-risk tasks exist or planned minutes exceed daily capacity. It requests a reminder only when reminders are enabled and a high-risk task exists.

### Verify

Run risk and capacity checks again against the produced plan. Verification reports unresolved high-risk tasks, unallocated priority work, capacity overflow, and a final status of `healthy`, `attention`, or `critical`. Replanning is successful when it produces valid work blocks even if a deadline remains objectively high risk.

### Memory

Persist a small `AgentMemory` record in `chroni-state.json`:

- Maximum work minutes per day, default 240.
- Preferred working start, default 09:00.
- Preferred working end, default 18:00.
- Reminder frequency: `important-only`, `daily`, or `off`.

Memory is separate from existing reminder and model preferences. Runtime validation applies to IPC and HTTP updates.

### Trace

Every run creates ordered trace entries for `observe`, `plan`, `act`, and `verify`. Entries contain timestamps, concise decision summaries, structured metrics, tool names, success state, and safe result summaries. Trace does not store hidden model reasoning, API keys, raw document bodies, or unrestricted chain-of-thought.

## Data Model

`AgentRunResult` contains:

- Unique run ID and start/completion timestamps.
- Observation metrics.
- Ranked priority tasks with risk levels and reasons.
- Planned work blocks with task ID, start, end, and allocated minutes.
- Actions and tool outcomes.
- Verification status and unresolved issues.
- Human-readable daily suggestions.
- Ordered Agent trace.

The latest result and a bounded history of ten traces are persisted privately in `ChroniStore`. The public Electron snapshot exposes Agent memory and the latest run so every renderer stays synchronized. HTTP snapshots remain sanitized.

## Tool Boundaries

`AgentTools` is dependency-injected and independently testable. Its production adapter uses:

- `ChroniStore.snapshot()` for task observation.
- Shared schedule helpers for active/snoozed filtering and ordering.
- `processIntake()` for text extraction and insertion.
- A dedicated deterministic risk analyzer and work-block planner colocated in the Agent tool module because no existing planner or risk module exists.
- A small standards-compliant ICS serializer that writes to the user-data exports directory.
- An injected reminder callback owned by Electron main, preserving the current Notification boundary.

The Agent orchestrator never imports Electron directly.

## Product Interface

Add a compact `Agent` tab to the control center. It is an operational surface, not a chat screen. It contains:

- A primary `Run today's inspection` command.
- Current status, latest run time, and daily suggestions.
- Ranked priority and high-risk task rows.
- Planned work blocks.
- A four-stage Observe / Plan / Act / Verify trace timeline.
- Compact memory controls and an explicit save command.
- An ICS export command.

No Agent controls are added to the pet or lightweight schedule drawer. After a run, the pet receives one short summary through the existing companion state.

## IPC And HTTP API

Electron preload exposes:

- `runDeadlineAgent()`
- `updateAgentMemory(patch)`
- `exportAgentIcs()`

The local HTTP API adds protected endpoints:

- `POST /api/agent/run`
- `GET /api/agent/latest`
- `PATCH /api/agent/memory`
- `POST /api/agent/export-ics`

All payloads pass shared runtime validation. HTTP responses never expose model credentials or raw source text through Agent traces.

## Error Handling

- An empty task list is a successful healthy run with an explanatory suggestion and complete trace.
- Invalid memory or API input is rejected before state mutation.
- Individual tool failures are recorded in the trace and surfaced in the result; verification still runs when safe.
- ICS export failure does not invalidate the latest inspection.
- Concurrent run requests share one in-flight promise so duplicate clicks cannot produce conflicting plans.
- Agent runs never modify deadlines, completion state, source records, or model settings.

## Testing

Focused tests cover:

- Observing real store tasks.
- Risk classification for overdue and near-deadline work.
- Replanning invocation under high risk or capacity overflow.
- Deterministic work-block generation inside preferred hours.
- Complete ordered traces.
- Memory persistence and validation.
- Empty-state and unresolved-risk verification.
- ICS serialization.
- Authenticated API run, latest, memory, and export routes.
- Existing Chroni tests, type checks, builds, packaging, and Windows runtime smoke tests.

## Acceptance Criteria

- A user can run today's Agent inspection from the control center without configuring an LLM.
- The run reads actual Chroni tasks, identifies high-risk deadlines, invokes replanning when required, and produces actionable suggestions.
- Observe, Plan, Act, and Verify are visible as structured trace entries.
- Memory survives restart and invalid updates cannot corrupt it.
- Agent decisions are deterministic for the same tasks, time, and memory.
- Existing extraction, schedule, pet, reminder, API security, and packaging behavior remains intact.
- The implementation contains no Python sidecar, chat interface, fake sample tasks, or OpenPets branding.
