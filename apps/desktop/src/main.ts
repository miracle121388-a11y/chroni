import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, Notification, safeStorage, shell } from "electron";
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
import { formatOperationError, formatUserFacingMessage } from "./shared/errors.js";
import type { AgentMemoryPatch, AgentRunResult, AgentRunTrigger, BehaviorMemoryPatch, ClarificationAnswerPayload, ClarificationResult, ChroniLlmSettings, CompanionState, DailyTaskCreateInput, DailyTaskPatch, ExplicitPreferenceInput, ChroniPreferencesPatch, ChroniSnapshot, IntakePayload, IntakeResult, ItemPatch, TaskPlanUpdatePayload } from "./shared/types.js";
import { companionStateForItems, ChroniStore, type SecretCodec } from "./store.js";
import { applyPreferences, broadcast, createAppWindows, createTray, refreshScheduleAfterUpdate, requestPetAction, showControlCenter, showPetMenu, showSchedule, toggleScheduleSurface, type ControlCenterRoute } from "./windows.js";
import { validateAgentMemoryPatch, validateBehaviorMemoryPatch, validateBoolean, validateClarificationAnswer, validateDailyTaskCreate, validateDailyTaskPatch, validateExplicitPreference, validateIdentifier, validateIntakePayload, validateItemPatch, validateLlmSettings, validatePreferenceStatus, validatePreferencesPatch, validateSourceText, validateTaskPlanUpdate } from "./validation.js";

let store: ChroniStore;
let apiServer: ReturnType<typeof startChroniApiServer> | undefined;
let deadlineAgent: DeadlineAgent;
let agentTools: DeadlineAgentTools;
let agentScheduler: AgentScheduler;
let lastTaskFingerprint = "";
let companionBeforeFileHover: { state: CompanionState; bubble: string } | undefined;

