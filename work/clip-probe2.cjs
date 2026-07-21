const { app, clipboard } = require("electron");
app.whenReady().then(() => {
  const png = clipboard.readBuffer("image/png");
  console.log("[probe2] readBuffer image/png:", png.length, "bytes");
  const img = clipboard.readImage();
  console.log("[probe2] readImage empty:", img.isEmpty(), "size:", JSON.stringify(img.getSize()));
  app.exit(0);
});
