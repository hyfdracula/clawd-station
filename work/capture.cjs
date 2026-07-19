// One-off visual capture harness (dev only, not shipped).
// Runs the real app (mock engines), drives the UI, and saves screenshots.
// Usage: npx electron work/capture.cjs
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;
delete process.env.CLAUDE_WORKBENCH_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));

const { app, BrowserWindow } = require("electron");

const shotsDir = path.join(__dirname, "shots");
fs.mkdirSync(shotsDir, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(win, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(shotsDir, `${name}.png`), image.toPNG());
  console.log(`[capture] ${name}.png`);
}

async function evalIn(win, js) {
  return win.webContents.executeJavaScript(js);
}

app.whenReady().then(async () => {
  try {
    // Wait for the main window to finish loading the renderer.
    let win;
    for (let i = 0; i < 60; i += 1) {
      win = BrowserWindow.getAllWindows()[0];
      if (win) {
        const ready = await evalIn(win, "document.readyState === 'complete' && !!document.querySelector('.app-shell')").catch(() => false);
        if (ready) break;
      }
      await wait(250);
    }
    win.webContents.on("console-message", (_e, level, message) => {
      if (level >= 2) console.log(`[renderer:${level}]`, message.slice(0, 300));
    });
    await wait(1200);
    await shot(win, "01-initial");

    // Open the new-conversation modal.
    const probe = await evalIn(win, `JSON.stringify({
      btn: !!document.querySelector('button[aria-label="新建对话"]'),
      dialogs: document.querySelectorAll('[role="dialog"]').length
    })`);
    console.log("[capture] probe before click:", probe);
    await evalIn(win, `document.querySelector('button[aria-label="新建对话"]')?.click()`);
    await wait(600);
    const probe2 = await evalIn(win, `JSON.stringify({ dialogs: document.querySelectorAll('[role="dialog"]').length })`);
    console.log("[capture] probe after click:", probe2);
    await shot(win, "02-new-modal");

    // Pick the claude engine card and confirm (same selectors as smoke test).
    await evalIn(win, `(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const claude = [...dialog.querySelectorAll('.engine-option')].find((el) => el.textContent.includes('Claude Code'));
      claude?.click();
    })()`);
    await wait(400);
    await evalIn(win, `(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '创建' && !b.disabled);
      confirm?.click();
    })()`);
    await wait(3500);
    await shot(win, "03-session-terminal");

    // Open settings.
    await evalIn(win, `document.querySelector('button[aria-label*="设置"]')?.click()`);
    await wait(700);
    await shot(win, "04-settings");

    console.log("[capture] done");
    app.exit(0);
  } catch (error) {
    console.error("[capture] failed", error);
    app.exit(1);
  }
});
