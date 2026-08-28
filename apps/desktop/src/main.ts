import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, Notification, safeStorage, shell } from "electron";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { DeadlineAgent } from "./agent/deadline-agent.js";
import { createLlmAgentPlanner } from "./agent/agent-planner.js";
import { reminderEligibility } from "./agent/agent-reminder.js";
import { AgentScheduler } from "./agent/agent-scheduler.js";
import { createAgentTools, type DeadlineAgentTools } from "./agent/agent-tools.js";
import { exportRedactedAgentEvidence } from "./agent/evidence-report.js";
import { startChroniApiServer, type AgentApiOperations } from "./api-server.js";
import { ensureTaskPlan, extractPayload, processIntake, reprocessSource } from "./intake.js";
import { clearSampleDataStore, createSampleDataStore, SAMPLE_DATA_NAMESPACE } from "./sample-data.js";
import { testLlmConnection } from "./llm-client.js";
import { isLlmReady, resolveLlmSettings } from "./llm-settings.js";
import { shouldRemindItem } from "./shared/schedule.js";
import { formatOperationError, formatUserFacingMessage } from "./shared/errors.js";
import { intakeProgressMessage, REPROCESS_PROGRESS_MESSAGE } from "./shared/intake-copy.js";
import type { AgentMemoryPatch, AgentRunResult, AgentRunTrigger, BehaviorMemoryPatch, ClarificationAnswerPayload, ClarificationResult, ChroniLlmSettings, CompanionState, DailyReviewInput, DailyTaskCreateInput, DailyTaskPatch, ExplicitPreferenceInput, ChroniPreferencesPatch, ChroniSnapshot, IntakePayload, IntakeResult, ItemPatch, LearningMissionEvidenceInput, SampleDataResult, SampleDataScenario, SampleDataStatus, TaskPlanUpdatePayload } from "./shared/types.js";
import { companionStateForItems, ChroniStore, type SecretCodec } from "./store.js";
import { ChroniUpdater } from "./updater.js";
import { applyPreferences, broadcast, createAppWindows, createTray, refreshScheduleAfterUpdate, requestPetAction, showControlCenter, showPetMenu, showSchedule, toggleScheduleSurface, type ControlCenterRoute } from "./windows.js";
import { validateAgentMemoryPatch, validateBehaviorMemoryPatch, validateBoolean, validateClarificationAnswer, validateDailyReviewInput, validateDailyTaskCreate, validateDailyTaskPatch, validateExplicitPreference, validateIdentifier, validateIntakePayload, validateItemPatch, validateLearningMissionCheckpointInput, validateLearningMissionFileInput, validateLearningMissionNoteInput, validateLlmSettings, validatePreferenceStatus, validatePreferencesPatch, validateSourceText, validateTaskPlanUpdate } from "./validation.js";

let store: ChroniStore;
let primaryStore: ChroniStore;
let storeSecretCodec: SecretCodec | undefined;
let activeSampleScenario: SampleDataScenario | undefined;
let apiServer: ReturnType<typeof startChroniApiServer> | undefined;
let deadlineAgent: DeadlineAgent;
let agentTools: DeadlineAgentTools;
let agentScheduler: AgentScheduler;
let applicationUpdater: ChroniUpdater;
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
    const userDataPath = app.getPath("userData");
    const firstLaunch = !existsSync(join(userDataPath, "chroni-state.json"));
    process.env.CHRONI_OCR_CACHE_PATH ||= join(userDataPath, "cache", "ocr");
    storeSecretCodec = createSecretCodec();
    primaryStore = new ChroniStore(userDataPath, storeSecretCodec);
    if (firstLaunch) primaryStore.updatePreferences({ llm: { enabled: true, mode: "managed" } });
    store = primaryStore;
    installDeadlineAgent();
    applicationUpdater = createApplicationUpdater();
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
      onCheckForUpdatesRequested: () => {
        showControlCenter({ tab: "services" });
        void applicationUpdater.check();
      },
    });
    applyPreferences(store.snapshot().preferences);
    registerHotkey();
    startLocalApiServer();
    applicationUpdater.start();
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
  applicationUpdater?.dispose();
  if (apiServer?.listening) apiServer.close();
});

