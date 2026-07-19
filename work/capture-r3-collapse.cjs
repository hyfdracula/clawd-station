// Round-3 extra: verify the brand name stays pinned in place while the
// collapsing sidebar card edge covers it (no fade, no jump).
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;
delete process.env.CLAUDE_WORKBENCH_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-r3");
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RECT_JS = `(() => {
  const el = document.querySelector('.brand-name');
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width),
    opacity: cs.opacity, visibility: cs.visibility, position: cs.position });
})()`;

async function main() {
  let win;
  for (let i = 0; i < 60; i += 1) {
    win = BrowserWindow.getAllWindows()[0];
    if (win) {
      const ready = await win.webContents
        .executeJavaScript("document.readyState === 'complete' && !!document.querySelector('.shell')")
        .catch(() => false);
      if (ready) break;
    }
    await wait(250);
  }
  if (!win) throw new Error("main window never appeared");
  const evalIn = (js) => win.webContents.executeJavaScript(js);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    console.log(`[r3x] ${name}.png`);
  };

  await wait(1800);
  const before = await evalIn(RECT_JS);
  console.log(`[r3x] brand before collapse: ${before}`);

  await evalIn(`document.querySelector('button[aria-label="折叠会话面板"]')?.click()`);
  await wait(200); // mid-flight (fast tier: --t-slow 360ms on console theme)
  const mid = await evalIn(RECT_JS);
  console.log(`[r3x] brand mid collapse:   ${mid}`);
  await shot("06-collapse-mid");

  await wait(900);
  const after = await evalIn(RECT_JS);
  console.log(`[r3x] brand collapsed:      ${after}`);
  await shot("07-collapsed");

  await evalIn(`document.querySelector('button[aria-label="展开会话面板"]')?.click()`);
  await wait(900);
  const expanded = await evalIn(RECT_JS);
  console.log(`[r3x] brand re-expanded:    ${expanded}`);
  await shot("08-expanded");

  console.log("[r3x] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[r3x] failed", error);
    app.exit(1);
  });
});
