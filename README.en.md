<p align="center"><img src="./apps/desktop/build/icon-source.svg" width="96" alt="Chroni mark"></p>

# Chroni

**A local-first learning execution Agent that turns course material into work you can do today and review at the end of the day.**

Chroni does not complete coursework for students. It turns course requirements into grounded goals, deliverables, success criteria, milestones, daily actions, output evidence, checkpoints, and a persistent daily review. New installations include zero-configuration managed DeepSeek access, while local validation, persistence, tools, and fallback retain authority.

![Chroni Learning Mission workspace](./docs/assets/chroni-learning-mission-v0.2.0.png)

_Actual product UI with isolated synthetic demo data._

[Product and download site](https://getchroni.zeabur.app/) · [Chinese README](./README.md) · [User guide](./docs/user/quick-start.md) · [Security](./docs/security/threat-model.md)

## Current version and three-minute path

The repository package version is `0.2.4`. Public installer availability, signatures, and notarization status must be checked on [GitHub Releases](https://github.com/miracle121388-a11y/chroni/releases).

1. Install and start Chroni. The managed smart service is enabled by default and requires no API key, access code, or account. The **Today** timeline is the default workspace.
2. Drop a course file onto the companion or import it from **Smart Organize**.
3. Review grounded goals and milestones in **Learning Tasks**, then choose **Smart plan** in **Today** to place realistic work blocks on the timeline.
4. Complete a block, record output evidence, and let Chroni adjust the remaining plan. At the end of the day, open **Daily Review** to keep the activity trail, reflection, and carry-over items under that date.

## Capabilities

| Area | Current implementation |
| --- | --- |
| Intake | TXT, Markdown, CSV/TSV, JSON, ICS, HTML/XML/YAML/RTF, DOCX, PDF, XLSX, and common image formats; local OCR for images/scan text. |
| Grounding | Source records, date validation, deliverables, constraints, conflict/conditional detection, duplicate reconciliation, and resumable clarification. |
| Learning Mission | Stable mission records with goals, deliverables, success criteria, milestones, next action, risk, and linked source evidence. |
| Verification | Local file metadata and SHA-256 or note evidence, milestone-bound checkpoints, actual effort, blockers, and evidence coverage. |
| Learning execution Agent | Ground, Plan, Act, Verify, Adapt loop with risk/slack/capacity scheduling, local tools, and structured trace. |
| Daily execution | Day/multi-day/week/month views, overlapping lanes, duration-aware blocks, zoom, drag/replan, history and future dates. |
| Daily review | A dedicated date-based workspace for completion metrics, the full activity trail, editable summaries, reflections, and unfinished carry-over items. |
| Local-first | Local state and memory, server-only managed model key, OS-backed encoding only for optional custom keys, loopback bearer-token API, no hidden analytics. |
| Auditability | On-screen operational trace plus default-redacted JSON/Markdown export with mission inventory and SHA-256. |

## Install for users

Download the platform artifact from [Releases](https://github.com/miracle121388-a11y/chroni/releases) or the [product site](https://getchroni.zeabur.app/). Windows users should prefer the x64 Setup executable; the portable executable requires no installation. macOS users should use the universal DMG. Verify `SHA256SUMS.txt` when available. Unsigned/unnotarized builds may trigger OS warnings; do not disable global security controls.

See [quick start](./docs/user/quick-start.md), [install FAQ](./docs/user/install-faq.md), and [troubleshooting](./docs/user/troubleshooting.md).

## Run from source

Requirements: Node.js 22.13+ and pnpm 11.7.0.

```bash
git clone https://github.com/miracle121388-a11y/chroni.git
cd chroni
npx pnpm@11.7.0 install --frozen-lockfile
npx pnpm@11.7.0 run dev
```

The renderer starts on `http://127.0.0.1:5173`; Electron opens automatically. The local API normally listens on `127.0.0.1:8765`, with actual address/token in the user-data `chroni-api.json` discovery file.

## Managed and custom model access

The public Windows and macOS builds default to **Chroni Smart Service**. It supports model extraction, clarification, TaskPlan, and Agent planning without asking the user for an API key, access code, or account. The DeepSeek provider key exists only in the Zeabur gateway environment and is never shipped in the desktop package or request. Source-network and global fair-use limits protect the public service; Chroni falls back to local rules when the service is unavailable or limited.

Advanced users can instead open **Preferences → Smart model service → Custom API**, set an OpenAI-compatible base URL and model, and enter their own key. The smart model can also be disabled for an entirely local workflow. Never commit custom keys or post them in issues.

## Architecture and API

Chroni is one hybrid Agent, not a claimed multi-Agent system. Models propose bounded candidates; local code controls evidence, validation, state transitions, planning constraints, tools, memory, and fallback. See [Agent design](./docs/agent-clarification-task-planning-memory.md), [local API](./docs/local-api.md), and [productization roadmap](./docs/productization-roadmap.md).

```bash
pnpm run check
pnpm run eval:smoke
pnpm run build
pnpm run store:check
pnpm run notices:generate
```

The 60-case report is machine-generated and includes known failures/unmeasured fields. Model evaluation is opt-in and does not run without credentials.

## Security, privacy, and asset rights

Imported files and model output are untrusted data. The renderer has no direct Node access; typed IPC/local API routes validate state changes. Read the [security policy](./SECURITY.md), [threat model](./docs/security/threat-model.md), and [privacy explanation](./docs/user/privacy.md).

Public packages include the full animated desktop companion. The MIT license covers Chroni first-party code; the companion visuals, fonts, and runtime dependencies remain subject to their own notices:

```bash
pnpm run package:windows
# or pnpm run package:macos
```

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and the generated dependency inventory.

## Known limitations

Real-image OCR accuracy, credentialed model quality/latency, long-run stability, TaskPlan dependency-cycle metrics, archive expansion hardening, signed Windows distribution, and notarized macOS distribution are not claimed complete. See the roadmap and completion report.

Contributions are welcome through [CONTRIBUTING.md](./CONTRIBUTING.md). Please report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).
