import { app, BrowserWindow, globalShortcut, ipcMain, Notification, safeStorage, shell } from "electron";
import { startChroniApiServer } from "./api-server.js";
import { extractPayload, processIntake, reprocessSource } from "./intake.js";
import type { ChroniPreferencesPatch, IntakePayload, ItemPatch } from "./shared/types.js";
import { companionStateForItems, ChroniStore, type SecretCodec } from "./store.js";
import { applyPreferences, broadcast, createAppWindows, createTray, refreshScheduleAfterUpdate, showControlCenter, showPetMenu, showSchedule, toggleScheduleSurface } from "./windows.js";

let store: ChroniStore;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) showControlCenter();
  });
  app.whenReady().then(() => {
    app.setName("Chroni");
    if (process.platform === "win32") app.setAppUserModelId("app.chroni.desktop");
    store = new ChroniStore(app.getPath("userData"), createSecretCodec());
    installIpc();
    createAppWindows();
    createTray();
    applyPreferences(store.snapshot().preferences);
    registerHotkey();
    startChroniApiServer(store, (snapshot, reason) => {
      if (reason === "preferences") {
        applyPreferences(snapshot.preferences);
        registerHotkey();
      }
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
    broadcast("chroni:snapshot-updated", store.setCompanion("processing", "正在识别 DDL..."));
    const result = await processIntake(payload, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    revealScheduleAfterIntake(result.ok);
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
    let snapshot = store.updatePreferences(patch);
    applyPreferences(snapshot.preferences);
    if (!registerHotkey() && snapshot.preferences.hotkey.trim()) {
      snapshot = store.setCompanion("confused", `快捷键 ${snapshot.preferences.hotkey} 注册失败，可能已被占用。`);
    }
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:quick-add", async (_event, text: string) => {
    broadcast("chroni:snapshot-updated", store.setCompanion("processing", "正在识别 DDL..."));
    const result = await processIntake({ kind: "text", text }, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    revealScheduleAfterIntake(result.ok);
    return result;
  });
  ipcMain.handle("chroni:open-control", () => showControlCenter());
  ipcMain.handle("chroni:open-pet-menu", (event) => showPetMenu(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("chroni:show-schedule", (_event, expanded: boolean) => showSchedule(expanded));
  ipcMain.handle("chroni:source-reprocess", async (_event, sourceId: string) => {
    broadcast("chroni:snapshot-updated", store.setCompanion("processing", "正在重新识别来源..."));
    const result = await reprocessSource(sourceId, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    refreshScheduleAfterUpdate();
    return result;
  });
  ipcMain.handle("chroni:source-update-text", (_event, sourceId: string, text: string) => {
    const snapshot = store.updateSourceText(sourceId, text);
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:open-storage", () => shell.showItemInFolder(store.filePath));
}

function refreshCompanionFromSchedule(): void {
  const current = store.snapshot();
  if (current.companion.state !== "processing" && current.companion.state !== "hover_accept") {
    const snapshot = refreshCompanionSnapshot();
    broadcast("chroni:snapshot-updated", snapshot);
  }
  setTimeout(refreshCompanionFromSchedule, 60_000);
}

function revealScheduleAfterIntake(ok: boolean): void {
  if (ok) {
    showSchedule(true);
    return;
  }
  refreshScheduleAfterUpdate();
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

function registerHotkey(): boolean {
  globalShortcut.unregisterAll();
  const hotkey = store.snapshot().preferences.hotkey.trim();
  if (!hotkey) return true;
  try {
    const registered = globalShortcut.register(hotkey, () => toggleScheduleSurface());
    if (!registered) console.warn(`Unable to register Chroni hotkey: ${hotkey}`);
    return registered;
  } catch {
    console.warn(`Unable to register Chroni hotkey: ${hotkey}`);
    return false;
  }
}

function createSecretCodec(): SecretCodec | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  return {
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
  };
}
