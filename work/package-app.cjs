const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const APP_NAME = "Clawd Station";
const BUNDLE_ID = "com.yomi.clawdstation";

const root = path.resolve(__dirname, "..");
const sourceApp = path.join(root, "node_modules/electron/dist/Electron.app");
const outputApp = path.join(root, "outputs", `${APP_NAME}.app`);
const resourcesDir = path.join(outputApp, "Contents/Resources");
const appDir = path.join(resourcesDir, "app");
const infoPlist = path.join(outputApp, "Contents/Info.plist");
const iconSource = path.join(root, "build", "icon.icns");

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.rmSync(outputApp, { recursive: true, force: true });
const ditto = childProcess.spawnSync("ditto", [sourceApp, outputApp], { encoding: "utf8" });
if (ditto.status !== 0) {
  throw new Error(ditto.stderr || "ditto failed to copy Electron.app");
}

fs.rmSync(path.join(resourcesDir, "default_app.asar"), { force: true });
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });

copyFile(path.join(root, "package.json"), path.join(appDir, "package.json"));
fs.cpSync(path.join(root, "electron"), path.join(appDir, "electron"), { recursive: true });
fs.cpSync(path.join(root, "dist"), path.join(appDir, "dist"), { recursive: true });

// Bundle the native node-pty module (already rebuilt for this Electron ABI) so the
// embedded terminal works in the packaged app.
const nodePtySrc = path.join(root, "node_modules", "node-pty");
if (fs.existsSync(nodePtySrc)) {
  fs.cpSync(nodePtySrc, path.join(appDir, "node_modules", "node-pty"), { recursive: true });
} else {
  console.warn("warning: node-pty not found; terminal will be disabled in the packaged app");
}

// Install the custom app icon and replace Electron's default.
if (fs.existsSync(iconSource)) {
  fs.copyFileSync(iconSource, path.join(resourcesDir, "icon.icns"));
  fs.rmSync(path.join(resourcesDir, "electron.icns"), { force: true });
}

const appPackage = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
appPackage.name = "clawd-station";
appPackage.productName = APP_NAME;
appPackage.main = "electron/main.cjs";
appPackage.scripts = {};
appPackage.dependencies = {};
appPackage.devDependencies = {};
fs.writeFileSync(path.join(appDir, "package.json"), `${JSON.stringify(appPackage, null, 2)}\n`);

const plistUpdates = [
  ["CFBundleName", APP_NAME],
  ["CFBundleDisplayName", APP_NAME],
  ["CFBundleIdentifier", BUNDLE_ID],
  ["CFBundleExecutable", "Electron"],
  ["CFBundleIconFile", "icon"],
  ["NSAppleEventsUsageDescription", "Clawd Station 需要读取 Finder 当前文件夹，以便在该目录打开终端会话。"]
];

for (const [key, value] of plistUpdates) {
  // Add the key if it does not exist yet, then set its value.
  childProcess.spawnSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, infoPlist], { stdio: "ignore" });
  childProcess.spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, infoPlist], { stdio: "ignore" });
}

// Declare that the app accepts folders, so clicking it in the Finder toolbar hands
// over the current folder (and the app can open a terminal there).
const docTypeCommands = [
  "Delete :CFBundleDocumentTypes",
  "Add :CFBundleDocumentTypes array",
  "Add :CFBundleDocumentTypes:0 dict",
  "Add :CFBundleDocumentTypes:0:CFBundleTypeName string Folder",
  "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer",
  "Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate",
  "Add :CFBundleDocumentTypes:0:LSItemContentTypes array",
  "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string public.folder"
];
for (const command of docTypeCommands) {
  childProcess.spawnSync("/usr/libexec/PlistBuddy", ["-c", command, infoPlist], { stdio: "ignore" });
}

console.log(outputApp);
