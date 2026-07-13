# Chroni Release Hardening And Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix verified DeepSeek, XLSX, and OCR failures, enforce dead-code checks, and remove development-only repository content.

**Architecture:** Keep OpenAI-compatible transport centralized in `llm-client.ts`, adapt current library module shapes inside `intake.ts`, and use strict TypeScript settings to prevent dead code. Preserve product documentation, runtime modules, assets, and all license material.

**Tech Stack:** Electron 42, TypeScript 6, Node.js 22, React 19, DeepSeek OpenAI-compatible API, read-excel-file 9, Tesseract.js 7, Node test runner, electron-builder.

## Global Constraints

- Do not add runtime or development dependencies.
- Never print, persist, or commit the real API key.
- Preserve all runtime Agent modules, pet assets, README, `.env.example`, product documentation, and license files.
- Work on the current `main` branch and preserve user changes.

---

### Task 1: DeepSeek Request Defaults

**Files:**
- Modify: `apps/desktop/test/llm-client.test.mjs`
- Modify: `apps/desktop/src/llm-client.ts`

**Interfaces:**
- Consumes: `requestChatCompletion(settings, messages, options)`.
- Produces: DeepSeek requests that default to non-thinking mode while allowing an explicit `body.thinking` override.

- [ ] Add tests asserting that a DeepSeek connection probe sends `thinking.type === "disabled"`, permits a final response, and does not add the field for another OpenAI-compatible host.
- [ ] Run `npx pnpm@11.7.0 --filter @chroni/desktop run build:main; node --test apps/desktop/test/llm-client.test.mjs` and confirm the new DeepSeek assertion fails.
- [ ] Merge provider defaults before caller body data in `requestChatCompletion()` and increase the probe budget from 8 to 32 tokens.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: XLSX And OCR Adapters

**Files:**
- Modify: `apps/desktop/test/core.test.mjs`
- Modify: `apps/desktop/src/intake.ts`

**Interfaces:**
- Consumes: `readXlsxFile(buffer)` returning `Array<{ sheet: string; data: unknown[][] }>` and a dynamically imported Tesseract module.
- Produces: `workbookText(sheets)` and `recognizeWithTesseract(module, image, languages)` behavior used by file extraction.

- [ ] Add tests for multi-sheet workbook flattening and a Tesseract module whose `recognize` function exists under `default`.
- [ ] Build main and run the focused core test, confirming the helpers are missing or the assertions fail.
- [ ] Implement workbook flattening with worksheet labels and ESM/CommonJS Tesseract resolution with a specific unavailable-runtime error.
- [ ] Re-run focused tests and verify they pass.

### Task 3: Strict Static Cleanup

**Files:**
- Modify: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/tsconfig.renderer.json`
- Modify: `apps/desktop/src/agent/behavior-memory.ts`
- Modify: `apps/desktop/src/agent/deadline-agent.ts`
- Modify: `apps/desktop/src/intake.ts`
- Modify: `apps/desktop/src/store.ts`
- Modify: `apps/desktop/src/renderer/src/components/AgentWorkspace.tsx`

**Interfaces:**
- Produces: normal project type checks that reject unused locals and parameters.

- [ ] Enable `noUnusedLocals` and `noUnusedParameters` in both TypeScript configurations.
- [ ] Run `npx pnpm@11.7.0 run typecheck` and confirm the five known unused declarations fail.
- [ ] Remove only the reported unused declarations and re-run type checking.

### Task 4: Repository Cleanup And Documentation

**Files:**
- Delete: `Chroni_Agent_主动追问_任务拆解_个性化Memory_开发提示词.md`
- Delete: `Chroni_控制中心前端优化完整指南.md`
- Delete: `product_requirements.md`
- Delete: `prompt.md`
- Delete: `docs/superpowers/plans/*.md`
- Delete: `docs/superpowers/specs/*.md`
- Modify: `README.md`

**Interfaces:**
- Produces: a lean open-source tree with one operational README and one detailed Agent product document.

- [ ] Remove the approved development-only files while preserving README, `.env.example`, product docs, runtime files, tests, assets, and licenses.
- [ ] Update README troubleshooting to explain DeepSeek environment precedence and the supported file paths without exposing secrets.
- [ ] Scan tracked files for API keys, obsolete branding, placeholders, and deleted-document references.

### Task 5: End-To-End Verification And Release Artifacts

**Files:**
- Generated and ignored: `apps/desktop/dist`, `apps/desktop/dist-electron`, temporary acceptance fixtures.

**Interfaces:**
- Consumes: the ignored root `.env` DeepSeek configuration.
- Produces: verified installer and portable executables.

- [ ] Run `npx pnpm@11.7.0 run check` and require zero failures.
- [ ] Run strict no-unused checks and `npx pnpm@11.7.0 audit --prod`.
- [ ] Run real DeepSeek probes for connection, extraction, clarification, task plan, and DeadlineAgent without printing the key.
- [ ] Extract temporary TXT, CSV, DOCX, XLSX, PDF, and PNG fixtures and require non-empty results.
- [ ] Run `npx pnpm@11.7.0 run package:desktop`, launch-smoke the packaged executable, and stop test processes cleanly.
- [ ] Review `git diff`, commit the product changes on `main`, and report whether the local branch is ahead of the remote.

