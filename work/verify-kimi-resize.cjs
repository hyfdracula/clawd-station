// Verify: kimi TUI after window resize — startup fix + resize debounce (dev only).
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
  const measure = () =>
    evalIn(`(() => {
      const panes = [...document.querySelectorAll('.terminal-pane')];
      const visible = panes.find((p) => p.style.display !== 'none') || panes[panes.length - 1];
      const rowsEl = visible.querySelector('.xterm-rows');
      const rows = [...visible.querySelectorAll('.xterm-rows > div')].map((r) => r.textContent);
      const ctx = document.createElement('canvas').getContext('2d');
      const cs = getComputedStyle(rowsEl);
      ctx.font = cs.fontSize + ' ' + cs.fontFamily;
      const charW = ctx.measureText('─').width;
      const boxLine = rows.find((r) => r.includes('╭')) || '';
      return JSON.stringify({
        cols: Math.round(rowsEl.clientWidth / charW),
        boxLen: boxLine.trim().length,
        hasInput: rows.join('\\n').includes('❯')
      });
    })()`);

  await wait(1500);
  await evalIn(`document.querySelector('button[aria-label="新建对话"]')?.click()`);
  await wait(700);
  await evalIn(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    [...dialog.querySelectorAll('.engine-option')].find((el) => /kimi/i.test(el.textContent))?.click();
  })()`);
  await wait(300);
  await evalIn(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '创建' && !b.disabled)?.click();
  })()`);

  await wait(16000);
  console.log("[verify] before resize:", await measure());

  // Simulate the user's maximize-after-start scenario.
  win.setSize(1700, 1000);
  await wait(6000);
  console.log("[verify] after resize: ", await measure());

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, "kimi-after-resize.png"), img.toPNG());
  console.log("[verify] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[verify] failed", error);
    app.exit(1);
  });
});
