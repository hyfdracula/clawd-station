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
