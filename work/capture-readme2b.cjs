// Re-shoot workbench-main in the default console theme (dev only).
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-readme2");
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
    const evalIn = (js) => win.webContents.executeJavaScript(js);
    await wait(1200);
    await evalIn(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
    await wait(500);
    await evalIn(`(() => {
      const items = [...document.querySelectorAll('.settings-nav-col button')];
      items.find((b) => b.textContent.includes('主题'))?.click();
    })()`);
    await wait(300);
    await evalIn(`(() => {
      const cards = [...document.querySelectorAll('.theme-card')];
      cards.find((c) => c.textContent.includes('墨岩'))?.click();
    })()`);
    await wait(400);
    await evalIn(`document.querySelector('button[aria-label="关闭设置"]')?.click()`);
    await wait(900);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, "workbench-main.png"), img.toPNG());
    console.log("[readme2b] workbench-main.png (console)");
    app.exit(0);
  } catch (error) {
    console.error("[readme2b] failed", error);
    app.exit(1);
  }
});
