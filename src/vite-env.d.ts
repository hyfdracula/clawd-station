/// <reference types="vite/client" />

type WorkbenchStatus = "local" | "processing" | "synced";
type WorkbenchRole = "user" | "assistant";
type WorkbenchEngine = "claude" | "codex" | "opencode" | "kimi";
type WorkbenchSandbox =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "read-only"
  | "workspace-write"
  | "danger-full-access"
  | "ask"
  | "auto";

interface WorkbenchAttachment {
  id: string;
  name: string;
  path: string;
  size?: number | string;
}

interface WorkbenchMessage {
  id: string;
  role: WorkbenchRole;
  body: string;
  meta?: string;
  output?: string;
}

interface WorkbenchConversation {
  id: string;
  claudeSessionId?: string;
  codexSessionId?: string;
  opencodeSessionId?: string;
  kimiSessionId?: string;
  title: string;
  updatedAt: string;
  directory: string;
  status: WorkbenchStatus;
  pinned: boolean;
  messages: WorkbenchMessage[];
  attachments: WorkbenchAttachment[];
  engine?: WorkbenchEngine;
  sandbox?: WorkbenchSandbox;
  outputDir?: string;
}

interface CreateConversationOptions {
  directory?: string;
  engine?: WorkbenchEngine;
  sandbox?: WorkbenchSandbox;
  outputDir?: string;
}

interface ClaudeChunkEvent {
  conversationId: string;
  messageId: string;
  chunk?: string;
  stderr?: string;
  conversations?: WorkbenchConversation[];
  finalMessage?: WorkbenchMessage;
  error?: string;
}

interface ClaudePermissionChoice {
  action: "allow-once" | "allow-always" | "deny";
  label: string;
  input: string;
}

interface ClaudePermissionEvent {
  conversationId: string;
  messageId: string;
  prompt: string;
  choices: ClaudePermissionChoice[];
}

interface SelectMessageContentEvent {
  x: number;
  y: number;
}

interface EngineInfo {
  key: WorkbenchEngine;
  name: string;
  abbr: string;
  defaultSandbox: WorkbenchSandbox;
  sandboxOptions: { value: WorkbenchSandbox; label: string }[];
}

interface EngineDetectEntry {
  engine: WorkbenchEngine;
  installed: boolean;
  bin: string;
  install: string;
}

interface EngineDetectResult {
  engines: EngineDetectEntry[];
  npm: boolean;
}

interface EngineInstallProgressEvent {
  engine: WorkbenchEngine;
  chunk?: string;
  done?: boolean;
  code?: number;
  error?: string;
}

interface EngineSessionIdEvent {
  conversationId: string;
  engine: string;
  sessionId: string;
}

interface WorkbenchInfo {
  storeDir: string;
  attachmentRoot: string;
  sessionRoot?: string;
  homeDir?: string;
  version?: string;
  claudeCommand: string;
  mockClaude: boolean;
  claudeConnection?: {
    connected: boolean;
    detail: string;
  };
}

interface UpdaterEvent {
  version?: string;
  releaseDate?: string;
  percent?: number;
  bytesPerSecond?: number;
  total?: number;
  transferred?: number;
  message?: string;
}

interface AppSettings {
  closeBehavior?: "quit" | "tray";
  appearance?: Partial<{
    theme: string;
    motion: string;
  }>;
  [key: string]: unknown;
}

