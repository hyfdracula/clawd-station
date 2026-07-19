// README screenshot capture (dev only). Deterministic: probe before every shot.
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-readme");
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
    console.log(`[readme-cap] ${name}.png`);
  };

  // 1. Main workbench: let the terminal boot its CLI TUI for a lively shot.
  await wait(4500);
  await shot("workbench-main");

  // 2. New-conversation modal.
  await evalIn(`document.querySelector('button[aria-label="新建对话"]')?.click()`);
  for (let i = 0; i < 20; i += 1) {
    const has = await evalIn(`!!document.querySelector('[role="dialog"]')`);
    if (has) break;
    await wait(150);
  }
  await wait(500);
  await shot("workbench-new-session");

  // Close the modal via its 取消 button.
  await evalIn(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const cancel = dialog && [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消');
    cancel?.click();
  })()`);
  await wait(500);

  // 3. Settings: background section.
  await evalIn(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
  for (let i = 0; i < 20; i += 1) {
    const has = await evalIn(`!!document.querySelector('.settings-nav-col')`);
    if (has) break;
    await wait(150);
  }
  await wait(500);
  await shot("workbench-settings");

  // 4. Settings: loading-animation section.
  await evalIn(`(() => {
    const items = [...document.querySelectorAll('.settings-nav-col button')];
    const loading = items.find((b) => /loading/i.test(b.textContent));
    loading?.click();
  })()`);
  await wait(500);
  await shot("workbench-loading");

  console.log("[readme-cap] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[readme-cap] failed", error);
    app.exit(1);
  });
});
