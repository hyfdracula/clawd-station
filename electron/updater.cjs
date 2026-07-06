const { autoUpdater } = require("electron-updater");
const { BrowserWindow } = require("electron");

let checkingForUpdates = false;

// The update lifecycle runs in the background. Each transition sends an IPC
// event to the renderer so it can show toast / status. The flow:
//   1. checking-for-update
//   2. update-available (with version info)
//   3. download-progress (bytes / total)
//   4. update-downloaded  → user prompted to restart
//   5. update-not-available (if on latest)

function setupAutoUpdater(getMainWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.fullChangelog = true;

  autoUpdater.on("checking-for-update", () => {
    checkingForUpdates = true;
    sendToRendererSafe(getMainWindow, "updater:checking");
  });

  autoUpdater.on("update-available", (info) => {
    sendToRendererSafe(getMainWindow, "updater:available", {
      version: info.version,
      releaseDate: info.releaseDate
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendToRendererSafe(getMainWindow, "updater:progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendToRendererSafe(getMainWindow, "updater:downloaded", {
      version: info.version,
      releaseDate: info.releaseDate
    });
  });

  autoUpdater.on("update-not-available", () => {
    checkingForUpdates = false;
    sendToRendererSafe(getMainWindow, "updater:not-available");
  });

  autoUpdater.on("error", (error) => {
    checkingForUpdates = false;
    sendToRendererSafe(getMainWindow, "updater:error", {
      message: error ? (error.message || error.toString()) : "Unknown update error"
    });
  });
}

function sendToRendererSafe(getMainWindow, channel, payload) {
  try {
    const win = getMainWindow();
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, payload);
    }
  } catch {}
}

function checkForUpdatesSilently() {
  if (checkingForUpdates) return;
  try {
    autoUpdater.checkForUpdates().catch(() => {});
  } catch {}
}

function quitAndInstall() {
  autoUpdater.quitAndInstall(false, true);
}

function getCurrentVersion() {
  return autoUpdater.currentVersion ? autoUpdater.currentVersion.toString() : "";
}

module.exports = {
  setupAutoUpdater,
  checkForUpdatesSilently,
  quitAndInstall,
  getCurrentVersion
};