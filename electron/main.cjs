const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, Tray, nativeImage } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createTerminalAnsiPassthrough } = require("./terminal-ansi.cjs");
const engines = require("./engines.cjs");
const { ENGINES, getEngine } = engines;

let pty = null;
try {
  pty = require("node-pty");
} catch (error) {
  console.error("node-pty unavailable:", error && error.message);
}
const terminals = new Map();

// When the app icon is clicked in the Finder toolbar (or a folder is dropped on it),
// macOS sends the folder path via "open-file". Open a new session there.
let pendingOpenDirectories = [];
let rendererReady = false;

if (process.platform === "darwin") {
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    handleOpenPath(filePath);
  });
}

function handleOpenPath(filePath) {
  let directory = filePath;
  try {
    if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      directory = path.dirname(filePath);
    }
  } catch {}
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("open-directory", { directory });
    focusMainWindow();
  } else {
    pendingOpenDirectories.push(directory);
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Clicking an app in the Finder toolbar just activates it; macOS does NOT pass the
// current folder. So (like "Claude Code Now") we ask Finder for its front window's
// folder and open a session there.
let lastFinderDir = "";

function getFinderDirectory() {
  try {
    const script = [
      'tell application "Finder"',
      "  if (count of Finder windows) > 0 then",
      "    return POSIX path of (target of front Finder window as alias)",
      "  end if",
      "end tell",
      'return ""'
    ].join("\n");
    const result = require("child_process").spawnSync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: 3000
    });
    if (result.status === 0) return (result.stdout || "").trim();
  } catch {}
  return "";
}

function openFinderFolderSession() {
  if (process.platform !== "darwin") return;
  const dir = getFinderDirectory();
  if (!dir || dir === lastFinderDir) return;
  lastFinderDir = dir;
  handleOpenPath(dir);
}

const bundledIndexCandidates = app.isPackaged
  ? [
      path.join(process.resourcesPath, "app", "dist", "index.html"),
      path.join(process.resourcesPath, "app.asar", "dist", "index.html"),
      path.join(__dirname, "..", "dist", "index.html")
    ]
  : [];
const bundledIndex = bundledIndexCandidates.find((candidate) => fs.existsSync(candidate)) || "";
const hasBundledBuild = Boolean(bundledIndex);
const isDev = !hasBundledBuild && !app.isPackaged && process.env.NODE_ENV !== "production";

function resolveClaudeCommand() {
  if (process.env.CLAUDE_CODE_BIN) return process.env.CLAUDE_CODE_BIN;
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  return "claude";
}
const claudeExecutable = resolveClaudeCommand();

function resolveLoginShell() {
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: [] };
  }
  const shell = process.env.SHELL || "/bin/zsh";
  return { command: shell, args: ["-l"] };
}
const claudeCommandOverride = process.env.CLAUDE_CODE_BIN || process.env.CLAUDE_BIN || "";
const claudeCommandLabel = claudeCommandOverride || "claude (via login shell)";
const mockClaude = process.env.CLAUDE_TO_CODE_MOCK === "1" || process.env.CLAUDE_WORKBENCH_MOCK === "1";
const mockCodex = process.env.CLAWDS_MOCK_CODEX === "1";
const mockOpencode = process.env.CLAWDS_MOCK_OPENCODE === "1";
const mockAll = process.env.CLAWDS_MOCK_ALL === "1";
const smokeMode = process.env.CLAUDE_TO_CODE_SMOKE === "1" || process.env.CLAUDE_WORKBENCH_SMOKE === "1";


let mainWindow = null;
let storeDir = "";
let dataFile = "";
let attachmentRoot = "";
let sessionRoot = "";
let appearanceRoot = "";
let settingsFile = "";
let appTray = null;
let closeBehavior = "quit"; // "quit" | "tray"
let isQuitting = false;
let conversations = [];
const activeClaudeRuns = new Map();
const activeEngineRuns = new Map();

