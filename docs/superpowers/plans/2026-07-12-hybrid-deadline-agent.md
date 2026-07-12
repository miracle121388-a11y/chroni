# Hybrid Deadline Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete hybrid Deadline Agent that plans reliably without an LLM, optionally uses validated model planning, persists applied work blocks, runs proactively, and reports truthful action and verification outcomes.

**Architecture:** Keep the Electron-free orchestrator and injected tool boundary. Add a structured optional planner adapter around the existing OpenAI-compatible client, convert all proposals into deterministic local work blocks, execute only allowlisted tools, and verify coverage independently. Persist backward-compatible memory, applied plans, run trigger, planner source, and safe trace data in `ChroniStore`.

**Tech Stack:** TypeScript, Electron, React, Node test runner, OpenAI-compatible Chat Completions API, JSON runtime validation.

## Global Constraints

- The Agent must remain fully useful without an LLM.
- LLM output must not directly mutate tasks, deadlines, completion state, sources, or settings.
- Automatic inspection is enabled by default and user-controllable.
- Existing IPC and HTTP routes remain backward-compatible.
- Raw model responses, source bodies, API keys, and chain-of-thought must not enter Agent traces.
- Existing Windows-specific files and behavior must not be modified.

---

### Task 1: Agent Domain Model And Backward-Compatible Persistence

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`
- Modify: `apps/desktop/src/agent/agent-memory.ts`
- Modify: `apps/desktop/src/store.ts`
- Modify: `apps/desktop/src/validation.ts`
- Test: `apps/desktop/test/agent-core.test.mjs`
- Test: `apps/desktop/test/agent-store.test.mjs`
- Test: `apps/desktop/test/validation.test.mjs`

**Interfaces:**
- Produces: `AgentRunTrigger`, `AgentPlannerSource`, expanded `AgentMemory`, `AgentPlan`, `AgentVerification`, optional `DdlItem.estimatedMinutes`, optional `DdlItem.progressPercent`, and persisted `AgentSnapshot.appliedPlan`.

- [ ] **Step 1: Write failing migration and validation tests**

Add assertions that old state defaults to `automaticInspectionEnabled: true` and `useLlmPlanning: true`, effort is constrained to 15–1440, progress to 0–100, and applied plans survive reload.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @chroni/desktop run build:main && node --test apps/desktop/test/agent-core.test.mjs apps/desktop/test/agent-store.test.mjs apps/desktop/test/validation.test.mjs`

Expected: failures for missing memory fields, item validators, and applied-plan persistence.

- [ ] **Step 3: Implement minimal types, defaults, normalization, and validators**

Use these contracts:

```ts
type AgentRunTrigger = "manual" | "startup" | "task-change";
type AgentPlannerSource = "rules" | "llm" | "rules-fallback";

type AgentMemory = {
  maxDailyMinutes: number;
  workdayStart: string;
  workdayEnd: string;
  reminderFrequency: AgentReminderFrequency;
  automaticInspectionEnabled: boolean;
  useLlmPlanning: boolean;
};
```

Normalize absent fields rather than rejecting older state files.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

### Task 2: Distinct Replanning And Coverage-Based Verification

**Files:**
- Modify: `apps/desktop/src/agent/agent-tools.ts`
- Modify: `apps/desktop/src/agent/agent-state.ts`
- Test: `apps/desktop/test/agent-core.test.mjs`

**Interfaces:**
- Produces: `replanWorkBlocks(assessments, memory, now)`, `planCoverage(assessments, plan)`, and `verifyAgentPlan(assessments, plan)`.

- [ ] **Step 1: Write failing behavior tests**

Create a constrained-capacity case where the initial plan partially spends time on a lower-risk task but replan reserves useful blocks for all high-risk tasks. Assert that the replan reduces zero-covered high-risk tasks. Add a fully-covered high-risk case whose verification is not unresolved.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @chroni/desktop run build:main && node --test apps/desktop/test/agent-core.test.mjs`

Expected: `replanWorkBlocks` or coverage fields are missing.

- [ ] **Step 3: Implement minimal risk-first replanning and verification**

Replanning must allocate at least a 15-minute useful block to high/critical tasks before filling remaining effort in score order. Verification derives unresolved IDs from allocation versus remaining effort, not from risk level alone.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all tests pass.

### Task 3: Structured Optional LLM Planner

**Files:**
- Create: `apps/desktop/src/agent/agent-planner.ts`
- Modify: `apps/desktop/src/llm-client.ts`
- Test: `apps/desktop/test/agent-planner.test.mjs`

**Interfaces:**
- Consumes: `requestChatCompletion`, assessments, memory, initial plan, and current time.
- Produces:

```ts
type AgentPlanningContext = {
  assessments: AgentTaskAssessment[];
  memory: AgentMemory;
  initialPlan: AgentPlan;
  now: Date;
};

type AgentPlanner = {
  propose(context: AgentPlanningContext): Promise<AgentPlannerProposal | undefined>;
};
```

- [ ] **Step 1: Write failing proposal-validation tests**

Test a valid proposal, unknown task ID, duplicate allocation, negative or excessive minutes, empty response, timeout, and malformed JSON. Assert that only the valid proposal becomes an `llm` plan and failures return a safe fallback category without raw response persistence.

- [ ] **Step 2: Run the new test and verify RED**

Run: `pnpm --filter @chroni/desktop run build:main && node --test apps/desktop/test/agent-planner.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the validated planner adapter**

Send bounded task fields only. Require JSON shaped as:

```json
{"allocations":[{"taskId":"ddl-id","minutes":60}],"suggestions":["先完成报告主体。"]}
```

