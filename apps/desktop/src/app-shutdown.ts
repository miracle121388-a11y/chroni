import type { App } from "electron";

/** Release native resources before quitting; bound a stalled native quit after cleanup. */
export function installAppShutdown(app: Pick<App, "on" | "quit" | "exit">, cleanup: () => Promise<void>, fallbackMs = 5_000): void {
  let phase: "running" | "cleaning" | "ready" = "running";
  app.on("before-quit", (event) => {
    if (phase === "ready") return;
    event.preventDefault();
    if (phase === "cleaning") return;
    phase = "cleaning";
    void cleanup().catch((error) => console.error("Chroni shutdown cleanup failed.", error)).finally(() => {
      phase = "ready";
      // MAS can leave AppKit and audio helpers alive after all windows close.
      // State is saved synchronously and native resources are released before
      // this fallback is armed. It never interrupts voice/model disposal.
      setTimeout(() => app.exit(0), fallbackMs);
      setImmediate(() => app.quit());
    });
  });
}
