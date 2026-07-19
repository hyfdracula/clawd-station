// Round-4 live verification: real app (mock engine detection), real UI driving.
//  01 session list — every card shows its sandbox chip, no loading marks
//  02 behavior settings — 动效等级 radiogroup, --t-slow swaps live
//  03 new-conversation modal — output directory row
//  04 session about panel — output directory row (修改/清除)
// Plus: conversations:create outputDir passthrough, fresh-spawn directive
// injection into the terminal, and zero renderer console errors.
// Smoke-created conversations are deleted again at the end.
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;
delete process.env.CLAUDE_WORKBENCH_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-r4");
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const SMOKE_OUTPUT_DIR = "D:\\software\\clawd-station\\work";

async function waitForShell() {
  let win;
  for (let i = 0; i < 60; i += 1) {
    win = BrowserWindow.getAllWindows()[0];
    if (win) {
      const ready = await win.webContents
        .executeJavaScript("document.readyState === 'complete' && !!document.querySelector('.shell')")
        .catch(() => false);
      if (ready) return win;
    }
    await wait(250);
  }
  throw new Error("main window never appeared");
}

async function main() {
  const win = await waitForShell();
  const consoleErrors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) {
      consoleErrors.push(message);
      console.log("[renderer:error]", message.slice(0, 300));
    }
  });
  const evalIn = (js) => win.webContents.executeJavaScript(js);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    console.log(`[r4] ${name}.png`);
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

  // Snapshot pre-existing conversations; smoke-created ones get cleaned up.
  const beforeIds = JSON.parse(
    await evalIn(`window.workbench.listConversations().then((items) => JSON.stringify(items.map((i) => i.id)))`)
  );

  // --- Two sessions through the real UI (modal selectors must stay intact). ---
  await createSession("Claude Code");
  await createSession("Kimi");

  // (1) Every card renders its sandbox chip; no loading marks; xterm mounted.
  const listState = JSON.parse(
    await evalIn(`JSON.stringify({
      items: document.querySelectorAll('.session-item').length,
      chips: document.querySelectorAll('.session-item .session-sandbox-chip').length,
      loadingMarks: document.querySelectorAll('.loading-mark').length,
      busySlots: document.querySelectorAll('.session-engine-busy, .session-engine-col').length,
      xterm: document.querySelectorAll('.xterm').length
    })`)
  );
  console.log(`[r4] list state: ${JSON.stringify(listState)}`);
  assert(listState.items >= 2, "expected at least two session cards");
  assert(listState.chips === listState.items, "every session card must render a sandbox chip");
  assert(listState.loadingMarks === 0, "no .loading-mark may remain");
  assert(listState.busySlots === 0, "engine busy slot / column must be gone");
  assert(listState.xterm >= 1, "xterm terminal must be mounted");
  await wait(1500);
  await shot("01-session-list");

  // (2) Behavior settings — 动效等级 with three options, live --t-slow swap.
  await evalIn(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
  await wait(700);
  await evalIn(`[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.includes('行为'))?.click()`);
  await wait(500);
  const motionState = JSON.parse(
    await evalIn(`(() => {
      const group = document.querySelector('[role="radiogroup"][aria-label="动效等级"]');
      if (!group) return JSON.stringify({ found: false });
      return JSON.stringify({
        found: true,
        options: [...group.querySelectorAll('[role="radio"]')].map((el) => el.querySelector('strong')?.textContent.trim())
      });
    })()`)
  );
  console.log(`[r4] motion group: ${JSON.stringify(motionState)}`);
  assert(motionState.found, "动效等级 radiogroup missing");
  assert(JSON.stringify(motionState.options) === JSON.stringify(["敏捷", "标准", "沉稳"]), "动效等级 must be 敏捷/标准/沉稳");
  await shot("02-behavior-motion");

  await evalIn(`(() => {
    const group = document.querySelector('[role="radiogroup"][aria-label="动效等级"]');
    [...group.querySelectorAll('[role="radio"]')].find((el) => el.textContent.includes('沉稳'))?.click();
  })()`);
  await wait(300);
  const slowSteady = await evalIn(`getComputedStyle(document.documentElement).getPropertyValue('--t-slow').trim()`);
  await evalIn(`(() => {
    const group = document.querySelector('[role="radiogroup"][aria-label="动效等级"]');
    [...group.querySelectorAll('[role="radio"]')].find((el) => el.textContent.includes('标准'))?.click();
  })()`);
  await wait(300);
  const slowBalanced = await evalIn(`getComputedStyle(document.documentElement).getPropertyValue('--t-slow').trim()`);
  console.log(`[r4] --t-slow steady=${slowSteady} balanced=${slowBalanced}`);
  assert(slowSteady === "800ms", "沉稳 must set --t-slow: 800ms");
  assert(slowBalanced === "600ms", "标准 must set --t-slow: 600ms");
  await evalIn(`document.querySelector('.settings-close')?.click()`);
  await wait(700);

  // (3) New-conversation modal — output directory row with 跟随工作目录 default.
  await evalIn(`document.querySelector('button[aria-label="新建对话"]')?.click()`);
  await wait(800);
  const modalState = JSON.parse(
    await evalIn(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return JSON.stringify({
        open: !!dialog,
        hasOutputRow: !!dialog && dialog.textContent.includes('输出目录（可选）'),
        followsCwd: !!dialog && dialog.textContent.includes('跟随工作目录')
      });
    })()`)
  );
  console.log(`[r4] modal: ${JSON.stringify(modalState)}`);
  assert(modalState.open && modalState.hasOutputRow && modalState.followsCwd, "modal must show the output directory row");
  await shot("03-new-modal-outputdir");
  await evalIn(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消')?.click();
  })()`);
  await wait(500);

  // (4) outputDir passthrough via conversations:create, then reload so the
  // IPC-created session shows up in the UI (create has no changed-broadcast).
  const created = JSON.parse(
    await evalIn(`window.workbench.createConversation(${JSON.stringify({ engine: "kimi", outputDir: SMOKE_OUTPUT_DIR })}).then((items) => JSON.stringify(items[0]))`)
  );
  console.log(`[r4] created: ${created.id} outputDir=${created.outputDir}`);
  assert(created.outputDir === SMOKE_OUTPUT_DIR, "conversations:create must pass outputDir through");

  await win.webContents.reload();
  await waitForShell();
  await wait(1500);

  // The new session sits on top → active → fresh terminal spawn → directive
  // should be typed in ~3.5s after terminalStart.
  let injected = false;
  for (let i = 0; i < 40; i += 1) {
    const text = await evalIn(`document.querySelector('.xterm')?.textContent || ''`);
    if (text.includes("输出目录是")) {
      injected = true;
      break;
    }
    await wait(500);
  }
  console.log(`[r4] directive injected into terminal: ${injected}`);
  assert(injected, "fresh spawn must receive the output-dir directive");
  await shot("04-terminal-directive");

  // About panel on the top card: output directory row with 修改 + 清除.
  await evalIn(`document.querySelector('.session-item button[aria-label="关于此会话"]')?.click()`);
  await wait(600);
  const aboutState = JSON.parse(
    await evalIn(`(() => {
      const panel = document.querySelector('.session-about.is-open');
      if (!panel) return JSON.stringify({ open: false });
      return JSON.stringify({
        open: true,
        hasOutputDir: panel.textContent.includes('输出目录'),
        showsPath: panel.textContent.includes('clawd-station'),
        hasEdit: [...panel.querySelectorAll('button')].some((b) => b.textContent.trim() === '修改'),
        hasClear: [...panel.querySelectorAll('button')].some((b) => b.textContent.trim() === '清除')
      });
    })()`)
  );
  console.log(`[r4] about panel: ${JSON.stringify(aboutState)}`);
  assert(aboutState.open && aboutState.hasOutputDir && aboutState.showsPath && aboutState.hasEdit && aboutState.hasClear,
    "about panel must show the output directory row with 修改/清除");
  await shot("05-about-outputdir");

  // Cleanup: delete only the conversations this run created (also kills the
  // live terminal before the CLI burns tokens on the injected directive).
  const afterIds = JSON.parse(
    await evalIn(`window.workbench.listConversations().then((items) => JSON.stringify(items.map((i) => i.id)))`)
  );
  const before = new Set(beforeIds);
  let cleaned = 0;
  for (const id of afterIds) {
    if (!before.has(id)) {
      await evalIn(`window.workbench.deleteConversation(${JSON.stringify(id)})`);
      cleaned += 1;
    }
  }
  console.log(`[r4] cleaned up ${cleaned} smoke sessions`);

  assert(consoleErrors.length === 0, `renderer console errors: ${consoleErrors.length}`);
  console.log("[r4] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[r4] failed", error);
    app.exit(1);
  });
});
