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
  createConversation: (directory) => ipcRenderer.invoke("conversations:create", { directory }),
  updateConversation: (id, patch) => ipcRenderer.invoke("conversations:update", { id, patch }),
  deleteConversation: (id) => ipcRenderer.invoke("conversations:delete", { id }),
  pickFiles: (conversationId) => ipcRenderer.invoke("files:pick", { conversationId }),
  copyFiles: (conversationId, paths) => ipcRenderer.invoke("files:copy", { conversationId, paths }),
  pickBackgroundImage: () => ipcRenderer.invoke("appearance:pick-background-image"),
  pickBackgroundVideo: () => ipcRenderer.invoke("appearance:pick-background-video"),
  sendToClaude: (payload) => ipcRenderer.invoke("claude:send", payload),
  answerClaudePermission: (payload) => ipcRenderer.invoke("claude:permission-answer", payload),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  onConversationsChanged: (callback) => subscribe("conversations:changed", callback),
  onClaudeChunk: (callback) => subscribe("claude:chunk", callback),
  onClaudeStderr: (callback) => subscribe("claude:stderr", callback),
  onClaudePermission: (callback) => subscribe("claude:permission", callback),
  onClaudeDone: (callback) => subscribe("claude:done", callback),
  onClaudeError: (callback) => subscribe("claude:error", callback),
  onSelectMessageContent: (callback) => subscribe("edit:select-message-content", callback),
  terminalStart: (opts) => ipcRenderer.invoke("terminal:start", opts),
  terminalWrite: (id, data) => ipcRenderer.send("terminal:write", { id, data }),
  terminalResize: (id, cols, rows) => ipcRenderer.send("terminal:resize", { id, cols, rows }),
  terminalKill: (id) => ipcRenderer.send("terminal:kill", { id }),
  onTerminalData: (callback) => subscribe("terminal:data", callback),
  onTerminalExit: (callback) => subscribe("terminal:exit", callback),
  notifyReady: () => ipcRenderer.send("app:renderer-ready"),
  onOpenDirectory: (callback) => subscribe("open-directory", callback)
});
