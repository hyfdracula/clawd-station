import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getTerminalRenderOptions } from "./terminalAppearance";
import { handleTerminalClipboardShortcut, quotePathForShell } from "./terminalClipboard";
import { installTerminalBlockArtSmoothing } from "./terminalBlockArt";
import type { XtermTheme } from "./themes";

// Session-start output-directory directive. In terminal mode the app talks to
// the CLI through a real PTY, not a key-stream API, so a per-task injection
// isn't possible — instead, when a conversation with an outputDir spawns a
// FRESH terminal, we wait for the CLI TUI to come up and type this one
// engine-agnostic instruction into it.
const OUTPUT_DIR_DIRECTIVE_DELAY_MS = 3500;
function outputDirDirective(outputDir: string): string {
  return `本会话的输出目录是 "${outputDir}"。之后如无特别说明，请把你要生成的文件（文档、脚本、图片、数据等）都保存到这个目录。`;
}

// Directive bookkeeping, per conversation id: the current PTY generation and
// the generations already told about outputDir. A fresh terminalStart (no
// replay) bumps the generation; the directive is sent exactly once per
// generation. That's what survives StrictMode double-mounting: mount #1 sees
// the fresh spawn and schedules a send, its cleanup cancels; mount #2
// re-attaches (replay) and reschedules because the generation is still
// unsent. LRU eviction kills the PTY, so revisiting the conversation spawns
// a new generation and the directive is sent again — acceptable, since the
// new CLI process has never seen it.
const outputDirGen = new Map<string, number>();
const outputDirSent = new Set<string>();

const TerminalView = memo(function TerminalView({
  id,
  cwd,
  active,
  engine,
  outputDir,
  xtermTheme
}: {
  id: string;
  cwd: string;
  active: boolean;
  engine?: string;
  outputDir?: string;
  xtermTheme: XtermTheme;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    // cwd, engine and outputDir are intentionally captured once at mount
    // (deps: [id]). Respawning the PTY on a directory change would kill the
    // running shell mid-work; changed directories apply the next time the
    // terminal is mounted (new conversation, or after LRU eviction).
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      ...getTerminalRenderOptions(),
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: xtermTheme
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
        readText: () =>
          navigator.clipboard
            .readText()
            .then((text) => ({ ok: true, text }))
            .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "Clipboard read failed" })),
        readFilePaths: () => {
          if (wb?.clipboardReadFilePaths) return wb.clipboardReadFilePaths();
          return Promise.resolve({ ok: true, paths: [] });
        },
        readImagePath: () => {
          if (wb?.clipboardReadImage) return wb.clipboardReadImage();
          return Promise.resolve({ ok: true, path: "" });
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

    // Spawn the PTY only once the layout has settled. Full-screen TUIs
    // (kimi & co.) paint for the cols/rows they see at startup and only
    // diff-redraw from then on — if the PTY starts at a provisional size
    // and the pane resizes right after (window restore/maximize), the TUI
    // output stays garbled. Two rAFs let CSS grid finish measuring.
    let cancelled = false;
    let outputDirTimer = 0;
    const startRaf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        try {
          fit.fit();
        } catch {
          /* keep the dims measured at mount */
        }
        const autoRun = engine === "codex" ? "codex" : engine === "opencode" ? "opencode" : engine === "kimi" ? "kimi" : "claude";
        wb.terminalStart({ id, cwd, cols: term.cols, rows: term.rows, autoRun }).then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            term.writeln("\x1b[31m终端启动失败：" + (result.error ?? "未知错误") + "\x1b[0m");
            return;
          }
          if (result.replay) {
            // Re-attached to a live PTY (StrictMode remount): refill this
            // fresh xterm with the shell's recent output.
            term.write(result.replay);
          }
          if (outputDir) {
            // Give the CLI TUI a moment to boot, then type the directive in —
            // once per PTY generation (see the bookkeeping note above). The
            // cancelled flag is the renderer-side equivalent of main's
            // terminals.get(id) === term liveness check.
            if (!result.replay) {
              outputDirGen.set(id, (outputDirGen.get(id) ?? 0) + 1);
            }
            const sendKey = `${id}#${outputDirGen.get(id) ?? 0}`;
            if (!outputDirSent.has(sendKey)) {
              outputDirTimer = window.setTimeout(() => {
                if (cancelled || outputDirSent.has(sendKey)) return;
                outputDirSent.add(sendKey);
                wb.terminalWrite(id, outputDirDirective(outputDir) + "\r");
              }, OUTPUT_DIR_DIRECTIVE_DELAY_MS);
            }
          }
        });
      });
    });

    const offData = wb.onTerminalData((event) => {
      if (event.id === id) term.write(event.data);
    });
    const offExit = wb.onTerminalExit((event) => {
      if (event.id === id) term.writeln("\r\n\x1b[90m[进程已退出，代码 " + event.exitCode + "]\x1b[0m");
    });
    const onInput = term.onData((data) => wb.terminalWrite(id, data));

    // Debounced: maximize/restore fires a storm of intermediate sizes. Each
    // one used to go straight to the PTY, making full-screen TUIs diff-redraw
    // against transient dimensions and leaving visual garbage behind.
    let resizeTimer = 0;
    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (cancelled) return;
        try {
          fit.fit();
          wb.terminalResize(id, term.cols, term.rows);
        } catch {
          /* container hidden / not measurable */
        }
      }, 120);
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      cancelAnimationFrame(startRaf);
      window.clearTimeout(outputDirTimer);
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      offData();
      offExit();
      onInput.dispose();
      // No terminalKill here: unmounting must not destroy the PTY. React
      // StrictMode double-mounts in dev, and LRU remounts should re-attach
      // instead of losing the shell. PTY teardown is owned by TerminalDeck
      // (explicit kill on eviction) and the main process (delete/quit).
      disposeBlockArtSmoothing();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // xterm supports hot-swapping options.theme — a theme switch repaints every
  // live terminal immediately, no PTY respawn needed.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme;
  }, [xtermTheme]);

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

  return (
    <div
      className="terminal-pane"
      ref={containerRef}
      style={{ display: active ? "block" : "none" }}
      onDragOver={(event) => {
        // Allow file drops (and only file drops) into the terminal.
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        // Dropping files types their paths into the shell, like native
        // terminals do. stopPropagation so the app-level guard below doesn't
        // also fire (it only prevents navigation).
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const wb = window.workbench;
        if (!wb) return;
        const paths = [...event.dataTransfer.files]
          .map((file) => {
            const viaWebUtils = wb.getPathForFile?.(file) ?? "";
            const legacy = (file as File & { path?: string }).path ?? "";
            return viaWebUtils || legacy;
          })
          .filter((path) => path.length > 0)
          .map(quotePathForShell);
        if (paths.length > 0) wb.terminalWrite(id, paths.join(" "));
      }}
    />
  );
});

