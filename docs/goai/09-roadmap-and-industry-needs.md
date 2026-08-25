# Roadmap and industry needs

This roadmap separates implemented work from proposed work. Dates should be assigned only after team capacity and competition milestones are confirmed.

## P1: reproducible release candidate

- Expand benchmark from 60 to at least 100 synthetic/authorized cases and add real image OCR fixtures with licenses.
- Implement decompression-ratio/file-count quotas and parser worker timeouts for OOXML/PDF workloads.
- Add MIME signature checks, Unicode confusable review, and a redacted diagnostic-bundle test.
- Measure long-run stability and opt-in model quality/latency/cost with recorded provider/model parameters.
- Add TaskPlan dependency edges, cycle validation, and a benchmarked cycle-detection rate.
- Add a versioned Learning Mission benchmark for deliverable grounding, success-criteria fidelity, milestone synchronization, evidence coverage, checkpoint recovery, and replan correctness.
- Produce signed Windows and signed/notarized macOS artifacts when credentials exist; verify installation on clean machines.
- Replace or formally authorize every competition-facing character asset; keep the original-mode verifier as a release gate.

## P2: authorized pilot

- Recruit a small, consenting pilot cohort through a verified partner; publish only aggregated/anonymous findings and disclose the actual sample instead of pre-committing to a number.
- Measure process outcomes before academic outcomes: requirement-understanding errors, plan activation, planned-versus-actual effort, evidence retention, blocked-checkpoint recovery, and user override rate.
- Treat grades or learning gains as a separate study requiring an appropriate design; do not infer them from evidence coverage or task completion.
- Add opt-in feedback and deletion controls; no silent telemetry.
- Build calendar/LMS adapters behind scoped permissions and stable capability contracts.
- Evaluate accessibility, low-end hardware, multi-display behavior, timezone travel, and offline recovery.
- Add English UI review and broader bilingual benchmark coverage.

## P3: ecosystem

- Extract parsers, capability schemas, benchmark harness, and trace/evidence formats into reusable packages where maintenance value is proven.
- Document adapter certification and security review for community integrations.
- Explore team/office workflows only after personal local-first permissions and synchronization semantics are designed.

## Requested resources

| Need | Why | Evidence expected before claiming completion |
| --- | --- | --- |
| Authorized campus pilot | Validate workflow value and failure recovery with real consented users. | Ethics/privacy process, consent text, anonymized protocol, participant/sample disclosure. |
| Education platform APIs | Reduce manual intake from LMS/calendar systems. | Written API access, scoped permissions, revocation and deletion path. |
| Security reviewers | Test malicious files, localhost threat model, gateway and updater. | Reproducible findings and fixed-version advisories. |
| Windows/Apple distribution credentials | Reduce install warnings and verify publisher identity. | Signed binaries, notarization logs, clean-machine install evidence. |
| Benchmark/OCR reviewers | Improve gold labels and image evaluation without leakage. | Licensed fixtures, independent label review, versioned reports. |
| Open-source maintainers | Sustain parser, accessibility, calendar and localization modules. | Merged contributions and documented ownership, not contributor-count estimates. |

No school partnership, pilot enrollment, investment, funding, revenue, or commercial contract is asserted by this document.
