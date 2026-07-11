# Chroni Windows And Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize Chroni's Windows surfaces and development lifecycle, then close API and secret-handling blockers for an open-source release.

**Architecture:** Electron's main process owns native window coordinates and API security. Pure geometry and serialization boundaries carry testable behavior, while the React renderer sends only interaction intent. A dedicated launcher normalizes the process environment before Electron starts.

**Tech Stack:** Electron 42, React 19, TypeScript 6, Vite 8, Node test runner, pnpm 11.

## Global Constraints

- Preserve the lightweight pet, DDL drawer, and three-tab control-center product shape.
- Preserve all currently supported input formats and source-record behavior.
- Do not expose LLM credentials over HTTP or write them as plaintext in production state.
- Use tests before production changes and keep the full `pnpm run check` green.

---

### Task 1: Native Window Geometry And Dragging

**Files:**
- Create: `apps/desktop/src/window-geometry.ts`
- Modify: `apps/desktop/src/windows.ts`
- Modify: `apps/desktop/preload.cjs`
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Modify: `apps/desktop/src/renderer/src/vite-env.d.ts`
- Create: `apps/desktop/test/window-geometry.test.mjs`

**Interfaces:**
- Produces: `draggedWindowPosition(startWindow, startCursor, cursor)`, `windowsDrawerPosition(area, size, expanded)`, `interpolatedPosition(start, target, progress)`, and `snappedWindowPosition(bounds, area, threshold)`.
- Produces preload methods: `startWindowDrag()`, `moveWindowDrag()`, `endWindowDrag()`.

- [ ] Write geometry tests for immutable-origin dragging, drawer targets on offset displays, clamping, interpolation, and snapping.
- [ ] Build and run only `window-geometry.test.mjs`; verify imports fail before the module exists.
- [ ] Implement the pure geometry module and rerun the focused test.
- [ ] Replace delta IPC with drag lifecycle IPC using `screen.getCursorScreenPoint()`.
- [ ] Add renderer pointer capture/cancel handling and update preload typings.
- [ ] Run typecheck and focused tests.

### Task 2: Stable Windows Drawer

**Files:**
- Modify: `apps/desktop/src/windows.ts`
- Test: `apps/desktop/test/window-geometry.test.mjs`

**Interfaces:**
- Consumes: geometry helpers from Task 1.
- Produces: a single generation-controlled drawer animation anchored to the pet display.

- [ ] Add a failing geometry test for a 34 px visible collapsed handle on a non-primary display.
- [ ] Update drawer display selection and target calculation.
- [ ] Replace queued timeout batches with a cancellable frame loop.
- [ ] Verify rapid target changes finish at the latest requested position.

### Task 3: Predictable Development Startup

**Files:**
- Create: `apps/desktop/scripts/run-electron.cjs`
- Create: `apps/desktop/test/run-electron.test.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`
- Modify: `apps/desktop/src/main.ts`

**Interfaces:**
- Produces: launcher function `sanitizedElectronEnvironment(source)` and CLI Electron spawn behavior.

- [ ] Write a failing test proving `ELECTRON_RUN_AS_NODE` is removed without mutating unrelated variables.
- [ ] Implement and test the launcher.
- [ ] Split `dev:electron`, `dev:desktop`, and `start` scripts; make Electron determine concurrent success.
- [ ] Add second-instance focus behavior.
- [ ] Smoke-test Electron version and dev startup under a polluted parent environment.

### Task 4: API Authentication And Response Safety

**Files:**
- Modify: `apps/desktop/src/api-server.ts`
- Modify: `apps/desktop/test/api-server.test.mjs`

**Interfaces:**
- Produces: health response `apiToken`, bearer authorization for protected routes, exact-origin CORS, bounded JSON reading, and redacted HTTP snapshots.

- [ ] Add failing tests for unauthorized access, authorized mutation, secret redaction, disallowed origin, and oversized content length.
- [ ] Implement session authentication and exact-origin CORS.
- [ ] Implement bounded JSON reading and recursive snapshot sanitization.
- [ ] Update existing API tests to authenticate and run the focused suite.

### Task 5: Protected LLM Key Persistence

**Files:**
- Modify: `apps/desktop/src/store.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/test/core.test.mjs`

**Interfaces:**
- Produces: `SecretCodec` with `encrypt(value)` and `decrypt(value)`, injected into `ChroniStore`.
- Consumes: Electron `safeStorage` in the desktop entry point.

- [ ] Add a failing test that updates an LLM key and asserts the state file excludes plaintext.
- [ ] Add a failing reload test using a deterministic codec.
- [ ] Implement encrypted persistence and legacy plaintext migration.
- [ ] Provide the production Electron safe-storage codec and run core tests.

### Task 6: User-Facing Failure Handling And Release Files

**Files:**
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Modify: `apps/desktop/src/intake.ts`
- Modify: `README.md`
- Create: `.github/workflows/ci.yml`
- Test: `apps/desktop/test/core.test.mjs`

**Interfaces:**
- Produces: visible one-line async failure messages and a model-fallback warning.

- [ ] Add a failing extraction test for enabled-model failure with a valid local-rule fallback.
- [ ] Implement the warning while retaining the valid local result.
- [ ] Catch renderer async failures and release busy state consistently.
- [ ] Document Windows startup, DeepSeek configuration, local API authentication, tests, and packaging.
- [ ] Add a Node 20 CI workflow running `pnpm run check`.

### Task 7: Release Verification

**Files:**
- Review: all changed files and tracked release metadata.

- [ ] Scan tracked files and built renderer text for legacy project identifiers.
- [ ] Run `npx pnpm@11.7.0 run check`.
- [ ] Run Windows portable packaging and inspect produced artifact names.
- [ ] Start `dev:desktop` with `ELECTRON_RUN_AS_NODE=1`, verify Electron remains alive, then close it cleanly and verify exit zero.
- [ ] Review `git diff --check`, `git status`, and final diff for accidental generated files or secrets.
