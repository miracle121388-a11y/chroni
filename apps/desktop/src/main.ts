import { app, BrowserWindow, globalShortcut, ipcMain, Notification, safeStorage, shell } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeadlineAgent } from "./agent/deadline-agent.js";
import { createLlmAgentPlanner } from "./agent/agent-planner.js";
import { reminderEligibility } from "./agent/agent-reminder.js";
import { AgentScheduler } from "./agent/agent-scheduler.js";
import { createAgentTools, type DeadlineAgentTools } from "./agent/agent-tools.js";
import { startChroniApiServer, type AgentApiOperations } from "./api-server.js";
import { ensureTaskPlan, extractPayload, processIntake, reprocessSource } from "./intake.js";
import { testLlmConnection } from "./llm-client.js";
import { resolveLlmSettings } from "./llm-settings.js";
import { shouldRemindItem } from "./shared/schedule.js";
import type { AgentMemoryPatch, AgentRunResult, AgentRunTrigger, BehaviorMemoryPatch, ClarificationAnswerPayload, ChroniLlmSettings, ExplicitPreferenceInput, ChroniPreferencesPatch, ChroniSnapshot, IntakePayload, ItemPatch, TaskPlanUpdatePayload } from "./shared/types.js";
import { companionStateForItems, ChroniStore, type SecretCodec } from "./store.js";
import { applyPreferences, broadcast, createAppWindows, createTray, refreshScheduleAfterUpdate, showControlCenter, showPetMenu, showSchedule, toggleScheduleSurface } from "./windows.js";
import { validateAgentMemoryPatch, validateBehaviorMemoryPatch, validateBoolean, validateClarificationAnswer, validateExplicitPreference, validateIdentifier, validateIntakePayload, validateItemPatch, validateLlmSettings, validatePreferenceStatus, validatePreferencesPatch, validateSourceText, validateTaskPlanUpdate } from "./validation.js";

let store: ChroniStore;
let apiServer: ReturnType<typeof startChroniApiServer> | undefined;
let deadlineAgent: DeadlineAgent;
let agentTools: DeadlineAgentTools;
let agentScheduler: AgentScheduler;
let lastTaskFingerprint = "";

app.setName("Chroni");
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) showControlCenter();
  });
  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("app.chroni.desktop");
    process.env.CHRONI_OCR_CACHE_PATH ||= join(app.getPath("userData"), "cache", "ocr");
    store = new ChroniStore(app.getPath("userData"), createSecretCodec());
    installDeadlineAgent();
    lastTaskFingerprint = taskFingerprint(store.snapshot());
    installIpc();
    createAppWindows({
      petPlacement: store.petPlacement(),
      onPetPlacementChanged: (placement) => store.updatePetPlacement(placement),
    });
    createTray();
    applyPreferences(store.snapshot().preferences);
    registerHotkey();
    apiServer = startChroniApiServer(store, (snapshot, reason) => {
      if (reason === "preferences") {
        applyPreferences(snapshot.preferences);
        registerHotkey();
      }
      const nextFingerprint = taskFingerprint(snapshot);
      if (reason === "data" && lastTaskFingerprint && nextFingerprint !== lastTaskFingerprint) agentScheduler.scheduleTaskChange();
      lastTaskFingerprint = nextFingerprint;
      broadcast("chroni:snapshot-updated", snapshot);
      refreshScheduleAfterUpdate();
    }, {
      discoveryFilePath: join(app.getPath("userData"), "chroni-api.json"),
      agent: agentApiOperations(),
    });
    refreshCompanionFromSchedule();
    refreshReminders();
    void agentScheduler.runStartupIfNeeded().catch((error) => console.error("Automatic Agent startup inspection failed.", error));
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
app.on("before-quit", () => {
  agentScheduler?.dispose();
  if (apiServer?.listening) apiServer.close();
});

