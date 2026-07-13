# Chroni Release Hardening And Cleanup Design

## Goal

Make the current Chroni repository release-ready by fixing the real DeepSeek connection, XLSX extraction, and image OCR failures; enforcing dead-code checks; and removing development-only requirement and planning documents without deleting runtime code, user documentation, or required licenses.

## Scope

- Keep `README.md`, `.env.example`, `LICENSE`, `docs/agent-clarification-task-planning-memory.md`, and every file under `apps/desktop/third_party/xiaotong`.
- Remove root development inputs: `Chroni_Agent_主动追问_任务拆解_个性化Memory_开发提示词.md`, `Chroni_控制中心前端优化完整指南.md`, `product_requirements.md`, and `prompt.md`.
- Remove internal Superpowers design and plan documents after implementation is complete.
- Do not remove Agent modules or pet animation assets: repository tracing shows that they are imported by the production main process and renderer.
- Do not add dependencies or expose the configured API key in test output, logs, state snapshots, or Git history.

## Architecture

### DeepSeek compatibility

`requestChatCompletion()` remains the single OpenAI-compatible transport. It will merge provider defaults into every request. Requests sent to `api.deepseek.com` default to `thinking: { type: "disabled" }` unless a caller explicitly supplies another value. This makes connection tests and every structured Agent request behave consistently with the current DeepSeek API, whose thinking mode is enabled by default.

The connection probe will allow enough completion tokens for a final response. Existing authentication, timeout, rate-limit, and response error categories remain unchanged.

### File adapters

XLSX extraction will consume the current `read-excel-file` v9 default result, which is an array of `{ sheet, data }` objects. All worksheets will be flattened into readable text with worksheet labels, preserving dates and cell values.

Tesseract extraction will resolve CommonJS/ESM interop through `module.default ?? module`, validate that `recognize` is callable, and keep the existing confidence and readable-text gates. A missing OCR API will produce a specific extraction failure rather than a raw TypeError.

### Static cleanup

TypeScript will enable `noUnusedLocals` and `noUnusedParameters` in both main and renderer configurations. The five currently reported unused imports/constants/parameters will be removed. This turns future dead code into a build failure.

## Error Handling

- DeepSeek response errors stay categorized and user-facing; no model reasoning or raw response body is persisted.
- A malformed workbook or unavailable OCR runtime is recorded as a per-file extraction failure, allowing other files in the same batch to continue.
- Provider-specific defaults apply only to DeepSeek URLs and can be overridden explicitly by a caller.

## Verification

- Add regression tests that first fail for the DeepSeek request body, workbook result shape, and Tesseract default export.
- Run focused red/green tests, strict TypeScript checks, all desktop tests, and the production renderer build.
- Run a real DeepSeek connection, text extraction, clarification, task-plan, and DeadlineAgent smoke test using the ignored `.env` key.
- Generate temporary TXT, CSV, DOCX, XLSX, PDF, and PNG fixtures and verify non-empty extraction without retaining them.
- Build Windows installer and portable artifacts and launch-smoke the packaged application.

