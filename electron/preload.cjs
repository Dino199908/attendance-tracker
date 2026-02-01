const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("attendanceUpdater", {
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  check: () => ipcRenderer.invoke("update:check"),
  installNow: () => ipcRenderer.invoke("update:installNow"),
  onStatus: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  }
});