Reject unknown IDs, duplicates, non-integers, allocations below 15, total allocation beyond local capacity, and suggestions above three items or 120 characters each. Convert validated allocations to work blocks locally.

- [ ] **Step 4: Run planner tests and verify GREEN**

Run the Step 2 command. Expected: all planner tests pass.

### Task 4: Hybrid Orchestrator, Truthful Actions, And Persisted Applied Plan

**Files:**
- Modify: `apps/desktop/src/agent/deadline-agent.ts`
- Modify: `apps/desktop/src/agent/agent-tools.ts`
- Modify: `apps/desktop/src/store.ts`
- Test: `apps/desktop/test/deadline-agent.test.mjs`

**Interfaces:**
- Consumes: optional `AgentPlanner`, trigger, `persistPlan`, structured reminder result, coverage helpers.
- Produces: `DeadlineAgent.run(trigger?: AgentRunTrigger)` and a run result with planner source, applied plan, truthful actions, and coverage verification.

- [ ] **Step 1: Write failing orchestrator tests**

Cover valid model plan, model failure fallback, genuinely improved replan, plan persistence failure, disabled reminder recorded as skipped, fully covered high-risk verification, and safe trace data.

- [ ] **Step 2: Run the orchestrator test and verify RED**

Run: `pnpm --filter @chroni/desktop run build:main && node --test apps/desktop/test/deadline-agent.test.mjs`

Expected: missing planner source, trigger, persistence tool, or reminder result fields.

- [ ] **Step 3: Implement the hybrid loop**

Use model planning only when the injected planner exists and memory enables it. Compare candidate plans using high-risk zero-coverage count, high-risk covered minutes, and overflow. Persist the chosen plan, record structured outcomes, verify independently, and save the run.

- [ ] **Step 4: Run the orchestrator test and verify GREEN**

Run the Step 2 command. Expected: all orchestrator tests pass.

### Task 5: Production Planner, Reminder Policy, And Automatic Trigger Controller

**Files:**
- Create: `apps/desktop/src/agent/agent-scheduler.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/store.ts`
- Test: `apps/desktop/test/agent-scheduler.test.mjs`
- Test: `apps/desktop/test/deadline-agent.test.mjs`

**Interfaces:**
- Produces: an Electron-free `AgentScheduler` that accepts `run(trigger)`, `getMemory()`, `getLatestRun()`, a clock, and a debounce implementation.

- [ ] **Step 1: Write failing scheduler and reminder tests**

Assert startup runs only once per local day, disabled automatic inspection does nothing, repeated task changes coalesce, a task change during an in-flight run schedules one follow-up, and reminder outcomes distinguish disabled, unsupported, quiet hours, duplicate, and sent.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @chroni/desktop run build:main && node --test apps/desktop/test/agent-scheduler.test.mjs apps/desktop/test/deadline-agent.test.mjs`

Expected: scheduler module is missing and reminder outcomes are not structured.

- [ ] **Step 3: Implement scheduler and production wiring**

Instantiate the LLM planner with resolved settings only when configured. Trigger startup inspection after windows and services initialize. Call `scheduleTaskChange()` after successful intake, item mutation, deletion, and source reprocessing. Enforce reminder preferences and quiet hours in one production callback, mark sent reminders, and return a reason for every branch.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass.

### Task 6: Agent UI, Effort Editing, And Documentation

**Files:**
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Modify: `apps/desktop/src/renderer/src/vite-env.d.ts`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: expanded public Agent snapshot and existing IPC methods.
- Produces: planner/trigger badges, mitigation metrics, automatic/LLM planning toggles, truthful action list, and task effort/progress editing.

- [ ] **Step 1: Add renderer-facing type usage and build to verify RED**

Reference the new memory, planner source, verification coverage, action result, and item effort fields in the UI.

Run: `pnpm --filter @chroni/desktop run typecheck`

Expected: failures until the UI and preload-facing types are aligned.

- [ ] **Step 2: Implement the compact Agent UI and editor fields**

Keep the existing control-center information architecture. Add badges and metrics near status, actions below work blocks, toggles inside Agent Memory, and estimate/progress fields in the existing item editor. Do not add a chat panel.

- [ ] **Step 3: Update README and environment documentation**

Document hybrid behavior, model fallback, automatic triggers, Agent-specific LLM participation, safe trace rules, and local-rule operation without credentials.

- [ ] **Step 4: Verify renderer typecheck and build**

Run: `pnpm --filter @chroni/desktop run typecheck && pnpm --filter @chroni/desktop run build`

Expected: both commands exit 0.

### Task 7: Full Regression And Acceptance Verification

**Files:**
- Review all files changed by Tasks 1–6.

**Interfaces:**
- Produces: verified implementation evidence and a clean scoped diff.

- [ ] **Step 1: Run the full repository check**

Run: `pnpm run check`

Expected: typecheck, all Node tests, and production build pass.

- [ ] **Step 2: Run whitespace and scope checks**

Run: `git diff --check && git status --short && git diff --name-only`

Expected: no whitespace errors and no Windows-specific source files in the diff.

- [ ] **Step 3: Exercise both planner paths**

Run focused tests that use a fake successful model response and a forced model failure. Confirm planner source is respectively `llm` and `rules-fallback`, and both produce a persisted usable plan.

- [ ] **Step 4: Review acceptance criteria**

Confirm every criterion in `docs/superpowers/specs/2026-07-12-hybrid-deadline-agent-design.md` has a passing test or direct source evidence before reporting completion.
