const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const url = process.argv[2] || "http://127.0.0.1:5173/";
const out = process.argv[3] || "work/screenshot.png";
const width = Number(process.argv[4] || 1240);
const height = Number(process.argv[5] || 820);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      offscreen: true
    }
  });

  await win.loadURL(url);
  await new Promise((resolve) => setTimeout(resolve, 900));

  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  await app.quit();
});
