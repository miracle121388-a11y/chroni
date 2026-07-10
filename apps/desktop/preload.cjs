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
