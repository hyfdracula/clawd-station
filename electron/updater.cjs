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
    // The CHECK is done once we know an update exists — the download is a
    // separate phase. Leaving the flag set here used to swallow every later
    // manual "检查更新" click.
    checkingForUpdates = false;
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
    checkingForUpdates = false;
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
      message: friendlyUpdateError(error)
    });
  });
}

// Raw electron-updater errors are Chromium net codes — meaningless to users.
// Map the common ones to plain-language explanations.
function friendlyUpdateError(error) {
  const raw = error ? error.message || error.toString() : "";
  if (!raw) return "检查更新失败，请稍后重试";
  if (/ERR_CERT|CERT_|certificate/i.test(raw)) {
    return "无法安全连接 GitHub（证书校验失败）。通常是当前网络拦截了加密连接，换个网络或稍后再试";
  }
  if (/ERR_CONNECTION|ERR_TIMED_OUT|ERR_INTERNET|ETIMEDOUT|ECONNRESET|socket hang up/i.test(raw)) {
    return "连不上 GitHub（网络超时或被重置）。稍后再试，或到 Releases 页面手动下载";
  }
  if (/404|not found/i.test(raw)) {
    return "还没有找到可用的更新包。可能是新版本尚未发布到 Releases";
  }
  if (/403|rate limit/i.test(raw)) {
    return "GitHub 访问频率超限，稍后再试";
  }
  if (/sha|checksum|signature|hash/i.test(raw)) {
    return "更新包校验失败，已中止更新。请稍后再试";
  }
  return `检查更新失败：${raw.slice(0, 120)}`;
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
    autoUpdater.checkForUpdates().catch(() => {
      // The "error" event usually precedes the rejection, but stall-reject
      // paths must not leave the flag stuck either.
      checkingForUpdates = false;
    });
  } catch {
    checkingForUpdates = false;
  }
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