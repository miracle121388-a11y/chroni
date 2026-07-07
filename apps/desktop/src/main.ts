import { app, ipcMain, shell } from "electron";
import { startDueFlowApiServer } from "./api-server.js";
import { extractPayload, processIntake } from "./intake.js";
import type { DueFlowPreferencesPatch, IntakePayload, ItemPatch } from "./shared/types.js";
import { companionStateForItems, DueFlowStore } from "./store.js";
import { broadcast, createAppWindows, createTray, showControlCenter, showSchedule } from "./windows.js";

let store: DueFlowStore;

app.commandLine.appendSwitch("use-mock-keychain");
app.commandLine.appendSwitch("password-store", "basic");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    app.setName("DueFlow");
    if (process.platform === "win32") app.setAppUserModelId("app.dueflow.desktop");
    store = new DueFlowStore(app.getPath("userData"));
    installIpc();
    createAppWindows();
    createTray();
    startDueFlowApiServer(store, (snapshot) => {
      broadcast("dueflow:snapshot-updated", snapshot);
      showSchedule(true);
    });
    refreshCompanionFromSchedule();
    console.log("DueFlow desktop shell ready.");
  }).catch((error) => {
    console.error("Failed to start DueFlow.", error);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  // The tray keeps DueFlow available as a lightweight desktop utility.
});

app.on("activate", () => showControlCenter());

function installIpc(): void {
  ipcMain.handle("dueflow:snapshot", () => store.snapshot());
  ipcMain.handle("dueflow:extract", async (_event, payload: IntakePayload) => extractPayload(payload, { llm: store.snapshot().preferences.llm }));
  ipcMain.handle("dueflow:intake", async (_event, payload: IntakePayload) => {
    const result = await processIntake(payload, store);
    broadcast("dueflow:snapshot-updated", result.snapshot);
    showSchedule(true);
    return result;
  });
  ipcMain.handle("dueflow:companion-clicked", () => {
    const current = companionStateForItems(store.snapshot().items);
    const snapshot = store.setCompanion("clicked", current.bubble);
    broadcast("dueflow:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("dueflow:companion-hover", (_event, hovering: boolean) => {
    const current = companionStateForItems(store.snapshot().items);
    const snapshot = hovering
      ? store.setCompanion("hover_accept", "松手就能自动识别。")
      : store.setCompanion(current.state, current.bubble);
    broadcast("dueflow:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("dueflow:item-update", (_event, id: string, patch: ItemPatch) => {
    const snapshot = store.updateItem(id, patch);
    broadcast("dueflow:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("dueflow:item-delete", (_event, id: string) => {
    const snapshot = store.deleteItem(id);
    broadcast("dueflow:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("dueflow:preferences-update", (_event, patch: DueFlowPreferencesPatch) => {
    const snapshot = store.updatePreferences(patch);
    broadcast("dueflow:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("dueflow:quick-add", async (_event, text: string) => {
    const result = await processIntake({ kind: "text", text }, store);
    broadcast("dueflow:snapshot-updated", result.snapshot);
    return result;
  });
  ipcMain.handle("dueflow:open-control", () => showControlCenter());
  ipcMain.handle("dueflow:show-schedule", (_event, expanded: boolean) => showSchedule(expanded));
  ipcMain.handle("dueflow:open-storage", () => shell.showItemInFolder(store.filePath));
}

function refreshCompanionFromSchedule(): void {
  const next = companionStateForItems(store.snapshot().items);
  const snapshot = store.setCompanion(next.state, next.bubble);
  broadcast("dueflow:snapshot-updated", snapshot);
  setTimeout(refreshCompanionFromSchedule, 60_000);
}
