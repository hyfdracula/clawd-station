// Polish-round live verification: real app, real UI driving, real captures.
//  1. chat view on the default console theme (pure terminal, window keys in
//     the sidebar footer)
//  2. mid-collapse frame (FLIP slide in flight)
//  3. collapsed sidebar (+ under the brand icon, vertical button stack)
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-polish");
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    console.log(`[polish] ${name}.png`);
  };

  await wait(2000);

  // Force the default console theme through the real settings UI.
  await evalIn(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
  await wait(600);
  await evalIn(`(() => {
    const items = [...document.querySelectorAll('.settings-nav-col button')];
    items.find((b) => b.textContent.includes('主题'))?.click();
  })()`);
  await wait(400);
  const themeClicked = await evalIn(`(() => {
    const cards = [...document.querySelectorAll('.theme-card')];
    const card = cards.find((c) => c.textContent.includes('墨岩'));
    if (card) card.click();
    return cards.length + ':' + !!card;
  })()`);
  console.log(`[polish] theme 墨岩 -> ${themeClicked}`);
  await wait(1200); // let the 850ms theme cross-fade finish
  // Back to chat (sidebar gear is the first "关闭设置" in DOM order).
  await evalIn(`document.querySelector('button[aria-label="关闭设置"]')?.click()`);
  await wait(600);

  // Make sure at least one session exists so the terminal is on screen.
  const hasSession = await evalIn(`!!document.querySelector('.session-item')`);
  if (!hasSession) {
    await evalIn(`document.querySelector('button[aria-label="新建对话"]')?.click()`);
    await wait(500);
    await evalIn(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      dialog?.querySelector('.engine-option')?.click();
    })()`);
    await wait(300);
    await evalIn(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const confirm = [...(dialog?.querySelectorAll('button') || [])].find(
        (b) => b.textContent.trim() === '创建' && !b.disabled
      );
      confirm?.click();
    })()`);
    await wait(800);
  }
  await evalIn(`(() => {
    for (let i = 0; i < 50; i += 1) {
      if (document.querySelector('.xterm')) return true;
    }
    return !!document.querySelector('.xterm');
  })()`);
  await wait(3500); // let the shell/CLI paint into the terminal
  await shot("01-chat-console");

  // Settings overlay covers only the stage; sidebar stays visible; the X in
  // the overlay's top-right backs out to chat.
  await evalIn(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
  await wait(700);
  await shot("04-settings-stage-only");
  await evalIn(`document.querySelector('.settings-close')?.click()`);
  await wait(500);

  // Inline "关于此会话" expansion on the session card.
  await evalIn(`document.querySelector('button[aria-label="关于此会话"]')?.click()`);
  await wait(600);
  await shot("05-session-about");
  await evalIn(`document.querySelector('button[aria-label="关于此会话"]')?.click()`);
  await wait(400);

  // Collapse: catch the FLIP slide mid-flight, then the settled strip.
  await evalIn(`document.querySelector('button[aria-label="折叠会话面板"]')?.click()`);
  await wait(130);
  await shot("02-collapse-mid");
  await wait(900);
  await shot("03-collapsed");

  console.log("[polish] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[polish] failed", error);
    app.exit(1);
  });
});