function createWindow() {
  const isMac = process.platform === "darwin";
  if (!isMac) Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    show: !smokeMode,
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    title: "Clawd Station",
    backgroundColor: isMac ? "#00000000" : "#0a0a0a",
    transparent: isMac,
    frame: isMac,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? { trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (smokeMode) {
    mainWindow.webContents.on("console-message", (_event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
      console.error(`[renderer:load-failed] ${code} ${description} ${url}`);
    });
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[renderer:gone] ${JSON.stringify(details)}`);
    });
  }

  mainWindow.webContents.on("context-menu", (_event, params) => {
    const template = [];
    const hasSelection = params.selectionText.trim().length > 0;

    if (params.isEditable) {
      template.push(
        { label: "剪切", role: "cut", enabled: params.editFlags.canCut },
        { label: "复制", role: "copy", enabled: params.editFlags.canCopy },
        { label: "粘贴", role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { label: "全选", role: "selectAll", enabled: params.editFlags.canSelectAll }
      );
    } else {
      template.push(
        { label: "复制", role: "copy", enabled: hasSelection },
        {
          label: "复制消息全文",
          click: () => {
            mainWindow.webContents.send("edit:copy-message-content", { x: params.x, y: params.y });
          }
        },
        { type: "separator" },
        {
          label: "选择本条消息",
          click: () => {
            mainWindow.webContents.send("edit:select-message-content", { x: params.x, y: params.y });
          }
        }
      );
    }

    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(bundledIndex || path.join(__dirname, "../dist/index.html"));
  }

  // Close-button behavior: either quit (default) or minimize to system tray.
  // In tray mode the window is hidden instead of destroyed; the user brings
  // it back via the tray icon or context menu. isQuitting is set by the
  // tray "彻底退出" item so we can tell the difference between an
  // explicit quit and a hide-to-tray.
  mainWindow.on("close", (event) => {
    if (closeBehavior === "tray" && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (process.platform !== "darwin") createTray();

  if (smokeMode) {
    mainWindow.webContents.once("did-finish-load", runSmokeCheck);
  }
}

async function runSmokeCheck() {
  try {
    await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitFor = async (selector) => {
          for (let index = 0; index < 40; index += 1) {
            const element = document.querySelector(selector);
            if (element) return element;
            await wait(100);
          }
          throw new Error(selector + ' not found; url=' + location.href + '; ready=' + document.readyState + '; body=' + document.body.textContent.slice(0, 240));
        };
        const setValue = (element, value) => {
          const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value');
          descriptor.set.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const assert = (condition, message) => {
          if (!condition) throw new Error(message);
        };

        await waitFor('button[aria-label="新建对话"]');
        document.querySelector('button[aria-label="新建对话"]').click();
        await wait(250);
        assert(document.body.textContent.includes('开始一个干净的 Claude Code 会话'), 'empty state missing');

        const textarea = await waitFor('#task-input');
        setValue(textarea, '用一句话确认你已经连接到 Claude Code。');
        const sendButton = await waitFor('.send-button');
        assert(!sendButton.disabled, 'send button disabled after typing');
        sendButton.click();
        await wait(1200);

        assert(document.body.textContent.includes('用一句话确认你已经连接到 Claude Code。'), 'user message missing');
        assert(document.body.textContent.includes('连接到本地 Claude Code 执行链路'), 'mock Claude response missing');
        assert(document.body.textContent.includes('Mock Claude 已启用'), 'mock indicator missing');
      })();
    `);
    await app.quit();
  } catch (error) {
    console.error(error);
    await app.quit();
    process.exitCode = 1;
  }
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

function defaultDirectory() {
  try {
    return app.getPath("home");
  } catch {
    return process.cwd();
  }
}

function resolveCwd(dir) {
  try {
    if (!dir || dir === "/") return defaultDirectory();
    let resolved = dir;
    if (resolved === "~") resolved = app.getPath("home");
    else if (resolved.startsWith("~/")) resolved = path.join(app.getPath("home"), resolved.slice(2));
    if (fs.existsSync(resolved)) return resolved;
    return defaultDirectory();
  } catch {
    return defaultDirectory();
  }
}

function ensureStorage() {
  storeDir = path.join(app.getPath("userData"), "local-records");
  attachmentRoot = path.join(storeDir, "attachments");
  sessionRoot = path.join(storeDir, "sessions");
  appearanceRoot = path.join(storeDir, "appearance");
  dataFile = path.join(storeDir, "conversations.json");
  settingsFile = path.join(storeDir, "settings.json");
  fs.mkdirSync(attachmentRoot, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  fs.mkdirSync(appearanceRoot, { recursive: true });
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const current = loadSettings();
  const next = { ...current, ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2));
  } catch (error) {
    console.error("saveSettings failed", error);
  }
  return next;
}

function getCloseBehavior() {
  const stored = loadSettings().closeBehavior;
  return stored === "tray" ? "tray" : "quit";
}

function loadAppSettings() {
  closeBehavior = getCloseBehavior();
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "显示 Clawd Station", click: () => focusMainWindow() },
    { type: "separator" },
    {
      label: "彻底退出",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  if (appTray) return;
  // Tray icon — prefer .ico (Windows honors alpha + small format) over PNG.
  // The .ico is a PNG-payload ICO generated from the wizard art.
  const iconCandidates = [
    path.join(__dirname, "..", "build", "tray.ico"),
    path.join(__dirname, "..", "build", "icon.iconset", "icon_32x32.png"),
    path.join(__dirname, "..", "build", "icon.iconset", "icon_16x16.png")
  ];
  const iconPath = iconCandidates.find((candidate) => fs.existsSync(candidate));
  let image = null;
  if (iconPath) {
    image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) image = null;
  }
  try {
    appTray = new Tray(image || nativeImage.createEmpty());
  } catch (error) {
    console.error("tray creation failed", error);
    return;
  }
  appTray.setToolTip("Clawd Station");
  appTray.setContextMenu(buildTrayMenu());
  appTray.on("click", () => focusMainWindow());
  appTray.on("double-click", () => focusMainWindow());
}

function refreshTrayMenu() {
  if (!appTray) return;
  appTray.setContextMenu(buildTrayMenu());
}

function defaultSandboxFor(engine) {
  if (engine === "codex") return "workspace-write";
  if (engine === "opencode") return "ask";
  return "default";
}

function readConversations() {
  try {
    conversations = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (!Array.isArray(conversations)) conversations = [];
    conversations = conversations.map((conversation) => {
      const engine = conversation.engine === "codex" || conversation.engine === "opencode"
        ? conversation.engine
        : "claude";
      return {
        ...conversation,
        engine,
        sandbox: conversation.sandbox || defaultSandboxFor(engine),
        title: conversation.title === "新的 Claude Code 会话" ? "新会话" : conversation.title,
        directory: conversation.directory === "/" ? defaultDirectory() : conversation.directory || defaultDirectory()
      };
    });
  } catch {
    conversations = [];
  }

  if (conversations.length === 0) {
    conversations = [
      {
        id: makeId("session"),
        claudeSessionId: crypto.randomUUID(),
        title: "新会话",
        updatedAt: "刚刚",
        directory: defaultDirectory(),
        status: "local",
        pinned: false,
        messages: [],
        attachments: [],
        engine: "claude",
        sandbox: "default"
      }
    ];
    writeConversations();
  }
}

function writeConversations() {
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(conversations, null, 2));
  for (const conversation of conversations) writeConversationFiles(conversation);
}

function conversationDir(id) {
  return path.join(sessionRoot, id);
}

