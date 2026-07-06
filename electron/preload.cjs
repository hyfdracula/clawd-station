const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Map();

function subscribe(channel, callback) {
  const wrapped = (_event, payload) => callback(payload);
  listeners.set(callback, { channel, wrapped });
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
    listeners.delete(callback);
  };
}

contextBridge.exposeInMainWorld("workbench", {
  listConversations: () => ipcRenderer.invoke("conversations:list"),
  createConversation: (opts) => {
    // Backward compat: accept a string directory OR an options object
    if (typeof opts === "string") return ipcRenderer.invoke("conversations:create", { directory: opts });
    return ipcRenderer.invoke("conversations:create", opts || {});
  },
  updateConversation: (id, patch) => ipcRenderer.invoke("conversations:update", { id, patch }),
  deleteConversation: (id) => ipcRenderer.invoke("conversations:delete", { id }),
  pickFiles: (conversationId) => ipcRenderer.invoke("files:pick", { conversationId }),
  copyFiles: (conversationId, paths) => ipcRenderer.invoke("files:copy", { conversationId, paths }),
  pickBackgroundImage: () => ipcRenderer.invoke("appearance:pick-background-image"),
  pickBackgroundVideo: () => ipcRenderer.invoke("appearance:pick-background-video"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  quitAndInstall: () => ipcRenderer.invoke("updater:quit-and-install"),
  setCloseBehavior: (value) => ipcRenderer.invoke("settings:set-close-behavior", value),
  pickDirectory: () => ipcRenderer.invoke("settings:pick-directory"),
  sendToClaude: (payload) => ipcRenderer.invoke("claude:send", payload),
  answerClaudePermission: (payload) => ipcRenderer.invoke("claude:permission-answer", payload),
  sendToEngine: (payload) => ipcRenderer.invoke("engine:send", payload),
  listEngines: () => ipcRenderer.invoke("engines:list"),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  onConversationsChanged: (callback) => subscribe("conversations:changed", callback),
  onClaudeChunk: (callback) => subscribe("claude:chunk", callback),
  onClaudeStderr: (callback) => subscribe("claude:stderr", callback),
  onClaudePermission: (callback) => subscribe("claude:permission", callback),
  onClaudeDone: (callback) => subscribe("claude:done", callback),
  onClaudeError: (callback) => subscribe("claude:error", callback),
  onEngineChunk: (callback) => subscribe("engine:chunk", callback),
  onEngineStderr: (callback) => subscribe("engine:stderr", callback),
  onEnginePermission: (callback) => subscribe("engine:permission", callback),
  onEngineDone: (callback) => subscribe("engine:done", callback),
  onEngineError: (callback) => subscribe("engine:error", callback),
  onEngineSessionId: (callback) => subscribe("engine:session-id", callback),
  onUpdaterChecking: (callback) => subscribe("updater:checking", callback),
  onUpdaterAvailable: (callback) => subscribe("updater:available", callback),
  onUpdaterProgress: (callback) => subscribe("updater:progress", callback),
  onUpdaterDownloaded: (callback) => subscribe("updater:downloaded", callback),
  onUpdaterNotAvailable: (callback) => subscribe("updater:not-available", callback),
  onUpdaterError: (callback) => subscribe("updater:error", callback),
  onSelectMessageContent: (callback) => subscribe("edit:select-message-content", callback),
  onCopyMessageContent: (callback) => subscribe("edit:copy-message-content", callback),
  terminalStart: (opts) => ipcRenderer.invoke("terminal:start", opts),
  terminalWrite: (id, data) => ipcRenderer.send("terminal:write", { id, data }),
  terminalResize: (id, cols, rows) => ipcRenderer.send("terminal:resize", { id, cols, rows }),
  terminalKill: (id) => ipcRenderer.send("terminal:kill", { id }),
  onTerminalData: (callback) => subscribe("terminal:data", callback),
  onTerminalExit: (callback) => subscribe("terminal:exit", callback),
  notifyReady: () => ipcRenderer.send("app:renderer-ready"),
  onOpenDirectory: (callback) => subscribe("open-directory", callback)
});
