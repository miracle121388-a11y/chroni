# Chroni DeadlineAgent Implementation Plan

**Goal:** Add a deterministic, auditable daily DeadlineAgent loop to the existing Electron application without introducing a chatbot or Python runtime.

**Architecture:** Pure Agent state, memory, trace, risk, planning, and ICS helpers live under `apps/desktop/src/agent`. A dependency-injected orchestrator calls production tools backed by `ChroniStore`. Electron main owns notifications and filesystem exports. Shared types and validators keep renderer, IPC, and HTTP contracts aligned.

**Tech Stack:** Electron 42, TypeScript 6, React 19, Node test runner, pnpm 11.

## Global Constraints

- Do not modify deadlines, completion state, source records, or model settings during an Agent run.
- Do not require an LLM for the Agent loop.
- Do not add fake tasks or a chat interface.
- Persist only structured summaries, never API keys, raw documents, or hidden reasoning.
- Write focused failing tests before each production behavior.

### Task 1: Agent Domain Types, Memory, And Trace

**Files:**
- Create `apps/desktop/src/agent/agent-state.ts`
- Create `apps/desktop/src/agent/agent-memory.ts`
- Create `apps/desktop/src/agent/agent-trace.ts`
- Modify `apps/desktop/src/shared/types.ts`
- Create `apps/desktop/test/agent-core.test.mjs`

- [ ] Add failing tests for memory defaults/patch validation and ordered trace entries.
- [ ] Define Agent observation, risk, priority, work block, action, verification, result, and public snapshot types.
- [ ] Implement pure memory normalization and trace builder helpers.
- [ ] Build main and run the focused test.

### Task 2: Agent Tools

**Files:**
- Create `apps/desktop/src/agent/agent-tools.ts`
- Test `apps/desktop/test/agent-core.test.mjs`

- [ ] Add failing tests for observing active tasks, high-risk classification, deterministic priority ranking, preferred-hour work blocks, capacity overflow, and ICS output.
- [ ] Implement deterministic risk scores and reasons.
- [ ] Implement initial planning and explicit replanning functions.
- [ ] Implement standards-compliant ICS serialization.
- [ ] Define the injected `AgentTools` interface and production adapter boundary.

### Task 3: Observe-Plan-Act-Verify Orchestrator

**Files:**
- Create `apps/desktop/src/agent/deadline-agent.ts`
- Test `apps/desktop/test/deadline-agent.test.mjs`

- [ ] Add failing tests proving task observation, high-risk detection, replanning invocation, reminder invocation, empty-state behavior, verification, and complete trace generation.
- [ ] Implement one-in-flight run deduplication.
- [ ] Implement the four-stage loop and daily suggestions.
- [ ] Ensure tool failures are traced and verification still executes safely.

### Task 4: Store Persistence And Validation

**Files:**
- Modify `apps/desktop/src/store.ts`
- Modify `apps/desktop/src/validation.ts`
- Modify `apps/desktop/test/core.test.mjs`
- Modify `apps/desktop/test/validation.test.mjs`

- [ ] Add failing tests for memory/latest-run persistence, bounded trace history, private state migration, and invalid patches.
- [ ] Persist Agent memory, latest run, and up to ten trace histories in `chroni-state.json`.
- [ ] Expose memory and latest run in the public snapshot.
- [ ] Add runtime Agent memory validation shared by HTTP and IPC.

### Task 5: Electron IPC, Reminder, And ICS Export

**Files:**
- Modify `apps/desktop/src/main.ts`
- Modify `apps/desktop/preload.cjs`
- Modify `apps/desktop/src/renderer/src/vite-env.d.ts`

- [ ] Build a production AgentTools adapter from `ChroniStore`, intake, exports directory, and Electron Notification.
- [ ] Add `chroni:agent-run`, `chroni:agent-memory-update`, and `chroni:agent-export-ics` handlers.
- [ ] Broadcast updated snapshots after runs and memory updates.
- [ ] Keep notification and filesystem ownership in Electron main.

### Task 6: Authenticated HTTP Agent API

**Files:**
- Modify `apps/desktop/src/api-server.ts`
- Modify `apps/desktop/test/api-server.test.mjs`

- [ ] Add failing authenticated tests for run, latest, memory update, and ICS export routes.
- [ ] Inject Agent service operations into the API server without importing Electron.
- [ ] Apply existing bearer authentication, CORS, body limits, redaction, and runtime validation.
- [ ] Return 503 when Agent operations are unavailable in isolated API tests.

### Task 7: Control Center Agent Surface

**Files:**
- Modify `apps/desktop/src/renderer/src/main.tsx`
- Modify `apps/desktop/src/renderer/src/styles.css`

- [ ] Add an Agent control-center tab with a stable compact layout.
- [ ] Implement run busy/error/success states.
- [ ] Show suggestions, priorities, work blocks, high-risk items, and Observe/Plan/Act/Verify trace entries.
- [ ] Add draft memory controls with explicit save and an ICS export command.
- [ ] Build renderer and inspect desktop/mobile-width control-center layouts.

### Task 8: Documentation And Release Verification

**Files:**
- Modify `README.md`
- Modify `product_requirements.md` only where Agent behavior changes the product contract.

- [ ] Document Agent behavior, deterministic boundaries, API routes, memory, trace, and ICS output.
- [ ] Run `pnpm run check` and confirm all old and new tests pass.
- [ ] Run branding/conflict scans and inspect the final diff.
- [ ] Build Windows installer and portable targets.
- [ ] Smoke-test packaged Agent API and control-center startup.
- [ ] Fast-forward merge the verified feature branch into `main` and rerun tests.
