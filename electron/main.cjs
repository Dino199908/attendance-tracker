const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;

function isDev() {
  return !!process.env.VITE_DEV_SERVER_URL;
}

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send("update:status", payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "../assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;

  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return mainWindow;
}

function setupAutoUpdater() {
  // Only run updater in packaged builds
  if (isDev()) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({
      state: "available",
      currentVersion: app.getVersion(),
      latestVersion: info?.version
    });
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus({
      state: "none",
      currentVersion: app.getVersion(),
      message: "Up to date."
    });
  });

  autoUpdater.on("download-progress", (p) => {
    sendUpdateStatus({
      state: "downloading",
      percent: Math.round(p?.percent || 0)
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus({
      state: "ready",
      latestVersion: info?.version,
      message: "Ready to install."
    });
  });

  autoUpdater.on("error", (err) => {
    sendUpdateStatus({
      state: "error",
      message: String(err?.message || err)
    });
  });

  // Kick off a silent check AFTER listeners are attached
  autoUpdater.checkForUpdates().catch((e) => {
    sendUpdateStatus({ state: "error", message: String(e?.message || e) });
  });

  // Re-check silently every 6 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      setupAutoUpdater();
    }
  });
});

// Renderer asks for version
ipcMain.handle("app:getVersion", async () => app.getVersion());

// Renderer requests manual check
ipcMain.handle("update:check", async () => {
  try {
    if (isDev()) return { ok: false, message: "Updater disabled in dev." };

    const result = await autoUpdater.checkForUpdates();
    // electron-updater returns info here, but we still rely on events for UI
    return {
      ok: true,
      currentVersion: app.getVersion(),
      latestVersion: result?.updateInfo?.version
    };
  } catch (e) {
    return { ok: false, message: String(e?.message || e) };
  }
});

// Renderer requests install now
ipcMain.handle("update:installNow", async () => {
  try {
    if (isDev()) return { ok: false, message: "Updater disabled in dev." };

    const res = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Install & Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: "Update ready to install",
      detail: "Attendance Tracker will restart to finish installing the update."
    });

    if (res.response === 0) {
      autoUpdater.quitAndInstall(true, true);
      return { ok: true };
    }
    return { ok: false, message: "User chose Later." };
  } catch (e) {
    return { ok: false, message: String(e?.message || e) };
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
