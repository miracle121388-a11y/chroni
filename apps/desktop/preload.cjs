const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("dueFlow", {
  getSnapshot: () => ipcRenderer.invoke("dueflow:snapshot"),
  extract: (payload) => ipcRenderer.invoke("dueflow:extract", payload),
  intake: (payload) => ipcRenderer.invoke("dueflow:intake", payload),
  companionClicked: () => ipcRenderer.invoke("dueflow:companion-clicked"),
  companionHover: (hovering) => ipcRenderer.invoke("dueflow:companion-hover", hovering),
  updateItem: (id, patch) => ipcRenderer.invoke("dueflow:item-update", id, patch),
  deleteItem: (id) => ipcRenderer.invoke("dueflow:item-delete", id),
  updatePreferences: (patch) => ipcRenderer.invoke("dueflow:preferences-update", patch),
  quickAdd: (text) => ipcRenderer.invoke("dueflow:quick-add", text),
  openControlCenter: () => ipcRenderer.invoke("dueflow:open-control"),
  showSchedule: (expanded) => ipcRenderer.invoke("dueflow:show-schedule", expanded),
  openStorage: () => ipcRenderer.invoke("dueflow:open-storage"),
  dragWindow: (dx, dy) => ipcRenderer.send("dueflow:drag-window", dx, dy),
  filePath: (file) => webUtils.getPathForFile(file),
  onSnapshotUpdated: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("dueflow:snapshot-updated", listener);
    return () => ipcRenderer.removeListener("dueflow:snapshot-updated", listener);
  },
});
