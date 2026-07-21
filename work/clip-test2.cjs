const path = require("path");
const fs = require("fs");
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
    const result = await win.webContents.executeJavaScript("window.workbench.clipboardReadImage()");
    console.log("[clip-img] result:", JSON.stringify(result));
    if (result.ok && result.path) {
      const stat = fs.statSync(result.path);
      console.log("[clip-img] file exists:", result.path, stat.size, "bytes");
      const magic = fs.readFileSync(result.path).slice(0, 8).toString("hex");
      console.log("[clip-img] png magic ok:", magic === "89504e470d0a1a0a");
    }
    app.exit(0);
  } catch (error) {
    console.error("[clip-img] failed", error);
    app.exit(1);
  }
});
