const assert = require("node:assert/strict");
const test = require("node:test");

test("terminal output normalizes ANSI black background to default background", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[40m ▐▛███▜▌\x1b[0m"),
    "\x1b[49m ▐▛███▜▌\x1b[0m"
  );
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[1;40m▝▜█████▛▘\x1b[0m"),
    "\x1b[1;49m▝▜█████▛▘\x1b[0m"
  );
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[38;2;215;119;87m▐\x1b[48;2;0;0;0m▛███▜\x1b[49m▌"),
    "\x1b[38;2;215;119;87m▐\x1b[49m▛███▜\x1b[49m▌"
  );
});

test("terminal output keeps foreground black and non-SGR escapes intact", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  assert.equal(normalizeTerminalAnsiForDisplay("\x1b[30mblack text\x1b[0m"), "\x1b[30mblack text\x1b[0m");
  assert.equal(normalizeTerminalAnsiForDisplay("\x1b[?25lhide cursor"), "\x1b[?25lhide cursor");
});

test("terminal output normalizes 256-color palette dark gray backgrounds (Codex TUI input box)", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  // Codex v0.142 uses palette index 235 for its input box
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[48;5;235m▌ type here\x1b[0m"),
    "\x1b[49m▌ type here\x1b[0m"
  );
  // OpenCode and similar tools may use other indices in 232-243 range
  for (let n = 232; n <= 243; n++) {
    assert.equal(
      normalizeTerminalAnsiForDisplay(`\x1b[48;5;${n}mcontent`),
      `\x1b[49mcontent`,
      `palette ${n} should normalize to default bg`
    );
  }
  // Bright grays (244+) are intentionally NOT normalized — they're light enough
  // to look fine on the cream UI.
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[48;5;250mlightbg"),
    "\x1b[48;5;250mlightbg"
  );
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[48;5;255mwhite"),
    "\x1b[48;5;255mwhite"
  );
});

test("normalization preserves foreground and other SGR attributes in compound sequences", () => {
  const { normalizeTerminalAnsiForDisplay } = require("../electron/terminal-ansi.cjs");

  // Compound: bold + 256-color dark gray bg + cyan fg should keep fg + bold
  assert.equal(
    normalizeTerminalAnsiForDisplay("\x1b[1;48;5;235;38;5;6mtext"),
    "\x1b[1;49;38;5;6mtext"
  );
});
