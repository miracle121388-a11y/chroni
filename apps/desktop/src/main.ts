import { app, globalShortcut, ipcMain, Notification, shell } from "electron";
import { startChroniApiServer } from "./api-server.js";
import { extractPayload, processIntake, reprocessSource } from "./intake.js";
import type { ChroniPreferencesPatch, IntakePayload, ItemPatch } from "./shared/types.js";
import { companionStateForItems, ChroniStore } from "./store.js";
import { applyPreferences, broadcast, createAppWindows, createTray, refreshScheduleAfterUpdate, showControlCenter, showSchedule, toggleScheduleSurface } from "./windows.js";

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
    applyPreferences(store.snapshot().preferences);
    registerHotkey();
    startChroniApiServer(store, (snapshot) => {
      broadcast("chroni:snapshot-updated", snapshot);
      refreshScheduleAfterUpdate();
    });
    refreshCompanionFromSchedule();
    refreshReminders();
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
app.on("will-quit", () => globalShortcut.unregisterAll());

function installIpc(): void {
  ipcMain.handle("chroni:snapshot", () => store.snapshot());
  ipcMain.handle("chroni:extract", async (_event, payload: IntakePayload) => extractPayload(payload, { llm: store.snapshot().preferences.llm }));
  ipcMain.handle("chroni:intake", async (_event, payload: IntakePayload) => {
    const result = await processIntake(payload, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    refreshScheduleAfterUpdate();
    return result;
  });
  ipcMain.handle("chroni:companion-clicked", () => {
    const current = companionStateForItems(store.snapshot().items);
    const snapshot = store.setCompanion("clicked", current.bubble);
    broadcast("chroni:snapshot-updated", snapshot);
    toggleScheduleSurface();
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
    store.updateItem(id, patch);
    const snapshot = refreshCompanionSnapshot();
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:item-delete", (_event, id: string) => {
    store.deleteItem(id);
    const snapshot = refreshCompanionSnapshot();
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:preferences-update", (_event, patch: ChroniPreferencesPatch) => {
    const snapshot = store.updatePreferences(patch);
    applyPreferences(snapshot.preferences);
    registerHotkey();
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
  ipcMain.handle("chroni:source-reprocess", async (_event, sourceId: string) => {
    const result = await reprocessSource(sourceId, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    refreshScheduleAfterUpdate();
    return result;
  });
  ipcMain.handle("chroni:open-storage", () => shell.showItemInFolder(store.filePath));
}

function refreshCompanionFromSchedule(): void {
  const snapshot = refreshCompanionSnapshot();
  broadcast("chroni:snapshot-updated", snapshot);
  setTimeout(refreshCompanionFromSchedule, 60_000);
}

function refreshCompanionSnapshot() {
  const next = companionStateForItems(store.snapshot().items);
  return store.setCompanion(next.state, next.bubble);
}

function refreshReminders(): void {
  const snapshot = store.snapshot();
  if (snapshot.preferences.remindersEnabled && !inQuietHours(snapshot.preferences.quietHoursEnabled, snapshot.preferences.quietHoursStart, snapshot.preferences.quietHoursEnd)) {
    const item = snapshot.items.find((candidate) => shouldRemind(candidate));
    if (item && Notification.isSupported()) {
      new Notification({
        title: item.dueAt < new Date().toISOString() ? "Chroni：DDL 已逾期" : "Chroni：DDL 临近",
        body: `${item.title} · ${timeUntil(item.dueAt)}`,
        silent: false,
      }).show();
      const next = store.markItemReminded(item.id);
      broadcast("chroni:snapshot-updated", next);
    }
  }
  setTimeout(refreshReminders, 60_000);
}

function shouldRemind(item: { completed: boolean; dueAt: string; snoozedUntil?: string; lastRemindedAt?: string }): boolean {
  if (item.completed) return false;
  const now = Date.now();
  if (item.snoozedUntil && new Date(item.snoozedUntil).getTime() > now) return false;
  const due = new Date(item.dueAt).getTime();
  const hours = (due - now) / 3_600_000;
  if (hours > 24) return false;
  if (!item.lastRemindedAt) return true;
  return now - new Date(item.lastRemindedAt).getTime() > 6 * 3_600_000;
}

function inQuietHours(enabled: boolean, start: string, end: string): boolean {
  if (!enabled) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const startMinutes = minutesOfDay(start);
  const endMinutes = minutesOfDay(end);
  if (startMinutes === endMinutes) return false;
  return startMinutes < endMinutes
    ? current >= startMinutes && current < endMinutes
    : current >= startMinutes || current < endMinutes;
}

function minutesOfDay(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function timeUntil(value: string): string {
  const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3_600_000);
  if (hours < 0) return "已逾期";
  if (hours <= 24) return `剩余 ${hours} 小时`;
  return `剩余 ${Math.ceil(hours / 24)} 天`;
}

function registerHotkey(): void {
  globalShortcut.unregisterAll();
  const hotkey = store.snapshot().preferences.hotkey.trim();
  if (!hotkey) return;
  try {
    globalShortcut.register(hotkey, () => toggleScheduleSurface());
  } catch {
    console.warn(`Unable to register Chroni hotkey: ${hotkey}`);
  }
}