function writeConversationFiles(conversation) {
  if (!conversation?.id) return;
  const targetDir = conversationDir(conversation.id);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "transcript.json"), JSON.stringify(conversation, null, 2));
}

function deleteConversationFiles(id) {
  fs.rmSync(path.join(attachmentRoot, id), { recursive: true, force: true });
  fs.rmSync(conversationDir(id), { recursive: true, force: true });
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function isIgnorableClaudeWarning(text) {
  return /Warning:\s*no stdin data received in 3s/i.test(stripAnsi(text));
}

function cleanRunnerOutput(text) {
  return stripAnsi(text)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !isIgnorableClaudeWarning(line))
    .join("\n")
    .trim();
}

function findConversation(id) {
  return conversations.find((conversation) => conversation.id === id);
}

function updateConversation(id, updater) {
  conversations = conversations.map((conversation) => (conversation.id === id ? updater(conversation) : conversation));
  writeConversations();
}

function safeCopyAttachment(conversationId, sourcePath) {
  const name = path.basename(sourcePath);
  const targetDir = path.join(attachmentRoot, conversationId);
  fs.mkdirSync(targetDir, { recursive: true });
  const uniqueName = `${Date.now()}-${name}`;
  const targetPath = path.join(targetDir, uniqueName);
  fs.copyFileSync(sourcePath, targetPath);
  const stat = fs.statSync(targetPath);
  return {
    id: makeId("att"),
    name,
    path: targetPath,
    size: stat.size
  };
}

function safeCopyAppearanceImage(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  if (!allowed.has(extension)) throw new Error("请选择 png、jpg、webp 或 gif 图片。");
  fs.mkdirSync(appearanceRoot, { recursive: true });
  const targetPath = path.join(appearanceRoot, `chat-background-${Date.now()}${extension}`);
  fs.copyFileSync(sourcePath, targetPath);
  return {
    path: targetPath,
    url: `file://${targetPath}`
  };
}

function safeCopyAppearanceVideo(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  const allowed = new Set([".mp4", ".webm", ".mov", ".m4v"]);
  if (!allowed.has(extension)) throw new Error("请选择 mp4、webm、mov 或 m4v 视频。");
  fs.mkdirSync(appearanceRoot, { recursive: true });
  const targetPath = path.join(appearanceRoot, `chat-background-video-${Date.now()}${extension}`);
  fs.copyFileSync(sourcePath, targetPath);
  return {
    path: targetPath,
    url: `file://${targetPath}`
  };
}

function normalizePrompt(prompt, attachments) {
  const lines = [prompt.trim()];
  if (attachments.length > 0) {
    lines.push("");
    lines.push("以下是本次任务的本地附件路径，请在需要时读取：");
    for (const file of attachments) lines.push(`- ${file.path}`);
  }
  return lines.filter(Boolean).join("\n");
}

function trimMiddle(text, maxLength) {
  if (text.length <= maxLength) return text;
  const head = Math.floor(maxLength * 0.42);
  const tail = maxLength - head;
  return `${text.slice(0, head)}\n...[中间内容已压缩，保留首尾上下文]...\n${text.slice(-tail)}`;
}

const MAX_CONTEXT_CHARACTERS = 2800000;

function buildClaudePrompt(conversation, currentPrompt) {
  const previousMessages = (conversation.messages || [])
    .filter((message) => message.body?.trim())
    .map((message) => {
      const role = message.role === "user" ? "用户" : "Claude Code";
      return `${role}：\n${message.body.trim()}`;
    });

  if (previousMessages.length === 0) return currentPrompt;

  const context = trimMiddle(previousMessages.join("\n\n---\n\n"), MAX_CONTEXT_CHARACTERS);
  return [
    "以下是这个桌面工作台里当前本地会话的完整上下文。请把它当作同一个连续对话来理解，但不要逐字复述。",
    "",
    context,
    "",
    "现在用户的新任务是：",
    currentPrompt
  ].join("\n");
}

function extractStreamText(line) {
  try {
    const event = JSON.parse(line);
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      return event.message.content
        .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
        .join("");
    }
    if (event.type === "content_block_delta" && typeof event.delta?.text === "string") return event.delta.text;
    if (event.type === "text" && typeof event.text === "string") return event.text;
    return "";
  } catch {
    return line;
  }
}

function parsePermissionPrompt(text) {
  const clean = cleanRunnerOutput(text).replace(/\r/g, "\n");
  if (!clean) return null;
  if (clean.trim().startsWith("{")) {
    try {
      JSON.parse(clean.trim());
      return null;
    } catch {
      // Keep checking non-JSON text that only happens to start with a brace.
    }
  }
  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const tail = lines.slice(-14).join("\n");
  const mentionsPermission = /(permission|permissions|approve|approval|allow|authorize|authorization|deny|reject|confirm|confirmation|proceed|continue|权限|授权|允许|批准|确认|继续|拒绝)/i.test(tail);
  const asksForChoice = /(\[y\/n\]|\(y\/n\)|yes\/no|\ballow\b|\bapprove\b|\bdeny\b|\breject\b|允许|批准|确认|拒绝|(^|\n)\s*(?:❯\s*)?[1-9][).、])/i.test(tail);
  if (!mentionsPermission || !asksForChoice) return null;

  const numbered = /(^|\n)\s*(?:❯\s*)?1[).、]/.test(tail) || /(^|\n)\s*2[).、]/.test(tail);
  return {
    prompt: tail.slice(-1200),
    inputMode: numbered ? "numbered" : "yes-no",
    fingerprint: tail.replace(/\s+/g, " ").slice(-300)
  };
}

