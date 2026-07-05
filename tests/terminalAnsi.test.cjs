const assert = require("node:assert/strict");
const test = require("node:test");

test("terminal output normalizes ANSI black background to default background", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[40m ▐▛███▜\x1b[0m"),
    "\x1b[48;2;255;255;255m ▐▛███▜\x1b[0m"
  );
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[1;40m▝▜█████▛\x1b[0m"),
    "\x1b[1;48;2;255;255;255m▝▜█████▛\x1b[0m"
  );
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[38;2;215;119;87m▐\x1b[48;2;0;0;0m▛███▜\x1b[49m▌"),
    "\x1b[38;2;215;119;87m▐\x1b[48;2;255;255;255m▛███▜\x1b[49m▌"
  );
});

test("terminal output keeps foreground black and non-SGR escapes intact", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  assert.equal(normalizeTerminalAnsiForDisplay("\x1b[30mblack text\x1b[0m"), "\x1b[30mblack text\x1b[0m");
  assert.equal(normalizeTerminalAnsiForDisplay("\x1b[?25lhide cursor"), "\x1b[?25lhide cursor");
});

test("terminal output normalizes 256-color palette dark gray backgrounds (Codex TUI input box)", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[48;5;235m▌ type here\x1b[0m"),
    "\x1b[48;2;255;255;255m▌ type here\x1b[0m"
  );
  for (let n = 232; n <= 243; n += 1) {
    assert.equal(
      normalizeTerminalAnsiForDisplay(`\x1b[48;5;${n}mcontent`),
      `\x1b[48;2;255;255;255mcontent`,
      `palette ${n} should normalize to explicit white bg`
    );
  }
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[48;5;250mlightbg"),
    "\x1b[48;5;250mlightbg"
  );
});

test("normalization preserves foreground and other SGR attributes in compound sequences", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[1;48;5;235;38;5;6mtext"),
    "\x1b[1;48;2;255;255;255;38;5;6mtext"
  );
});

// ---------------------------------------------------------------------------
// Stream / chunk-boundary tests
// ---------------------------------------------------------------------------

test("stream normalizer buffers a partial SGR split across chunks (Codex 48;5;235)", () => {
  const { createTerminalAnsiDisplayNormalizer } = require("../electron/terminal-ansi.cjs");
  const normalize = createTerminalAnsiDisplayNormalizer();

  const out1 = normalize("\x1b[48;");
  const out2 = normalize("5;235mtext");

  assert.equal(out1, "", "first chunk should buffer the partial sequence");
  assert.equal(out2, "\x1b[48;2;255;255;255mtext", "second chunk should emit the rewritten sequence plus rest");
});

test("stream normalizer reassembles arbitrarily split Codex input box sequences", () => {
  const { createTerminalAnsiDisplayNormalizer } = require("../electron/terminal-ansi.cjs");
  const normalize = createTerminalAnsiDisplayNormalizer();

  const input = "\x1b[48;5;235m▌placeholder\x1b[0m";
  const parts = [];
  for (const ch of input) {
    parts.push(normalize(ch));
  }
  assert.equal(
    parts.join(""),
    "\x1b[48;2;255;255;255m▌placeholder\x1b[0m"
  );
});

test("stream normalizer flushes pending partial when followed by a non-ANSI byte", () => {
  const { createTerminalAnsiDisplayNormalizer } = require("../electron/terminal-ansi.cjs");
  const normalize = createTerminalAnsiDisplayNormalizer();

  const out1 = normalize("\x1b[4");
  const out2 = normalize("x");
  assert.equal(out1, "");
  assert.equal(out2, "\x1b[4x");
});

test("stream normalizer leaves non-dark SGR sequences untouched across chunks", () => {
  const { createTerminalAnsiDisplayNormalizer } = require("../electron/terminal-ansi.cjs");
  const normalize = createTerminalAnsiDisplayNormalizer();

  assert.equal(normalize("\x1b[48;5;25"), "");
  assert.equal(normalize("0mhi"), "\x1b[48;5;250mhi");
});

test("stream normalizer handles multiple complete SGRs in one chunk", () => {
  const { createTerminalAnsiDisplayNormalizer } = require("../electron/terminal-ansi.cjs");
  const normalize = createTerminalAnsiDisplayNormalizer();

  const out = normalize("\x1b[48;5;235mA\x1b[48;5;240mB\x1b[0m");
  assert.equal(out, "\x1b[48;2;255;255;255mA\x1b[48;2;255;255;255mB\x1b[0m");
});