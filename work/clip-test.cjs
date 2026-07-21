// Verify clipboard:read-file-paths against a real Explorer-style file clipboard.
const path = require("path");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  try {
    let win;
    for (let i = 0; i < 60; i += 1) {
      win = BrowserWindow.getAllWindows()[0];
      if (win) {
        const ready = await win.webContents
          .executeJavaScript("document.readyState === 'complete' && !!document.querySelector('.app-shell')")
          .catch(() => false);
        if (ready) break;
      }
      await wait(250);
    }
    const result = await win.webContents.executeJavaScript("window.workbench.clipboardReadFilePaths()");
    console.log("[clip-test] result:", JSON.stringify(result));
    app.exit(0);
  } catch (error) {
    console.error("[clip-test] failed", error);
    app.exit(1);
  }
});
