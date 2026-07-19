// Force-open the output-dir notice for a visual check (dev only).
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-notice");
fs.mkdirSync(outDir, { recursive: true });
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
    await wait(1500);
    await win.webContents.executeJavaScript(`document.querySelector('.notice-overlay')?.classList.add('is-open')`);
    await wait(600);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, "notice.png"), img.toPNG());
    console.log("[notice] notice.png");
    app.exit(0);
  } catch (error) {
    console.error("[notice] failed", error);
    app.exit(1);
  }
});
