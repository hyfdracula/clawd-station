// Kimi TUI corruption repro — staged screenshots + screen text probes (dev only).
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-kimi");
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
  };
  const probe = async (tag) => {
    const text = await evalIn(`(() => {
      const panes = [...document.querySelectorAll('.terminal-pane')];
      const visible = panes.find((p) => p.style.display !== 'none') || panes[panes.length - 1];
      const rows = visible ? visible.querySelectorAll('.xterm-rows > div') : [];
      return [...rows].map((r) => r.textContent).join('\\n').slice(0, 500);
    })()`);
    console.log(`\n===== ${tag} =====\n${text}\n`);
  };

  await wait(1500);
  await evalIn(`document.querySelector('button[aria-label="新建对话"]')?.click()`);
  await wait(700);
  await evalIn(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const kimi = [...dialog.querySelectorAll('.engine-option')].find((el) => /kimi/i.test(el.textContent));
    kimi?.click();
  })()`);
  await wait(300);
  await evalIn(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '创建' && !b.disabled);
    confirm?.click();
  })()`);

  await wait(6000);
  await probe("t+6s");
  await shot("kimi-06s");
  await wait(9000);
  await probe("t+15s");
  await shot("kimi-15s");
  await wait(10000);
  await probe("t+25s");
  await shot("kimi-25s");

  console.log("[kimi-cap] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[kimi-cap] failed", error);
    app.exit(1);
  });
});
