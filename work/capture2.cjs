// Settings-view capture (dev only).
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const shotsDir = path.join(__dirname, "shots");
fs.mkdirSync(shotsDir, { recursive: true });
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
    const r1 = await win.webContents.executeJavaScript(`(() => {
      const gear = document.querySelector('button[aria-label="打开设置"]');
      if (gear) gear.click();
      return JSON.stringify({ gear: !!gear });
    })()`);
    console.log("[cap2] gear:", r1);
    await wait(900);
    const r2 = await win.webContents.executeJavaScript(`JSON.stringify({
      settingsNav: !!document.querySelector('.settings-nav-col'),
      cards: document.querySelectorAll('.settings-card').length
    })`);
    console.log("[cap2] settings dom:", r2);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotsDir, "05-settings-view.png"), img.toPNG());
    console.log("[cap2] 05-settings-view.png done");
    app.exit(0);
  } catch (error) {
    console.error("[cap2] failed", error);
    app.exit(1);
  }
});
