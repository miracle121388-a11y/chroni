# Chroni GOAI v1 benchmark

This reproducible benchmark measures the current offline Chroni intake, clarification, TaskPlan, and Agent fallback paths against 60 synthetic cases. It contains no student names, identifiers, private chats, email addresses, or credentials.

## Run

```bash
pnpm run eval:smoke
pnpm run eval:goai
```

The full command builds the desktop main process and writes `reports/latest.json` plus `reports/latest.md`. The smoke command selects one case from each category and writes `reports/smoke.*`.

`pnpm run eval:goai:model` is opt-in. Without `CHRONI_LLM_API_KEY` or `DEEPSEEK_API_KEY`, it exits successfully without making a network request. The v1 model evaluator is intentionally marked unmeasured rather than reporting invented scores.

## Dataset

The fixed clock is `2026-08-06T10:00:00+08:00`, timezone `Asia/Shanghai`. Categories follow the GOAI master prompt: 10 clear tasks, 10 multi-task/deliverable cases, 8 clarifications, 6 source conflicts, 8 relative/timezone cases, 6 OCR-transcript-noise cases, 6 no-task controls, and 6 prompt-injection inputs.

OCR-transcript cases measure the parser after text recognition. They are not an image OCR benchmark. This boundary is repeated in the generated report.

## Metric policy

All percentages are calculated from executable outputs. Unsupported or not-yet-run metrics are emitted as `尚未完成测量`; they are never estimated. Reports include the Git commit, environment, fixed clock, and dataset SHA-256.
