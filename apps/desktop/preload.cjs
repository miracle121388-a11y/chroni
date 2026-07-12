const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("chroni", {
  platform: process.platform,
  getSnapshot: () => ipcRenderer.invoke("chroni:snapshot"),
  extract: (payload) => ipcRenderer.invoke("chroni:extract", payload),
  intake: (payload) => ipcRenderer.invoke("chroni:intake", payload),
  companionClicked: () => ipcRenderer.invoke("chroni:companion-clicked"),
  companionHover: (hovering) => ipcRenderer.invoke("chroni:companion-hover", hovering),
  updateItem: (id, patch) => ipcRenderer.invoke("chroni:item-update", id, patch),
  deleteItem: (id) => ipcRenderer.invoke("chroni:item-delete", id),
  updatePreferences: (patch) => ipcRenderer.invoke("chroni:preferences-update", patch),
  testLlmConnection: (settings) => ipcRenderer.invoke("chroni:llm-test", settings),
  runDeadlineAgent: () => ipcRenderer.invoke("chroni:agent-run"),
  updateAgentMemory: (patch) => ipcRenderer.invoke("chroni:agent-memory-update", patch),
  exportAgentIcs: () => ipcRenderer.invoke("chroni:agent-export-ics"),
  answerClarification: (id, payload) => ipcRenderer.invoke("chroni:clarification-answer", id, payload),
  dismissClarification: (id) => ipcRenderer.invoke("chroni:clarification-dismiss", id),
  cancelIntakeDraft: (id) => ipcRenderer.invoke("chroni:intake-draft-cancel", id),
  generateTaskPlan: (taskId, regenerate = false) => ipcRenderer.invoke("chroni:task-plan-generate", taskId, regenerate),
  activateTaskPlan: (taskId, planId) => ipcRenderer.invoke("chroni:task-plan-activate", taskId, planId),
  updateTaskPlan: (taskId, payload) => ipcRenderer.invoke("chroni:task-plan-update", taskId, payload),
  updateBehaviorMemory: (patch) => ipcRenderer.invoke("chroni:behavior-memory-update", patch),
  upsertPlanningPreference: (input) => ipcRenderer.invoke("chroni:planning-preference-upsert", input),
  setPlanningPreferenceStatus: (id, status) => ipcRenderer.invoke("chroni:planning-preference-status", id, status),
  deletePlanningPreference: (id) => ipcRenderer.invoke("chroni:planning-preference-delete", id),
  clearBehaviorMemory: () => ipcRenderer.invoke("chroni:behavior-memory-clear"),
  quickAdd: (text) => ipcRenderer.invoke("chroni:quick-add", text),
  openControlCenter: () => ipcRenderer.invoke("chroni:open-control"),
  openPetMenu: () => ipcRenderer.invoke("chroni:open-pet-menu"),
  showSchedule: (expanded) => ipcRenderer.invoke("chroni:show-schedule", expanded),
  reprocessSource: (sourceId) => ipcRenderer.invoke("chroni:source-reprocess", sourceId),
  updateSourceText: (sourceId, text) => ipcRenderer.invoke("chroni:source-update-text", sourceId, text),
  openStorage: () => ipcRenderer.invoke("chroni:open-storage"),
  startWindowDrag: (screenX, screenY) => ipcRenderer.sendSync("chroni:start-window-drag", screenX, screenY),
  moveWindowDrag: () => ipcRenderer.send("chroni:move-window-drag"),
  endWindowDrag: () => ipcRenderer.send("chroni:end-window-drag"),
  filePath: (file) => webUtils.getPathForFile(file),
  onSnapshotUpdated: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("chroni:snapshot-updated", listener);
    return () => ipcRenderer.removeListener("chroni:snapshot-updated", listener);
  },
});
