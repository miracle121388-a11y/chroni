# Security and privacy

Chroni is local-first, not network-free under every configuration. Tasks, Learning Missions, sources, plans, evidence metadata, checkpoints, preferences, memory, and traces are stored in the Electron user-data directory. The app connects to a model only when the user enables managed or custom LLM mode; update checks and user-opened external links may also use the network.

## What leaves the device

When LLM extraction is enabled, bounded source excerpts, the current reference time, and requested structured fields are sent to the configured OpenAI-compatible endpoint or managed gateway. Chroni does not upload local files as arbitrary binaries to the model; it extracts text/OCR locally first. Provider retention and training policy are governed by that provider. The local-rules sample path and offline benchmark make no model calls.

Custom API keys are encoded using Electron `safeStorage` where available and are not present in renderer snapshots, traces, benchmark reports, or redacted evidence. Managed gateway secrets and beta access hashes are deployment environment variables. The local HTTP API listens on `127.0.0.1` and requires a random bearer token after health discovery.

Output evidence files do not leave the device. The main process streams each selected file into SHA-256 and persists only display name, byte size, MIME, modification time, digest, linked deliverable, and creation time. The state does not retain the absolute path or binary content. The HTTP API intentionally cannot register arbitrary file paths.

## Data control

The app exposes the local storage directory in **运行状态**. Users can quit Chroni and delete the state file and exports. Planning memory is visible and can be disabled, deleted individually, or cleared. Daily reviews are stored by date in the same local state and are removed with that data. There is no hidden analytics/telemetry client in this implementation.

## Validation and fallback

- Imported material is untrusted data; injection-like instructions cannot create tasks or clarification prompts in the local rule path.
- Model output is a bounded candidate. Dates, evidence, duplicate occurrences, plan fields, and constraints are validated locally.
- Conflicting/conditional deadlines remain drafts until user confirmation; a TaskPlan cannot rewrite the source deadline.
- Files and API bodies have size limits. DOCX/XLSX archives are preflighted for forged signatures, directory bounds, traversal, entry count, expanded size, and abnormal compression ratio before parser execution; failures commit no tasks.
- Model timeout, authentication, rate limit, invalid JSON, or unavailable service falls back to rules where possible and reports limitations honestly.
- The evidence exporter omits keys, tokens, raw text, file paths, titles, plan-step titles, and free-form summaries; it includes a SHA-256 integrity value.
- Source records and output evidence use different schemas. Course material is never counted as a completed deliverable merely because it was imported.
- A model cannot mark a Mission complete or grade academic quality; explicit user action remains the final authority.

## Education and minor-data boundary

Chroni does not currently provide classroom surveillance, teacher dashboards, cloud student profiles, or automatic academic grading. The project does not claim a completed student study. Any authorized pilot must define informed consent (and guardian/school requirements where applicable), data minimization, withdrawal, retention/deletion, incident response, and aggregated reporting before collecting real learner data. Public demos and repository fixtures remain synthetic.

## Gateway controls

The managed gateway validates access codes, bounds body size, applies rate limiting and upstream timeouts, maps upstream failures to public error categories, and does not expose the upstream API key. Deployment operators still own log retention, access-code revocation, infrastructure security, and provider agreements.

## Known boundaries

Parser process isolation and cancellation, broad Unicode-confusable detection, a real-image OCR accuracy benchmark, long-run stability measurement, signed Windows distribution, and notarized macOS distribution are not proven complete. The full threat table and backlog are in `docs/security/threat-model.md`; private vulnerability reporting is described in `SECURITY.md`.
