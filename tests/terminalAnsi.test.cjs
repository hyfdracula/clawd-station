const assert = require("node:assert/strict");
const test = require("node:test");

// Terminal pane is now dark — we no longer rewrite dark backgrounds to
// white. The normalizer just buffers partial ANSI sequences across chunk
// boundaries so downstream code (and xterm.js) always sees complete units.

test("normalizeTerminalAnsiForDisplay passes ANSI sequences through verbatim", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[40m ▐▛███▜\x1b[0m"),
    "\x1b[40m ▐▛███▜\x1b[0m"
  );
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[38;2;215;119;87m▐\x1b[48;2;0;0;0m▛███▜\x1b[49m▌"),
    "\x1b[38;2;215;119;87m▐\x1b[48;2;0;0;0m▛███▜\x1b[49m▌"
  );
});

test("normalizeTerminalAnsiForDisplay keeps foreground black and non-SGR escapes intact", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  assert.equal(normalizeTerminalAnsiForDisplay("\x1b[30mblack text\x1b[0m"), "\x1b[30mblack text\x1b[0m");
  assert.equal(normalizeTerminalAnsiForDisplay("\x1b[?25lhide cursor"), "\x1b[?25lhide cursor");
});

// ---------------------------------------------------------------------------
// Stream / chunk-boundary tests
// ---------------------------------------------------------------------------

test("stream passthrough buffers a partial SGR split across chunks (Codex 48;5;235)", () => {
  const { createTerminalAnsiPassthrough } = require("../electron/terminal-ansi.cjs");
  const passthrough = createTerminalAnsiPassthrough();

  const out1 = passthrough("\x1b[48;");
  const out2 = passthrough("5;235mtext");

  assert.equal(out1, "", "first chunk should buffer the partial sequence");
  assert.equal(out2, "\x1b[48;5;235mtext", "second chunk should emit the joined sequence verbatim");
});

test("stream passthrough reassembles arbitrarily split Codex input box sequences", () => {
  const { createTerminalAnsiPassthrough } = require("../electron/terminal-ansi.cjs");
  const passthrough = createTerminalAnsiPassthrough();

  const input = "\x1b[48;5;235m▌placeholder\x1b[0m";
  const parts = [];
  for (const ch of input) {
    parts.push(passthrough(ch));
  }
  assert.equal(
    parts.join(""),
    "\x1b[48;5;235m▌placeholder\x1b[0m"
  );
});

test("stream passthrough flushes pending partial when followed by a non-ANSI byte", () => {
  const { createTerminalAnsiPassthrough } = require("../electron/terminal-ansi.cjs");
  const passthrough = createTerminalAnsiPassthrough();

  const out1 = passthrough("\x1b[4");
  const out2 = passthrough("x");
  assert.equal(out1, "");
  assert.equal(out2, "\x1b[4x");
});

test("stream passthrough leaves non-dark SGR sequences untouched across chunks", () => {
  const { createTerminalAnsiPassthrough } = require("../electron/terminal-ansi.cjs");
  const passthrough = createTerminalAnsiPassthrough();

  assert.equal(passthrough("\x1b[48;5;25"), "");
  assert.equal(passthrough("0mhi"), "\x1b[48;5;250mhi");
});

test("stream passthrough handles multiple complete SGRs in one chunk", () => {
  const { createTerminalAnsiPassthrough } = require("../electron/terminal-ansi.cjs");
  const passthrough = createTerminalAnsiPassthrough();

  const out = passthrough("\x1b[48;5;235mA\x1b[48;5;240mB\x1b[0m");
  assert.equal(out, "\x1b[48;5;235mA\x1b[48;5;240mB\x1b[0m");
});

test("legacyNormalizeTerminalAnsiForDisplay is a no-op passthrough", () => {
  const { legacyNormalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");
  assert.equal(legacyNormalizeTerminalAnsiForDisplay("\x1b[40mhi"), "\x1b[40mhi");
});