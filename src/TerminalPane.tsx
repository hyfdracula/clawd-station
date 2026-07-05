import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getTerminalRenderOptions } from "./terminalAppearance";
import { handleTerminalClipboardShortcut } from "./terminalClipboard";
import { installTerminalBlockArtSmoothing } from "./terminalBlockArt";
// remapAnsiBackground is no longer used here — the main process now
// statefully strips dark backgrounds before the data reaches xterm, so the
// renderer just passes through. Keeping the import commented for reference.
// import { remapAnsiBackground } from "./terminalAnsiRemap";

const TERMINAL_THEME = {
  // Pure black/white terminal — Codex / OpenCode / Claude Code all assume a
  // classic dark terminal. Keep colors saturated so CLI tool output (red
  // errors, green success) reads clearly.
  background: "#000000",
  foreground: "#E0E0E0",
  cursor: "#FFFFFF",
  cursorAccent: "#000000",
  selectionBackground: "#444444",
  black: "#000000",
  red: "#E06C75",
  green: "#98C379",
  yellow: "#E5C07B",
  blue: "#61AFEF",
  magenta: "#C678DD",
  cyan: "#56B6C2",
  white: "#ABB2BF",
  brightBlack: "#5C6370",
  brightRed: "#E06C75",
  brightGreen: "#98C379",
  brightYellow: "#E5C07B",
  brightBlue: "#61AFEF",
  brightMagenta: "#C678DD",
  brightCyan: "#56B6C2",
  brightWhite: "#FFFFFF"
};

function TerminalView({ id, cwd, active, engine }: { id: string; cwd: string; active: boolean; engine?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      ...getTerminalRenderOptions(),
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: TERMINAL_THEME
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    const disposeBlockArtSmoothing = installTerminalBlockArtSmoothing(container);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* not measurable yet */
    }

    const wb = window.workbench;
    term.attachCustomKeyEventHandler((event) =>
      handleTerminalClipboardShortcut(event, term, {
        writeText: (text) => {
          if (wb?.clipboardWriteText) return wb.clipboardWriteText(text);
          return navigator.clipboard
            .writeText(text)
            .then(() => ({ ok: true }))
            .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "Clipboard write failed" }));
        },
        readText: () => {
          if (wb?.clipboardReadText) return wb.clipboardReadText();
          return navigator.clipboard
            .readText()
            .then((text) => ({ ok: true, text }))
            .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "Clipboard read failed" }));
        }
      })
    );

    if (!wb) {
      term.writeln("终端仅在桌面 App 中可用（当前为浏览器预览模式）。");
      return () => {
        disposeBlockArtSmoothing();
        term.dispose();
      };
    }

    const autoRun = engine === "codex" ? "codex" : engine === "opencode" ? "opencode" : "claude";
    wb.terminalStart({ id, cwd, cols: term.cols, rows: term.rows, autoRun }).then((result) => {
      if (!result.ok) {
        term.writeln("\x1b[31m终端启动失败：" + (result.error ?? "未知错误") + "\x1b[0m");
      }
    });

    const offData = wb.onTerminalData((event) => {
      if (event.id === id) term.write(event.data);
    });
    const offExit = wb.onTerminalExit((event) => {
      if (event.id === id) term.writeln("\r\n\x1b[90m[进程已退出，代码 " + event.exitCode + "]\x1b[0m");
    });
    const onInput = term.onData((data) => wb.terminalWrite(id, data));

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
        wb.terminalResize(id, term.cols, term.rows);
      } catch {
        /* container hidden / not measurable */
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      offData();
      offExit();
      onInput.dispose();
      wb.terminalKill(id);
      disposeBlockArtSmoothing();
      term.dispose();
    };
  }, [id, cwd]);

  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    const timer = window.setTimeout(() => {
      try {
        fit.fit();
        window.workbench?.terminalResize(id, term.cols, term.rows);
      } catch {
        /* ignore */
      }
      term.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [active, id]);

  return <div className="terminal-pane" ref={containerRef} style={{ display: active ? "block" : "none" }} />;
}

export function TerminalDeck({ activeId, sessions }: { activeId: string; sessions: { id: string; cwd: string; engine?: string }[] }) {
  const [mountedIds, setMountedIds] = useState<string[]>([]);
  const existingKey = sessions.map((s) => s.id).join(",");

  useEffect(() => {
    const existing = new Set(sessions.map((s) => s.id));
    setMountedIds((current) => {
      let next = current.filter((id) => existing.has(id));
      if (activeId && existing.has(activeId) && !next.includes(activeId)) {
        next = [...next, activeId];
      }
      if (next.length === current.length && next.every((value, index) => value === current[index])) {
        return current;
      }
      return next;
    });
  }, [activeId, existingKey]);

  const cwdById = new Map(sessions.map((s) => [s.id, s.cwd]));
  const engineById = new Map(sessions.map((s) => [s.id, s.engine]));

  return (
    <>
      {mountedIds.map((id) => (
        <TerminalView
          key={id}
          id={id}
          cwd={cwdById.get(id) ?? "~"}
          active={id === activeId}
          engine={engineById.get(id)}
        />
      ))}
    </>
  );
}
