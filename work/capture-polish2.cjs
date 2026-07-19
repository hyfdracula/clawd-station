// Verify polish round 2: bottom keys layout, collapsed order, sakura/meadow tweaks (dev only).
const path = require("path");
const fs = require("fs");

process.env.CLAWDS_MOCK_ALL = "1";
delete process.env.CLAUDE_TO_CODE_SMOKE;

require(path.join(__dirname, "../electron/main.cjs"));
const { app, BrowserWindow } = require("electron");

const outDir = path.join(__dirname, "shots-polish2");
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
    console.log(`[p2] ${name}.png`);
  };
  const setTheme = async (name) => {
    await evalIn(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
    await wait(400);
    await evalIn(`(() => {
      const items = [...document.querySelectorAll('.settings-nav-col button')];
      items.find((b) => b.textContent.includes('主题'))?.click();
    })()`);
    await wait(300);
    await evalIn(`(() => {
      const cards = [...document.querySelectorAll('.theme-card')];
      cards.find((c) => c.textContent.includes('${name}'))?.click();
    })()`);
    await wait(300);
    await evalIn(`document.querySelector('button[aria-label="关闭设置"]')?.click()`);
    await wait(600);
  };

  await wait(2000);
  await shot("01-expanded-keys");
  await evalIn(`document.querySelector('button[aria-label="折叠会话面板"]')?.click()`);
  await wait(800);
  await shot("02-collapsed-keys");
  await evalIn(`document.querySelector('button[aria-label="展开会话面板"]')?.click()`);
  await wait(600);

  await setTheme("樱语");
  await shot("03-sakura-radius");
  await setTheme("青野");
  await shot("04-meadow-ring");

  console.log("[p2] done");
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error("[p2] failed", error);
    app.exit(1);
  });
});
