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

type AppView = "chat" | "settings";
type SettingsSection = "background" | "loading" | "behavior" | "about" | "record";

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
  const [appView, setAppView] = useState<AppView>("chat");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("background");
  // Appearance starts from a local default, then gets hydrated from
  // main-process settings on first mount. Subsequent changes are
  // persisted to local-records/settings.json via the setSettings IPC.
  const [appearance, setAppearance] = useState(loadAppearance);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [closeBehavior, setCloseBehavior] = useState<"quit" | "tray">("quit");
  // Auto-updater state — shown in settings and as toast
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "available" | "downloading" | "downloaded" | "error">("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdaterEvent | null>(null);
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

  // Render a working-directory label for the workspace header. The
  // home directory itself is hidden behind a generic "工作目录" chip
  // since the full path is noisy; any other directory shows its
  // basename so the active project is recognizable.
  function formatWorkingDirectory(directory: string | undefined): string {
    if (!directory) return "工作目录";
    const normalized = directory.replace(/[\\/]+$/, "");
    if (!normalized) return "工作目录";
    if (appInfo && normalized === appInfo.homeDir) return "工作目录";
    const segments = normalized.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || normalized;
  }
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

  // Persist appearance to main-process settings.json once we've finished
  // hydrating from disk. Avoids re-writing the file on the initial
  // hydration tick.
  useEffect(() => {
    if (!settingsHydrated) return;
    if (!window.workbench?.setSettings) return;
    void window.workbench.setSettings({ appearance });
  }, [appearance, settingsHydrated]);

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

    window.workbench.getSettings().then((settings) => {
      if (!mounted) return;
      if (settings.closeBehavior === "tray" || settings.closeBehavior === "quit") {
        setCloseBehavior(settings.closeBehavior);
      }
      // Hydrate appearance from disk (overrides the local default if the
      // user has previously changed anything). Mark hydrated so the local-
      // storage sync useEffect below knows it's safe to start persisting.
      if (settings.appearance && typeof settings.appearance === "object") {
        setAppearance((current) => ({ ...current, ...settings.appearance }));
      }
      setSettingsHydrated(true);
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
    };

    const offPermission = window.workbench.onClaudePermission(() => {
      // (No PermissionCard surface yet — events are accepted but ignored.
      //  When the permission UI is reintroduced, render the request here.)
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
      ? window.workbench.onEnginePermission(() => {
          // (No surface yet — see Claude permission handler above.)
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

    // --- Auto-updater listeners (displayed in settings + toast) ---

    const offUpdaterChecking = window.workbench.onUpdaterChecking
      ? window.workbench.onUpdaterChecking(() => setUpdateState("checking"))
      : () => {};

    const offUpdaterAvailable = window.workbench.onUpdaterAvailable
      ? window.workbench.onUpdaterAvailable((event) => {
          setUpdateState("downloading");
          setUpdateInfo(event);
        })
      : () => {};

    const offUpdaterProgress = window.workbench.onUpdaterProgress
      ? window.workbench.onUpdaterProgress((event) => {
          setUpdateState("downloading");
          setUpdateInfo(event);
        })
      : () => {};

    const offUpdaterDownloaded = window.workbench.onUpdaterDownloaded
      ? window.workbench.onUpdaterDownloaded((event) => {
          setUpdateState("downloaded");
          setUpdateInfo(event);
          showToast(`新版 v${event.version || ""} 已就绪，重启生效`);
        })
      : () => {};

    const offUpdaterNotAvailable = window.workbench.onUpdaterNotAvailable
      ? window.workbench.onUpdaterNotAvailable(() => setUpdateState("idle"))
      : () => {};

    const offUpdaterError = window.workbench.onUpdaterError
      ? window.workbench.onUpdaterError((event) => {
          setUpdateState("error");
          setUpdateInfo(event);
        })
      : () => {};

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
      offUpdaterChecking();
      offUpdaterAvailable();
      offUpdaterProgress();
      offUpdaterDownloaded();
      offUpdaterNotAvailable();
      offUpdaterError();
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

  async function confirmNewConversation(engine: Engine, sandbox: Sandbox, directory: string) {
    setShowNewConversationModal(false);
    if (window.workbench) {
      const items = await window.workbench.createConversation({
        engine,
        sandbox,
        directory: directory || undefined
      });
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
      directory: directory || "~",
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

  async function changeConversationDirectory(id: string) {
    if (!window.workbench?.pickDirectory) return;
    const next = await window.workbench.pickDirectory();
    if (!next) return;
    await window.workbench.updateConversation(id, { directory: next });
    showToast("工作目录已更新；当前 PTY 仍跑在旧目录，新建会话会使用新目录");
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
      className={`app-shell ${appView === "settings" ? "settings-view" : ""} ${dragging ? "is-dragging" : ""}`}
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
              <button
                className={`settings-nav-item ${settingsSection === "behavior" ? "is-active" : ""}`}
                type="button"
                onClick={() => setSettingsSection("behavior")}
              >
                <Settings aria-hidden="true" />
                行为
              </button>
              <button
                className={`settings-nav-item ${settingsSection === "about" ? "is-active" : ""}`}
                type="button"
                onClick={() => setSettingsSection("about")}
              >
                <CheckCircle2 aria-hidden="true" />
                关于
              </button>
              <button
                className={`settings-nav-item ${settingsSection === "record" ? "is-active" : ""}`}
                type="button"
                onClick={() => setSettingsSection("record")}
              >
                <Archive aria-hidden="true" />
                本地记录
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

      {/* Persistent X close button — top-right of the whole window.
          Renders outside the sidebar so it floats over the entire app,
          matching the OS window close button position. */}
      <button
        className="icon-button window-close"
        type="button"
        onClick={() => {
          window.workbench?.closeWindow?.();
        }}
        aria-label={closeBehavior === "tray" ? "隐藏到托盘" : "关闭应用"}
        title={closeBehavior === "tray" ? "隐藏到托盘" : "关闭应用"}
      >
        <X aria-hidden="true" />
      </button>

      <section className="workspace" aria-label={appView === "settings" ? "设置" : "当前会话"}>
        {/* Chat view stays mounted at all times — the settings panel overlays
            it. Keeping TerminalDeck (xterm + node-pty) mounted means the
            Codex / OpenCode / Claude Code sessions survive a settings visit
            instead of being torn down and re-spawned on every toggle. */}
        {appView === "chat" ? (
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
                  {activeConversation ? (
                    <button
                      className="directory-link"
                      type="button"
                      onClick={() => changeConversationDirectory(activeConversation.id)}
                      title={`当前工作目录：${activeConversation.directory ?? ""}\n点击修改`}
                    >
                      <span className="directory-link-name">
                        {formatWorkingDirectory(activeConversation.directory)}
                      </span>
                      <PencilLine aria-hidden="true" className="directory-link-edit" />
                    </button>
                  ) : (
                    <span className="directory-link-muted">工作目录</span>
                  )}
                </p>
              </div>
            </div>
            <div className="topbar-actions" />
          </header>
        ) : null}

        <div className="conversation-shell terminal-shell">
          <TerminalDeck
            activeId={activeConversation?.id ?? ""}
            sessions={sortedConversations.map((conversation) => ({
              id: conversation.id,
              cwd: conversation.directory || "~",
              engine: conversation.engine
            }))}
          />
          <input ref={fileInputRef} className="hidden-input" type="file" multiple onChange={handleBrowserFiles} />
        </div>

        {/* Settings overlay — sits above the (always-mounted) terminal shell.
            Keeps xterm + node-pty alive across settings visits. */}
        {appView === "settings" ? (
          <div className="settings-page">
            <div className="settings-content">
              <header className="settings-page-header">
                <button
                  className="settings-back-btn"
                  type="button"
                  onClick={() => setAppView("chat")}
                  aria-label="返回聊天"
                >
                  <ArrowLeft aria-hidden="true" />
                  返回
                </button>
                <h2>
                  {settingsSection === "background"
                    ? "背景"
                    : settingsSection === "loading"
                      ? "Loading"
                      : settingsSection === "behavior"
                        ? "行为"
                        : settingsSection === "about"
                          ? "关于"
                          : "本地记录"}
                </h2>
                <p>
                  {settingsSection === "background"
                    ? "调整对话文本大框的背景颜色、图片和透明度。"
                    : settingsSection === "loading"
                      ? "选择 Claude Code 处理任务时，小 logo 位置显示的 loading 动画。"
                      : settingsSection === "behavior"
                        ? "配置点击关闭按钮时的行为。"
                        : settingsSection === "about"
                          ? "版本信息和更新检查。"
                          : "当前会话的本地状态和元数据。"}
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
              ) : settingsSection === "loading" ? (
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
              ) : settingsSection === "behavior" ? (
                <section className="settings-card" aria-label="行为设置">
                  <div className="setting-row">
                    <span>关闭按钮</span>
                    <div className="behavior-options" role="radiogroup" aria-label="关闭按钮行为">
                      <button
                        className={`loading-option ${closeBehavior === "quit" ? "is-active" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={closeBehavior === "quit"}
                        onClick={() => {
                          setCloseBehavior("quit");
                          void window.workbench?.setCloseBehavior?.("quit");
                        }}
                      >
                        <strong>彻底退出</strong>
                        <span>点 ✕ 直接关掉应用</span>
                      </button>
                      <button
                        className={`loading-option ${closeBehavior === "tray" ? "is-active" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={closeBehavior === "tray"}
                        onClick={() => {
                          setCloseBehavior("tray");
                          void window.workbench?.setCloseBehavior?.("tray");
                        }}
                      >
                        <strong>收起到系统托盘</strong>
                        <span>点 ✕ 隐藏窗口，托盘图标保留</span>
                      </button>
                    </div>
                  </div>
                </section>
              ) : settingsSection === "about" ? (
                <section className="settings-card" aria-label="版本与更新">
                  <div className="setting-row">
                    <span>版本</span>
                    <span className="version-label">
                      {appInfo?.version || "—"}
                      {updateState === "downloaded" ? (
                        <button
                          className="button-primary compact"
                          type="button"
                          onClick={() => window.workbench?.quitAndInstall?.()}
                        >
                          重启更新
                        </button>
                      ) : (
                        <button
                          className="button-secondary"
                          type="button"
                          onClick={() => {
                            setUpdateState("checking");
                            window.workbench?.checkForUpdates?.();
                          }}
                          disabled={updateState === "checking" || updateState === "downloading"}
                        >
                          {updateState === "checking" || updateState === "downloading"
                            ? "检查中…"
                            : "检查更新"}
                        </button>
                      )}
                    </span>
                  </div>
                  {updateState === "downloading" && updateInfo?.percent != null ? (
                    <div className="setting-row">
                      <span>下载进度</span>
                      <span>{Math.round(updateInfo.percent)}%</span>
                    </div>
                  ) : null}
                  {updateState === "error" && updateInfo?.message ? (
                    <div className="setting-row">
                      <span>更新出错</span>
                      <span className="version-error">{updateInfo.message}</span>
                    </div>
                  ) : null}
                </section>
              ) : settingsSection === "record" ? (
                <>
                  <section className="settings-card" aria-label="发送预览">
                    <div className="setting-row">
                      <span>工作目录</span>
                      <span>{activeConversation?.directory ?? "~"}</span>
                    </div>
                    <p className="muted">发送时会附带当前工作目录和待发送附件路径。</p>
                  </section>
                  <section className="settings-card" aria-label="会话状态">
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
                  <section className="settings-card" aria-label="终端 Claude Code">
                    <div className="setting-row">
                      <span>CLI 路径</span>
                      <span>{appInfo?.claudeCommand ?? "浏览器预览模式"}</span>
                    </div>
                  </section>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

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
          homeDir={appInfo?.homeDir}
          onConfirm={(engine, sandbox, directory) =>
            void confirmNewConversation(engine, sandbox, directory)
          }
          onCancel={() => setShowNewConversationModal(false)}
        />
      ) : null}
    </main>
  );
}
