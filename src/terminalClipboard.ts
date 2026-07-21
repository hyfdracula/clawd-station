export interface TerminalClipboardSurface {
  hasSelection: () => boolean;
  getSelection: () => string;
  paste: (text: string) => void;
}

export interface TerminalClipboardApi {
  writeText: (text: string) => Promise<{ ok: boolean; error?: string }>;
  readText: () => Promise<{ ok: boolean; text?: string; error?: string }>;
  /** Files copied in Explorer/Finder — parsed by the main process. */
  readFilePaths?: () => Promise<{ ok: boolean; paths?: string[]; error?: string }>;
  /** Clipboard image (screenshot tools) persisted to a temp PNG by the main
      process — resolves with its path, or "" when no image is present. */
  readImagePath?: () => Promise<{ ok: boolean; path?: string; error?: string }>;
}

/** Quote a file path the way native terminals do when pasting/dropping files. */
export function quotePathForShell(path: string): string {
  // Bare unless it contains whitespace or characters cmd.exe/PowerShell treat
  // specially — then wrap in double quotes (inner quotes are unlikely but get
  // backslash-escaped, which both cmd and posix shells accept).
  return /[\s&()^%!,;=+[\]{}'"]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

type TerminalShortcutEvent = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

function getTerminalShortcut(event: TerminalShortcutEvent): "copy" | "cut" | "paste" | null {
  if (event.type !== "keydown") return null;
  if (!(event.ctrlKey || event.metaKey)) return null;
  // Alt is reserved for OS / menu shortcuts. Shift is explicitly allowed so
  // that Ctrl+Shift+C / Ctrl+Shift+V work — the standard Windows / Linux
  // terminal copy / paste bindings.
  if (event.altKey) return null;

  const key = event.key.toLowerCase();
  if (key === "c") return "copy";
  if (key === "x") return "cut";
  if (key === "v") return "paste";
  return null;
}

export function handleTerminalClipboardShortcut(
  event: TerminalShortcutEvent,
  terminal: TerminalClipboardSurface,
  clipboard: TerminalClipboardApi
) {
  const shortcut = getTerminalShortcut(event);
  if (!shortcut) return true;

  if (shortcut === "copy" || shortcut === "cut") {
    if (!terminal.hasSelection()) return true;

    const text = terminal.getSelection();
    if (!text) return true;

    void clipboard.writeText(text);
    return false;
  }

  void (async () => {
    // Files first: a copied file in Explorer/Finder pastes as its path, like
    // native terminals. Then clipboard images (screenshots): saved to a temp
    // PNG whose path gets pasted. Plain text is the final fallback.
    if (clipboard.readFilePaths) {
      const files = await clipboard.readFilePaths().catch(() => ({ ok: false as const, paths: [] as string[] }));
      if (files.ok && files.paths && files.paths.length > 0) {
        terminal.paste(files.paths.map(quotePathForShell).join(" "));
        return;
      }
    }
    if (clipboard.readImagePath) {
      const image = await clipboard.readImagePath().catch(() => ({ ok: false as const, path: "" }));
      if (image.ok && image.path) {
        terminal.paste(quotePathForShell(image.path));
        return;
      }
    }
    const result = await clipboard.readText();
    if (result.ok && result.text) terminal.paste(result.text);
  })();
  return false;
}
