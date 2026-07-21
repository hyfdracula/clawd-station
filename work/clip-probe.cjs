// Probe clipboard formats for the file list (dev only).
const { app, clipboard } = require("electron");

app.whenReady().then(() => {
  const formats = ["CF_HDROP", "FileNameW", "FileNameA", "FileGroupDescriptorW", "text/uri-list", "text/plain", "CF_UNICODETEXT", "CF_TEXT"];
  for (const format of formats) {
    try {
      const buffer = clipboard.readBuffer(format);
      console.log(`[probe] ${format}: ${buffer.length} bytes`, buffer.length > 0 && buffer.length < 400 ? buffer.toString("hex").slice(0, 120) : "");
    } catch (error) {
      console.log(`[probe] ${format}: ERROR ${error.message}`);
    }
  }
  try {
    console.log("[probe] clipboard.read('FileNameW'):", JSON.stringify(clipboard.read("FileNameW").slice(0, 200)));
  } catch (error) {
    console.log("[probe] read FileNameW ERROR", error.message);
  }
  app.exit(0);
});
