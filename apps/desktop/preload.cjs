const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("chroni", {
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
  showSchedule: (expanded) => ipcRenderer.invoke("chroni:show-schedule", expanded),
  openStorage: () => ipcRenderer.invoke("chroni:open-storage"),
  dragWindow: (dx, dy) => ipcRenderer.send("chroni:drag-window", dx, dy),
  filePath: (file) => webUtils.getPathForFile(file),
  onSnapshotUpdated: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("chroni:snapshot-updated", listener);
    return () => ipcRenderer.removeListener("chroni:snapshot-updated", listener);
  },
});
