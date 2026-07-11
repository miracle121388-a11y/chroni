# Chroni Windows And Release Readiness Design

## Goal

Make Chroni stable on Windows, remove drag and drawer position drift, make development shutdown predictable, and close release-blocking API and secret-handling gaps without expanding the lightweight product surface.

## Investigated Causes

- The renderer calculates drag deltas from `PointerEvent.screenX/screenY`, while Electron moves windows in display-independent coordinates. Windows display scaling and cross-display movement can therefore amplify the displacement.
- The drawer starts a new six-timeout animation on every enter/leave request and never cancels the previous animation. Old callbacks can continue moving the window after state changes.
- `concurrently -k` treats the Vite process killed after Electron exits as a failure because its default success policy requires every process to return zero.
- An inherited `ELECTRON_RUN_AS_NODE` variable makes the Electron executable run the compiled application as plain Node. Setting the variable to an empty string or `0` does not remove it.
- The loopback API currently permits wildcard CORS, has no request authentication, accepts unbounded request bodies, and serializes the configured LLM key in snapshots.

## Considered Approaches

### 1. Main-process coordinate ownership (selected)

The renderer sends drag lifecycle events only. The main process captures the starting cursor and window positions using Electron's `screen` API, computes every frame from that immutable origin, and snaps only at drag end. This keeps all coordinates in Electron DIP units and works across Windows scaling modes.

### 2. CSS native drag regions

`-webkit-app-region: drag` delegates movement to Chromium, but it conflicts with the pet's click, context-menu, pointer animation, and file-drop surface. Splitting tiny draggable and non-draggable regions would make the main interaction unpredictable.

### 3. Renderer-side scale conversion

The current delta protocol could divide by `devicePixelRatio`, but per-monitor DPI changes and Chromium event semantics still leave edge cases. It also keeps two coordinate systems coupled.

## Window Design

- Add pure geometry helpers for drag positions, drawer targets, interpolation, and edge snapping.
- Track drag state per `webContents` in the main process. Start from `screen.getCursorScreenPoint()` and the immutable initial window position; ignore move/end events without a live session.
- Capture the pointer in the pet renderer so pointer-up and pointer-cancel reliably finish the session.
- Anchor the Windows drawer to the display containing the pet. If the pet is unavailable, use the display nearest the cursor.
- Replace independent timeout batches with one generation-controlled animation. Starting a new animation invalidates all old frames.
- Keep the 34 px handle visible when collapsed and clamp all final positions to the selected display work area.

## Development Lifecycle Design

- Add a small Node launcher that deletes `ELECTRON_RUN_AS_NODE` before spawning the workspace Electron binary.
- Give the Electron branch its own script and make `concurrently` use the Electron command's exit status. A normal app exit becomes success; a real Electron startup failure remains failure.
- Keep renderer and Electron scripts separately runnable for diagnosis.
- Handle a second app instance by focusing the control center instead of silently doing nothing.

## API And Secret Design

- Generate a random API session token at server startup. `/api/health` remains readable and returns the token; all other routes require `Authorization: Bearer <token>`.
- Do not emit CORS headers by default. An exact `CHRONI_API_ALLOWED_ORIGIN` may opt a trusted browser client in.
- Reject oversized JSON bodies before buffering them.
- Sanitize every HTTP response recursively so `preferences.llm.apiKey` is always empty outside Electron IPC.
- Persist the DeepSeek/OpenAI-compatible key through an injected secret codec. The desktop process uses Electron `safeStorage`; tests use an explicit deterministic codec. Legacy plaintext state is migrated on the next save.
- Keep the current control-center fields and environment-variable fallback. No new developer panel is added.

## Reliability And UX Design

- Convert renderer intake failures into visible one-line feedback and always release busy state.
- Report a model failure even when local rules provide a fallback result.
- Preserve all supported file types, source tracking, correction, reminder, and tray behavior.
- Update the Chroni-specific README with Windows commands, DeepSeek values, API authentication, and troubleshooting. Add CI for typecheck, tests, and build.

## Testing

- Unit-test drag geometry, drawer bounds, interpolation, and snapping before implementation.
- Add API tests for authentication, secret redaction, allowed-origin behavior, and request-size limits.
- Add store tests proving plaintext keys are not written and encrypted keys reload.
- Run the full `pnpm run check`, package the Windows portable target, and smoke-test `dev:desktop` with and without inherited `ELECTRON_RUN_AS_NODE`.

## Acceptance Criteria

- Dragging the pet follows the cursor one-for-one at Windows 100%, 125%, 150%, and mixed-monitor scaling without accumulating distance.
- Repeated drawer enter/leave actions never allow stale animation frames to move it away from its current target.
- Closing Chroni normally does not produce `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`; genuine Electron failures still do.
- HTTP snapshots never expose the LLM key, unauthenticated mutations fail, and oversized payloads are rejected.
- Existing product requirements and all automated checks continue to pass.
