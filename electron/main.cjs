const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;

function sendUpdateStatus(payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send("update:status", payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "../assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;

  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    autoUpdater.checkForUpdates();
  }
}

app.whenReady().then(() => {
  createWindow();

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({
      state: "available",
      currentVersion: app.getVersion(),
      latestVersion: info.version
    });
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus({
      state: "none",
      currentVersion: app.getVersion()
    });
  });

  autoUpdater.on("download-progress", (p) => {
    sendUpdateStatus({
      state: "downloading",
      percent: Math.round(p.percent || 0)
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus({
      state: "ready",
      latestVersion: info.version
    });
  });

  autoUpdater.on("error", (err) => {
    sendUpdateStatus({
      state: "error",
      message: String(err?.message || err)
    });
  });

  // Re-check silently every 6 hours
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 6 * 60 * 60 * 1000);
});

// Renderer asks for info
ipcMain.handle("app:getVersion", () => app.getVersion());

// Renderer requests manual check
ipcMain.handle("update:check", async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e?.message || e) };
  }
});

// Renderer requests install now
ipcMain.handle("update:installNow", async () => {
  const res = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Install & Restart", "Later"],
    defaultId: 0,
    message: "Update ready to install",
    detail: "Attendance Tracker will restart to finish installing the update."
  });

  if (res.response === 0) {
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  }
  return { ok: false };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
