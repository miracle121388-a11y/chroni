const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, symlinkSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const desktopRoot = resolve(__dirname, "..");

if (!process.versions.electron) {
  if (process.platform !== "darwin") throw new Error("This native menu check requires macOS.");
  const { spawnSync } = require("node:child_process");
  const fixture = mkdtempSync(join(tmpdir(), "chroni-window-menu-"));
  try {
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "chroni-window-menu-check", main: "main.cjs" }));
    writeFileSync(join(fixture, "main.cjs"), `require(${JSON.stringify(__filename)});`);
    writeFileSync(join(fixture, "index.html"), "<!doctype html><title>Chroni window lifecycle check</title><p>Window lifecycle fixture</p>");
    symlinkSync(join(desktopRoot, "preload.cjs"), join(fixture, "preload.cjs"));
    const env = { ...process.env, CHRONI_RENDERER_URL: pathToFileURL(join(fixture, "index.html")).href };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require("electron"), [fixture], { env, stdio: "inherit", timeout: 30000 });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow, Menu } = require("electron");
  app.setPath("userData", join(app.getAppPath(), "user-data"));
  const waitUntil = async (condition) => {
    const deadline = Date.now() + 10000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error("Window lifecycle check timed out.");
      await new Promise((done) => setTimeout(done, 50));
    }
  };
  app.whenReady().then(async () => {
    try {
      const { createAppWindows } = await import(pathToFileURL(join(desktopRoot, "dist", "windows.js")).href);
      createAppWindows();
      const reopen = Menu.getApplicationMenu()?.getMenuItemById("chroni-open-control-center");
      assert.ok(reopen?.enabled, "A persistent reopen menu item must be enabled.");
      assert.equal(reopen.accelerator, "Command+1");
      const control = () => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith("?view=control"));
      reopen.click(reopen);
      await waitUntil(() => control()?.isVisible());
      const first = control();
      first.close();
      await waitUntil(() => first.isDestroyed());
      assert.equal(reopen.enabled, true, "Closing the main window must leave the reopen command available.");
      reopen.click(reopen);
      await waitUntil(() => control()?.isVisible());
      const second = control();
      assert.notEqual(second.id, first.id, "The command must recreate the closed main window.");
      second.minimize();
      await waitUntil(() => second.isMinimized());
      reopen.click(reopen);
      await waitUntil(() => !second.isMinimized() && second.isVisible());
      assert.equal(control().id, second.id, "Reopening a minimized window must restore it without duplicating it.");
      console.log("PASS: native Window menu opens, recreates a closed window, and restores a minimized window.");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
