# Chroni Reliability Polish Implementation Plan

> **For agentic workers:** Implement each task with focused failing tests before production changes, then run full verification.

**Goal:** Make pet placement, DeepSeek configuration, and local API integration reliable enough for an open-source desktop release.

**Architecture:** Pure geometry and validation modules define the boundaries. Electron main owns native state, secrets, server lifecycle, and display topology. The renderer keeps unsaved model settings locally and invokes typed IPC commands.

**Tech Stack:** Electron 42, React 19, TypeScript 6, Vite 8, Node test runner, pnpm 11.

### Task 1: Pet Placement Persistence

**Files:** `src/window-geometry.ts`, `src/windows.ts`, `src/store.ts`, `src/main.ts`, geometry and store tests.

- [ ] Add failing normalization, restoration, fallback, and persistence tests.
- [ ] Implement the placement type and pure geometry helpers.
- [ ] Restore placement during window creation and persist the snapped drag result.
- [ ] Handle display removal and work-area changes.
- [ ] Run focused tests and typecheck.

### Task 2: Bounded DeepSeek Client And Connection Test

**Files:** create `src/llm-client.ts`, update `src/intake.ts`, `src/main.ts`, preload/type declarations, and tests.

- [ ] Add failing tests for success, timeout, authentication, model, and rate-limit outcomes.
- [ ] Implement the shared OpenAI-compatible request client with timeout cleanup.
- [ ] Route extraction through the client.
- [ ] Add typed `chroni:llm-test` IPC and renderer bridge.
- [ ] Run focused tests and typecheck.

### Task 3: Explicit Model Settings Save

**Files:** `src/renderer/src/main.tsx` and renderer styles if needed.

- [ ] Keep editable model values in local draft state.
- [ ] Add a save-and-test command with busy, success, and failure states.
- [ ] Preserve immediate handling for the enabled toggle.
- [ ] Build the renderer and inspect the compact preferences layout.

### Task 4: Runtime Validation And API Discovery

**Files:** create `src/validation.ts`, update `src/api-server.ts`, `src/main.ts`, and API tests.

- [ ] Add failing tests for malformed intake, item patch, preference patch, and discovery records.
- [ ] Implement shared runtime validators and HTTP 400 mapping.
- [ ] Apply validators to matching IPC handlers.
- [ ] Atomically publish and safely remove the actual API endpoint record.
- [ ] Run focused tests and typecheck.

### Task 5: Documentation And Release Verification

**Files:** `README.md`, release configuration only where required.

- [ ] Document DeepSeek save/test behavior and `chroni-api.json` discovery.
- [ ] Run `pnpm run check`.
- [ ] Run the native Windows drag verification.
- [ ] Build the Windows portable package and report its hash.
- [ ] Review the final diff for branding, secrets, and unrelated changes.
