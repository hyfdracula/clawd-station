// README screenshot capture — current final UI (dev only).
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-readme2");
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    console.log(`[readme2] ${name}.png`);
  };
  const openSettingsTo = async (section) => {
    await evalIn(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
    await wait(500);
    await evalIn(`(() => {
      const items = [...document.querySelectorAll('.settings-nav-col button')];
      items.find((b) => b.textContent.includes('${section}'))?.click();
    })()`);
    await wait(400);
  };
  const pickTheme = async (name) => {
    await evalIn(`(() => {
      const cards = [...document.querySelectorAll('.theme-card')];
      cards.find((c) => c.textContent.includes('${name}'))?.click();
    })()`);
    await wait(400);
  };
  const closeSettings = async () => {
    await evalIn(`document.querySelector('button[aria-label="关闭设置"]')?.click()`);
    await wait(600);
  };

  // 1. Main chat view (default theme).
  await wait(3500);
  await shot("workbench-main");

  // 2. Theme picker grid.
  await openSettingsTo("主题");
  await wait(300);
  await shot("workbench-themes");

  // 3. Sakura chat view (show off a light theme).
  await pickTheme("樱语");
  await closeSettings();
  await wait(400);
  await shot("workbench-sakura");

  // Back to default, then 4. new-session modal (with output dir row).
  await openSettingsTo("主题");
  await pickTheme("墨岩");
  await closeSettings();
  await evalIn(`document.querySelector('button[aria-label="新建对话"]')?.click()`);
  for (let i = 0; i < 20; i += 1) {
    const has = await evalIn(`!!document.querySelector('.modal-overlay.is-open')`);
    if (has) break;
    await wait(150);
  }
  await wait(500);
  await shot("workbench-new-session");

  console.log("[readme2] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[readme2] failed", error);
    app.exit(1);
  });
});