function permissionChoices(inputMode) {
  if (inputMode === "numbered") {
    return [
      { action: "allow-once", label: "允许本次", input: "1\n" },
      { action: "allow-always", label: "始终允许", input: "2\n" },
      { action: "deny", label: "拒绝", input: "3\n" }
    ];
  }

  return [
    { action: "allow-once", label: "允许", input: "y\n" },
    { action: "deny", label: "拒绝", input: "n\n" }
  ];
}

function runMockClaude({ conversationId, prompt, attachments }) {
  const conversation = findConversation(conversationId);
  const messageId = makeId("msg");
  const wantsPermissionTest = /权限测试|permission test/i.test(prompt);
  const hadContext = Boolean(conversation?.messages?.length);
  updateConversation(conversationId, (conversation) => ({
    ...conversation,
    updatedAt: nowLabel(),
    status: "processing",
    attachments: [...conversation.attachments, ...attachments],
    messages: [
      ...conversation.messages,
      { id: makeId("msg"), role: "user", body: normalizePrompt(prompt, attachments), meta: `你 · ${nowLabel()}` },
      { id: messageId, role: "assistant", body: "", meta: "Claude Code · 处理中", output: "mock runner connected" }
    ]
  }));
  sendToRenderer("conversations:changed", conversations);

  if (wantsPermissionTest) {
    const runState = {
      child: {
        killed: false,
        stdin: {
          writable: true,
          write: (input) => {
            activeClaudeRuns.delete(conversationId);
            const answer = String(input || "").trim();
            const chunk = `已收到权限选择：${answer || "继续"}。我会继续执行任务。`;
            updateConversation(conversationId, (conversation) => ({
              ...conversation,
              status: "synced",
              messages: conversation.messages.map((message) =>
                message.id === messageId
                  ? { ...message, body: `${message.body}${chunk}`, meta: "Claude Code · 已整理", output: "mock permission accepted" }
                  : message
              )
            }));
            sendToRenderer("claude:chunk", { conversationId, messageId, chunk });
            sendToRenderer("claude:done", { conversationId, messageId, conversations });
          }
        }
      },
      messageId,
      awaitingPermission: true
    };
    activeClaudeRuns.set(conversationId, runState);
    sendToRenderer("claude:permission", {
      conversationId,
      messageId,
      prompt: "Mock Claude 想执行一个需要确认的操作。\n1. 允许本次\n2. 始终允许\n3. 拒绝",
      choices: permissionChoices("numbered")
    });
    return;
  }

  const chunks = [
    "我已经收到任务，并连接到本地 Claude Code 执行链路。",
    hadContext ? "\n\n我也会带上这个本地会话的最近上下文。" : "\n\n",
    "第一版会把输出整理成聊天记录，附件路径也会随任务传入。"
  ];
  chunks.forEach((chunk, index) => {
    setTimeout(() => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === messageId ? { ...message, body: `${message.body}${chunk}` } : message
        )
      }));
      sendToRenderer("claude:chunk", { conversationId, messageId, chunk });
      if (index === chunks.length - 1) {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          status: "synced",
          messages: conversation.messages.map((message) =>
            message.id === messageId ? { ...message, meta: "Claude Code · 已整理", output: "mock run complete" } : message
          )
        }));
        sendToRenderer("claude:done", { conversationId, messageId, conversations });
      }
    }, 120 + index * 120);
  });
}

// Mock Codex — emits the same JSONL event shape that the real CLI produces,
// then runs them through the real Codex parser. This both drives the UI and
// proves the parser handles a realistic event stream.
function runMockCodex({ conversationId, prompt, attachments }) {
  const conversation = findConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found");

  const messageId = makeId("msg");
  const startedAt = nowLabel();
  const fullPrompt = normalizePrompt(prompt, attachments);
  const mockThreadId = "mock-thread-" + crypto.randomUUID();

  updateConversation(conversationId, (current) => ({
    ...current,
    updatedAt: startedAt,
    status: "processing",
    attachments: [...current.attachments, ...attachments],
    messages: [
      ...current.messages,
      { id: makeId("msg"), role: "user", body: fullPrompt, meta: `你 · ${startedAt}` },
      { id: messageId, role: "assistant", body: "", meta: "Codex CLI · 处理中 (mock)" }
    ]
  }));
  sendToRenderer("conversations:changed", conversations);

  // Sequence of fake Codex JSONL events. Parsed by the real extractCodexText.
  const events = [
    JSON.stringify({ type: "thread.started", thread_id: mockThreadId }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "收到。" } }),
    JSON.stringify({ type: "item.completed", item: { id: "i2", type: "agent_message", text: "这是 mock 模式下的 Codex 假回复，" } }),
    JSON.stringify({ type: "item.completed", item: { id: "i3", type: "agent_message", text: "用来在没有 codex CLI 的机器上演示流式输出。" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 0, output_tokens: 0 } })
  ];

  const parseEvent = ENGINES.codex.parseEvent;
  let i = 0;

  const emit = () => {
    if (i >= events.length) {
      updateConversation(conversationId, (current) => ({
        ...current,
        status: "synced",
        updatedAt: nowLabel(),
        codexSessionId: mockThreadId,
        messages: current.messages.map((m) =>
          m.id === messageId ? { ...m, meta: "Codex CLI · 已整理 (mock)", output: "mock run complete" } : m
        )
      }));
      sendToRenderer("engine:done", { conversationId, messageId, code: 0, conversations });
      return;
    }
    const line = events[i++];
    const chunk = parseEvent(line);
    if (chunk && chunk.trim()) {
      updateConversation(conversationId, (current) => ({
        ...current,
        messages: current.messages.map((m) =>
          m.id === messageId ? { ...m, body: `${m.body}${chunk}` } : m
        )
      }));
      sendToRenderer("engine:chunk", { conversationId, messageId, chunk });
    }
    setTimeout(emit, 180 + Math.floor(Math.random() * 120));
  };
  setTimeout(emit, 80);
}

