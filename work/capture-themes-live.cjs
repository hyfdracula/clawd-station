// Theme-switch live verification: drive the real settings UI (dev only).
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-theme-live");
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const THEME_NAMES = ["墨岩", "玄铁", "樱语", "霓光", "墨香", "青野", "深海", "暖阳", "紫霄", "银翼", "熔岩"];

async function main() {
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
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    console.log(`[live] ${name}.png`);
  };

  await wait(2000);

  for (const name of THEME_NAMES) {
    // open settings
    await evalIn(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
    await wait(500);
    // go to theme section (first nav item is 主题)
    await evalIn(`(() => {
      const items = [...document.querySelectorAll('.settings-nav-col button')];
      items.find((b) => b.textContent.includes('主题'))?.click();
    })()`);
    await wait(400);
    // click the theme card with this name
    const clicked = await evalIn(`(() => {
      const cards = [...document.querySelectorAll('.theme-card')];
      const card = cards.find((c) => c.textContent.includes('${name}'));
      if (card) card.click();
      return cards.length + ':' + !!card;
    })()`);
    await wait(500);
    // back to chat
    await evalIn(`document.querySelector('button[aria-label="关闭设置"]')?.click()`);
    await wait(600);
    console.log(`[live] theme ${name} -> ${clicked}`);
    await shot(`theme-${name}`);
  }

  console.log("[live] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[live] failed", error);
    app.exit(1);
  });
});
