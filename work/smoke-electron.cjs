const { app, BrowserWindow } = require("electron");

const url = process.argv[2] || "http://127.0.0.1:5173/";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createWindow(width, height) {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      offscreen: true
    }
  });
  await win.loadURL(url);
  await new Promise((resolve) => setTimeout(resolve, 700));
  return win;
}

app.whenReady().then(async () => {
  try {
    const desktop = await createWindow(1240, 820);

    await desktop.webContents.executeJavaScript(`
      (async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const click = (selector) => document.querySelector(selector).click();
        const setValue = (element, value) => {
          const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value');
          descriptor.set.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
        };

        click('button[aria-label="新建对话"]');
        await wait(80);
        if (!document.body.textContent.includes('开始一个干净的 Claude Code 会话')) {
          throw new Error('empty state did not appear after creating a conversation');
        }

        const textarea = document.querySelector('#task-input');
        setValue(textarea, '请检查当前项目的入口文件');
        textarea.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          bubbles: true
        }));
        await wait(80);

        if (!document.body.textContent.includes('请检查当前项目的入口文件')) {
          throw new Error('sent message did not render');
        }

        const search = document.querySelector('.search-field input');
        setValue(search, '没有这个会话');
        await wait(80);
        if (!document.body.textContent.includes('没有匹配的本地会话')) {
          throw new Error('empty search state did not render');
        }
      })();
    `);

    const mobile = await createWindow(390, 780);
    const overflow = await mobile.webContents.executeJavaScript(`
      (() => ({
        viewport: document.documentElement.clientWidth,
        body: document.body.scrollWidth,
        doc: document.documentElement.scrollWidth
      }))();
    `);
    assert(overflow.body <= overflow.viewport && overflow.doc <= overflow.viewport, `mobile overflow: ${JSON.stringify(overflow)}`);

    await desktop.close();
    await mobile.close();
    await app.quit();
  } catch (error) {
    console.error(error);
    await app.quit();
    process.exitCode = 1;
  }
});