// Mock OpenCode — emits fake JSONL with a <think> block to exercise stripping.
function runMockOpencode({ conversationId, prompt, attachments }) {
  const conversation = findConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found");

  const messageId = makeId("msg");
  const startedAt = nowLabel();
  const fullPrompt = normalizePrompt(prompt, attachments);
  const mockSessionId = "mock-ses-" + crypto.randomUUID();

  updateConversation(conversationId, (current) => ({
    ...current,
    updatedAt: startedAt,
    status: "processing",
    attachments: [...current.attachments, ...attachments],
    messages: [
      ...current.messages,
      { id: makeId("msg"), role: "user", body: fullPrompt, meta: `你 · ${startedAt}` },
      { id: messageId, role: "assistant", body: "", meta: "OpenCode · 处理中 (mock)" }
    ]
  }));
  sendToRenderer("conversations:changed", conversations);

  const events = [
    JSON.stringify({ type: "step_start", sessionID: mockSessionId }),
    JSON.stringify({ type: "text", part: { type: "text", text: "Hi 神~ " } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "这是 mock 模式跑的 opencode 假回复，\n\n" } }),
    // <think> block intentionally present — parser must strip it
    JSON.stringify({ type: "text", part: { type: "text", text: "<think>让我想想怎么回比较有意思</think>你应该只看到这一句。" } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish", tokens: { total: 0, input: 0, output: 0 } } })
  ];

  const parseEvent = ENGINES.opencode.parseEvent;
  let i = 0;

  const emit = () => {
    if (i >= events.length) {
      updateConversation(conversationId, (current) => ({
        ...current,
        status: "synced",
        updatedAt: nowLabel(),
        opencodeSessionId: mockSessionId,
        messages: current.messages.map((m) =>
          m.id === messageId ? { ...m, meta: "OpenCode · 已整理 (mock)", output: "mock run complete" } : m
        )
      }));
      sendToRenderer("engine:done", { conversationId, messageId, code: 0, conversations });
      return;
    }
    const line = events[i++];
    const chunk = parseEvent(line);
    if (chunk && chunk.trim()) {
      updateConversation(conversationId, (current) => ({
        ...current,
        messages: current.messages.map((m) =>
          m.id === messageId ? { ...m, body: `${m.body}${chunk}` } : m
        )
      }));
      sendToRenderer("engine:chunk", { conversationId, messageId, chunk });
    }
    setTimeout(emit, 180 + Math.floor(Math.random() * 120));
  };
  setTimeout(emit, 80);
}

function runClaude({ conversationId, prompt, attachments }) {
  const conversation = findConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found");

  if (mockClaude) {
    runMockClaude({ conversationId, prompt, attachments });
    return;
  }

  const messageId = makeId("msg");
  const startedAt = nowLabel();
  const fullPrompt = normalizePrompt(prompt, attachments);
  const claudePrompt = buildClaudePrompt(conversation, fullPrompt);

  updateConversation(conversationId, (current) => ({
    ...current,
    updatedAt: startedAt,
    status: "processing",
    attachments: [...current.attachments, ...attachments],
    messages: [
      ...current.messages,
      { id: makeId("msg"), role: "user", body: fullPrompt, meta: `你 · ${startedAt}` },
      {
        id: messageId,
        role: "assistant",
        body: "",
        meta: "Claude Code · 处理中"
      }
    ]
  }));
  sendToRenderer("conversations:changed", conversations);

  const args = [
    "-p",
    claudePrompt,
    "--verbose",
    "--safe-mode",
    "--no-session-persistence",
    "--append-system-prompt",
    "你正在 Clawd Station 桌面壳中运行。请以 Claude Code/Claude 的身份回答，不要自称 Kiro，也不要引用 Kiro 开发环境的身份说明，除非用户明确询问 Kiro。输出给用户的正文不要使用 Markdown 标题井号 #，也不要使用星号 * 或 ** 做加粗/斜体；需要分段时直接写自然段，列表优先用数字编号或普通短横线。",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--permission-mode",
    "default",
  ];

  const child = spawn(
    claudeExecutable,
    args,
    {
      cwd: resolveCwd(conversation.directory),
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let lastPermissionFingerprint = "";

  const runState = { child, messageId, awaitingPermission: false };
  activeClaudeRuns.set(conversationId, runState);

  const maybeSendPermissionPrompt = (text) => {
    const permission = parsePermissionPrompt(text);
    if (!permission || permission.fingerprint === lastPermissionFingerprint) return;
    lastPermissionFingerprint = permission.fingerprint;
    runState.awaitingPermission = true;
    sendToRenderer("claude:permission", {
      conversationId,
      messageId,
      prompt: permission.prompt,
      choices: permissionChoices(permission.inputMode)
    });
  };

  child.stdout.on("data", (buffer) => {
    stdoutBuffer += buffer.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      if (isIgnorableClaudeWarning(line)) continue;
      const chunk = extractStreamText(line);
      if (!chunk.trim()) continue;
      updateConversation(conversationId, (current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === messageId ? { ...message, body: `${message.body}${chunk}` } : message
        )
      }));
      sendToRenderer("claude:chunk", { conversationId, messageId, chunk });
    }
  });

  child.stderr.on("data", (buffer) => {
    stderrBuffer += buffer.toString("utf8");
    const cleanStderr = cleanRunnerOutput(stderrBuffer);
    if (!cleanStderr) return;
    maybeSendPermissionPrompt(cleanStderr);
    updateConversation(conversationId, (current) => ({
      ...current,
      messages: current.messages.map((message) =>
        message.id === messageId ? { ...message, output: cleanStderr.slice(-4000) } : message
      )
    }));
    sendToRenderer("claude:stderr", { conversationId, messageId, stderr: cleanStderr.slice(-4000) });
  });

  child.on("error", (error) => {
    activeClaudeRuns.delete(conversationId);
    let finalMessage = null;
    updateConversation(conversationId, (current) => ({
      ...current,
      status: "local",
      messages: current.messages.map((message) => {
        if (message.id !== messageId) return message;
        finalMessage = {
          ...message,
          body: "没有成功启动 Claude Code。请确认 claude 命令可用。",
          meta: "Claude Code · 启动失败",
          output: error.message
        };
        return finalMessage;
      })
    }));
    sendToRenderer("claude:error", { conversationId, messageId, error: error.message, finalMessage });
  });

  child.on("close", (code) => {
    activeClaudeRuns.delete(conversationId);
    const cleanStderr = cleanRunnerOutput(stderrBuffer);
    const status = code === 0 ? "synced" : "local";
    let finalMessage = null;
    updateConversation(conversationId, (current) => ({
      ...current,
      status,
      updatedAt: nowLabel(),
      messages: current.messages.map((message) => {
        if (message.id !== messageId) return message;
        if (code === 0) {
          finalMessage = { ...message, meta: "Claude Code · 已整理", output: cleanStderr || message.output || "run complete" };
          return finalMessage;
        }
        finalMessage = {
          ...message,
          meta: "Claude Code · 执行失败",
          body: message.body || "Claude Code 没有返回可整理的文本。",
          output: cleanStderr || `claude exited with code ${code}`
        };
        return finalMessage;
      })
    }));
    sendToRenderer(code === 0 ? "claude:done" : "claude:error", {
      conversationId,
      messageId,
      code,
      finalMessage
    });
  });
}

