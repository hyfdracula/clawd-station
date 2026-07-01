const { app, BrowserWindow, Menu, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  handleOpenPath(filePath);
});

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
  const dir = getFinderDirectory();
  if (!dir || dir === lastFinderDir) return;
  lastFinderDir = dir;
  handleOpenPath(dir);
}

const bundledIndex = path.join(process.resourcesPath, "app/dist/index.html");
const hasBundledBuild = fs.existsSync(bundledIndex);
const isDev = !hasBundledBuild && !app.isPackaged && process.env.NODE_ENV !== "production";
const claudeCommandOverride = process.env.CLAUDE_CODE_BIN || process.env.CLAUDE_BIN || "";
const claudeCommandLabel = claudeCommandOverride || "claude (via login shell)";
const mockClaude = process.env.CLAUDE_TO_CODE_MOCK === "1" || process.env.CLAUDE_WORKBENCH_MOCK === "1";
const smokeMode = process.env.CLAUDE_TO_CODE_SMOKE === "1" || process.env.CLAUDE_WORKBENCH_SMOKE === "1";


let mainWindow = null;
let storeDir = "";
let dataFile = "";
let attachmentRoot = "";
let sessionRoot = "";
let appearanceRoot = "";
let conversations = [];
const activeClaudeRuns = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    show: !smokeMode,
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    title: "Clawd Station",
    backgroundColor: "#00000000",
    transparent: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
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
    mainWindow.loadFile(hasBundledBuild ? bundledIndex : path.join(__dirname, "../dist/index.html"));
  }

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
  fs.mkdirSync(attachmentRoot, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  fs.mkdirSync(appearanceRoot, { recursive: true });
}

function readConversations() {
  try {
    conversations = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (!Array.isArray(conversations)) conversations = [];
    conversations = conversations.map((conversation) => ({
      ...conversation,
      title: conversation.title === "新的 Claude Code 会话" ? "新会话" : conversation.title,
      directory: conversation.directory === "/" ? defaultDirectory() : conversation.directory || defaultDirectory()
    }));
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
        attachments: []
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
    "/bin/zsh",
    [
      "-lc",
      'if [ -n "$CLAUDE_CODE_BIN" ]; then exec "$CLAUDE_CODE_BIN" "$@"; elif [ -n "$CLAUDE_BIN" ]; then exec "$CLAUDE_BIN" "$@"; else exec claude "$@"; fi',
      "claude-to-code",
      ...args
    ],
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

function checkClaudeConnection() {
  if (mockClaude) {
    return { connected: true, detail: "Mock Claude 已启用" };
  }

  const result = spawn(
    "/bin/zsh",
    [
      "-lc",
      'if [ -n "$CLAUDE_CODE_BIN" ]; then exec "$CLAUDE_CODE_BIN" "$@"; elif [ -n "$CLAUDE_BIN" ]; then exec "$CLAUDE_BIN" "$@"; else exec claude "$@"; fi',
      "claude-to-code-check",
      "--version"
    ],
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
  readConversations();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    openFinderFolderSession();
    focusMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("conversations:list", async () => conversations);

ipcMain.handle("conversations:create", async (_event, arg) => {
  const requestedDir = arg && typeof arg.directory === "string" && arg.directory ? arg.directory : "";
  const directory = requestedDir ? resolveCwd(requestedDir) : defaultDirectory();
  const conversation = {
    id: makeId("session"),
    claudeSessionId: crypto.randomUUID(),
    title: requestedDir ? path.basename(directory) || "新会话" : "新会话",
    updatedAt: "刚刚",
    directory,
    status: "local",
    pinned: false,
    messages: [],
    attachments: []
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

ipcMain.handle("claude:permission-answer", async (_event, { conversationId, input }) => {
  const run = activeClaudeRuns.get(conversationId);
  if (!run || run.child.killed || !run.child.stdin?.writable) {
    return { ok: false, error: "当前没有等待权限选择的 Claude Code 进程。" };
  }

  run.awaitingPermission = false;
  run.child.stdin.write(input || "\n");
  return { ok: true };
});

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
    const shell = process.env.SHELL || "/bin/zsh";
    const term = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: cols || 80,
      rows: rows || 24,
      cwd: resolveCwd(cwd),
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" }
    });
    term.onData((data) => sendToRenderer("terminal:data", { id, data }));
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
