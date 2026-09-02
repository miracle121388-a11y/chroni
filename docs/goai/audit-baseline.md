# Chroni GOAI 2026 baseline audit

> Historical baseline captured before the semifinal upgrade. For the current Learning Mission implementation and verified results, start from [the semifinal submission index](./00-submission-index.md).

> Current resolution (2026-09-02): the final noncommercial semifinal installer uses the verified `product/xiaotong` build with complete license, additional terms, source link and About access. The original-mode decision below records the earlier conservative audit and is not the current artifact choice. No separate commercial authorization is claimed.

Audit date: 2026-08-06
Baseline commit: `68cd9a713f706437ce0c1a42dd47274478d0ae95`
Working branch: `feat/goai-2026`
Operating system: Windows 10.0.26200
Node.js: 24.12.0
pnpm used for the frozen install: 11.7.0

## Executive finding

The current `main` baseline is buildable and its existing automated checks pass. Chroni already implements a credible local-first deadline workflow rather than a chat-only prototype: material parsing, evidence-bearing extraction, clarification, editable task plans, deterministic scheduling, reminders, structured traces, behavior memory, a local API, and a guarded model gateway are present.

The repository is not yet GOAI-ready. The blocking gaps are competition-safe visual assets, an isolated no-key demo namespace, reproducible public evaluation data, redacted run-report export, competition-facing security/IP documentation, and submission materials grounded in generated evidence. These gaps must be closed without giving the model authority to mutate facts or task state.

## Repository shape

- `apps/desktop`: Electron main process, React renderer, local store, parsers, Agent modules, tests, and packaging.
- `apps/gateway`: optional managed OpenAI-compatible gateway with access control, rate limiting, and redacted diagnostics.
- `site`: product download site source.
- `docs`: user, release, privacy, architecture, marketing, and productization documentation.
- `examples`: local API and demo examples.
- `.github/workflows`: CI, release, Pages, and product-site checks.
- `apps/desktop/third_party`: visual asset and font notices distributed with the desktop package.

## Baseline commands and results

| Command | Result | Evidence |
|---|---|---|
| `npx pnpm@11.7.0 install --frozen-lockfile` | Passed | Workspace already matched the lockfile. Registry update metadata was unavailable, but installation completed from the existing store. |
| `pnpm run typecheck` | Passed as part of `pnpm run check` | Main and renderer TypeScript projects completed without errors. |
| `pnpm run test` | Passed | 231 desktop tests: 230 passed, 0 failed, 1 skipped. |
| `pnpm run gateway:test` | Passed | 4 passed, 0 failed. |
| `pnpm run build` | Passed | Electron main and Vite renderer production builds completed. |
| `pnpm run site:check` | Passed | Product site built; 42 IDs, 36 references, and 3 installer entries were checked. |
| `pnpm run check` | Passed | Typecheck, desktop tests, gateway tests, and desktop production build passed. |

The baseline was run from a dirty worktree containing existing, unrelated marketing-script work. Those files are preserved and are not treated as GOAI baseline defects.

## Existing capability inventory

### Material intake and evidence

- Text and local file payload validation with size and shape limits.
- TXT/Markdown, PDF, DOCX, XLSX, ICS, and image/OCR parsing paths.
- Local rule extraction with optional OpenAI-compatible model augmentation.
- Stored source records, source summaries, evidence excerpts, deliverables, constraints, risks, uncertainties, and reminder suggestions.
- Duplicate handling, reprocessing, and source-text correction.

### Clarification and task planning

- Required and optional clarification fields with resumable drafts.
- A policy that lets well-grounded tasks proceed before optional questions.
- Editable `TaskPlan` objects with goals, deliverables, constraints, steps, estimates, dependencies, buffers, uncertainties, versions, and activation.
- Local plan validation, dependency-cycle rejection, grounded-requirement checks, and deterministic fallback when model output fails.

### Deadline Agent

- `Observe -> Plan -> Act -> Verify` lifecycle.
- Risk scoring, daily capacity, work blocks, overflow, coverage, risk-prioritized replanning, reminders, and persisted daily tasks.
- Explicit planner source values: rules, model, or rules fallback.
- Structured trace entries rather than private reasoning-chain display.
- Controlled planning preferences with evidence, confidence, disable, delete, and clear operations.

### Product and operations

- Electron/React desktop surfaces for Windows and macOS.
- Local JSON persistence with repair/normalization paths and secret encoding through Electron safe storage.
- Local API discovery and bearer authentication.
- Optional managed/custom model configuration with failure fallback.
- Cross-platform CI, release packaging, checksums, updater support, user documentation, and a product site.

## Known gaps and risks