// ---------------------------------------------------------------------------
// Engine dispatch (Codex / OpenCode)
// Claude keeps its existing runClaude pipeline (it owns interactive permission
// prompts + stream-json parsing). Codex/OpenCode go through a shared generic
// spawn helper that handles their --json / --format json event streams.
// ---------------------------------------------------------------------------

function spawnGenericChild({ engine, binary, args, cwd, conversationId, messageId }) {
  const child = spawn(binary, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let capturedSessionId = "";
  const parseEvent = engine.parseEvent;
  const extractSessionIdFromLine = engine.extractSessionIdFromLine;

  child.stdout.on("data", (buffer) => {
    stdoutBuffer += buffer.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      // Capture session ID from event stream (Codex thread.started, OpenCode sessionID)
      if (extractSessionIdFromLine && !capturedSessionId) {
        const sid = extractSessionIdFromLine(line);
        if (sid) {
          capturedSessionId = sid;
          updateConversation(conversationId, (current) => engine.saveSessionId(current, sid));
          sendToRenderer("engine:session-id", {
            conversationId,
            engine: engine.name,
            sessionId: sid
          });
        }
      }
      if (!parseEvent) continue;
      const chunk = parseEvent(line);
      if (!chunk || !chunk.trim()) continue;
      updateConversation(conversationId, (current) => ({
        ...current,
        messages: current.messages.map((m) =>
          m.id === messageId ? { ...m, body: `${m.body}${chunk}` } : m
        )
      }));
      sendToRenderer("engine:chunk", { conversationId, messageId, chunk });
    }
  });

  child.stderr.on("data", (buffer) => {
    stderrBuffer += buffer.toString("utf8");
    const cleanStderr = cleanRunnerOutput(stderrBuffer);
    if (!cleanStderr) return;
    updateConversation(conversationId, (current) => ({
      ...current,
      messages: current.messages.map((m) =>
        m.id === messageId ? { ...m, output: cleanStderr.slice(-4000) } : m
      )
    }));
    sendToRenderer("engine:stderr", { conversationId, messageId, stderr: cleanStderr.slice(-4000) });
  });

  child.on("error", (error) => {
    activeEngineRuns.delete(conversationId);
    let finalMessage = null;
    updateConversation(conversationId, (current) => ({
      ...current,
      status: "local",
      messages: current.messages.map((m) => {
        if (m.id !== messageId) return m;
        finalMessage = {
          ...m,
          body: `没有成功启动 ${engine.name}。请确认 ${binary} 命令可用。`,
          meta: `${engine.name} · 启动失败`,
          output: error.message
        };
        return finalMessage;
      })
    }));
    sendToRenderer("engine:error", { conversationId, messageId, error: error.message, finalMessage });
  });

  child.on("close", (code) => {
    activeEngineRuns.delete(conversationId);
    const cleanStderr = cleanRunnerOutput(stderrBuffer);
    const status = code === 0 ? "synced" : "local";
    let finalMessage = null;
    updateConversation(conversationId, (current) => ({
      ...current,
      status,
      updatedAt: nowLabel(),
      messages: current.messages.map((m) => {
        if (m.id !== messageId) return m;
        if (code === 0) {
          finalMessage = {
            ...m,
            meta: `${engine.name} · 已整理`,
            output: cleanStderr || m.output || "run complete"
          };
          return finalMessage;
        }
        finalMessage = {
          ...m,
          meta: `${engine.name} · 执行失败`,
          body: m.body || `${engine.name} 没有返回可整理的文本。`,
          output: cleanStderr || `${binary} exited with code ${code}`
        };
        return finalMessage;
      })
    }));
    sendToRenderer(code === 0 ? "engine:done" : "engine:error", {
      conversationId,
      messageId,
      code,
      finalMessage
    });
  });

  return child;
}

