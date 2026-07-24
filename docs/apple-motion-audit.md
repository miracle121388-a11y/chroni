# Chroni Apple Motion Audit

## Existing page

The original download page was a well-structured static product page, but its story was assembled from independent sections:

- The hero used one full-background planner screenshot with a separate mascot image.
- Input, extraction, planning, and reminders were described in three parallel text columns.
- Product screenshots appeared as complete frames, so the user saw the result but not how Chroni reached it.
- Four mascot states were displayed as an image grid rather than one continuous system state.
- Motion was limited to button hover and smooth anchor scrolling.

The page therefore explained the feature list but did not visually demonstrate Chroni's closed loop.

## Reusable product material

- `chroni-daily-planner-v0.1.4.png`: real Daily Planner UI and time-duration blocks.
- `chroni-agent-workspace-v0.1.4.png`: real Agent workspace and risk summary.
- Tongluv PNG frames: idle, study, response, wake, play, and sleep states.
- Existing release API integration: live GitHub Release metadata and installer URLs.
- Existing static deployment: zero framework runtime and direct Zeabur static output.

## Motion architecture

The site has no Framer Motion or animation dependency. The revised implementation therefore uses:

- CSS transforms and opacity for all moving product objects.
- One throttled `requestAnimationFrame` update for the Hero and clarity scroll scenes.
- `IntersectionObserver` for one-shot planner, Agent, and journal transitions.
- Native `details` for accessible FAQ interaction.
- Native buttons and ARIA tab semantics for mascot states.

No Three.js, canvas, video, or additional runtime package is introduced.

## Performance risks

- The two full product screenshots are the largest visual assets.
- Large sticky sections can keep layers promoted longer than ordinary sections.
- Drop shadows and multiple transparent PNGs can be expensive on older integrated GPUs.
- Updating many DOM nodes directly during scroll would create unnecessary layout work.

Mitigations:

- The scroll handler writes only CSS custom properties and is capped to one update per frame.
- Only transform and opacity are animated.
- Product screenshots have stable aspect ratios.
- Mobile removes sticky storytelling and displays the final state.
- Off-viewport sequences do not run timers or continuous JavaScript.

## Mobile risks

Desktop object paths cannot be compressed into a narrow viewport without overlap. Below 901 px:

- Hero and clarity scenes become normal-flow sections.
- The final readable state is shown directly.
- Evidence transfer chips are removed.
- Planner remains horizontally inspectable rather than shrinking text below a readable size.
- Desktop application guidance remains next to the primary CTA.

## Reduced motion

The original page only disabled button transitions. The revised page fully handles `prefers-reduced-motion`:

- Sticky story heights collapse.
- Hero opens on the final complete product composition.
- Mascot ambient breathing stops.
- Cross-screen object travel is removed.
- Timeline blocks and source evidence appear in final positions.
- Every conclusion remains available as ordinary DOM text.

