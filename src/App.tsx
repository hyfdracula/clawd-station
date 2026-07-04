import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePlus2,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Loader2,
  Minus,
  Paperclip,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Square,
  Trash2,
  X
} from "lucide-react";
import { CSSProperties, ChangeEvent, DragEvent, KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clawdWizard from "./assets/clawd-wizard.png";
import { TerminalDeck } from "./TerminalPane";
import { EngineBadge, engineLabel } from "./components/EngineBadge";
import { NewConversationModal } from "./components/NewConversationModal";

type Status = WorkbenchStatus;
type Attachment = WorkbenchAttachment;
type Conversation = WorkbenchConversation;
type Engine = WorkbenchEngine;
type Sandbox = WorkbenchSandbox;

const defaultAppearance = {
  chatBackground: "#F0EBE0",
  chatOpacity: 100,
  chatImageUrl: "",
  chatImagePath: "",
  chatVideoUrl: "",
  chatVideoPath: "",
  loadingVariant: "ring"
};

const initialConversations: Conversation[] = [
  {
    id: "session-1",
    claudeSessionId: "11111111-1111-4111-8111-111111111111",
    title: "新会话",
    updatedAt: "刚刚",
    directory: "~",
    status: "local",
    pinned: false,
    attachments: [],
    messages: [],
    engine: "claude",
    sandbox: "default"
  }
];

const statusText: Record<Status, string> = {
  local: "本地记录",
  processing: "处理中",
  synced: "已整理"
};

const statusIcon: Record<Status, ReactNode> = {
  local: <Archive aria-hidden="true" />,
  processing: <Loader2 aria-hidden="true" />,
  synced: <CheckCircle2 aria-hidden="true" />
};

type AppView = "chat" | "settings";
type SettingsSection = "background" | "loading";

const loadingOptions = [
  { id: "ring", label: "Ring" },
  { id: "ring-dual", label: "Dual Ring" },
  { id: "ring-dash", label: "Dash Ring" },
  { id: "ring-thin", label: "Thin Ring" },
  { id: "ring-bold", label: "Bold Ring" },
  { id: "ring-reverse", label: "Reverse" },
  { id: "orbit", label: "Orbit" },
  { id: "orbit-double", label: "Double Orbit" },
  { id: "orbit-slow", label: "Slow Orbit" },
  { id: "orbit-fast", label: "Fast Orbit" },
  { id: "pulse", label: "Pulse" },
  { id: "pulse-soft", label: "Soft Pulse" },
  { id: "pulse-ring", label: "Pulse Ring" },
  { id: "dots", label: "Dots" },
  { id: "dots-wave", label: "Dot Wave" },
  { id: "dots-chase", label: "Dot Chase" },
  { id: "bars", label: "Bars" },
  { id: "bars-wave", label: "Bar Wave" },
  { id: "bars-rise", label: "Bar Rise" },
  { id: "square", label: "Square" },
  { id: "square-flip", label: "Flip" },
  { id: "diamond", label: "Diamond" },
  { id: "typing", label: "Typing" },
  { id: "scan", label: "Scan" },
  { id: "radar", label: "Radar" },
  { id: "breath", label: "Breath" },
  { id: "spark", label: "Spark" },
  { id: "flower", label: "Flower" },
  { id: "clock", label: "Clock" },
  { id: "pinwheel", label: "Pinwheel" }
] as const;

type LoadingVariant = (typeof loadingOptions)[number]["id"];

function formatFileSize(size: number) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function displayFileSize(size?: number | string) {
  if (typeof size === "number") return formatFileSize(size);
  return size ?? "";
}

function displayMessageBody(body: string) {
  return body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "$1")
    .replace(/(^|[\s（(])\*([^*\n]+)\*(?=$|[\s，。！？、）)])/g, "$1$2");
}

function isMessageProcessing(message: WorkbenchMessage) {
  return message.meta?.includes("处理中") ?? false;
}

function ClaudeMessageMark({
  processing,
  loadingVariant,
  completed
}: {
  processing: boolean;
  loadingVariant: LoadingVariant;
  completed: boolean;
}) {
  if (processing) {
    return (
      <span className={`loading-mark loading-${loadingVariant}`} aria-hidden="true">
        <span />
      </span>
    );
  }

  return <img className={completed ? "is-complete" : ""} src={clawdWizard} alt="" />;
}