function runGenericEngine({ engine, conversationId, prompt, attachments }) {
  const conversation = findConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found");

  const messageId = makeId("msg");
  const startedAt = nowLabel();
  const fullPrompt = normalizePrompt(prompt, attachments);
  const cwd = resolveCwd(conversation.directory);
  const binary = engine.resolveBinary();
  const args = engine.buildArgs({
    prompt: fullPrompt,
    cwd,
    sandbox: conversation.sandbox || engine.defaultSandbox,
    sessionId: engine.getSessionId(conversation),
    attachments
  });

  updateConversation(conversationId, (current) => ({
    ...current,
    updatedAt: startedAt,
    status: "processing",
    attachments: [...current.attachments, ...attachments],
    messages: [
      ...current.messages,
      { id: makeId("msg"), role: "user", body: fullPrompt, meta: `你 · ${startedAt}` },
      { id: messageId, role: "assistant", body: "", meta: `${engine.name} · 处理中` }
    ]
  }));
  sendToRenderer("conversations:changed", conversations);

  const child = spawnGenericChild({ engine, binary, args, cwd, conversationId, messageId });
  activeEngineRuns.set(conversationId, { child, messageId, awaitingPermission: false, engine: engine.name });
}

function runEngine({ conversationId, prompt, attachments }) {
  const conversation = findConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  const engine = getEngine(conversation.engine || "claude");

  // Mock branch — run without spawning the real CLI. Useful for demos and CI.
  if (engine === ENGINES.claude && mockClaude) {
    return runMockClaude({ conversationId, prompt, attachments });
  }
  if (engine === ENGINES.codex && (mockCodex || mockAll)) {
    return runMockCodex({ conversationId, prompt, attachments });
  }
  if (engine === ENGINES.opencode && (mockOpencode || mockAll)) {
    return runMockOpencode({ conversationId, prompt, attachments });
  }

  // Claude keeps its existing pipeline (interactive permission prompts + stream-json)
  if (engine === ENGINES.claude) {
    return runClaude({ conversationId, prompt, attachments });
  }
  // Codex / OpenCode share the generic pipeline
  return runGenericEngine({ engine, conversationId, prompt, attachments });
}

function checkClaudeConnection() {
  if (mockClaude) {
    return { connected: true, detail: "Mock Claude 已启用" };
  }

  const result = spawn(
    claudeExecutable,
    ["--version"],
    {
      cwd: defaultDirectory(),
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: false,
      stdio: ["ignore", "ignore", "ignore"]
    }
  );

  return new Promise((resolve) => {
    let settled = false;
    const done = (connected, detail) => {
      if (settled) return;
      settled = true;
      resolve({ connected, detail });
    };

    const timeout = setTimeout(() => {
      result.kill();
      done(false, "Claude Code 检测超时");
    }, 2500);

    result.on("error", (error) => {
      clearTimeout(timeout);
      done(false, error.message);
    });

    result.on("close", (code) => {
      clearTimeout(timeout);
      done(code === 0, code === 0 ? "Claude Code 可用" : `claude --version exited ${code}`);
    });
  });
}

app.whenReady().then(() => {
  ensureStorage();
  loadAppSettings();
  readConversations();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    openFinderFolderSession();
    focusMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // In tray mode, keep the app running even when the main window is closed
  // (the user can re-open via the tray icon). Otherwise quit as usual.
  if (process.platform === "darwin") return;
  if (closeBehavior === "tray") return;
  app.quit();
});

ipcMain.handle("conversations:list", async () => conversations);

ipcMain.handle("conversations:create", async (_event, arg) => {
  const opts = arg && typeof arg === "object" ? arg : {};
  const requestedDir = typeof opts.directory === "string" && opts.directory ? opts.directory : "";
  const directory = requestedDir ? resolveCwd(requestedDir) : defaultDirectory();
  const engine = opts.engine === "codex" || opts.engine === "opencode" ? opts.engine : "claude";
  const sandbox = typeof opts.sandbox === "string" && opts.sandbox ? opts.sandbox : defaultSandboxFor(engine);
  const conversation = {
    id: makeId("session"),
    claudeSessionId: crypto.randomUUID(),
    codexSessionId: engine === "codex" ? crypto.randomUUID() : undefined,
    opencodeSessionId: engine === "opencode" ? crypto.randomUUID() : undefined,
    title: requestedDir ? path.basename(directory) || "新会话" : "新会话",
    updatedAt: "刚刚",
    directory,
    status: "local",
    pinned: false,
    messages: [],
    attachments: [],
    engine,
    sandbox
  };
  conversations = [conversation, ...conversations];
  writeConversations();
  return conversations;
});

ipcMain.handle("conversations:update", async (_event, { id, patch }) => {
  updateConversation(id, (conversation) => ({ ...conversation, ...patch }));
  return conversations;
});

ipcMain.handle("conversations:delete", async (_event, { id }) => {
  conversations = conversations.filter((conversation) => conversation.id !== id);
  deleteConversationFiles(id);
  writeConversations();
  return conversations;
});

ipcMain.handle("files:pick", async (_event, { conversationId }) => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    title: "添加到当前 Claude Code 会话"
  });

  if (result.canceled) return [];

  return result.filePaths.map((filePath) => safeCopyAttachment(conversationId, filePath));
});

ipcMain.handle("files:copy", async (_event, { conversationId, paths }) => {
  return paths.filter(Boolean).map((filePath) => safeCopyAttachment(conversationId, filePath));
});

ipcMain.handle("appearance:pick-background-image", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "选择对话背景图片",
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  return safeCopyAppearanceImage(result.filePaths[0]);
});

ipcMain.handle("appearance:pick-background-video", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "选择对话背景视频",
    filters: [{ name: "视频", extensions: ["mp4", "webm", "mov", "m4v"] }]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  return safeCopyAppearanceVideo(result.filePaths[0]);
});

