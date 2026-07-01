import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_THEME = {
  background: "#FFFFFF",
  foreground: "#1E2A3A",
  cursor: "#E8632A",
  cursorAccent: "#FFFFFF",
  selectionBackground: "#ECE3D4",
  black: "#1E2A3A",
  red: "#C0392B",
  green: "#2E7D46",
  yellow: "#B8860B",
  blue: "#2E6DA4",
  magenta: "#8E44AD",
  cyan: "#1F8A99",
  white: "#5A6B82",
  brightBlack: "#8493A8",
  brightRed: "#E2574F",
  brightGreen: "#3E9B73",
  brightYellow: "#E0A82E",
  brightBlue: "#3E7CA8",
  brightMagenta: "#A569BD",
  brightCyan: "#2AA5B5",
  brightWhite: "#1E2A3A"
};

// One persistent terminal per session. It mounts once (spawning a node-pty shell that
// auto-runs claude) and STAYS mounted while other sessions are active — only its
// visibility toggles. That keeps the shell, claude process and scrollback alive when
// you switch between sessions, so history is never lost.
function TerminalView({ id, cwd, active }: { id: string; cwd: string; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: '"Anthropic Mono", "SF Mono", ui-monospace, Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: TERMINAL_THEME
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* not measurable yet */
    }

    const wb = window.workbench;
    if (!wb) {
      term.writeln("终端仅在桌面 App 中可用（当前为浏览器预览模式）。");
      return () => term.dispose();
    }

    wb.terminalStart({ id, cwd, cols: term.cols, rows: term.rows, autoRun: "claude" }).then((result) => {
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
      // Only runs when this session is removed (deleted), not on a plain switch.
      resizeObserver.disconnect();
      offData();
      offExit();
      onInput.dispose();
      wb.terminalKill(id);
      term.dispose();
    };
  }, [id, cwd]);

  // When this view becomes visible again, re-measure and refocus.
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

// Keeps a live terminal for every session that has been opened, showing only the
// active one. Sessions that get deleted are pruned (their pty is killed).
export function TerminalDeck({ activeId, sessions }: { activeId: string; sessions: { id: string; cwd: string }[] }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, existingKey]);

  const cwdById = new Map(sessions.map((s) => [s.id, s.cwd]));

  return (
    <>
      {mountedIds.map((id) => (
        <TerminalView key={id} id={id} cwd={cwdById.get(id) ?? "~"} active={id === activeId} />
      ))}
    </>
  );
}
