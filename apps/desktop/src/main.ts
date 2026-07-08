import { app, ipcMain, shell } from "electron";
import { startChroniApiServer } from "./api-server.js";
import { extractPayload, processIntake } from "./intake.js";
import type { ChroniPreferencesPatch, IntakePayload, ItemPatch } from "./shared/types.js";
import { companionStateForItems, ChroniStore } from "./store.js";
import { broadcast, createAppWindows, createTray, showControlCenter, showSchedule } from "./windows.js";

let store: ChroniStore;

app.commandLine.appendSwitch("use-mock-keychain");
app.commandLine.appendSwitch("password-store", "basic");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    app.setName("Chroni");
    if (process.platform === "win32") app.setAppUserModelId("app.chroni.desktop");
    store = new ChroniStore(app.getPath("userData"));
    installIpc();
    createAppWindows();
    createTray();
    startChroniApiServer(store, (snapshot) => {
      broadcast("chroni:snapshot-updated", snapshot);
      showSchedule(true);
    });
    refreshCompanionFromSchedule();
    console.log("Chroni desktop shell ready.");
  }).catch((error) => {
    console.error("Failed to start Chroni.", error);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  // The tray keeps Chroni available as a lightweight desktop utility.
});

app.on("activate", () => showControlCenter());

function installIpc(): void {
  ipcMain.handle("chroni:snapshot", () => store.snapshot());
  ipcMain.handle("chroni:extract", async (_event, payload: IntakePayload) => extractPayload(payload, { llm: store.snapshot().preferences.llm }));
  ipcMain.handle("chroni:intake", async (_event, payload: IntakePayload) => {
    const result = await processIntake(payload, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    showSchedule(true);
    return result;
  });
  ipcMain.handle("chroni:companion-clicked", () => {
    const current = companionStateForItems(store.snapshot().items);
    const snapshot = store.setCompanion("clicked", current.bubble);
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:companion-hover", (_event, hovering: boolean) => {
    const current = companionStateForItems(store.snapshot().items);
    const snapshot = hovering
      ? store.setCompanion("hover_accept", "松手就能自动识别。")
      : store.setCompanion(current.state, current.bubble);
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:item-update", (_event, id: string, patch: ItemPatch) => {
    const snapshot = store.updateItem(id, patch);
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:item-delete", (_event, id: string) => {
    const snapshot = store.deleteItem(id);
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:preferences-update", (_event, patch: ChroniPreferencesPatch) => {
    const snapshot = store.updatePreferences(patch);
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:quick-add", async (_event, text: string) => {
    const result = await processIntake({ kind: "text", text }, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    return result;
  });
  ipcMain.handle("chroni:open-control", () => showControlCenter());
  ipcMain.handle("chroni:show-schedule", (_event, expanded: boolean) => showSchedule(expanded));
  ipcMain.handle("chroni:open-storage", () => shell.showItemInFolder(store.filePath));
}

function refreshCompanionFromSchedule(): void {
  const next = companionStateForItems(store.snapshot().items);
  const snapshot = store.setCompanion(next.state, next.bubble);
  broadcast("chroni:snapshot-updated", snapshot);
  setTimeout(refreshCompanionFromSchedule, 60_000);
}
