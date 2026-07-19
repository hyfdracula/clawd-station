// Measure kimi TUI box width vs actual xterm dimensions (dev only).
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

  await wait(20000);

  const report = await evalIn(`(() => {
    const panes = [...document.querySelectorAll('.terminal-pane')];
    const visible = panes.find((p) => p.style.display !== 'none') || panes[panes.length - 1];
    const rowsEl = visible.querySelector('.xterm-rows');
    const rows = [...visible.querySelectorAll('.xterm-rows > div')].map((r) => r.textContent);
    // measure single cell width using the xterm's own helper element if present
    const measureCanvas = document.createElement('canvas');
    const ctx = measureCanvas.getContext('2d');
    const cs = getComputedStyle(rowsEl);
    ctx.font = cs.fontSize + ' ' + cs.fontFamily;
    const charW = ctx.measureText('─').width;
    const boxLine = rows.find((r) => r.includes('╭')) || '';
    const full = rows.join('\\n');
    return JSON.stringify({
      rowsClientWidth: rowsEl.clientWidth,
      font: cs.fontSize + ' ' + cs.fontFamily.slice(0, 60),
      charWidth: charW,
      approxCols: Math.round(rowsEl.clientWidth / charW),
      boxDashCount: (boxLine.match(/─/g) || []).length,
      boxLineLen: boxLine.length,
      totalChars: full.length,
      hasWelcome: full.includes('Welcome'),
      hasInput: full.includes('❯') || full.includes('MCP'),
      text: full
    }, null, 2);
  })()`);
  fs.writeFileSync(path.join(outDir, "kimi-measure.json"), report);
  console.log(report.slice(0, 900));

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, "kimi-measure.png"), img.toPNG());
  console.log("[kimi-measure] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[kimi-measure] failed", error);
    app.exit(1);
  });
});