// Keep at most this many PTYs alive; visiting a 7th conversation disposes the
// least-recently-active one (its TerminalView unmounts → terminalKill).
const MAX_MOUNTED_TERMINALS = 6;

export function TerminalDeck({
  activeId,
  sessions,
  xtermTheme
}: {
  activeId: string;
  sessions: { id: string; cwd: string; engine?: string; outputDir?: string }[];
  xtermTheme: XtermTheme;
}) {
  // LRU order: least-recently-active first, active last.
  const [mountedIds, setMountedIds] = useState<string[]>([]);
  const mountedIdsRef = useRef<string[]>([]);
  const sessionsKey = sessions.map((s) => s.id).join(",");

  useEffect(() => {
    const existing = new Set(sessions.map((s) => s.id));
    const current = mountedIdsRef.current;
    // Deleted conversations drop out here; beyond the cap, the
    // least-recently-active terminals are evicted from the front.
    let next = current.filter((id) => existing.has(id));
    if (activeId && existing.has(activeId)) {
      next = [...next.filter((id) => id !== activeId), activeId];
      if (next.length > MAX_MOUNTED_TERMINALS) {
        next = next.slice(next.length - MAX_MOUNTED_TERMINALS);
      }
    }
    // PTY teardown is owned here, not by TerminalView unmount: StrictMode
    // double-mounts and LRU re-attachments must never kill a live shell.
    for (const id of current.filter((id) => !next.includes(id))) {
      window.workbench?.terminalKill(id);
    }
    if (next.length !== current.length || next.some((value, index) => value !== current[index])) {
      mountedIdsRef.current = next;
      setMountedIds(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, sessionsKey]);

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  return (
    <>
      {mountedIds.map((id) => {
        const session = sessionById.get(id);
        return (
          <TerminalView
            key={id}
            id={id}
            cwd={session?.cwd ?? "~"}
            active={id === activeId}
            engine={session?.engine}
            outputDir={session?.outputDir}
            xtermTheme={xtermTheme}
          />
        );
      })}
    </>
  );
}
