// State-aware passthrough for terminal output.
//
// Earlier revisions of this module stripped dark backgrounds so dark CLI
// TUIs (Codex, OpenCode) blended into a cream app surface. The terminal pane
// has since been switched to a dark theme that matches those TUIs natively,
// so we no longer rewrite colors — we only handle chunk-boundary buffering
// so that an ANSI sequence split across two PTY emissions still arrives at
// xterm as a complete unit (xterm.js itself reassembles, so this is a
// safety net rather than a correctness requirement for rendering).
//
// To get a handle for one terminal:
//   const pass = createTerminalAnsiPassthrough();
//   term.onData((data) => sendToRenderer("terminal:data", { id, data: pass(data) }));

const VALID_SGR_BODY = /^[0-9;]*$/;

function createTerminalAnsiPassthrough() {
  let pending = "";

  return function normalize(data) {
    if (data === "" && !pending) return "";
    if (data === "") {
      const flushed = pending;
      pending = "";
      return flushed;
    }

    const chunk = pending + data;
    const lastEsc = chunk.lastIndexOf("\x1b");
    if (lastEsc === -1) {
      pending = "";
      return chunk;
    }
    const tailBody = chunk.slice(lastEsc + 1);
    if (tailBody.includes("m")) {
      pending = "";
      return chunk;
    }
    const tail = chunk.slice(lastEsc);
    const bodyOnly = tail.startsWith("\x1b[") ? tail.slice(2) : tail.slice(1);
    if (!VALID_SGR_BODY.test(bodyOnly)) {
      pending = "";
      return chunk;
    }
    pending = tail;
    return chunk.slice(0, lastEsc);
  };
}

// Backwards-compatible no-op alias used by existing call sites and tests.
// The legacy rewrite logic is preserved as \`legacyNormalizeTerminalAnsiForDisplay\`
// for reference; the active normalize is a stream passthrough.
function normalizeTerminalAnsiForDisplay(data) {
  return createTerminalAnsiPassthrough()(data);
}

function legacyNormalizeTerminalAnsiForDisplay(data) {
  return String(data);
}

module.exports = {
  createTerminalAnsiPassthrough,
  createTerminalAnsiDisplayNormalizer: createTerminalAnsiPassthrough,
  normalizeTerminalAnsiForDisplay,
  legacyNormalizeTerminalAnsiForDisplay
};