function loadAppearance() {
  try {
    const stored = window.localStorage.getItem("claude-workbench-appearance");
    if (!stored) return defaultAppearance;
    const parsed = JSON.parse(stored) as Partial<typeof defaultAppearance>;
    // Backgrounds auto-saved by earlier themes; treat them as "not customized" so the current default wins.
    const legacyBackgrounds = ["#F7F4EE", "#436690", "#34527A", "#EFF5FC", "#FBF5DA", "#DCE8F5", "#EAE3D5"];
    const storedBackground =
      typeof parsed.chatBackground === "string" &&
      !legacyBackgrounds.includes(parsed.chatBackground.toUpperCase())
        ? parsed.chatBackground
        : defaultAppearance.chatBackground;
    return {
      chatBackground: storedBackground,
      chatOpacity:
        typeof parsed.chatOpacity === "number"
          ? Math.min(100, Math.max(20, parsed.chatOpacity))
          : defaultAppearance.chatOpacity,
      chatImageUrl: typeof parsed.chatImageUrl === "string" ? parsed.chatImageUrl : defaultAppearance.chatImageUrl,
      chatImagePath: typeof parsed.chatImagePath === "string" ? parsed.chatImagePath : defaultAppearance.chatImagePath,
      chatVideoUrl: typeof parsed.chatVideoUrl === "string" ? parsed.chatVideoUrl : defaultAppearance.chatVideoUrl,
      chatVideoPath: typeof parsed.chatVideoPath === "string" ? parsed.chatVideoPath : defaultAppearance.chatVideoPath,
      loadingVariant: loadingOptions.some((option) => option.id === parsed.loadingVariant)
        ? (parsed.loadingVariant as LoadingVariant)
        : defaultAppearance.loadingVariant
    };
  } catch {
    return defaultAppearance;
  }
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return { r: 247, g: 244, b: 238 };
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function App() {
  // In the desktop app, real sessions load from storage — start empty so we don't spawn
  // a throwaway placeholder terminal. The seed is only for browser-preview mode.
  const hasWorkbench = typeof window !== "undefined" && Boolean(window.workbench);
  const [conversations, setConversations] = useState<Conversation[]>(hasWorkbench ? [] : initialConversations);
  const [activeId, setActiveId] = useState(hasWorkbench ? "" : initialConversations[0].id);
  const [appInfo, setAppInfo] = useState<WorkbenchInfo | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [composerFiles, setComposerFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [permissionRequests, setPermissionRequests] = useState<Record<string, ClaudePermissionEvent>>({});
  const [appView, setAppView] = useState<AppView>("chat");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("background");
  const [appearance, setAppearance] = useState(loadAppearance);
  const [completedMessageIds, setCompletedMessageIds] = useState<Set<string>>(() => new Set());
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const streamQueuesRef = useRef(new Map<string, string[]>());
  const streamTimersRef = useRef(new Map<string, number>());

  const chatRgb = hexToRgb(appearance.chatBackground);
  const chatOpacity = appearance.chatOpacity / 100;
  const hasVisualBackground = Boolean(appearance.chatImageUrl || appearance.chatVideoUrl);
  const appStyle = {
    "--custom-chat-background": `rgb(${chatRgb.r} ${chatRgb.g} ${chatRgb.b} / ${hasVisualBackground ? 1 : chatOpacity})`,
    "--custom-chat-background-overlay": `rgb(${chatRgb.r} ${chatRgb.g} ${chatRgb.b} / ${hasVisualBackground ? 1 - chatOpacity : 0})`,
    "--custom-chat-image": appearance.chatImageUrl && !appearance.chatVideoUrl ? `url("${appearance.chatImageUrl}")` : "none"
  } as CSSProperties;

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sortedConversations;
    return sortedConversations.filter((conversation) => {
      return (
        conversation.title.toLowerCase().includes(normalized) ||
        conversation.directory.toLowerCase().includes(normalized)
      );
    });
  }, [query, sortedConversations]);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? conversations[0];

  useEffect(() => {
    window.localStorage.setItem("claude-workbench-appearance", JSON.stringify(appearance));
  }, [appearance]);

  function splitStreamChunk(text: string) {
    const pieces: string[] = [];
    let index = 0;
    while (index < text.length) {
      const nextBreak = text.slice(index).search(/(?<=[。！？.!?；;，,、\n])\s*/);
      const softEnd = nextBreak >= 0 ? index + nextBreak + 1 : index + 18;
      const end = Math.min(text.length, Math.max(index + 6, Math.min(index + 24, softEnd)));
      pieces.push(text.slice(index, end));
      index = end;
    }
    return pieces.filter(Boolean);
  }

  function appendMessageChunk(conversationId: string, messageId: string, chunk: string) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              status: "processing",
              messages: conversation.messages.map((message) =>
                message.id === messageId ? { ...message, body: `${message.body}${chunk}` } : message
              )
            }
          : conversation
      )
    );
  }

  function stopStreamQueue(messageId: string, conversationId?: string, flush = false) {
    const timer = streamTimersRef.current.get(messageId);
    if (timer) window.clearTimeout(timer);
    if (flush && conversationId) {
      const queue = streamQueuesRef.current.get(messageId);
      if (queue?.length) {
        appendMessageChunk(conversationId, messageId, queue.join(""));
      }
    }
    streamTimersRef.current.delete(messageId);
    streamQueuesRef.current.delete(messageId);
  }

  function enqueueMessageChunk(conversationId: string, messageId: string, chunk: string) {
    const queue = streamQueuesRef.current.get(messageId) ?? [];
    queue.push(...splitStreamChunk(chunk));
    streamQueuesRef.current.set(messageId, queue);

    if (streamTimersRef.current.has(messageId)) return;

    const flush = () => {
      const currentQueue = streamQueuesRef.current.get(messageId);
      if (!currentQueue || currentQueue.length === 0) {
        stopStreamQueue(messageId);
        return;
      }
      const next = currentQueue.shift();
      if (next) appendMessageChunk(conversationId, messageId, next);
      const timer = window.setTimeout(flush, 18);
      streamTimersRef.current.set(messageId, timer);
    };

    const timer = window.setTimeout(flush, 18);
    streamTimersRef.current.set(messageId, timer);
  }

  function scrollConversationToBottom(behavior: ScrollBehavior = "smooth") {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTo({ top: scroll.scrollHeight, behavior });
  }

  useLayoutEffect(() => {
    scrollConversationToBottom("auto");
    const frame = window.requestAnimationFrame(() => scrollConversationToBottom("auto"));
    const timer = window.setTimeout(() => scrollConversationToBottom("auto"), 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [activeId]);

  useEffect(() => {
    scrollConversationToBottom("smooth");
  }, [activeId, activeConversation?.messages.length, activeConversation?.messages.at(-1)?.body]);

  // Load available engines from main process for the new-conversation modal.
  useEffect(() => {
    if (!window.workbench?.listEngines) return;
    void window.workbench.listEngines().then((items) => setEngines(items || []));
  }, []);

  useEffect(() => {
    const resetDragState = () => {
      dragDepthRef.current = 0;
      setDragging(false);
    };

    const handleWindowDragLeave = (event: globalThis.DragEvent) => {
      const x = event.clientX;
      const y = event.clientY;
      if (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight) resetDragState();
    };

    window.addEventListener("dragend", resetDragState);
    window.addEventListener("drop", resetDragState);
    window.addEventListener("blur", resetDragState);
    window.addEventListener("dragleave", handleWindowDragLeave);

    return () => {
      window.removeEventListener("dragend", resetDragState);
      window.removeEventListener("drop", resetDragState);
      window.removeEventListener("blur", resetDragState);
      window.removeEventListener("dragleave", handleWindowDragLeave);
    };
  }, []);

  useEffect(() => {
    if (!window.workbench) return;

    let mounted = true;

    window.workbench.listConversations().then((items) => {
      if (!mounted) return;
      setConversations(items);
      setActiveId((current) => items.find((item) => item.id === current)?.id ?? items[0]?.id ?? "");
    });

    window.workbench.getAppInfo().then((info) => {
      if (mounted) setAppInfo(info);
    });

    const offChanged = window.workbench.onConversationsChanged((items) => {
      setConversations(items);
      setActiveId((current) => items.find((item) => item.id === current)?.id ?? items[0]?.id ?? "");
    });

    const offChunk = window.workbench.onClaudeChunk(({ conversationId, messageId, chunk }) => {
      if (!chunk) return;
      enqueueMessageChunk(conversationId, messageId, chunk);
    });

    const offStderr = window.workbench.onClaudeStderr(({ conversationId, messageId, stderr }) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === messageId ? { ...message, output: stderr ?? message.output } : message
                )
              }
            : conversation
        )
      );
    });

    const syncFinal = (event: ClaudeChunkEvent) => {
      if (event.messageId) stopStreamQueue(event.messageId, event.conversationId, true);
      if (event.conversations) setConversations(event.conversations);
      if (event.finalMessage) {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === event.conversationId
              ? {
                  ...conversation,
                  status: event.finalMessage?.meta?.includes("已整理") ? "synced" : "local",
                  messages: conversation.messages.map((message) =>
                    message.id === event.messageId
                      ? {
                          ...message,
                          meta: event.finalMessage?.meta ?? message.meta,
                          output: event.finalMessage?.output ?? message.output,
                          body: message.body || event.finalMessage?.body || message.body
                        }
                      : message
                  )
                }
              : conversation
          )
        );
      }
      if (event.error) showToast(event.error);
      if (event.messageId) {
        setCompletedMessageIds((current) => new Set(current).add(event.messageId));
        setPermissionRequests((current) => {
          const next = { ...current };
          delete next[event.messageId];
          return next;
        });
      }
    };

    const offPermission = window.workbench.onClaudePermission((event) => {
      setPermissionRequests((current) => ({ ...current, [event.messageId]: event }));
    });
    const offSelectMessageContent = window.workbench.onSelectMessageContent(({ x, y }) => {
      selectMessageContentAt(x, y);
    });
    const offCopyMessageContent = window.workbench.onCopyMessageContent(({ x, y }) => {
      void copyMessageContentAt(x, y);
    });
    const offDone = window.workbench.onClaudeDone(syncFinal);
    const offError = window.workbench.onClaudeError(syncFinal);

    // Engine (Codex / OpenCode / generic) listeners share the same plumbing as Claude.
    const offEngineChunk = window.workbench.onEngineChunk
      ? window.workbench.onEngineChunk(({ conversationId, messageId, chunk }) => {
          if (!chunk) return;
          enqueueMessageChunk(conversationId, messageId, chunk);
        })
      : () => {};
    const offEngineStderr = window.workbench.onEngineStderr
      ? window.workbench.onEngineStderr(({ conversationId, messageId, stderr }) => {
          setConversations((current) =>
            current.map((conversation) =>
              conversation.id === conversationId
                ? {
                    ...conversation,
                    messages: conversation.messages.map((message) =>
                      message.id === messageId ? { ...message, output: stderr ?? message.output } : message
                    )
                  }
                : conversation
            )
          );
        })
      : () => {};
    const offEnginePermission = window.workbench.onEnginePermission
      ? window.workbench.onEnginePermission((event) => {
          setPermissionRequests((current) => ({ ...current, [event.messageId]: event }));
        })
      : () => {};
    const offEngineDone = window.workbench.onEngineDone ? window.workbench.onEngineDone(syncFinal) : () => {};
    const offEngineError = window.workbench.onEngineError ? window.workbench.onEngineError(syncFinal) : () => {};
    const offEngineSessionId = window.workbench.onEngineSessionId
      ? window.workbench.onEngineSessionId((event) => {
          // Persist the captured session id back into the conversation so future
          // turns can resume the same Codex/OpenCode session.
          updateConversation(event.conversationId, (conversation) => {
            if (event.engine === "Codex CLI" && event.sessionId) {
              return { ...conversation, codexSessionId: event.sessionId };
            }
            if (event.engine === "OpenCode" && event.sessionId) {
              return { ...conversation, opencodeSessionId: event.sessionId };
            }
            return conversation;
          });
          void persistConversation(event.conversationId, {});
        })
      : () => {};

    const offOpenDirectory = window.workbench.onOpenDirectory(({ directory }) => {
      void openConversationInDirectory(directory);
    });

    window.workbench.notifyReady();

    // Global keyboard handler: only copies selected text from non-editable
    // areas (chat messages). Cut / paste are handled by xterm's own
    // attachCustomKeyEventHandler and the textarea/input default behavior.
    const handleKeydown = (event: KeyboardEvent) => {
      const isLetter = event.key.length === 1;
      const isCopy = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && isLetter && event.key.toLowerCase() === "c";
      if (!isCopy) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? "";
      const editable = !!active && (tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable);
      if (editable) return;
      const selection = window.getSelection();
      const text = selection ? selection.toString() : "";
      if (!text || !window.workbench) return;
      event.preventDefault();
      void window.workbench.clipboardWriteText(text);
    };
    window.addEventListener("keydown", handleKeydown as unknown as EventListener);

    return () => {
      mounted = false;
      offChanged();
      offChunk();
      offStderr();
      offPermission();
      offSelectMessageContent();
      offCopyMessageContent();
      offDone();
      offError();
      offEngineChunk();
      offEngineStderr();
      offEnginePermission();
      offEngineDone();
      offEngineError();
      offEngineSessionId();
      offOpenDirectory();
      streamTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      streamTimersRef.current.clear();
      streamQueuesRef.current.clear();
      window.removeEventListener("keydown", handleKeydown as unknown as EventListener);
    };
  }, []);

  async function persistConversation(id: string, patch: Partial<Conversation>) {
    if (!window.workbench) return;
    const items = await window.workbench.updateConversation(id, patch);
    setConversations(items);
  }

  function updateConversation(id: string, updater: (conversation: Conversation) => Conversation) {
    setConversations((current) => current.map((conversation) => (conversation.id === id ? updater(conversation) : conversation)));
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  function openNewConversationModal() {
    if (!window.workbench) {
      // No workbench (browser preview) — just create a default Claude session.
      void createConversation();
      return;
    }
    setShowNewConversationModal(true);
  }

  async function confirmNewConversation(engine: Engine, sandbox: Sandbox) {
    setShowNewConversationModal(false);
    if (window.workbench) {
      const items = await window.workbench.createConversation({ engine, sandbox });
      setConversations(items);
      setActiveId(items[0]?.id ?? "");
      setDraft("");
      setComposerFiles([]);
      return;
    }

    const next: Conversation = {
      id: makeId("session"),
      claudeSessionId: engine === "claude" ? makeId("claude") : undefined,
      codexSessionId: engine === "codex" ? makeId("codex") : undefined,
      opencodeSessionId: engine === "opencode" ? makeId("opencode") : undefined,
      title: "新会话",
      updatedAt: "刚刚",
      directory: "~",
      status: "local",
      pinned: false,
      attachments: [],
      messages: [],
      engine,
      sandbox
    };
    setConversations((current) => [next, ...current]);
    setActiveId(next.id);
    setDraft("");
    setComposerFiles([]);
  }

  // Legacy entry point kept for keyboard shortcuts / direct invocations that
  // don't want to show the picker — creates a default Claude session.
  async function createConversation() {
    if (window.workbench) {
      const items = await window.workbench.createConversation();
      setConversations(items);
      setActiveId(items[0]?.id ?? "");
      setDraft("");
      setComposerFiles([]);
      return;
    }

    const next: Conversation = {
      id: makeId("session"),
      claudeSessionId: makeId("claude"),
      title: "新会话",
      updatedAt: "刚刚",
      directory: "~",
      status: "local",
      pinned: false,
      attachments: [],
      messages: [],
      engine: "claude",
      sandbox: "default"
    };
    setConversations((current) => [next, ...current]);
    setActiveId(next.id);
    setDraft("");
    setComposerFiles([]);
  }

  // Launched from the Finder toolbar (or folder dropped on the app): open a fresh
  // session whose terminal starts in that folder.
  async function openConversationInDirectory(directory: string) {
    if (!window.workbench) return;
    const items = await window.workbench.createConversation(directory);
    setConversations(items);
    setActiveId(items[0]?.id ?? "");
    setDraft("");
    setComposerFiles([]);
  }

  async function deleteConversation(id: string) {
    const target = conversations.find((conversation) => conversation.id === id);
    if (!target) return;

    if (window.workbench) {
      const remaining = await window.workbench.deleteConversation(id);
      setConversations(remaining);
      if (activeId === id) {
        setActiveId(remaining[0]?.id ?? "");
        setDraft("");
        setComposerFiles([]);
      }
      showToast(`已删除「${target.title}」和本地记录`);
      return;
    }

    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (activeId === id) {
      setActiveId(remaining[0]?.id ?? "");
      setDraft("");
      setComposerFiles([]);
    }
    showToast(`已删除「${target.title}」和本地记录`);
  }

  function togglePin(id: string) {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    updateConversation(id, (item) => ({ ...item, pinned: !item.pinned }));
    void persistConversation(id, { pinned: !conversation.pinned });
  }

  function beginRename(conversation: Conversation) {
    setEditingId(conversation.id);
    setRenameValue(conversation.title);
  }

  function finishRename(id: string) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      updateConversation(id, (conversation) => ({ ...conversation, title: trimmed }));
      void persistConversation(id, { title: trimmed });
    }
    setEditingId(null);
    setRenameValue("");
  }

  async function pickFiles() {
    if (window.workbench?.pickFiles && activeConversation) {
      const picked = await window.workbench.pickFiles(activeConversation.id);
      addAttachments(picked);
      return;
    }

    fileInputRef.current?.click();
  }

  function addAttachments(files: Attachment[]) {
    if (files.length === 0) return;
    setComposerFiles((current) => {
      const existing = new Set(current.map((file) => file.path));
      return [...current, ...files.filter((file) => !existing.has(file.path))];
    });
  }

  function handleBrowserFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []).map((file) => ({
      id: makeId("att"),
      name: file.name,
      path: `local://${file.name}`,
      size: formatFileSize(file.size)
    }));
    addAttachments(selected);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    const dropped = Array.from(event.dataTransfer.files);
    const filePaths = dropped
      .map((file) => (file as File & { path?: string }).path)
      .filter((filePath): filePath is string => Boolean(filePath));

    if (window.workbench?.copyFiles && activeConversation && filePaths.length > 0) {
      void window.workbench.copyFiles(activeConversation.id, filePaths).then(addAttachments);
      return;
    }

    const files = dropped.map((file) => ({
      id: makeId("att"),
      name: file.name,
      path: "path" in file ? String((file as File & { path?: string }).path ?? `local://${file.name}`) : `local://${file.name}`,
      size: formatFileSize(file.size)
    }));
    addAttachments(files);
  }

  async function sendMessage() {
    const body = draft.trim();
    if ((!body && composerFiles.length === 0) || !activeConversation || sending) return;

    if (window.workbench?.sendToEngine || window.workbench?.sendToClaude) {
      const files = composerFiles;
      const previousDraft = draft;
      setDraft("");
      setComposerFiles([]);
      if (textAreaRef.current) textAreaRef.current.style.height = "110px";
      setSending(true);
      const payload = {
        conversationId: activeConversation.id,
        prompt: body || "请查看这些附件。",
        attachments: files
      };
      // Route to the right channel based on the conversation's engine. Claude
      // keeps its existing dedicated channel; Codex / OpenCode go through the
      // generic engine channel.
      const engine = activeConversation.engine || "claude";
      const sender =
        engine === "claude"
          ? window.workbench.sendToClaude
          : window.workbench.sendToEngine || window.workbench.sendToClaude;
      try {
        const result = await sender(payload);
        if (!result.ok) throw new Error(result.error || `${engineLabel(engine)} 没有接受这次任务。`);
      } catch (error) {
        setDraft(previousDraft);
        setComposerFiles(files);
        showToast(error instanceof Error ? error.message : "发送失败，请重新试一次。");
      } finally {
        setSending(false);
      }
      return;
    }

    const fileLines = composerFiles.map((file) => `- ${file.path}`).join("\n");
    const userBody = [body, fileLines ? `\n附件路径：\n${fileLines}` : ""].filter(Boolean).join("\n");
    const assistantBody = composerFiles.length
      ? "我会把这些附件路径一起传给 Claude Code，并把关键输出整理回当前会话。"
      : "已收到。我会把这条任务发送给 Claude Code，并在这里保留整理后的关键结果。";

    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      updatedAt: "刚刚",
      status: "processing",
      attachments: [...conversation.attachments, ...composerFiles],
      messages: [
        ...conversation.messages,
        {
          id: makeId("msg"),
          role: "user",
          body: userBody,
          meta: "你 · 刚刚"
        },
        {
          id: makeId("msg"),
          role: "assistant",
          body: assistantBody,
          meta: "Claude Code · 处理中",
          output: "queued task\nattached paths forwarded\nwaiting for local runner"
        }
      ]
    }));

    setDraft("");
    setComposerFiles([]);
    if (textAreaRef.current) textAreaRef.current.style.height = "110px";
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  }

  function resizeComposer() {
    const element = textAreaRef.current;
    if (!element) return;
    element.style.height = "110px";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 110), 276)}px`;
  }

  function jumpToPreviousUserMessage() {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const userMessages = Array.from(scroll.querySelectorAll<HTMLElement>(".message-user"));
    if (userMessages.length === 0) return;

    const currentTop = scroll.scrollTop;
    const target =
      [...userMessages].reverse().find((message) => message.offsetTop < currentTop - 12) ?? userMessages[0];

    scroll.scrollTo({
      top: Math.max(0, target.offsetTop - 20),
      behavior: "smooth"
    });
  }

  function selectMessageContentAt(x: number, y: number) {
    const target = document.elementFromPoint(x, y);
    const message = target?.closest(".message-content");
    if (!message) return;

    const contentNodes = Array.from(message.querySelectorAll(".message-body, pre")).filter((node) =>
      node.textContent?.trim()
    );
    if (contentNodes.length === 0) return;

    const range = document.createRange();
    range.setStartBefore(contentNodes[0]);
    range.setEndAfter(contentNodes[contentNodes.length - 1]);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function copyMessageContentAt(x: number, y: number) {
    const target = document.elementFromPoint(x, y);
    const message = target?.closest(".message-content");
    if (!message) return;

    const contentNodes = Array.from(message.querySelectorAll(".message-body, pre")).filter((node) =>
      node.textContent?.trim()
    );
    if (contentNodes.length === 0) return;

    const text = contentNodes.map((node) => node.textContent ?? "").join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: select the text so the user can Ctrl+C
      const range = document.createRange();
      range.setStartBefore(contentNodes[0]);
      range.setEndAfter(contentNodes[contentNodes.length - 1]);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  async function answerPermission(request: ClaudePermissionEvent, choice: ClaudePermissionChoice) {
    if (!window.workbench?.answerClaudePermission) return;
    const result = await window.workbench.answerClaudePermission({
      conversationId: request.conversationId,
      input: choice.input
    });

    if (!result.ok) {
      showToast(result.error || "没有成功提交权限选择。");
      return;
    }

    setPermissionRequests((current) => {
      const next = { ...current };
      delete next[request.messageId];
      return next;
    });
  }

  async function pickChatBackgroundImage() {
    if (!window.workbench?.pickBackgroundImage) return;
    const picked = await window.workbench.pickBackgroundImage();
    if (!picked) return;
    setAppearance((current) => ({
      ...current,
      chatImagePath: picked.path,
      chatImageUrl: picked.url,
      chatVideoPath: "",
      chatVideoUrl: ""
    }));
  }

  function removeChatBackgroundImage() {
    setAppearance((current) => ({
      ...current,
      chatImagePath: "",
      chatImageUrl: ""
    }));
  }

  async function pickChatBackgroundVideo() {
    if (!window.workbench?.pickBackgroundVideo) return;
    const picked = await window.workbench.pickBackgroundVideo();
    if (!picked) return;
    setAppearance((current) => ({
      ...current,
      chatImagePath: "",
      chatImageUrl: "",
      chatVideoPath: picked.path,
      chatVideoUrl: picked.url
    }));
  }

  function removeChatBackgroundVideo() {
    setAppearance((current) => ({
      ...current,
      chatVideoPath: "",
      chatVideoUrl: ""
    }));
  }

  return (
    <main
      className={`app-shell ${appView === "settings" ? "settings-view" : ""} ${dragging ? "is-dragging" : ""} ${
        inspectorCollapsed ? "inspector-collapsed" : ""
      }`}
      style={appStyle}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <div className="top-window-drag" aria-hidden="true" />
      <aside className="sidebar" aria-label={appView === "settings" ? "设置目录" : "会话列表"}>
        <div className="sidebar-media" aria-hidden="true">
          {appearance.chatVideoUrl ? (
            <video className="sidebar-media-video" src={appearance.chatVideoUrl} autoPlay muted loop playsInline />
          ) : null}
          <div className="sidebar-media-overlay" />
        </div>
        <div className="window-drag" />
        {appView === "settings" ? (
          <>
            <button className="settings-back" type="button" onClick={() => setAppView("chat")}>
              <ArrowLeft aria-hidden="true" />
              返回应用
            </button>
            <label className="search-field">
              <Search aria-hidden="true" />
              <span className="sr-only">搜索设置</span>
              <input placeholder="搜索设置..." />
            </label>
            <nav className="settings-nav" aria-label="设置分类">
              <p>个人</p>
              <button
                className={`settings-nav-item ${settingsSection === "background" ? "is-active" : ""}`}
                type="button"
                onClick={() => setSettingsSection("background")}
              >
                <ImageIcon aria-hidden="true" />
                背景
              </button>
              <button
                className={`settings-nav-item ${settingsSection === "loading" ? "is-active" : ""}`}
                type="button"
                onClick={() => setSettingsSection("loading")}
              >
                <LoaderCircle aria-hidden="true" />
                Loading
              </button>
            </nav>
          </>
        ) : (
          <>
            <header className="sidebar-header">
              <div className="brand-lockup">
                <img className="brand-mark" src={clawdWizard} alt="Clawd Station" />
                <span className="brand-name">Clawd Station</span>
              </div>
              <button className="icon-button primary" type="button" onClick={openNewConversationModal} aria-label="新建对话">
                <Plus aria-hidden="true" />
              </button>
            </header>

            <label className="search-field">
              <Search aria-hidden="true" />
              <span className="sr-only">搜索对话</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对话或目录" />
            </label>

            <div className="session-list" role="list">
              {filteredConversations.length === 0 ? (
                <div className="sidebar-empty">
                  <Search aria-hidden="true" />
                  <p>没有匹配的本地会话</p>
                </div>
              ) : (
                filteredConversations.map((conversation) => (
                  <article
                    className={`session-item ${conversation.id === activeId ? "is-active" : ""}`}
                    key={conversation.id}
                    role="listitem"
                  >
                    <button className="session-main" type="button" onClick={() => setActiveId(conversation.id)}>
                      <span className="session-title-row">
                        {conversation.pinned ? <Pin className="pin-mark" aria-label="已置顶" /> : null}
                        <span className="session-engine-badge">
                          <EngineBadge engine={conversation.engine} />
                        </span>
                        {editingId === conversation.id ? (
                          <input
                            className="rename-input"
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onBlur={() => finishRename(conversation.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") finishRename(conversation.id);
                              if (event.key === "Escape") setEditingId(null);
                            }}
                            autoFocus
                            onClick={(event) => event.stopPropagation()}
                          />
                        ) : (
                          <strong>{conversation.title}</strong>
                        )}
                      </span>
                      <span className="session-meta">
                        <Clock3 aria-hidden="true" />
                        {conversation.updatedAt}
                      </span>
                    </button>
                    <div className="session-actions" aria-label={`${conversation.title} 操作`}>
                      <button
                        type="button"
                        onClick={() => togglePin(conversation.id)}
                        aria-label={conversation.pinned ? "取消置顶" : "置顶"}
                      >
                        {conversation.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                      </button>
                      <button type="button" onClick={() => beginRename(conversation)} aria-label="重命名">
                        <PencilLine aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => deleteConversation(conversation.id)} aria-label="删除对话和本地记录">
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="sidebar-footer">
              <button className="settings-trigger" type="button" onClick={() => setAppView("settings")} aria-label="打开设置">
                <Settings aria-hidden="true" />
                <span>设置</span>
              </button>
            </div>
          </>
        )}
      </aside>

      <section className="workspace" aria-label={appView === "settings" ? "设置" : "当前会话"}>
        {appView === "settings" ? (
          <div className="settings-page">
            <div className="settings-content">
              <header className="settings-page-header">
                <h2>{settingsSection === "background" ? "背景" : "Loading"}</h2>
                <p>
                  {settingsSection === "background"
                    ? "调整对话文本大框的背景颜色、图片和透明度。"
                    : "选择 Claude Code 处理任务时，小 logo 位置显示的 loading 动画。"}
                </p>
              </header>
              {settingsSection === "background" ? (
                <section className="settings-card" aria-label="背景设置">
                  <label className="setting-row">
                    <span>对话框背景</span>
                    <span className="color-control">
                      <button
                        className="color-swatch"
                        type="button"
                        style={{ background: appearance.chatBackground }}
                        onClick={() => colorInputRef.current?.click()}
                        aria-label="选择对话框背景色"
                      />
                      <input
                        ref={colorInputRef}
                        type="color"
                        value={appearance.chatBackground}
                        onChange={(event) =>
                          setAppearance((current) => ({
                            ...current,
                            chatBackground: event.target.value
                          }))
                        }
                        aria-label="选择对话框背景色"
                      />
                    </span>
                  </label>
                  <div className="setting-row">
                    <span>背景图片</span>
                    <div className="image-control">
                      {appearance.chatImageUrl ? (
                        <span
                          className="image-preview"
                          style={{ backgroundImage: `url("${appearance.chatImageUrl}")` }}
                          aria-hidden="true"
                        />
                      ) : (
                        <span className="image-preview is-empty" aria-hidden="true" />
                      )}
                      <div>
                        <button className="settings-action" type="button" onClick={pickChatBackgroundImage}>
                          选择图片
                        </button>
                        {appearance.chatImageUrl ? (
                          <button className="settings-action subtle" type="button" onClick={removeChatBackgroundImage}>
                            移除图片
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="setting-row">
                    <span>背景视频</span>
                    <div className="image-control">
                      {appearance.chatVideoUrl ? (
                        <span className="video-preview" aria-hidden="true">
                          <video src={appearance.chatVideoUrl} muted loop playsInline />
                        </span>
                      ) : (
                        <span className="video-preview is-empty" aria-hidden="true" />
                      )}
                      <div>
                        <button className="settings-action" type="button" onClick={pickChatBackgroundVideo}>
                          选择视频
                        </button>
                        {appearance.chatVideoUrl ? (
                          <button className="settings-action subtle" type="button" onClick={removeChatBackgroundVideo}>
                            移除视频
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <label className="setting-slider">
                    <span>{appearance.chatVideoUrl ? "视频透明度" : appearance.chatImageUrl ? "图片透明度" : "背景透明度"}</span>
                    <span className="compact-slider-control">
                      <input
                        type="range"
                        min="20"
                        max="100"
                        step="1"
                        value={appearance.chatOpacity}
                        style={{ "--slider-progress": `${appearance.chatOpacity}%` } as CSSProperties}
                        onChange={(event) =>
                          setAppearance((current) => ({
                            ...current,
                            chatOpacity: Number(event.target.value)
                          }))
                        }
                      />
                      <strong>{appearance.chatOpacity}%</strong>
                    </span>
                  </label>
                  <button className="reset-appearance" type="button" onClick={() => setAppearance(defaultAppearance)}>
                    <RotateCcw aria-hidden="true" />
                    重置背景
                  </button>
                </section>
              ) : (
                <section className="settings-card" aria-label="Loading 设置">
                  <div className="loading-options" role="radiogroup" aria-label="选择 loading 动画">
                    {loadingOptions.map((option) => (
                      <button
                        className={`loading-option ${appearance.loadingVariant === option.id ? "is-active" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={appearance.loadingVariant === option.id}
                        key={option.id}
                        onClick={() =>
                          setAppearance((current) => ({
                            ...current,
                            loadingVariant: option.id
                          }))
                        }
                      >
                        <span className={`loading-mark loading-${option.id}`} aria-hidden="true">
                          <span />
                        </span>
                        <strong>{option.label}</strong>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        ) : (
          <>
            <header className="topbar">
              <div className="topbar-title">
                <div>
                  <h2>
                    {activeConversation?.title ?? "没有会话"}
                    {activeConversation ? (
                      <span className="workspace-engine-strip" title={`引擎: ${engineLabel(activeConversation.engine)} · 权限: ${activeConversation.sandbox || "default"}`}>
                        <EngineBadge engine={activeConversation.engine} size="md" />
                        <span>{engineLabel(activeConversation.engine)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{activeConversation.sandbox || "default"}</span>
                      </span>
                    ) : null}
                  </h2>
                  <p>
                    <FolderOpen aria-hidden="true" />
                    {activeConversation?.directory ?? "未选择目录"}
                  </p>
                </div>
              </div>
              <div className="topbar-actions">
                {activeConversation ? (
                  <div className={`status-pill status-${activeConversation.status}`} aria-live="polite">
                    {statusIcon[activeConversation.status]}
                    {statusText[activeConversation.status]}
                  </div>
                ) : null}
                {inspectorCollapsed ? (
                  <button
                    className="ghost-button compact topbar-inspector-toggle"
                    type="button"
                    onClick={() => setInspectorCollapsed(false)}
                    aria-label="展开本地会话信息"
                    title="展开"
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </header>

            <div className="conversation-shell terminal-shell">
              <TerminalDeck
                activeId={activeConversation?.id ?? ""}
                sessions={sortedConversations.map((conversation) => ({
                  id: conversation.id,
                  cwd: conversation.directory || "~"
                }))}
              />
              <input ref={fileInputRef} className="hidden-input" type="file" multiple onChange={handleBrowserFiles} />
            </div>
          </>
        )}
      </section>

      <aside className="inspector" aria-label="本地会话信息" aria-expanded={!inspectorCollapsed}>
        <header>
          <p className="eyebrow">Local session</p>
          <button
            className="ghost-button compact inspector-toggle"
            type="button"
            onClick={() => setInspectorCollapsed((value) => !value)}
            aria-label={inspectorCollapsed ? "展开本地会话信息" : "收起本地会话信息"}
            title={inspectorCollapsed ? "展开" : "收起"}
          >
            {inspectorCollapsed ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        </header>
        <div className="inspector-body" aria-hidden={inspectorCollapsed}>
          <section>
            <h3>发送预览</h3>
            <div className="path-preview">
              <ChevronDown aria-hidden="true" />
              <span>{activeConversation?.directory ?? "~"}</span>
            </div>
            <p className="muted">发送时会附带当前工作目录和待发送附件路径。</p>
          </section>
          <section>
            <h3>会话状态</h3>
            <ul className="status-list">
              <li>
                <span>本地 transcript</span>
                <strong>{activeConversation?.messages.length ?? 0} 条</strong>
              </li>
              <li>
                <span>附件记录</span>
                <strong>{activeConversation?.attachments.length ?? 0} 个</strong>
              </li>
              <li>
                <span>置顶</span>
                <strong>{activeConversation?.pinned ? "是" : "否"}</strong>
              </li>
            </ul>
          </section>
          <section>
            <h3>终端 Claude Code</h3>
            <p className="muted">{appInfo?.claudeCommand ?? "浏览器预览模式"}</p>
          </section>
        </div>
      </aside>

      {dragging ? (
        <div className="drop-overlay" aria-hidden="true">
          <div>
            <FilePlus2 />
            <strong>松开以添加到当前会话</strong>
            <span>文件会进入附件队列，发送时带上本地路径</span>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
      {showNewConversationModal && engines.length > 0 ? (
        <NewConversationModal
          engines={engines}
          onConfirm={(engine, sandbox) => void confirmNewConversation(engine, sandbox)}
          onCancel={() => setShowNewConversationModal(false)}
        />
      ) : null}
    </main>
  );
}

function PermissionCard({
  request,
  onChoose
}: {
  request: ClaudePermissionEvent;
  onChoose: (request: ClaudePermissionEvent, choice: ClaudePermissionChoice) => void;
}) {
  return (
    <div className="permission-card" role="group" aria-label="Claude Code 权限确认">
      <div>
        <strong>Claude Code 需要你确认</strong>
        <p>{request.prompt}</p>
      </div>
      <div className="permission-actions">
        {request.choices.map((choice) => (
          <button
            className={`permission-button permission-${choice.action}`}
            key={choice.action}
            type="button"
            onClick={() => onChoose(request, choice)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyConversation({ onPickFiles }: { onPickFiles: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-mark">
        <img src={clawdWizard} alt="" aria-hidden="true" />
      </div>
      <h2>开始一个干净的 Claude Code 会话</h2>
      <p>输入任务、拖入文件，或先添加附件。这里会保留整理后的双方对话和关键输出，不让完整终端噪音淹没工作。</p>
      <div className="empty-actions">
        <button className="soft-button" type="button" onClick={onPickFiles}>
          <FilePlus2 aria-hidden="true" />
          添加文件
        </button>
        <span>也可以直接把文件拖进窗口</span>
      </div>
    </div>
  );
}
