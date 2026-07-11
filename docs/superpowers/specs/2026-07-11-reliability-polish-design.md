# Chroni Reliability Polish Design

## Goal

Close the remaining reliability gaps that are visible to real users: remember the pet's position across restarts and display changes, make DeepSeek configuration testable and failure-bounded, reject malformed local API input, and make a dynamically selected API port discoverable.

## Scope Decision

Three approaches were considered:

1. Reliability-first (selected): finish persistence, model connectivity, validation, discovery, and release verification before structural frontend refactoring.
2. Refactor-first: split the large renderer immediately. This improves maintainability but does not fix the current runtime failure modes by itself.
3. Release-first: add publishing and signing automation now. This is premature while model requests and local API inputs still have unbounded or weakly validated behavior.

The selected approach keeps the visible product shape unchanged and makes the existing workflows dependable. Renderer decomposition remains a follow-up after behavior is covered by end-to-end tests.

## Pet Placement

- Persist a private `PetPlacement` record containing the display identifier and normalized X/Y coordinates within that display's movable work area.
- Restore the pet on the same display when available. If the display was removed, use the primary display and clamp the restored coordinates.
- Save the final snapped position after a drag completes.
- Re-clamp and save the position when display topology or work-area metrics change.
- Keep all coordinate conversion in pure geometry helpers so multi-monitor and DPI behavior remains testable.

## DeepSeek Reliability

- Route model requests through one OpenAI-compatible client with an `AbortController` timeout.
- Add a real connection test that performs a minimal completion request and reports useful categories for credentials, model name, rate limiting, timeout, and generic HTTP failures.
- Keep edited base URL, model, and API key as renderer drafts. Persist them only when the user chooses to save and test, avoiding encrypted disk writes on every keystroke.
- Never return the API key over HTTP; the existing `safeStorage` boundary remains authoritative.

## Input Validation

- Validate HTTP and IPC payloads at runtime before they reach store or intake logic.
- Enforce known enum values, field types, text and list limits, valid date strings, and supported preference shapes.
- Return HTTP 400 with a concise message for invalid client input.
- Reuse the same validators across HTTP and IPC so the two entry points cannot drift.

## API Discovery

- After the server is listening, atomically write `chroni-api.json` under Electron's user-data directory.
- Include the actual base URL, process ID, and start time. This also covers fallback to an operating-system-selected port when 8765 is occupied.
- Remove only the discovery record owned by the current process when the server closes.

## Release Boundary

- Run type checks, unit/integration tests, renderer build, native Windows drag verification, and Windows portable packaging.
- Document model setup and API discovery behavior.
- Code-signing and notarization credentials are external release inputs; this work may configure and document them but cannot manufacture certificates.

## Acceptance Criteria

- The pet reopens near its last valid position and remains visible after monitor removal or work-area changes.
- DeepSeek requests time out predictably, and the settings screen can verify real credentials/model connectivity.
- Editing model fields does not persist partial values before an explicit save action.
- Malformed HTTP and IPC requests are rejected without mutating state.
- API clients can discover the actual loopback address even when port 8765 is unavailable.
- The complete repository check and Windows package build pass.