function installIpc(): void {
  ipcMain.handle("chroni:snapshot", () => store.snapshot());
  ipcMain.handle("chroni:update-status", () => applicationUpdater.status());
  ipcMain.handle("chroni:update-check", () => applicationUpdater.check());
  ipcMain.handle("chroni:update-install", () => applicationUpdater.install());
  ipcMain.handle("chroni:open-releases", () => shell.openExternal("https://github.com/miracle121388-a11y/chroni/releases"));
  ipcMain.handle("chroni:extract", async (_event, payload: IntakePayload) => {
    const validatedPayload = validateIntakePayload(payload);
    const previousCompanion = beginPetInput(validatedPayload, intakeProgressMessage(validatedPayload, "preview"));
    try {
      return await extractPayload(validatedPayload, { llm: store.llmSettings() });
    } finally {
      restoreCompanionAfterWork(previousCompanion);
    }
  });
  ipcMain.handle("chroni:intake", async (_event, payload: IntakePayload) => {
    const validatedPayload = validateIntakePayload(payload);
    const previousPendingIds = pendingClarificationIds();
    beginPetInput(validatedPayload, intakeProgressMessage(validatedPayload));
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
  ipcMain.handle("chroni:daily-task-create", (_event, input: DailyTaskCreateInput) => {
    const previousFingerprint = taskFingerprint(store.snapshot());
    const snapshot = store.createDailyTask(validateDailyTaskCreate(input));
    if (taskFingerprint(snapshot) !== previousFingerprint) scheduleAgentForTaskChange();
    return publishStoreSnapshot(snapshot);
  });
  ipcMain.handle("chroni:daily-task-update", (_event, id: string, patch: DailyTaskPatch) => {
    const previousFingerprint = taskFingerprint(store.snapshot());
    const snapshot = store.updateDailyTask(validateIdentifier(id, "daily task id"), validateDailyTaskPatch(patch));
    if (taskFingerprint(snapshot) !== previousFingerprint) scheduleAgentForTaskChange();
    return publishStoreSnapshot(snapshot);
  });
  ipcMain.handle("chroni:daily-task-delete", (_event, id: string) => {
    const previousFingerprint = taskFingerprint(store.snapshot());
    const snapshot = store.deleteDailyTask(validateIdentifier(id, "daily task id"));
    if (taskFingerprint(snapshot) !== previousFingerprint) scheduleAgentForTaskChange();
    return publishStoreSnapshot(snapshot);
  });
  ipcMain.handle("chroni:daily-review-save", (_event, input: DailyReviewInput) => publishStoreSnapshot(store.saveDailyReview(validateDailyReviewInput(input))));
  ipcMain.handle("chroni:learning-mission-file", async (_event, missionId: string, rawInput: unknown) => {
    const input = validateLearningMissionFileInput(rawInput);
    const evidence = await localFileEvidence(input.path, input.linkedDeliverable);
    return publishStoreSnapshot(store.addLearningMissionEvidence(validateIdentifier(missionId, "learning mission id"), evidence));
  });
  ipcMain.handle("chroni:learning-mission-note", (_event, missionId: string, rawInput: unknown) => {
    const input = validateLearningMissionNoteInput(rawInput);
    return publishStoreSnapshot(store.addLearningMissionEvidence(validateIdentifier(missionId, "learning mission id"), { kind: "note", ...input }));
  });
  ipcMain.handle("chroni:learning-mission-checkpoint", (_event, missionId: string, rawInput: unknown) => {
    const input = validateLearningMissionCheckpointInput(rawInput);
    return publishStoreSnapshot(store.recordLearningMissionCheckpoint(validateIdentifier(missionId, "learning mission id"), input));
  });
  ipcMain.handle("chroni:learning-mission-evidence-remove", (_event, missionId: string, evidenceId: string) => publishStoreSnapshot(store.removeLearningMissionEvidence(
    validateIdentifier(missionId, "learning mission id"),
    validateIdentifier(evidenceId, "learning mission evidence id"),
  )));
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
  ipcMain.handle("chroni:agent-export-evidence", () => exportAgentEvidence());
  ipcMain.handle("chroni:sample-data-status", () => sampleDataStatus());
  ipcMain.handle("chroni:sample-data-load", async (_event, scenario: SampleDataScenario) => activateSampleData(validateSampleDataScenario(scenario)));
  ipcMain.handle("chroni:sample-data-reset", async () => activateSampleData(activeSampleScenario ?? "clear"));
  ipcMain.handle("chroni:sample-data-clear", async () => deactivateSampleData());
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
    beginPetInput(payload, intakeProgressMessage(payload));
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
    beginPetWork(REPROCESS_PROGRESS_MESSAGE);
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

async function localFileEvidence(filePath: string, linkedDeliverable?: string): Promise<LearningMissionEvidenceInput> {
  const maxEvidenceBytes = 512 * 1024 * 1024;
  const absolutePath = resolve(filePath);
  let metadata: ReturnType<typeof statSync>;
  try {
    metadata = statSync(absolutePath);
  } catch {
    throw new Error("无法读取所选产出文件，请确认文件仍然存在且具有读取权限。");
  }
  if (!metadata.isFile()) throw new Error("请选择一个可读取的本地文件作为产出证据。");
  if (metadata.size > maxEvidenceBytes) throw new Error("单个产出证据文件不能超过 512 MiB。");
  const sha256 = await new Promise<string>((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
  let verifiedMetadata: ReturnType<typeof statSync>;
  try {
    verifiedMetadata = statSync(absolutePath);
  } catch {
    throw new Error("文件在登记过程中被移动或删除，请重新选择。");
  }
  if (!verifiedMetadata.isFile() || verifiedMetadata.size !== metadata.size || verifiedMetadata.mtimeMs !== metadata.mtimeMs) {
    throw new Error("文件在登记过程中发生了变化，请等待文件保存完成后重试。");
  }
  return {
    kind: "file",
    title: basename(absolutePath).slice(0, 160),
    bytes: metadata.size,
    sha256,
    modifiedAt: metadata.mtime.toISOString(),
    ...(linkedDeliverable ? { linkedDeliverable } : {}),
  };
}

function startLocalApiServer(): void {
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
    version: app.getVersion(),
  });
}

async function stopLocalApiServer(): Promise<void> {
  if (!apiServer?.listening) {
    apiServer = undefined;
    return;
  }
  await new Promise<void>((resolve) => apiServer?.close(() => resolve()));
  apiServer = undefined;
}

async function switchActiveStore(nextStore: ChroniStore): Promise<void> {
  agentScheduler?.dispose();
  await stopLocalApiServer();
  store = nextStore;
  installDeadlineAgent();
  lastTaskFingerprint = taskFingerprint(store.snapshot());
  startLocalApiServer();
  applyPreferences(store.snapshot().preferences);
  registerHotkey();
  if (!activeSampleScenario) agentScheduler.startDailyChecks();
  broadcast("chroni:snapshot-updated", store.snapshot());
  refreshScheduleAfterUpdate();
}

async function activateSampleData(scenario: SampleDataScenario): Promise<SampleDataResult> {
  activeSampleScenario = scenario;
  const demoStore = createSampleDataStore(app.getPath("userData"), storeSecretCodec, scenario);
  await switchActiveStore(demoStore);
  if (scenario === "clear") {
    for (const item of store.snapshot().items) {
      await ensureTaskPlan(item.id, store, true, "rules-only");
      const plan = store.taskPlanByTaskId(item.id);
      if (plan) store.activateTaskPlan(item.id, plan.id);
      const mission = store.snapshot().learningMissions.find((candidate) => candidate.taskId === item.id);
      if (mission) {
        store.addLearningMissionEvidence(mission.id, {
          kind: "note",
          title: "演示检查记录：需求与提交物已对齐",
          note: "已依据课程通知核对 PDF 报告、SQL 文件、实验截图与课程平台提交要求。此记录属于隔离的合成演示数据。",
          linkedDeliverable: mission.deliverables[0],
        });
        store.recordLearningMissionCheckpoint(mission.id, {
          status: "on-track",
          summary: "已完成要求理解，准备进入关系模式设计。",
          actualMinutes: 25,
          reflection: "先锁定两个交付物的共同依赖，减少报告与 SQL 文件返工。",
        });
      }
    }
    await runDeadlineAgentAndPublish("manual");
  }
  const snapshot = store.snapshot();
  broadcast("chroni:snapshot-updated", snapshot);
  return {
    status: sampleDataStatus(),
    snapshot,
    message: scenario === "clear"
      ? "完整课程任务示例已进入提取、拆解、排期与执行状态。"
      : scenario === "clarification"
        ? "待补充示例已停在必要截止时间确认，其他可识别信息均已保留。"
        : "多来源示例已保留冲突证据，等待你选择可信截止时间。",
  };
}

async function deactivateSampleData(): Promise<SampleDataResult> {
  activeSampleScenario = undefined;
  await switchActiveStore(primaryStore);
  clearSampleDataStore(app.getPath("userData"));
  const snapshot = store.snapshot();
  return {
    status: sampleDataStatus(),
    snapshot,
    message: "演示数据已清除，已返回你的正式本地数据。",
  };
}

function sampleDataStatus(): SampleDataStatus {
  return {
    active: !!activeSampleScenario,
    scenario: activeSampleScenario,
    namespace: SAMPLE_DATA_NAMESPACE,
    synthetic: true,
    noKeyRequired: true,
  };
}

function validateSampleDataScenario(value: unknown): SampleDataScenario {
  if (value === "clear" || value === "clarification" || value === "conflict") return value;
  throw new Error("不支持的示例数据类型。");
}

function createApplicationUpdater(): ChroniUpdater {
  return new ChroniUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    managedByStore: Boolean(process.mas || process.windowsStore),
    onStatus: (status) => broadcast("chroni:update-status", status),
    onDownloaded: (status) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({
        title: "Chroni 更新已准备好",
        body: status.message,
      });
      notification.on("click", () => showControlCenter({ tab: "services" }));
      notification.show();
    },
  });
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
        title: "Chroni Agent：高风险学习任务",
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
        if (!isLlmReady(settings)) return Promise.resolve({ fallbackReason: "unavailable" });
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

function exportAgentEvidence() {
  return exportRedactedAgentEvidence(
    store.snapshot(),
    store.agentTraceHistory(),
    join(app.getPath("userData"), "exports"),
    {
      version: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      petAssetMode: builtPetAssetMode(),
      demoScenario: activeSampleScenario,
    },
  );
}

async function runDeadlineAgentAndPublish(trigger: AgentRunTrigger = "manual"): Promise<AgentRunResult> {
  if (trigger === "manual") {
    beginPetWork("正在检查任务并安排今天…");
  } else {
    broadcast("chroni:snapshot-updated", store.setCompanion("processing", "正在自动检查日程并更新安排…"));
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
    ? `Agent 巡检完成：${highRiskCount} 个高风险学习任务。`
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
    exportEvidence: () => exportAgentEvidence(),
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
          : new Date(item.dueAt).getTime() < now ? "Chroni：学习任务已逾期" : "Chroni：关键节点临近",
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
  if (candidate.tab === "missions" || candidate.tab === "schedule" || candidate.tab === "daily" || candidate.tab === "review" || candidate.tab === "agent" || candidate.tab === "preferences" || candidate.tab === "services") route.tab = candidate.tab;
  if (candidate.tab === "settings") route.tab = "preferences";
  if (candidate.tab === "demo" || candidate.tab === "about") route.tab = "services";
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

function createSecretCodec(): SecretCodec {
  return {
    encrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("System secret storage is unavailable.");
      return safeStorage.encryptString(value).toString("base64");
    },
    decrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("System secret storage is unavailable.");
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    },
  };
}

function applyMacDevelopmentIcon(): void {
  if (process.platform !== "darwin" || app.isPackaged) return;
  const icon = nativeImage.createFromPath(join(app.getAppPath(), "build", "icon.png"));
  if (!icon.isEmpty()) app.dock?.setIcon(icon);
}

function builtPetAssetMode(): "original" | "xiaotong" {
  try {
    const manifest = JSON.parse(readFileSync(join(app.getAppPath(), "dist", "build-manifest.json"), "utf8")) as { petAssetMode?: unknown };
    if (manifest.petAssetMode === "original" || manifest.petAssetMode === "xiaotong") return manifest.petAssetMode;
  } catch {
    // Development-only fallback for a partially built workspace.
  }
  return process.env.CHRONI_PET_ASSET_MODE === "original" ? "original" : "xiaotong";
}
