# Chroni Apple Motion Performance Plan

## Asset budget

- Hero preloads only `pet-idle.png` and `pet-study.png`.
- Remaining mascot states are copied at build time and preloaded after JavaScript initialization.
- Product screenshots use existing optimized release documentation assets.
- No video, web font, canvas, WebGL, or animation library is added.

The build should continue to keep first-screen image transfer below the agreed product-site budget where the hosting/CDN compression supports it. Product screenshots should be converted to WebP in a future release if visual comparison confirms no text degradation.

## Loading strategy

- HTML, CSS, icon, and two Hero mascot frames are critical.
- The JavaScript bundle is deferred.
- Non-Hero mascot state images are requested after first render.
- Product sections use stable dimensions to prevent layout shift.
- Release metadata loads asynchronously and falls back to bundled v0.1.4 data.

## Component boundaries

This is a dependency-free static site, so boundaries are DOM scenes rather than framework components:

- Hero scroll scene
- Clarity scroll scene
- Planner one-shot scene
- Mascot state controller
- Journal one-shot scene
- Release/download controller

Each controller owns a limited selector set. Only Hero and clarity subscribe to page scroll.

## Runtime policy

- Passive scroll listener.
- At most one pending `requestAnimationFrame`.
- Transform and opacity only for narrative movement.
- No animated width, height, top, left, blur, or box-shadow.
- Ambient animation pauses when the document becomes hidden.
- Scene calculations are disabled below 901 px and under reduced motion.

## Measurement

Before each public release:

1. Run `pnpm site:check`.
2. Capture 1440x900, 1280x720, 390x844, and 360x800 screenshots.
3. Inspect the Hero at initial, extraction, planning, and final scroll positions.
4. Record Chrome Performance while scrolling Hero on a Windows integrated-GPU laptop.
5. Confirm no long main-thread task exceeds 200 ms.
6. Run Lighthouse mobile and desktop against the production Zeabur URL.
7. Verify CLS below 0.1 and target LCP below 2.5 s on a warm CDN.

## Test matrix

- Windows 10/11: Chrome, Edge, 100% and 125% display scaling.
- macOS: Safari and Chrome.
- Mobile: iOS Safari and Android Chrome.
- Keyboard-only navigation.
- JavaScript disabled: core product explanation and download links remain usable.
- `prefers-reduced-motion: reduce`.
- Slow 4G and 4x CPU throttling.
- GitHub API unavailable: bundled release fallback still downloads v0.1.4.

## Degradation

- Low-width devices render static final story frames.
- Reduced motion collapses sticky heights and removes object travel.
- Unsupported `IntersectionObserver` displays all content immediately.
- Failed GitHub metadata requests keep direct fallback installer links.
- Failed mascot preload affects only the selected optional state; idle remains available.

