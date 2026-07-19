import {
  CheckCircle2,
  FolderOpen,
  Info,
  Minus,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Square,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clawdWizard from "./assets/clawd-wizard.png";
import { TerminalDeck } from "./TerminalPane";
import { EngineBadge, engineLabel } from "./components/EngineBadge";
import { NewConversationModal } from "./components/NewConversationModal";
import { DEFAULT_THEME_ID, THEMES, getTheme } from "./themes";

type Conversation = WorkbenchConversation;
type Engine = WorkbenchEngine;
type Sandbox = WorkbenchSandbox;

type MotionLevel = "swift" | "balanced" | "steady";

const defaultAppearance: { theme: string; motion: MotionLevel } = {
  theme: DEFAULT_THEME_ID,
  motion: "balanced"
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
type SettingsSection = "theme" | "behavior" | "about";

// Motion packs — the UI tempo is a behavior setting, independent of the
// theme. The active pack is injected onto :root after the theme vars (themes
// no longer carry --t-*/--ease), so switching levels retimes every
// var()-driven transition in place, with no reload.
const MOTION_PACKS: Record<MotionLevel, Record<string, string>> = {
  swift: { "--t-fast": "100ms", "--t-med": "200ms", "--t-slow": "360ms", "--ease": "cubic-bezier(0.22, 0.68, 0.35, 1)" },
  balanced: { "--t-fast": "160ms", "--t-med": "340ms", "--t-slow": "600ms", "--ease": "cubic-bezier(0.22, 0.68, 0.35, 1)" },
  steady: { "--t-fast": "240ms", "--t-med": "460ms", "--t-slow": "800ms", "--ease": "cubic-bezier(0.42, 0, 0.2, 1)" }
};

const MOTION_OPTIONS: { id: MotionLevel; label: string; hint: string }[] = [
  { id: "swift", label: "敏捷", hint: "100 / 200 / 360ms" },
  { id: "balanced", label: "标准", hint: "160 / 340 / 600ms" },
  { id: "steady", label: "沉稳", hint: "240 / 460 / 800ms" }
];

// Mirrors electron/engines.cjs (ENGINES + SANDBOX_OPTIONS). Used only when the
// engines:list IPC fails, so the new-conversation button never goes dead.
const FALLBACK_ENGINES: EngineInfo[] = [
  {
    key: "claude",
    name: "Claude Code",
    abbr: "C",
    defaultSandbox: "default",
    sandboxOptions: [
      { value: "default", label: "默认（每次确认）" },
      { value: "acceptEdits", label: "自动接受编辑" },
      { value: "bypassPermissions", label: "全部放行（危险）" }
    ]
  },
  {
    key: "codex",
    name: "Codex CLI",
    abbr: "X",
    defaultSandbox: "workspace-write",
    sandboxOptions: [
      { value: "read-only", label: "只读" },
      { value: "workspace-write", label: "工作区可写" },
      { value: "danger-full-access", label: "完全访问（危险）" }
    ]
  },
  {
    key: "kimi",
    name: "Kimi CLI",
    abbr: "K",
    defaultSandbox: "default",
    sandboxOptions: [
      { value: "default", label: "默认（每次确认）" },
      { value: "acceptEdits", label: "自动接受编辑" },
      { value: "bypassPermissions", label: "全部放行（危险）" }
    ]
  },
  {
    key: "opencode",
    name: "OpenCode",
    abbr: "O",
    defaultSandbox: "ask",
    sandboxOptions: [
      { value: "ask", label: "每次询问" },
      { value: "auto", label: "自动批准" }
    ]
  }
];

function loadAppearance() {
  try {
    const stored = window.localStorage.getItem("claude-workbench-appearance");
    if (!stored) return defaultAppearance;
    const parsed = JSON.parse(stored) as Partial<typeof defaultAppearance>;
    return {
      theme:
        typeof parsed.theme === "string" && THEMES.some((theme) => theme.id === parsed.theme)
          ? parsed.theme
          : defaultAppearance.theme,
      motion:
        parsed.motion === "swift" || parsed.motion === "balanced" || parsed.motion === "steady"
          ? parsed.motion
          : defaultAppearance.motion
    };
  } catch {
    return defaultAppearance;
  }
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// A freshly created conversation belongs at the TOP of the session list. The
// main process already returns it first; this makes the ordering explicit on
// the renderer side so the list never depends on IPC payload order. The pin
// sort runs on top of this and stays untouched.
function withCreatedFirst(items: Conversation[], previous: Conversation[]): Conversation[] {
  const known = new Set(previous.map((conversation) => conversation.id));
  const fresh = items.filter((item) => !known.has(item.id));
  if (fresh.length === 0) return items;
  return [...fresh, ...items.filter((item) => known.has(item.id))];
}

// Rough sRGB luminance check — used to flip the native color-scheme (form
// controls, scrollbars) for themes with a light backdrop.
function isLightColor(color: string | undefined): boolean {
  if (!color) return false;
  const hex = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.5872 * g + 0.0722 * b > 0.6;
}

export function App() {
  // In the desktop app, real sessions load from storage — start empty so we don't spawn
  // a throwaway placeholder terminal. The seed is only for browser-preview mode.
  const hasWorkbench = typeof window !== "undefined" && Boolean(window.workbench);
  const [conversations, setConversations] = useState<Conversation[]>(hasWorkbench ? [] : initialConversations);
  const [activeId, setActiveId] = useState(hasWorkbench ? "" : initialConversations[0].id);
  const [appInfo, setAppInfo] = useState<WorkbenchInfo | null>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [appView, setAppView] = useState<AppView>("chat");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("theme");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Inline "关于此会话" expansion on a session card (id of the open card).
  const [aboutId, setAboutId] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  // Pre-toggle bounding boxes for the collapse/expand FLIP animation.
  const flipRectsRef = useRef<Map<string, DOMRect> | null>(null);
  // Appearance starts from a local default, then gets hydrated from
  // main-process settings on first mount. Subsequent changes are
  // persisted to local-records/settings.json via the setSettings IPC.
  const [appearance, setAppearance] = useState(loadAppearance);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [showOutputDirNotice, setShowOutputDirNotice] = useState(false);
  // CLI install detection — used only for the empty-stage hint when nothing
  // is installed. The modal runs its own (cached) check on open.
  const [engineDetect, setEngineDetect] = useState<EngineDetectResult | null>(null);
  const [closeBehavior, setCloseBehavior] = useState<"quit" | "tray">("quit");
  // Auto-updater state — shown in settings and as toast
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "available" | "downloading" | "downloaded" | "error">("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdaterEvent | null>(null);
  const toastTimerRef = useRef<number | null>(null);

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

  // Stable session descriptors for TerminalDeck — memoized so stream-unrelated
  // re-renders (search typing, hover, toast) don't churn the terminal tree.
  const terminalSessions = useMemo(
    () =>
      sortedConversations.map((conversation) => ({
        id: conversation.id,
        cwd: conversation.directory || "~",
        engine: conversation.engine,
        outputDir: conversation.outputDir || ""
      })),
    [sortedConversations]
  );

  // Collapse/expand toggle with FLIP: capture every marked button's box before
  // the layout flip, then useLayoutEffect slides each one from its old spot to
  // the new one (instead of the instant jump a flex-direction switch causes).
  function togglePanelCollapsed() {
    const root = sidebarRef.current;
    if (root) {
      const rects = new Map<string, DOMRect>();
      root.querySelectorAll<HTMLElement>("[data-flip]").forEach((element) => {
        rects.set(element.dataset.flip as string, element.getBoundingClientRect());
      });
      flipRectsRef.current = rects;
    }
    setPanelCollapsed((current) => !current);
  }

  useLayoutEffect(() => {
    const root = sidebarRef.current;
    const first = flipRectsRef.current;
    flipRectsRef.current = null;
    if (!root || !first) return;
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((element) => {
      const before = first.get(element.dataset.flip as string);
      if (!before) return;
      const after = element.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) return;
      element.style.transition = "none";
      element.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        // Synced with the shell grid's --t-slow track: the buttons slide for
        // exactly as long as the card takes to shrink/grow. The cleanup reads
        // the live --t-slow (steady pack = 800ms) plus a margin so no motion
        // level gets its slide cut mid-way.
        element.style.transition = "transform var(--t-slow) var(--ease)";
        element.style.transform = "";
        const slowMs = parseFloat(getComputedStyle(element).getPropertyValue("--t-slow"));
        window.setTimeout(() => {
          element.style.transition = "";
        }, (Number.isFinite(slowMs) ? slowMs : 800) + 150);
      });
    });
  }, [panelCollapsed]);

  // Clicking anywhere outside a card with an open "关于此会话" region closes it.
  useEffect(() => {
    if (!aboutId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-about-id="${aboutId}"]`)) return;
      setAboutId(null);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [aboutId]);

  // Theme switching gets a global cross-fade window: for ~850ms every element
  // eases its colors to the new tokens instead of snapping.
  const prevThemeRef = useRef(appearance.theme);
  useEffect(() => {
    if (prevThemeRef.current === appearance.theme) return;
    prevThemeRef.current = appearance.theme;
    const root = document.documentElement;
    root.classList.add("theme-fading");
    const timer = window.setTimeout(() => root.classList.remove("theme-fading"), 850);
    return () => {
      window.clearTimeout(timer);
      root.classList.remove("theme-fading");
    };
  }, [appearance.theme]);

  // Persist appearance to main-process settings.json once we've finished
  // hydrating from disk. Avoids re-writing the file on the initial
  // hydration tick. `appearance.theme` rides along in the same payload, so
  // no main-process change is needed; old settings.json files simply lack
  // the key and hydrate to the console default.
  useEffect(() => {
    if (!settingsHydrated) return;
    if (!window.workbench?.setSettings) return;
    void window.workbench.setSettings({ appearance });
  }, [appearance, settingsHydrated]);

  // Apply the active theme: push every token onto :root, swap the per-theme
  // override stylesheet, and stamp the id on <html data-theme>. xterm gets
  // its palette separately via TerminalDeck (options.theme hot-swap).
  useEffect(() => {
    const theme = getTheme(appearance.theme);
    const root = document.documentElement;
    for (const [name, value] of Object.entries(theme.vars)) {
      root.style.setProperty(name, value);
    }
    // xterm's viewport element keeps xterm.css's hard #000 behind the painted
    // cell grid — paint the terminal well with the theme's xterm background
    // so the padding ring and any unpainted cells match the grid exactly.
    root.style.setProperty("--term-bg", theme.xterm.background);
    root.dataset.theme = theme.id;
    root.style.colorScheme = isLightColor(theme.vars["--backdrop"]) ? "light" : "dark";
    let extra = document.getElementById("clawd-theme-extra");
    if (!extra) {
      extra = document.createElement("style");
      extra.id = "clawd-theme-extra";
      document.head.appendChild(extra);
    }
    extra.textContent = theme.extraCss;
  }, [appearance.theme]);

  // Motion level is a behavior setting, not a theme property: push the active
  // pack's tempo tokens onto :root. Declared after the theme effect so on a
  // same-tick theme change these values win the --t-*/--ease slots.
  useEffect(() => {
    const pack = MOTION_PACKS[appearance.motion] ?? MOTION_PACKS.balanced;
    const root = document.documentElement;
    for (const [name, value] of Object.entries(pack)) {
      root.style.setProperty(name, value);
    }
  }, [appearance.motion]);

  // Stable reference as long as the id is unchanged — getTheme returns the
  // registry object itself, so TerminalView memoization is unaffected.
  const activeTheme = getTheme(appearance.theme);

  // Load available engines from main process for the new-conversation modal.
  // Fall back to a local mirror of the engine registry so a failed IPC never
  // silently kills the new-conversation button.
  useEffect(() => {
    if (!window.workbench?.listEngines) {
      setEngines(FALLBACK_ENGINES);
      return;
    }
    void window.workbench
      .listEngines()
      .then((items) => setEngines(items && items.length > 0 ? items : FALLBACK_ENGINES))
      .catch(() => setEngines(FALLBACK_ENGINES));
  }, []);

  // One cheap cached detection pass at startup, only to decide whether the
  // empty stage should show the "no CLI installed yet" hint.
  useEffect(() => {
    if (!window.workbench?.detectEngines) return;
    let mounted = true;
    window.workbench
      .detectEngines()
      .then((result) => {
        if (mounted) setEngineDetect(result);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const noEngineInstalled = Boolean(
    engineDetect && engineDetect.engines.length > 0 && engineDetect.engines.every((entry) => !entry.installed)
  );

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
        // Pick only the keys we still support — legacy settings.json files
        // may carry long-removed appearance fields; those are ignored.
        const stored = settings.appearance;
        setAppearance((current) => ({
          ...current,
          theme:
            typeof stored.theme === "string" && THEMES.some((theme) => theme.id === stored.theme)
              ? stored.theme
              : current.theme,
          motion:
            stored.motion === "swift" || stored.motion === "balanced" || stored.motion === "steady"
              ? stored.motion
              : current.motion
        }));
      }
      setSettingsHydrated(true);
    });

    const offChanged = window.workbench.onConversationsChanged((items) => {
      setConversations(items);
      setActiveId((current) => items.find((item) => item.id === current)?.id ?? items[0]?.id ?? "");
    });

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
    // areas. Cut / paste inside the terminal are handled by xterm's own
    // attachCustomKeyEventHandler.
    const handleKeydown = (event: globalThis.KeyboardEvent) => {
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
    window.addEventListener("keydown", handleKeydown);

    return () => {
      mounted = false;
      offChanged();
      offUpdaterChecking();
      offUpdaterAvailable();
      offUpdaterProgress();
      offUpdaterDownloaded();
      offUpdaterNotAvailable();
      offUpdaterError();
      offOpenDirectory();
      window.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  // Pending toast timer is cleared on unmount.
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
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

  // Consecutive toasts reset the dismissal timer instead of stacking timers
  // that clear each other's message early.
  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2600);
  }

  function openNewConversationModal() {
    if (!window.workbench) {
      // No workbench (browser preview) — just create a default Claude session.
      void createConversation();
      return;
    }
    setShowNewConversationModal(true);
  }

  async function confirmNewConversation(engine: Engine, sandbox: Sandbox, directory: string, outputDir: string) {
    setShowNewConversationModal(false);
    if (window.workbench) {
      const items = await window.workbench.createConversation({
        engine,
        sandbox,
        directory: directory || undefined,
        outputDir: outputDir || undefined
      });
      const merged = withCreatedFirst(items, conversations);
      setConversations(merged);
      setActiveId(merged[0]?.id ?? "");
      return;
    }

    const next: Conversation = {
      id: makeId("session"),
      claudeSessionId: engine === "claude" ? makeId("claude") : undefined,
      codexSessionId: engine === "codex" ? makeId("codex") : undefined,
      opencodeSessionId: engine === "opencode" ? makeId("opencode") : undefined,
      kimiSessionId: engine === "kimi" ? makeId("kimi") : undefined,
      title: "新会话",
      updatedAt: "刚刚",
      directory: directory || "~",
      status: "local",
      pinned: false,
      attachments: [],
      messages: [],
      engine,
      sandbox,
      outputDir: outputDir || ""
    };
    setConversations((current) => [next, ...current]);
    setActiveId(next.id);
  }

  // Legacy entry point kept for direct invocations that don't want to show the
  // picker — creates a default Claude session.
  async function createConversation() {
    if (window.workbench) {
      const items = await window.workbench.createConversation();
      const merged = withCreatedFirst(items, conversations);
      setConversations(merged);
      setActiveId(merged[0]?.id ?? "");
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
  }

  // Launched from the Finder toolbar (or folder dropped on the app): open a fresh
  // session whose terminal starts in that folder.
  async function openConversationInDirectory(directory: string) {
    if (!window.workbench) return;
    const items = await window.workbench.createConversation(directory);
    const merged = withCreatedFirst(items, conversations);
    setConversations(merged);
    setActiveId(merged[0]?.id ?? "");
  }

  async function deleteConversation(id: string) {
    const target = conversations.find((conversation) => conversation.id === id);
    if (!target) return;

    if (window.workbench) {
      const remaining = await window.workbench.deleteConversation(id);
      setConversations(remaining);
      if (activeId === id) setActiveId(remaining[0]?.id ?? "");
      showToast(`已删除「${target.title}」和本地记录`);
      return;
    }

    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (activeId === id) setActiveId(remaining[0]?.id ?? "");
    showToast(`已删除「${target.title}」和本地记录`);
  }

  async function changeConversationDirectory(id: string) {
    if (!window.workbench?.pickDirectory) return;
    const next = await window.workbench.pickDirectory();
    if (!next) return;
    await window.workbench.updateConversation(id, { directory: next });
    showToast("工作目录已更新；当前终端仍跑在旧目录，新挂载的会话会使用新目录");
  }

  // Output directory: applied via a session-start prompt the next time the
  // conversation's terminal spawns fresh (see TerminalPane). Picking one pops
  // the explainer so the mechanism and its cost are never a surprise.
  async function changeConversationOutputDir(id: string) {
    if (!window.workbench?.pickDirectory) return;
    const next = await window.workbench.pickDirectory();
    if (!next) return;
    const items = await window.workbench.updateConversation(id, { outputDir: next });
    setConversations(items);
    setShowOutputDirNotice(true);
  }

  async function clearConversationOutputDir(id: string) {
    if (!window.workbench) return;
    const items = await window.workbench.updateConversation(id, { outputDir: "" });
    setConversations(items);
    showToast("已清除输出目录，恢复跟随工作目录");
  }

  function togglePin(id: string) {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    updateConversation(id, (item) => ({ ...item, pinned: !conversation.pinned }));
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

  const settingsTitle =
    settingsSection === "theme"
      ? "主题"
      : settingsSection === "behavior"
        ? "行为"
        : "关于";

  const settingsDescription =
    settingsSection === "theme"
      ? "选择工作台的整体配色与质感，12 个主题即时生效并自动保存。"
      : settingsSection === "behavior"
        ? "配置点击关闭按钮时的行为，以及界面动效的节奏。"
        : "版本信息和更新检查。";

  return (
    <main className={`shell ${panelCollapsed ? "is-collapsed" : ""}`}>
      <aside className="card sidebar-card" aria-label="会话列表" ref={sidebarRef}>
        <div className="sidebar-top">
          <span className="brand-mark" title="Clawd Station">
            <img className="brand-logo" src={clawdWizard} alt="Clawd Station" />
          </span>
          <span className="brand-name">Clawd Station</span>
          <button
            className="icon-button accent"
            type="button"
            data-flip="new"
            onClick={openNewConversationModal}
            aria-label="新建对话"
            title="新建对话"
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

        <label className="search-field">
          <Search aria-hidden="true" />
          <span className="sr-only">搜索对话</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对话或目录" />
        </label>

        <div className="session-list" role="list">
          {filteredConversations.length === 0 ? (
            <div className="panel-empty">
              <Search aria-hidden="true" />
              <p>{conversations.length === 0 ? "还没有会话。\n从上方 + 新建一个开始。" : "没有匹配的会话"}</p>
            </div>
          ) : (
            filteredConversations.map((conversation) => (
              <article
                className={`session-item ${conversation.id === activeId ? "is-active" : ""}`}
                key={conversation.id}
                role="listitem"
                data-about-id={conversation.id}
              >
                <button
                  className="session-main"
                  type="button"
                  onClick={() => setActiveId(conversation.id)}
                  onDoubleClick={() => beginRename(conversation)}
                >
                  <span className="session-title-row">
                    {conversation.pinned ? <Pin className="pin-mark" aria-label="已置顶" /> : null}
                    <EngineBadge engine={conversation.engine} />
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
                        onDoubleClick={(event) => event.stopPropagation()}
                      />
                    ) : (
                      <strong>{conversation.title}</strong>
                    )}
                    <span className="chip session-sandbox-chip" title={`权限: ${conversation.sandbox || "default"}`}>
                      {conversation.sandbox || "default"}
                    </span>
                  </span>
                  <span className="session-meta">{conversation.updatedAt}</span>
                </button>
                <div className={`session-about ${aboutId === conversation.id ? "is-open" : ""}`}>
                  <div className="session-about-inner">
                    <div className="session-about-row">
                      <span className="session-about-label">引擎</span>
                      <span className="session-about-value">
                        <EngineBadge engine={conversation.engine} />
                        {engineLabel(conversation.engine)}
                      </span>
                    </div>
                    <div className="session-about-row">
                      <span className="session-about-label">权限模式</span>
                      <span className="chip">{conversation.sandbox || "default"}</span>
                    </div>
                    <div className="session-about-row">
                      <span className="session-about-label">工作目录</span>
                      <span className="session-about-dir" title={conversation.directory || "~"}>
                        <FolderOpen aria-hidden="true" />
                        <span className="session-about-path">{conversation.directory || "~"}</span>
                      </span>
                      <button
                        className="session-about-edit"
                        type="button"
                        onClick={() => void changeConversationDirectory(conversation.id)}
                      >
                        修改
                      </button>
                    </div>
                    <div className="session-about-row">
                      <span className="session-about-label">输出目录</span>
                      <span className="session-about-dir" title={conversation.outputDir || "跟随工作目录"}>
                        <FolderOpen aria-hidden="true" />
                        <span className="session-about-path">{conversation.outputDir || "跟随工作目录"}</span>
                      </span>
                      <button
                        className="session-about-edit"
                        type="button"
                        onClick={() => void changeConversationOutputDir(conversation.id)}
                      >
                        修改
                      </button>
                      {conversation.outputDir ? (
                        <button
                          className="session-about-edit"
                          type="button"
                          onClick={() => void clearConversationOutputDir(conversation.id)}
                        >
                          清除
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
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
                  <button
                    type="button"
                    onClick={() => setAboutId((current) => (current === conversation.id ? null : conversation.id))}
                    aria-label="关于此会话"
                    aria-expanded={aboutId === conversation.id}
                  >
                    <Info aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => deleteConversation(conversation.id)} aria-label="删除对话和本地记录">
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="sidebar-bottom">
          <button
            className="icon-button"
            type="button"
            data-flip="collapse"
            onClick={togglePanelCollapsed}
            aria-label={panelCollapsed ? "展开会话面板" : "折叠会话面板"}
            title={panelCollapsed ? "展开会话面板" : "折叠会话面板"}
          >
            {panelCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
          <button
            className={`icon-button ${appView === "settings" ? "is-active" : ""}`}
            type="button"
            data-flip="settings"
            onClick={() => setAppView((current) => (current === "settings" ? "chat" : "settings"))}
            aria-label={appView === "settings" ? "关闭设置" : "打开设置"}
            title={appView === "settings" ? "关闭设置" : "打开设置"}
          >
            <Settings aria-hidden="true" />
          </button>
          {/* Frameless window controls live in the sidebar footer. Close still
              respects the user's closeBehavior setting (quit vs hide-to-tray). */}
          <button
            className="icon-button"
            type="button"
            data-flip="minimize"
            onClick={() => window.workbench?.minimizeWindow?.()}
            aria-label="最小化"
            title="最小化"
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            data-flip="maximize"
            onClick={() => window.workbench?.toggleMaximizeWindow?.()}
            aria-label="最大化 / 还原"
            title="最大化 / 还原"
          >
            <Square aria-hidden="true" />
          </button>
          <button
            className="icon-button wc-close"
            type="button"
            data-flip="close"
            onClick={() => window.workbench?.closeWindow?.()}
            aria-label={closeBehavior === "tray" ? "隐藏到托盘" : "关闭应用"}
            title={closeBehavior === "tray" ? "隐藏到托盘" : "关闭应用"}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </aside>

      <section className="card stage-card" aria-label="当前会话">
        <div className="terminal-area">
          {/* TerminalDeck stays mounted across settings visits (settings is an
              overlay), so xterm + node-pty sessions are never torn down. */}
          <TerminalDeck activeId={activeConversation?.id ?? ""} sessions={terminalSessions} xtermTheme={activeTheme.xterm} />
          {conversations.length === 0 ? (
            <div className="stage">
              <img className="stage-logo" src={clawdWizard} alt="" />
              <p>一个安静的终端工作台，把 Claude Code、Codex、OpenCode、Kimi 装进同一个窗口。</p>
              <button className="button-primary" type="button" onClick={openNewConversationModal}>
                <Plus aria-hidden="true" />
                新建会话
              </button>
              {noEngineInstalled ? (
                <div className="stage-install-hint">
                  <p>检测到你还没有安装任何 CLI</p>
                  <p className="stage-install-engines">Claude Code · Codex CLI · Kimi CLI · OpenCode</p>
                  <p>点上方「新建会话」，可按引导安装</p>
                </div>
              ) : null}
            </div>
          ) : !activeConversation ? (
            <div className="stage">
              <p className="stage-hint">从左侧选择一个会话，或按 + 新建。</p>
            </div>
          ) : null}
        </div>
      </section>

      {/* Settings overlay — a floating card covering only the stage area, so
          the sidebar (collapse / settings / window keys) stays reachable.
          TerminalDeck stays mounted below. The overlay itself also stays
          mounted: toggling is-open gives open and close symmetric motion. */}
      <div
        className={`card settings-overlay ${appView === "settings" ? "is-open" : ""}`}
        aria-hidden={appView !== "settings"}
      >
        <button
          className="icon-button settings-close"
          type="button"
          onClick={() => setAppView("chat")}
          aria-label="关闭设置"
          title="关闭设置"
          tabIndex={appView === "settings" ? 0 : -1}
        >
          <X aria-hidden="true" />
        </button>
        <nav className="settings-nav-col" aria-label="设置分类">
          <p className="settings-nav-title">设置</p>
            <button
              className={`settings-nav-item ${settingsSection === "theme" ? "is-active" : ""}`}
              type="button"
              onClick={() => setSettingsSection("theme")}
            >
              <Palette aria-hidden="true" />
              主题
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
          </nav>

          <div className="settings-content">
            <header>
              <h2>{settingsTitle}</h2>
              <p>{settingsDescription}</p>
            </header>

            {settingsSection === "theme" ? (
              <section className="settings-card theme-settings-card" aria-label="主题设置">
                <div className="theme-options" role="radiogroup" aria-label="选择主题">
                  {THEMES.map((theme) => {
                    const isActive = appearance.theme === theme.id;
                    return (
                      <button
                        className={`theme-card ${isActive ? "is-active" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        key={theme.id}
                        onClick={() =>
                          setAppearance((current) => ({
                            ...current,
                            theme: theme.id
                          }))
                        }
                      >
                        {/* Each card renders itself in its own palette (swatch
                            colors), so differences survive any active theme. */}
                        <span className="theme-card-preview" style={{ background: theme.swatch[0] }} aria-hidden="true">
                          <span className="theme-card-mini" style={{ background: theme.swatch[1] }}>
                            <span className="theme-card-mini-bar" style={{ background: theme.swatch[2] }} />
                          </span>
                        </span>
                        <span className="theme-card-swatches" aria-hidden="true">
                          {theme.swatch.map((color) => (
                            <span key={color} style={{ background: color }} />
                          ))}
                        </span>
                        <strong>{theme.name}</strong>
                        <small>{theme.vibe}</small>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : settingsSection === "behavior" ? (
              <section className="settings-card" aria-label="行为设置">
                <div className="setting-row">
                  <span>动效等级</span>
                  <div className="behavior-options three" role="radiogroup" aria-label="动效等级">
                    {MOTION_OPTIONS.map((option) => (
                      <button
                        className={`loading-option ${appearance.motion === option.id ? "is-active" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={appearance.motion === option.id}
                        key={option.id}
                        onClick={() =>
                          setAppearance((current) => ({
                            ...current,
                            motion: option.id
                          }))
                        }
                      >
                        <strong>{option.label}</strong>
                        <span>{option.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
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
                        {updateState === "checking" || updateState === "downloading" ? "检查中…" : "检查更新"}
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
            ) : null}
          </div>
      </div>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}

      {/* Always mounted once engines are known: the .is-open class drives
          symmetric enter/exit motion (same pattern as the settings overlay),
          so closing the picker animates instead of disappearing. */}
      {engines.length > 0 ? (
        <NewConversationModal
          open={showNewConversationModal}
          engines={engines}
          homeDir={appInfo?.homeDir}
          onConfirm={(engine, sandbox, directory, outputDir) => void confirmNewConversation(engine, sandbox, directory, outputDir)}
          onCancel={() => setShowNewConversationModal(false)}
          onOutputDirPicked={() => setShowOutputDirNotice(true)}
        />
      ) : null}

      {/* Output-directory explainer — shown right after the user picks an
          output dir (modal or About panel), so the spawn-injection mechanism
          and its costs are never a surprise. Always mounted for symmetric
          open/close motion. */}
      <div
        className={`modal-overlay notice-overlay ${showOutputDirNotice ? "is-open" : ""}`}
        aria-hidden={!showOutputDirNotice}
      >
        <div className="modal notice-modal" role="alertdialog" aria-label="输出目录说明">
          <div className="modal-header">
            <h3>输出目录已设置</h3>
          </div>
          <div className="modal-body">
            <ul className="notice-list">
              <li>CLI 启动时会自动发送一条指令，让 AI 把生成的文件保存到该目录。</li>
              <li>这条指令是一条真实的 AI 消息，会产生一次 API 交互。</li>
              <li>长对话后 AI 可能淡忘；修改输出目录或重进会话会重新告知。</li>
            </ul>
          </div>
          <div className="modal-footer">
            <button
              className="button-primary"
              type="button"
              onClick={() => setShowOutputDirNotice(false)}
            >
              知道了
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