ipcMain.handle("claude:send", async (_event, payload) => {
  try {
    runClaude(payload);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Claude Code 发送失败。" };
  }
});

// --- App settings (close behavior, etc.) ---

ipcMain.handle("settings:get", async () => {
  return loadSettings();
});

ipcMain.handle("settings:set-close-behavior", async (_event, value) => {
  const next = value === "tray" ? "tray" : "quit";
  closeBehavior = next;
  saveSettings({ closeBehavior: next });
  refreshTrayMenu();
  return { closeBehavior: next };
});

ipcMain.handle("settings:pick-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "选择工作目录"
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("claude:permission-answer", async (_event, { conversationId, input }) => {
  const run = activeClaudeRuns.get(conversationId);
  if (!run || run.child.killed || !run.child.stdin?.writable) {
    return { ok: false, error: "当前没有等待权限选择的 Claude Code 进程。" };
  }

  run.awaitingPermission = false;
  run.child.stdin.write(input || "\n");
  return { ok: true };
});

// Generic engine send — routes by conversation.engine.
// Claude keeps using the legacy claude:send channel above for now; once the
// renderer is migrated (Phase 3), this becomes the single entry point.
ipcMain.handle("engine:send", async (_event, payload) => {
  try {
    runEngine(payload);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "引擎发送失败。" };
  }
});

ipcMain.handle("engine:permission-answer", async (_event, { conversationId, input }) => {
  const run = activeEngineRuns.get(conversationId);
  if (!run || run.child.killed || !run.child.stdin?.writable) {
    return { ok: false, error: "当前没有等待输入的引擎进程。" };
  }
  run.awaitingPermission = false;
  run.child.stdin.write(input || "\n");
  return { ok: true };
});

ipcMain.handle("engines:list", async () =>
  Object.entries(ENGINES).map(([key, engine]) => ({
    key,
    name: engine.name,
    abbr: engine.abbr,
    defaultSandbox: engine.defaultSandbox,
    sandboxOptions: engines.sandboxOptionsFor(key)
  }))
);

ipcMain.handle("app:info", async () => ({
  storeDir,
  attachmentRoot,
  sessionRoot,
  claudeCommand: claudeCommandLabel,
  mockClaude,
  claudeConnection: await checkClaudeConnection()
}));

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function safeWindowOp(op) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { op(mainWindow); } catch (error) { console.error("window control failed:", error && error.message); }
}

ipcMain.handle("window:minimize", () => { safeWindowOp((win) => win.minimize()); return { ok: true }; });
ipcMain.handle("window:toggle-maximize", () => {
  safeWindowOp((win) => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  return { ok: true, maximized: mainWindow?.isMaximized() ?? false };
});
ipcMain.handle("window:close", () => { safeWindowOp((win) => win.close()); return { ok: true }; });

ipcMain.handle("clipboard:write-text", (_event, text) => {
  try { clipboard.writeText(typeof text === "string" ? text : ""); return { ok: true }; }
  catch (error) { return { ok: false, error: error && error.message }; }
});
ipcMain.handle("clipboard:read-text", () => {
  try { return { ok: true, text: clipboard.readText() }; }
  catch (error) { return { ok: false, error: error && error.message }; }
});

ipcMain.handle("terminal:start", async (_event, { id, cwd, cols, rows, autoRun }) => {
  if (!pty) return { ok: false, error: "终端引擎 node-pty 未加载" };
  try {
    const existing = terminals.get(id);
    if (existing) {
      try {
        existing.kill();
      } catch {}
      terminals.delete(id);
    }
    const shell = resolveLoginShell();
    const term = pty.spawn(shell.command, shell.args, {
      name: "xterm-256color",
      cols: cols || 80,
      rows: rows || 24,
      cwd: resolveCwd(cwd),
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" }
    });
    // Per-PTY passthrough buffers partial ANSI sequences that arrive across
    // chunk boundaries so the renderer always sees complete sequences.
    // (xterm.js reassembles internally; this is a defense-in-depth safety net
    // for downstream code that might want to parse ANSI later.)
    const passthroughForThisTerminal = createTerminalAnsiPassthrough();
    term.onData((data) => sendToRenderer("terminal:data", { id, data: passthroughForThisTerminal(data) }));
    term.onExit(({ exitCode }) => {
      terminals.delete(id);
      sendToRenderer("terminal:exit", { id, exitCode });
    });
    terminals.set(id, term);
    if (autoRun) {
      // Give the login shell a moment to finish sourcing rc files (so aliases/PATH
      // are ready), then run the command for the user — one-click straight into it.
      setTimeout(() => {
        if (terminals.get(id) === term) {
          try {
            term.write(autoRun + "\r");
          } catch {}
        }
      }, 600);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "无法启动终端" };
  }
});

ipcMain.on("terminal:write", (_event, { id, data }) => {
  const term = terminals.get(id);
  if (term) term.write(data);
});

ipcMain.on("terminal:resize", (_event, { id, cols, rows }) => {
  const term = terminals.get(id);
  if (term && cols > 0 && rows > 0) {
    try {
      term.resize(cols, rows);
    } catch {}
  }
});

ipcMain.on("terminal:kill", (_event, { id }) => {
  const term = terminals.get(id);
  if (term) {
    try {
      term.kill();
    } catch {}
    terminals.delete(id);
  }
});

ipcMain.on("app:renderer-ready", () => {
  rendererReady = true;
  const dirs = pendingOpenDirectories.splice(0);
  if (dirs.length && mainWindow && !mainWindow.isDestroyed()) {
    dirs.forEach((directory) => mainWindow.webContents.send("open-directory", { directory }));
    focusMainWindow();
  }
  // Cold launch (e.g. clicked from the Finder toolbar): open the current Finder folder.
  openFinderFolderSession();
});