app.setName("Chroni");
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) showControlCenter();
  });
  app.whenReady().then(() => {
    applyMacDevelopmentIcon();
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
    createTray({
      onCompanionVisibilityRequested: (visible) => {
        const snapshot = store.updatePreferences({ companionEnabled: visible });
        applyPreferences(snapshot.preferences);
        broadcast("chroni:snapshot-updated", snapshot);
      },
    });
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
    agentScheduler.startDailyChecks();
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
  ipcMain.handle("chroni:extract", async (_event, payload: IntakePayload) => {
    const validatedPayload = validateIntakePayload(payload);
    const previousCompanion = beginPetInput(validatedPayload, "正在预览并理解输入...");
    try {
      return await extractPayload(validatedPayload, { llm: store.llmSettings() });
    } finally {
      restoreCompanionAfterWork(previousCompanion);
    }
  });
  ipcMain.handle("chroni:intake", async (_event, payload: IntakePayload) => {
    const validatedPayload = validateIntakePayload(payload);
    const previousPendingIds = pendingClarificationIds();
    beginPetInput(validatedPayload, "正在识别 DDL...");
    try {
      const result = await processIntake(validatedPayload, store);
      broadcast("chroni:snapshot-updated", result.snapshot);
      revealScheduleAfterIntake(result, previousPendingIds);
      if (result.ok) scheduleAgentForTaskChange();
      return result;
    } catch (error) {
      publishUnexpectedPetFailure(error, "识别输入失败");
      throw error;
    }
  });
  ipcMain.handle("chroni:companion-clicked", () => {
    toggleScheduleSurface();
    return store.snapshot();
  });
  ipcMain.handle("chroni:companion-hover", (_event, hovering: boolean) => {
    hovering = validateBoolean(hovering, "hovering");
    const current = store.snapshot();
    if (hovering && current.companion.state !== "hover_accept") companionBeforeFileHover = { ...current.companion };
    const snapshot = hovering
      ? store.setCompanion("hover_accept", "松手后我会开始阅读。")
      : current.companion.state === "hover_accept" && companionBeforeFileHover
        ? store.setCompanion(companionBeforeFileHover.state, companionBeforeFileHover.bubble)
        : current;
    if (!hovering) companionBeforeFileHover = undefined;
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
  ipcMain.handle("chroni:daily-task-create", (_event, input: DailyTaskCreateInput) => publishStoreSnapshot(store.createDailyTask(validateDailyTaskCreate(input))));
  ipcMain.handle("chroni:daily-task-update", (_event, id: string, patch: DailyTaskPatch) => publishStoreSnapshot(store.updateDailyTask(validateIdentifier(id, "daily task id"), validateDailyTaskPatch(patch))));
  ipcMain.handle("chroni:daily-task-delete", (_event, id: string) => publishStoreSnapshot(store.deleteDailyTask(validateIdentifier(id, "daily task id"))));
  ipcMain.handle("chroni:preferences-update", (_event, patch: ChroniPreferencesPatch) => {
    const previousHotkey = store.snapshot().preferences.hotkey;
    let snapshot = store.updatePreferences(validatePreferencesPatch(patch));
    applyPreferences(snapshot.preferences);
    if (!registerHotkey() && snapshot.preferences.hotkey.trim()) {
      const failedHotkey = snapshot.preferences.hotkey;
      snapshot = store.updatePreferences({ hotkey: previousHotkey });
      const restored = registerHotkey();
      const recovery = !previousHotkey ? "已保持快捷键关闭" : restored ? "已保留原快捷键并继续生效" : "原快捷键当前也无法注册，请重新设置";
      snapshot = store.setCompanion("confused", `快捷键 ${failedHotkey} 注册失败，${recovery}。可能是组合键格式不正确或已被占用。`);
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
    if (!agentTools.exportIcs) throw new Error("日历导出功能当前不可用。");
    return agentTools.exportIcs();
  });
  ipcMain.handle("chroni:clarification-answer", async (_event, id: string, payload: ClarificationAnswerPayload) => {
    const result = store.answerClarification(validateIdentifier(id, "clarification id"), validateClarificationAnswer(payload));
    const complete = await completeClarificationPlanning(result);
    broadcast("chroni:snapshot-updated", complete.snapshot);
    return complete;
  });
  ipcMain.handle("chroni:clarification-dismiss", (_event, id: string) => publishStoreSnapshot(store.dismissClarification(validateIdentifier(id, "clarification id"))));
  ipcMain.handle("chroni:intake-draft-cancel", (_event, id: string) => publishStoreSnapshot(store.cancelIntakeDraft(validateIdentifier(id, "draft id"))));
  ipcMain.handle("chroni:task-plan-generate", async (_event, taskId: string, regenerate: boolean) => {
    taskId = validateIdentifier(taskId, "task id");
    const previousCompanion = beginPetWork("正在拆解任务计划...");
    try {
      await ensureTaskPlan(taskId, store, validateBoolean(regenerate, "regenerate"));
      const plan = store.taskPlanByTaskId(taskId);
      if (!plan) throw new Error("任务规划生成失败。");
      restoreCompanionAfterWork(previousCompanion);
      const snapshot = publishStoreSnapshot(store.snapshot());
      const source = plan.plannerSource === "llm" || plan.plannerSource === "personalized-llm" ? "大模型" : plan.plannerSource === "rules-fallback" ? "本地回退" : "本地规则";
      return { ok: true, plan, snapshot, message: `${source}规划草案已生成，确认后才会启用。` };
    } catch (error) {
      publishUnexpectedPetFailure(error, "任务规划失败");
      throw error;
    }
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
    const previousPendingIds = pendingClarificationIds();
    beginPetInput(payload, "正在识别 DDL...");
    try {
      const result = await processIntake(payload, store);
      broadcast("chroni:snapshot-updated", result.snapshot);
      revealScheduleAfterIntake(result, previousPendingIds);
      if (result.ok) scheduleAgentForTaskChange();
      return result;
    } catch (error) {
      publishUnexpectedPetFailure(error, "快速添加失败");
      throw error;
    }
  });
  ipcMain.handle("chroni:open-control", (_event, route?: unknown) => showControlCenter(controlCenterRoute(route)));
  ipcMain.handle("chroni:open-pet-menu", (event) => showPetMenu(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("chroni:show-schedule", (_event, expanded: boolean) => showSchedule(expanded));
  ipcMain.handle("chroni:source-reprocess", async (_event, sourceId: string) => {
    sourceId = validateIdentifier(sourceId, "source id");
    beginPetWork("正在重新识别来源...");
    try {
      const result = await reprocessSource(sourceId, store);
      broadcast("chroni:snapshot-updated", result.snapshot);
      refreshScheduleAfterUpdate();
      if (result.ok) scheduleAgentForTaskChange();
      return result;
    } catch (error) {
      publishUnexpectedPetFailure(error, "重新识别失败");
      throw error;
    }
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

function beginPetInput(payload: IntakePayload, bubble: string): { state: CompanionState; bubble: string } {
  const previous = { ...store.snapshot().companion };
  requestPetAction(payload.kind === "text" ? "eat" : "study", "replace");
  broadcast("chroni:snapshot-updated", store.setCompanion("processing", bubble));
  return previous;
}

function beginPetWork(bubble: string): { state: CompanionState; bubble: string } {
  const previous = { ...store.snapshot().companion };
  requestPetAction("idle", "replace");
  broadcast("chroni:snapshot-updated", store.setCompanion("processing", bubble));
  return previous;
}

function restoreCompanionAfterWork(previous?: { state: CompanionState; bubble: string }): ChroniSnapshot {
  const current = store.snapshot();
  if (current.companion.state !== "processing") return current;
  const restored = previous
    ? store.setCompanion(previous.state, previous.bubble)
    : refreshCompanionSnapshot();
  broadcast("chroni:snapshot-updated", restored);
  return restored;
}

function publishUnexpectedPetFailure(error: unknown, prefix: string): void {
  broadcast("chroni:snapshot-updated", store.setCompanion("confused", formatOperationError(error, `${prefix}，请稍后重试。`)));
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
      showTaskNotification({
        title: "Chroni Agent：高风险 DDL",
        body: `${task.title} · ${formatUserFacingMessage(task.reasons[0], "需要优先处理")}`,
      }, task.taskId);
      store.markItemReminded(task.taskId);
      requestPetAction("wake", "enqueue");
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
  if (trigger === "manual") {
    beginPetWork("Agent 正在巡检并安排任务...");
  } else {
    broadcast("chroni:snapshot-updated", store.setCompanion("processing", "正在进行自动日程巡检..."));
  }
  let result: AgentRunResult;
  try {
    result = await deadlineAgent.run(trigger);
  } catch (error) {
    publishUnexpectedPetFailure(error, "Agent 巡检失败");
    throw error;
  }
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
      if (!agentTools.exportIcs) throw new Error("日历导出功能当前不可用。");
      return agentTools.exportIcs();
    },
    answerClarification: async (id, payload) => {
      const result = store.answerClarification(id, payload);
      return completeClarificationPlanning(result);
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

async function completeClarificationPlanning(result: ClarificationResult): Promise<ClarificationResult> {
  if (!result.createdTaskId) return { ...result, snapshot: store.snapshot() };
  let message = result.message;
  try {
    await ensureTaskPlan(result.createdTaskId, store);
  } catch {
    message = `${message} 执行规划暂未生成，可稍后在任务详情中重试。`;
    store.setCompanion("success", message);
  }
  scheduleAgentForTaskChange();
  return { ...result, message, snapshot: store.snapshot() };
}

function refreshCompanionFromSchedule(): void {
  const current = store.snapshot();
  const protectedState = current.companion.state === "processing"
    || current.companion.state === "hover_accept"
    || current.companion.state === "needs_clarification"
    || (current.companion.state === "sleeping" && !current.preferences.companionEnabled);
  if (!protectedState) {
    const snapshot = refreshCompanionSnapshot();
    broadcast("chroni:snapshot-updated", snapshot);
  }
  setTimeout(refreshCompanionFromSchedule, 60_000);
}

function revealScheduleAfterIntake(result: IntakeResult, previousPendingIds: Set<string>): void {
  const needsConfirmation = result.snapshot.clarifications.some((item) => item.status === "pending" && !previousPendingIds.has(item.id))
    || (!result.ok && result.reason.startsWith("需要确认"));
  if (needsConfirmation) {
    showControlCenter({ tab: "schedule", focus: "clarifications" });
    return;
  }
  if (result.ok) {
    showSchedule(true);
    return;
  }
  refreshScheduleAfterUpdate();
}

function pendingClarificationIds(): Set<string> {
  return new Set(store.snapshot().clarifications.filter((item) => item.status === "pending").map((item) => item.id));
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
      showTaskNotification({
        title: isSnoozeWakeUp
          ? "Chroni：稍后提醒"
          : new Date(item.dueAt).getTime() < now ? "Chroni：DDL 已逾期" : "Chroni：DDL 临近",
        body: `${item.title} · ${timeUntil(item.dueAt)}`,
        silent: false,
      }, item.id);
      const next = store.markItemReminded(item.id);
      broadcast("chroni:snapshot-updated", next);
      requestPetAction("wake", "enqueue");
    }
  }
  setTimeout(refreshReminders, 60_000);
}

function showTaskNotification(options: Electron.NotificationConstructorOptions, taskId: string): void {
  const notification = new Notification(options);
  notification.on("click", () => showControlCenter({ tab: "schedule", taskId }));
  notification.show();
}

function controlCenterRoute(value: unknown): ControlCenterRoute | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const route: ControlCenterRoute = {};
  if (candidate.tab === "schedule" || candidate.tab === "daily" || candidate.tab === "agent" || candidate.tab === "preferences" || candidate.tab === "services") route.tab = candidate.tab;
  if (typeof candidate.taskId === "string" && candidate.taskId.trim()) route.taskId = candidate.taskId.trim().slice(0, 200);
  if (candidate.focus === "clarifications") route.focus = candidate.focus;
  return Object.keys(route).length ? route : undefined;
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

function applyMacDevelopmentIcon(): void {
  if (process.platform !== "darwin" || app.isPackaged) return;
  const icon = nativeImage.createFromPath(join(app.getAppPath(), "build", "icon.png"));
  if (!icon.isEmpty()) app.dock?.setIcon(icon);
}
