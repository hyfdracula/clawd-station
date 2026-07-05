// State-aware normalizer for ANSI terminal output.
//
// node-pty emits stdout in chunks that may split ANSI escape sequences across
// boundaries (e.g. "\x1b[48;" + "5;235m"). A stateless regex per chunk misses
// any sequence whose terminating `m` arrives in the next chunk. xterm.js
// concatenates chunks internally so it always sees the full sequence, hence
// the original black box still rendered.
//
// This factory returns a per-terminal normalizer that:
//   1. Buffers any trailing partial `\x1b[...` (no terminating `m` yet) and
//      prepends it to the next chunk before processing.
//   2. Strips dark backgrounds so dark CLI TUIs (Codex, OpenCode) blend with
//      the cream app surface. We replace them with an EXPLICIT light
//      background (24-bit RGB 255,255,255) rather than SGR 49 (default bg),
//      because we don't want to depend on the xterm theme being correctly
//      applied for the visual fix to take effect.
//
// To get a handle for one terminal:
//   const normalize = createTerminalAnsiDisplayNormalizer();
//   term.onData((data) => sendToRenderer("terminal:data", { id, data: normalize(data) }));

const DARK_BG_RE = /\x1b\[([0-9;]*)m/g;

// Indexed dark backgrounds. Each branch matches one of these forms:
//   40 / 100                           (basic palette black / bright black)
//   48;5;0  / 48;5;8                   (256-color basic black / bright black)
//   48;5;232-243                       (256-color grayscale ramp dark half)
//   48;2;0;0;0                         (24-bit pure black)
// All → rewritten to 48;2;255;255;255 (explicit 24-bit white)
//
// Only the dark-bg subsequence is replaced; surrounding parameters (bold,
// fg, underline, …) are preserved verbatim.  For whole-sequence forms
// (`40`, `100`) we drop the leading index and use the explicit bg.
const EXPLICIT_WHITE_BG = "48;2;255;255;255";

function rewriteSgr(params) {
  if (params === "40" || params === "100") return EXPLICIT_WHITE_BG;
  if (params === "") return params;

  const parts = params.split(";");
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p === "40" || p === "100") {
      out.push(...EXPLICIT_WHITE_BG.split(";"));
      continue;
    }
    if (p === "48" && i + 1 < parts.length) {
      const mode = parts[i + 1];
      if (mode === "5" && i + 2 < parts.length) {
        const idx = parseInt(parts[i + 2], 10);
        if (idx === 0 || idx === 8 || (idx >= 232 && idx <= 243)) {
          out.push(...EXPLICIT_WHITE_BG.split(";"));
          i += 2;
          continue;
        }
        // Light 256-color palette bg — pass through unchanged.
        out.push(p, mode, parts[i + 2]);
        i += 2;
        continue;
      }
      if (mode === "2" && i + 4 < parts.length) {
        const r = parseInt(parts[i + 2], 10);
        const g = parseInt(parts[i + 3], 10);
        const b = parseInt(parts[i + 4], 10);
        if (r === 0 && g === 0 && b === 0) {
          out.push(...EXPLICIT_WHITE_BG.split(";"));
          i += 4;
          continue;
        }
        // Any other 24-bit bg — pass through unchanged.
        out.push(p, mode, parts[i + 2], parts[i + 3], parts[i + 4]);
        i += 4;
        continue;
      }
    }
    out.push(p);
  }
  return out.join(";");
}

function processCompleteSgr(match, params) {
  return `\x1b[${rewriteSgr(params)}m`;
}

// A pending tail is treated as a real SGR-in-progress only if its body
// (after \x1b[) is purely digits and semicolons. Otherwise it's just bytes
// that happened to start with \x1b[ (e.g. "\x1b[4x") and should be
// emitted verbatim on the next call instead of being held indefinitely.
const VALID_SGR_BODY = /^[0-9;]*$/;

function createTerminalAnsiDisplayNormalizer() {
  // Tail of the previous chunk that looked like the start of an SGR sequence
  // but didn't yet have its closing `m`. Prepended to the next chunk so the
  // regex sees the complete sequence. Only emitted when a subsequent chunk
  // arrives that turns out NOT to be a continuation (then pending is flushed
  // verbatim — we don't want to silently swallow non-SGR bytes).
  let pending = "";

  return function normalize(data) {
    // Empty call with no pending → nothing to do.
    if (data === "" && !pending) return "";
    // Empty call with pending → caller is closing; emit pending verbatim.
    if (data === "") {
      const flushed = pending;
      pending = "";
      return flushed;
    }

    // Prepend any held-over partial so the regex sees the full sequence.
    const chunk = pending + data;

    // Find the last ESC byte in chunk. We can't look for "\x1b[" as a unit
    // because byte-by-byte chunks can split ESC from the `[`.
    const lastEsc = chunk.lastIndexOf("\x1b");
    if (lastEsc === -1) {
      pending = "";
      return chunk.replace(DARK_BG_RE, processCompleteSgr);
    }
    const tailBody = chunk.slice(lastEsc + 1); // chars after ESC (may include `[`, params, …)
    if (tailBody.includes("m")) {
      pending = "";
      return chunk.replace(DARK_BG_RE, processCompleteSgr);
    }
    // Incomplete tail — check it actually looks like an SGR body (digits +
    // semicolons, possibly preceded by `[`). If not, the buffered partial
    // was never an SGR start; emit verbatim and let the rest of chunk be
    // processed normally.
    const tail = chunk.slice(lastEsc);
    // Skip a leading `[` if present (CSI sequences).
    const bodyOnly = tail.startsWith("\x1b[") ? tail.slice(2) : tail.slice(1);
    if (!VALID_SGR_BODY.test(bodyOnly)) {
      pending = "";
      return chunk.replace(DARK_BG_RE, processCompleteSgr);
    }
    pending = tail;
    return chunk.slice(0, lastEsc).replace(DARK_BG_RE, processCompleteSgr);
  };
}

// Stateless variant kept for backwards compatibility and unit tests that pass
// complete strings (no chunk boundaries). Production code should use the
// factory above.
function normalizeTerminalAnsiForDisplay(data) {
  return String(data).replace(DARK_BG_RE, (_match, params) =>
    `\x1b[${rewriteSgr(params)}m`
  );
}

module.exports = {
  createTerminalAnsiDisplayNormalizer,
  normalizeTerminalAnsiForDisplay
};