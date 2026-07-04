export interface TerminalClipboardSurface {
  hasSelection: () => boolean;
  getSelection: () => string;
  paste: (text: string) => void;
}

export interface TerminalClipboardApi {
  writeText: (text: string) => Promise<{ ok: boolean; error?: string }>;
  readText: () => Promise<{ ok: boolean; text?: string; error?: string }>;
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

  void clipboard.readText().then((result) => {
    if (result.ok && result.text) terminal.paste(result.text);
  });
  return false;
}
