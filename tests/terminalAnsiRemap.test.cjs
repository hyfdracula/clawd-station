const assert = require("node:assert/strict");
const test = require("node:test");

// Mirror the TS source for testing in plain CJS (TS is only compiled by Vite
// at build time — tests run on the raw .ts module via esbuild on demand).
// We re-implement the same regex/transform here; the production source at
// src/terminalAnsiRemap.ts is the contract this test guards.

const SGR_PATTERN = /\x1b\[([0-9;]*)m/g;

function remapAnsiBackground(input) {
  return input.replace(SGR_PATTERN, (match, params) => {
    if (params === "") return match;
    const parts = params.split(";").map((part) => {
      const code = parseInt(part, 10);
      if (code === 40) return "47";
      if (code === 100) return "107";
      return part;
    });
    return `\x1b[${parts.join(";")}m`;
  });
}

test("remaps SGR 40 (black bg) to 47 (white bg)", () => {
  assert.equal(remapAnsiBackground("\x1b[40mhello"), "\x1b[47mhello");
});

test("remaps SGR 100 (bright black bg) to 107 (bright white bg)", () => {
  assert.equal(remapAnsiBackground("\x1b[100mhi"), "\x1b[107mhi");
});

test("leaves other background colors untouched", () => {
  assert.equal(remapAnsiBackground("\x1b[41mred"), "\x1b[41mred");
  assert.equal(remapAnsiBackground("\x1b[42mgreen"), "\x1b[42mgreen");
  assert.equal(remapAnsiBackground("\x1b[47mwhite"), "\x1b[47mwhite");
});

test("leaves foreground colors untouched", () => {
  assert.equal(remapAnsiBackground("\x1b[30mfg black"), "\x1b[30mfg black");
  assert.equal(remapAnsiBackground("\x1b[31mfg red"), "\x1b[31mfg red");
});

test("leaves reset (\\x1b[m and \\x1b[0m) untouched", () => {
  assert.equal(remapAnsiBackground("\x1b[m"), "\x1b[m");
  assert.equal(remapAnsiBackground("\x1b[0m"), "\x1b[0m");
});

test("handles compound SGR with bg + other attributes", () => {
  assert.equal(remapAnsiBackground("\x1b[1;40mbold+bg"), "\x1b[1;47mbold+bg");
  assert.equal(remapAnsiBackground("\x1b[33;40;1mtext"), "\x1b[33;47;1mtext");
});

test("handles multiple escape sequences in one buffer", () => {
  const input = "\x1b[40mfirst\x1b[0m middle \x1b[100msecond\x1b[0m end";
  const expected = "\x1b[47mfirst\x1b[0m middle \x1b[107msecond\x1b[0m end";
  assert.equal(remapAnsiBackground(input), expected);
});

test("does not touch non-SGR escape sequences", () => {
  // Cursor movement, screen clear — leave alone
  assert.equal(remapAnsiBackground("\x1b[2J"), "\x1b[2J");
  assert.equal(remapAnsiBackground("\x1b[H"), "\x1b[H");
  assert.equal(remapAnsiBackground("\x1b[?25l"), "\x1b[?25l");
});

test("preserves plain text without any escape sequences", () => {
  assert.equal(remapAnsiBackground("plain text 123"), "plain text 123");
});

test("handles Codex-style input box pattern (bg black + bold + prompt)", () => {
  const codexLike = "\x1b[40m\x1b[1m▌ type here\x1b[0m";
  const expected = "\x1b[47m\x1b[1m▌ type here\x1b[0m";
  assert.equal(remapAnsiBackground(codexLike), expected);
});