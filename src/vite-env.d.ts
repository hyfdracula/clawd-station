/// <reference types="vite/client" />

type WorkbenchStatus = "local" | "processing" | "synced";
type WorkbenchRole = "user" | "assistant";
type WorkbenchEngine = "claude" | "codex" | "opencode";
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
  title: string;
  updatedAt: string;
  directory: string;
  status: WorkbenchStatus;
  pinned: boolean;
  messages: WorkbenchMessage[];
  attachments: WorkbenchAttachment[];
  engine?: WorkbenchEngine;
  sandbox?: WorkbenchSandbox;
}

interface CreateConversationOptions {
  directory?: string;
  engine?: WorkbenchEngine;
  sandbox?: WorkbenchSandbox;
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

interface PickedBackgroundImage {
  path: string;
  url: string;
}

interface PickedBackgroundVideo {
  path: string;
  url: string;
}

interface EngineInfo {
  key: WorkbenchEngine;
  name: string;
  abbr: string;
  defaultSandbox: WorkbenchSandbox;
  sandboxOptions: { value: WorkbenchSandbox; label: string }[];
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
  claudeCommand: string;
  mockClaude: boolean;
  claudeConnection?: {
    connected: boolean;
    detail: string;
  };
}

interface AppSettings {
  closeBehavior?: "quit" | "tray";
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
    pickBackgroundImage: () => Promise<PickedBackgroundImage | null>;
    pickBackgroundVideo: () => Promise<PickedBackgroundVideo | null>;
    getSettings: () => Promise<AppSettings>;
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
    onSelectMessageContent: (callback: (event: SelectMessageContentEvent) => void) => () => void;
    onCopyMessageContent: (callback: (event: SelectMessageContentEvent) => void) => () => void;
    terminalStart: (opts: { id: string; cwd?: string; cols?: number; rows?: number; autoRun?: string }) => Promise<{ ok: boolean; error?: string }>;
    terminalWrite: (id: string, data: string) => void;
    terminalResize: (id: string, cols: number, rows: number) => void;
    terminalKill: (id: string) => void;
    onTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void;
    onTerminalExit: (callback: (event: { id: string; exitCode: number }) => void) => () => void;
    notifyReady: () => void;
    onOpenDirectory: (callback: (event: { directory: string }) => void) => () => void;
    clipboardWriteText: (text: string) => Promise<{ ok: boolean; error?: string }>;
  };
}