interface Window {
  workbench?: {
    listConversations: () => Promise<WorkbenchConversation[]>;
    createConversation: (opts?: CreateConversationOptions | string) => Promise<WorkbenchConversation[]>;
    updateConversation: (id: string, patch: Partial<WorkbenchConversation>) => Promise<WorkbenchConversation[]>;
    deleteConversation: (id: string) => Promise<WorkbenchConversation[]>;
    pickFiles: (conversationId: string) => Promise<WorkbenchAttachment[]>;
    copyFiles: (conversationId: string, paths: string[]) => Promise<WorkbenchAttachment[]>;
    getSettings: () => Promise<AppSettings>;
    setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
    checkForUpdates: () => Promise<void>;
    quitAndInstall: () => Promise<void>;
    closeWindow: () => Promise<{ ok: boolean; hidden?: boolean }>;
    minimizeWindow: () => Promise<{ ok: boolean }>;
    toggleMaximizeWindow: () => Promise<{ ok: boolean; maximized?: boolean }>;
    setCloseBehavior: (value: "quit" | "tray") => Promise<{ closeBehavior: "quit" | "tray" }>;
    pickDirectory: () => Promise<string | null>;
    sendToClaude: (payload: {
      conversationId: string;
      prompt: string;
      attachments: WorkbenchAttachment[];
    }) => Promise<{ ok: boolean; error?: string }>;
    answerClaudePermission: (payload: {
      conversationId: string;
      input: string;
    }) => Promise<{ ok: boolean; error?: string }>;
    sendToEngine: (payload: {
      conversationId: string;
      prompt: string;
      attachments: WorkbenchAttachment[];
    }) => Promise<{ ok: boolean; error?: string }>;
    listEngines: () => Promise<EngineInfo[]>;
    detectEngines: (refresh?: boolean) => Promise<EngineDetectResult>;
    installEngine: (engine: WorkbenchEngine) => Promise<{ ok: boolean; error?: string }>;
    onEngineInstallProgress: (callback: (event: EngineInstallProgressEvent) => void) => () => void;
    getAppInfo: () => Promise<WorkbenchInfo>;
    onConversationsChanged: (callback: (conversations: WorkbenchConversation[]) => void) => () => void;
    onClaudeChunk: (callback: (event: ClaudeChunkEvent) => void) => () => void;
    onClaudeStderr: (callback: (event: ClaudeChunkEvent) => void) => () => void;
    onClaudePermission: (callback: (event: ClaudePermissionEvent) => void) => () => void;
    onClaudeDone: (callback: (event: ClaudeChunkEvent) => void) => () => void;
    onClaudeError: (callback: (event: ClaudeChunkEvent) => void) => () => void;
    onEngineChunk: (callback: (event: ClaudeChunkEvent) => void) => () => void;
    onEngineStderr: (callback: (event: ClaudeChunkEvent) => void) => () => void;
    onEnginePermission: (callback: (event: ClaudePermissionEvent) => void) => () => void;
    onEngineDone: (callback: (event: ClaudeChunkEvent) => void) => () => void;
    onEngineError: (callback: (event: ClaudeChunkEvent) => void) => () => void;
    onEngineSessionId: (callback: (event: EngineSessionIdEvent) => void) => () => void;
    onUpdaterChecking: (callback: () => void) => () => void;
    onUpdaterAvailable: (callback: (event: UpdaterEvent) => void) => () => void;
    onUpdaterProgress: (callback: (event: UpdaterEvent) => void) => () => void;
    onUpdaterDownloaded: (callback: (event: UpdaterEvent) => void) => () => void;
    onUpdaterNotAvailable: (callback: () => void) => () => void;
    onUpdaterError: (callback: (event: UpdaterEvent) => void) => () => void;
    onSelectMessageContent: (callback: (event: SelectMessageContentEvent) => void) => () => void;
    onCopyMessageContent: (callback: (event: SelectMessageContentEvent) => void) => () => void;
    terminalStart: (opts: { id: string; cwd?: string; cols?: number; rows?: number; autoRun?: string }) => Promise<{ ok: boolean; error?: string; replay?: string }>;
    terminalWrite: (id: string, data: string) => void;
    terminalResize: (id: string, cols: number, rows: number) => void;
    terminalKill: (id: string) => void;
    onTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void;
    onTerminalExit: (callback: (event: { id: string; exitCode: number }) => void) => () => void;
    notifyReady: () => void;
    onOpenDirectory: (callback: (event: { directory: string }) => void) => () => void;
    clipboardWriteText: (text: string) => Promise<{ ok: boolean; error?: string }>;
    clipboardReadFilePaths: () => Promise<{ ok: boolean; paths?: string[]; error?: string }>;
    getPathForFile: (file: File) => string;
  };
}