function installIpc(): void {
  ipcMain.handle("chroni:snapshot", () => store.snapshot());
  ipcMain.handle("chroni:extract", async (_event, payload: IntakePayload) => extractPayload(validateIntakePayload(payload), { llm: store.llmSettings() }));
  ipcMain.handle("chroni:intake", async (_event, payload: IntakePayload) => {
    const validatedPayload = validateIntakePayload(payload);
    broadcast("chroni:snapshot-updated", store.setCompanion("processing", "正在识别 DDL..."));
    const result = await processIntake(validatedPayload, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    revealScheduleAfterIntake(result.ok);
    if (result.ok) scheduleAgentForTaskChange();
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
    hovering = validateBoolean(hovering, "hovering");
    const current = companionStateForItems(store.snapshot().items);
    const snapshot = hovering
      ? store.setCompanion("hover_accept", "松手就能自动识别。")
      : store.setCompanion(current.state, current.bubble);
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:item-update", (_event, id: string, patch: ItemPatch) => {
    const snapshot = store.updateItem(validateIdentifier(id, "item id"), validateItemPatch(patch));
    scheduleAgentForTaskChange();
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:item-delete", (_event, id: string) => {
    const snapshot = store.deleteItem(validateIdentifier(id, "item id"));
    scheduleAgentForTaskChange();
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:preferences-update", (_event, patch: ChroniPreferencesPatch) => {
    let snapshot = store.updatePreferences(validatePreferencesPatch(patch));
    applyPreferences(snapshot.preferences);
    if (!registerHotkey() && snapshot.preferences.hotkey.trim()) {
      snapshot = store.setCompanion("confused", `快捷键 ${snapshot.preferences.hotkey} 注册失败，可能已被占用。`);
    }
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:llm-test", (_event, settings: ChroniLlmSettings) => {
    const validated = validateLlmSettings(settings);
    const current = store.llmSettings();
    return testLlmConnection(resolveLlmSettings({ ...validated, apiKey: validated.apiKey || current.apiKey }));
  });
  ipcMain.handle("chroni:agent-run", async () => {
    await runDeadlineAgentAndPublish();
    return store.snapshot();
  });
  ipcMain.handle("chroni:agent-memory-update", (_event, patch: AgentMemoryPatch) => {
    const snapshot = store.updateAgentMemory(validateAgentMemoryPatch(patch, store.snapshot().agent.memory));
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:agent-export-ics", async () => {
    if (!agentTools.exportIcs) throw new Error("Agent ICS export is unavailable.");
    return agentTools.exportIcs();
  });
  ipcMain.handle("chroni:clarification-answer", async (_event, id: string, payload: ClarificationAnswerPayload) => {
    const result = store.answerClarification(validateIdentifier(id, "clarification id"), validateClarificationAnswer(payload));
    if (result.createdTaskId) await ensureTaskPlan(result.createdTaskId, store);
    const complete = { ...result, snapshot: store.snapshot() };
    broadcast("chroni:snapshot-updated", complete.snapshot);
    if (result.createdTaskId) scheduleAgentForTaskChange();
    return complete;
  });
  ipcMain.handle("chroni:clarification-dismiss", (_event, id: string) => publishStoreSnapshot(store.dismissClarification(validateIdentifier(id, "clarification id"))));
  ipcMain.handle("chroni:intake-draft-cancel", (_event, id: string) => publishStoreSnapshot(store.cancelIntakeDraft(validateIdentifier(id, "draft id"))));
  ipcMain.handle("chroni:task-plan-generate", async (_event, taskId: string, regenerate: boolean) => {
    taskId = validateIdentifier(taskId, "task id");
    await ensureTaskPlan(taskId, store, validateBoolean(regenerate, "regenerate"));
    const snapshot = publishStoreSnapshot(store.snapshot());
    return { ok: true, plan: store.taskPlanByTaskId(taskId), snapshot, message: "任务规划草案已生成。" };
  });
  ipcMain.handle("chroni:task-plan-activate", (_event, taskId: string, planId: string) => {
    const result = store.activateTaskPlan(validateIdentifier(taskId, "task id"), validateIdentifier(planId, "plan id"));
    publishStoreSnapshot(result.snapshot);
    scheduleAgentForTaskChange();
    return result;
  });
  ipcMain.handle("chroni:task-plan-update", (_event, taskId: string, payload: TaskPlanUpdatePayload) => {
    const result = store.updateTaskPlan(validateIdentifier(taskId, "task id"), validateTaskPlanUpdate(payload));
    publishStoreSnapshot(result.snapshot);
    scheduleAgentForTaskChange();
    return result;
  });
  ipcMain.handle("chroni:behavior-memory-update", (_event, patch: BehaviorMemoryPatch) => publishStoreSnapshot(store.updateBehaviorMemory(validateBehaviorMemoryPatch(patch))));
  ipcMain.handle("chroni:planning-preference-upsert", (_event, input: ExplicitPreferenceInput) => publishStoreSnapshot(store.upsertExplicitPlanningPreference(validateExplicitPreference(input))));
  ipcMain.handle("chroni:planning-preference-status", (_event, id: string, status: "active" | "disabled") => publishStoreSnapshot(store.setPlanningPreferenceStatus(validateIdentifier(id, "preference id"), validatePreferenceStatus(status))));
  ipcMain.handle("chroni:planning-preference-delete", (_event, id: string) => publishStoreSnapshot(store.deletePlanningPreference(validateIdentifier(id, "preference id"))));
  ipcMain.handle("chroni:behavior-memory-clear", () => publishStoreSnapshot(store.clearBehaviorMemory()));
  ipcMain.handle("chroni:quick-add", async (_event, text: string) => {
    const payload = validateIntakePayload({ kind: "text", text });
    broadcast("chroni:snapshot-updated", store.setCompanion("processing", "正在识别 DDL..."));
    const result = await processIntake(payload, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    revealScheduleAfterIntake(result.ok);
    if (result.ok) scheduleAgentForTaskChange();
    return result;
  });
  ipcMain.handle("chroni:open-control", () => showControlCenter());
  ipcMain.handle("chroni:open-pet-menu", (event) => showPetMenu(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("chroni:show-schedule", (_event, expanded: boolean) => showSchedule(expanded));
  ipcMain.handle("chroni:source-reprocess", async (_event, sourceId: string) => {
    sourceId = validateIdentifier(sourceId, "source id");
    broadcast("chroni:snapshot-updated", store.setCompanion("processing", "正在重新识别来源..."));
    const result = await reprocessSource(sourceId, store);
    broadcast("chroni:snapshot-updated", result.snapshot);
    refreshScheduleAfterUpdate();
    if (result.ok) scheduleAgentForTaskChange();
    return result;
  });
  ipcMain.handle("chroni:source-update-text", (_event, sourceId: string, text: string) => {
    const snapshot = store.updateSourceText(validateIdentifier(sourceId, "source id"), validateSourceText(text));
    broadcast("chroni:snapshot-updated", snapshot);
    return snapshot;
  });
  ipcMain.handle("chroni:open-storage", () => shell.showItemInFolder(store.filePath));
}

function publishStoreSnapshot(snapshot: ChroniSnapshot): ChroniSnapshot {
  broadcast("chroni:snapshot-updated", snapshot);
  refreshScheduleAfterUpdate();
  return snapshot;
}

function installDeadlineAgent(): void {
  agentTools = createAgentTools({
    readTasks: () => store.snapshot().items,
    readTaskPlans: () => store.snapshot().taskPlans,
    intakeText: (text) => processIntake({ kind: "text", text }, store),
    writeIcs: (content, fileName) => {
      const directory = join(app.getPath("userData"), "exports");
      mkdirSync(directory, { recursive: true });
      const path = join(directory, fileName);
      writeFileSync(path, content, "utf8");
      return path;
    },
    sendReminder: async (task) => {
      const preferences = store.snapshot().preferences;
      const item = store.snapshot().items.find((candidate) => candidate.id === task.taskId);
      const outcome = reminderEligibility({
        enabled: preferences.remindersEnabled,
        supported: Notification.isSupported(),
        inQuietHours: inQuietHours(preferences.quietHoursEnabled, preferences.quietHoursStart, preferences.quietHoursEnd),
        lastRemindedAt: item?.lastRemindedAt,
        now: new Date(),
      });
      if (!outcome.sent) return outcome;
      new Notification({
        title: "Chroni Agent：高风险 DDL",
        body: `${task.title} · ${task.reasons[0] ?? "需要优先处理"}`,
      }).show();
      store.markItemReminded(task.taskId);
      return outcome;
    },
    persistPlan: (plan) => { store.saveAppliedAgentPlan(plan); },
  });
  deadlineAgent = new DeadlineAgent({
    tools: agentTools,
    getMemory: () => store.snapshot().agent.memory,
    saveRun: (result) => { store.saveAgentRun(result); },
    planner: {
      propose: (context) => {
        const settings = resolveLlmSettings(store.llmSettings());
        if (!settings.enabled || !settings.apiKey || !settings.model) return Promise.resolve({ fallbackReason: "unavailable" });
        return createLlmAgentPlanner(settings).propose(context);
      },
    },
  });
  agentScheduler = new AgentScheduler({
    run: (trigger) => runDeadlineAgentAndPublish(trigger),
    getMemory: () => store.snapshot().agent.memory,
    getLatestRun: () => store.snapshot().agent.latestRun,
    getLastAutomaticRunAt: () => store.snapshot().agent.lastAutomaticRunAt,
  });
}

async function runDeadlineAgentAndPublish(trigger: AgentRunTrigger = "manual"): Promise<AgentRunResult> {
  const result = await deadlineAgent.run(trigger);
  const highRiskCount = result.priorities.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical").length;
  const bubble = highRiskCount
    ? `Agent 巡检完成：${highRiskCount} 个高风险 DDL。`
    : "Agent 巡检完成，今日安排正常。";
  const snapshot = store.setCompanion(highRiskCount ? "deadline_near" : "success", bubble);
  broadcast("chroni:snapshot-updated", snapshot);
  refreshScheduleAfterUpdate();
  return result;
}

function scheduleAgentForTaskChange(): void {
  lastTaskFingerprint = taskFingerprint(store.snapshot());
  agentScheduler.scheduleTaskChange();
}

function taskFingerprint(snapshot: ChroniSnapshot): string {
  const items = snapshot.items.map((item) => [item.id, item.title, item.dueAt, item.importance, item.completed, item.snoozedUntil ?? "", item.estimatedMinutes ?? "", item.progressPercent ?? ""].join("|")).sort();
  const plans = snapshot.taskPlans.filter((plan) => plan.status === "active").map((plan) => `${plan.taskId}|${plan.version}|${plan.steps.map((step) => `${step.id}:${step.estimatedMinutes}:${step.status}`).join(",")}`).sort();
  return [...items, ...plans].join("\n");
}

function agentApiOperations(): AgentApiOperations {
  return {
    run: runDeadlineAgentAndPublish,
    latest: () => store.snapshot().agent.latestRun,
    updateMemory: (patch) => {
      const snapshot = store.updateAgentMemory(patch);
      broadcast("chroni:snapshot-updated", snapshot);
      return snapshot;
    },
    exportIcs: async () => {
      if (!agentTools.exportIcs) throw new Error("Agent ICS export is unavailable.");
      return agentTools.exportIcs();
    },
    answerClarification: async (id, payload) => {
      const result = store.answerClarification(id, payload);
      if (result.createdTaskId) await ensureTaskPlan(result.createdTaskId, store);
      if (result.createdTaskId) scheduleAgentForTaskChange();
      return { ...result, snapshot: store.snapshot() };
    },
    dismissClarification: (id) => store.dismissClarification(id),
    cancelIntakeDraft: (id) => store.cancelIntakeDraft(id),
    generateTaskPlan: async (taskId, regenerate) => {
      await ensureTaskPlan(taskId, store, regenerate);
      const plan = store.taskPlanByTaskId(taskId);
      if (!plan) throw new Error("任务规划生成失败。");
      return { ok: true, plan, snapshot: store.snapshot(), message: regenerate ? "已生成新的规划草案，原计划未被覆盖。" : "任务规划草案已生成。" };
    },
    activateTaskPlan: (taskId, planId) => store.activateTaskPlan(taskId, planId),
    updateTaskPlan: (taskId, payload) => store.updateTaskPlan(taskId, payload),
    updateBehaviorMemory: (patch) => store.updateBehaviorMemory(patch),
    upsertPlanningPreference: (input) => store.upsertExplicitPlanningPreference(input),
    setPlanningPreferenceStatus: (id, status) => store.setPlanningPreferenceStatus(id, status),
    deletePlanningPreference: (id) => store.deletePlanningPreference(id),
    clearBehaviorMemory: () => store.clearBehaviorMemory(),
  };
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
    const item = snapshot.items.find((candidate) => shouldRemindItem(candidate));
    if (item && Notification.isSupported()) {
      const now = Date.now();
      const snoozedUntil = item.snoozedUntil ? new Date(item.snoozedUntil).getTime() : Number.NaN;
      const lastRemindedAt = item.lastRemindedAt ? new Date(item.lastRemindedAt).getTime() : Number.NaN;
      const isSnoozeWakeUp = Number.isFinite(snoozedUntil)
        && snoozedUntil <= now
        && (!Number.isFinite(lastRemindedAt) || snoozedUntil > lastRemindedAt);
      new Notification({
        title: isSnoozeWakeUp
          ? "Chroni：稍后提醒"
          : new Date(item.dueAt).getTime() < now ? "Chroni：DDL 已逾期" : "Chroni：DDL 临近",
        body: `${item.title} · ${timeUntil(item.dueAt)}`,
        silent: false,
      }).show();
      const next = store.markItemReminded(item.id);
      broadcast("chroni:snapshot-updated", next);
    }
  }
  setTimeout(refreshReminders, 60_000);
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
  const remaining = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remaining)) return "截止时间无效";
  if (remaining < 0) return "已逾期";
  if (remaining < 3_600_000) return "剩余不到 1 小时";
  const hours = Math.ceil(remaining / 3_600_000);
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