### Functional and evaluation gaps

1. There is no isolated GOAI demo namespace. Loading synthetic data into the current store would mix it with user data.
2. There is no one-command, versioned benchmark with at least 60 synthetic cases and generated JSON/Markdown reports.
3. Trace data is visible in the Agent workspace, but there is no judge-friendly redacted JSON/Markdown run-report export.
4. The current trace does not expose one stable report contract covering trigger, source types, tools, validation, fallback, confirmation, persistence, and elapsed time.
5. There are no checked-in synthetic conflict fixtures covering source precedence and conflict confirmation as a complete scenario.

### Security gaps

1. Existing intake validation and model-output validation are substantial, but the public threat model is missing.
2. Export-specific tests do not yet prove removal of API keys, bearer tokens, gateway codes, home directories, full paths, and source bodies.
3. Prompt-injection, malformed archive, spoofed extension, extreme date, and diagnostic leakage protections are not summarized in one auditable matrix.
4. No telemetry is enabled by default, which must remain unchanged.

### Intellectual-property blocker

`apps/desktop/third_party/xiaotong/ADDITIONAL_TERMS.md` restricts commercial use and requires complete notices and an easily reachable attribution surface. GOAI participation, prize money, public video distribution, and later commercialization are not safe to infer from that text. No written competition/commercial authorization is present in the repository.

Therefore the default GOAI build must not package or render XIAOTONG visual assets. Until written authorization is obtained, the safe path is a distinct `CHRONI_PET_ASSET_MODE=original` build using only Chroni-owned neutral branding already in the repository, while retaining `xiaotong` as an explicit opt-in mode with its complete notices. This audit is not legal advice.

### Data and migration risk

- The current persisted schema has repair logic and must remain readable.
- Demo isolation should use a separate storage directory/namespace instead of adding synthetic records to the production state.
- New trace export is derived output and must not alter persisted task schema.
- Any new snapshot fields must be optional or generated at runtime so older data remains valid.

## GOAI requirement mapping

| Requirement | Baseline | Planned evidence |
|---|---|---|
| Material-to-action loop | Implemented, not isolated for judging | Three synthetic no-key demo scenarios and smoke tests |
| Evidence and clarification | Implemented | Scenario A/B assertions and benchmark metrics |
| Conflict handling | Partial primitives | Scenario C fixture, conflict contract, and tests |
| Deterministic control | Implemented | Technical solution and invalid-model-output tests |
| Daily scheduling | Implemented | Demo run and planning metrics |
| Controllable memory | Implemented | Demo instructions and judge Q&A |
| Structured run evidence | Visible, not exportable | Redacted JSON/Markdown export |
| Reproducible evaluation | Missing | `eval:smoke`, `eval:goai`, generated reports |
| Competition-safe assets | Blocked | `CHRONI_PET_ASSET_MODE=original`, packaging test, notices |
| Submission materials | Missing | `docs/goai/*`, English README, completion report |

## Prioritized implementation plan

### P0

1. Add competition-safe asset selection and package-license verification.
2. Add an isolated GOAI demo store with load, reset, clear, and three synthetic scenarios.
3. Add redacted run-report generation and desktop export actions.
4. Add a deterministic 60-case GOAI benchmark, smoke subset, metrics, and generated reports.
5. Add focused security tests and public threat/privacy documentation.
6. Document stable Agent capability contracts and existing API reuse.
7. Produce the submission index, introduction, pitch outline, demo scripts, technical solution, IP, evaluation, judge Q&A, roadmap, one-pager, and English entry point.
8. Update repository entry points and run all checks.

### P1

- Expand the benchmark to at least 100 cases.
- Run separately consented student research; do not include original course materials.
- Publish signed/notarized GOAI installers and a dedicated release.
- Add model-enabled benchmark runs only when explicit credentials and cost consent are present.

### P2

- Authorized connectors, MCP/plugin surface, mobile coordination, team mode, and optional cloud sync only after the local loop is stable.

## Explicit non-goals for this pass

- No fabricated user studies, model accuracy, partnerships, awards, or revenue.
- No multi-Agent rewrite for presentation value.
- No hidden telemetry or background upload.
- No model-controlled state mutation.
- No replacement of the local rules fallback.
- No broad persistence-schema rewrite.
- No claim that XIAOTONG assets are cleared for competition or commercialization without written authorization.
- No release tag or remote push until the engineering and legal gates are actually satisfied.

## Baseline readiness decision

`GOAI READY: NO`

Blocking items at baseline: competition-safe asset mode, isolated no-key demo, generated benchmark report, redacted run-report export, GOAI security/IP material, and reproducible submission entry points.
