// Round-3 live verification: real app (mock engines), real UI driving, real captures.
//  04 session list with two sessions — the newer one (Kimi) sits on top
//  01 settings theme page — 12 theme cards, no vertical scrolling
//  02 Rosé theme chat view
//  03 active session card hover state (chip faded, actions shown) — forced
//      via injected :hover-equivalent rules before capturePage
//  05 (bonus) mini busy indicator under the engine badge, if terminal
//      output arrives while we watch
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
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) console.log(`[renderer:${level}]`, message.slice(0, 300));
  });
  const evalIn = (js) => win.webContents.executeJavaScript(js);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    console.log(`[r3] ${name}.png`);
  };

  const createSession = async (engineName) => {
    await evalIn(`document.querySelector('button[aria-label="新建对话"]')?.click()`);
    await wait(700);
    await evalIn(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const opt = [...dialog.querySelectorAll('.engine-option')].find((el) => el.textContent.includes('${engineName}'));
      opt?.click();
    })()`);
    await wait(350);
    await evalIn(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '创建' && !b.disabled);
      confirm?.click();
    })()`);
    await wait(900);
  };

  await wait(1800);

  // --- Session A (Claude), then session B (Kimi) — B must land on top. ---
  await createSession("Claude Code");
  await createSession("Kimi");

  // Watch for the mini busy indicator while the fresh terminal prints.
  let busySeen = false;
  for (let i = 0; i < 20; i += 1) {
    const busy = await evalIn(`document.querySelectorAll('.session-engine-busy .loading-mark').length`);
    if (busy > 0) {
      busySeen = true;
      await shot("05-busy-indicator");
      break;
    }
    await wait(200);
  }
  console.log(`[r3] busy indicator seen: ${busySeen}`);

  const order = await evalIn(`JSON.stringify([...document.querySelectorAll('.session-item')].map((el) => ({
    title: el.querySelector('.session-title-row strong')?.textContent ?? '',
    engine: el.querySelector('.session-engine-col [aria-label]')?.getAttribute('aria-label') ?? '',
    active: el.classList.contains('is-active'),
    chip: el.querySelector('.session-sandbox-chip')?.textContent ?? null
  })))`);
  console.log(`[r3] session order: ${order}`);
  await wait(2500);
  await shot("04-session-list-top");

  // --- Settings theme page: 12 cards, no scrolling. ---
  await evalIn(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
  await wait(900);
  const fit = await evalIn(`(() => {
    const el = document.querySelector('.settings-content');
    return JSON.stringify({
      cards: document.querySelectorAll('.theme-card').length,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      fits: el.scrollHeight <= el.clientHeight + 1
    });
  })()`);
  console.log(`[r3] theme page fit: ${fit}`);
  await shot("01-settings-themes");

  // --- Switch to Rosé, back to chat. ---
  const roseClicked = await evalIn(`(() => {
    const card = [...document.querySelectorAll('.theme-card')].find((c) => c.textContent.includes('蔷薇'));
    card?.click();
    return !!card;
  })()`);
  console.log(`[r3] rose card clicked: ${roseClicked}`);
  await wait(300);
  await evalIn(`document.querySelector('.settings-close')?.click()`);
  await wait(1300); // let the 850ms theme cross-fade finish
  // Put the Claude session (mock output) in front for a livelier terminal.
  await evalIn(`(() => {
    const items = [...document.querySelectorAll('.session-item')];
    const claude = items.find((el) => el.querySelector('.session-engine-col [aria-label]')?.getAttribute('aria-label') === 'Claude Code');
    claude?.querySelector('.session-main')?.click();
  })()`);
  await wait(1200);
  await shot("02-rose-chat");

  // --- Forced hover state on the active card. ---
  await evalIn(`(() => {
    const st = document.createElement('style');
    st.id = 'forced-hover';
    st.textContent = [
      '.session-item.is-active { background: var(--hover); }',
      '.session-item.is-active .session-sandbox-chip { opacity: 0 !important; }',
      '.session-item.is-active .session-actions { opacity: 1 !important; transform: none !important; transition: none !important; }'
    ].join('\\n');
    document.head.appendChild(st);
  })()`);
  await wait(250);
  await shot("03-session-hover");

  console.log("[r3] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[r3] failed", error);
    app.exit(1);
  });
});
