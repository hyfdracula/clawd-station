const assert = require("node:assert/strict");
const test = require("node:test");

// Mirror the TS source for testing in plain CJS (TS is only compiled by Vite
// at build time — tests run on the raw .ts module via esbuild on demand).
// We re-implement the same regex/transform here; the production source at
// src/terminalAnsiRemap.ts is the contract this test guards.

const SGR_PATTERN = /\x1b\[([0-9;]*)m/g;
const DARK_256_PALETTE = new Set([
  0, 8,
  232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243
]);

function remapBackgroundCode(part) {
  const code = parseInt(part, 10);
  if (code === 40) return "47";
  if (code === 100) return "107";
  return part;
}

function remapBackgroundSubsequence(parts) {
  for (let i = 0; i + 2 < parts.length; i++) {
    if (parts[i] === "48" && parts[i + 1] === "5") {
      const idx = parseInt(parts[i + 2], 10);
      if (DARK_256_PALETTE.has(idx)) {
        const next = [];
        next.push(...parts.slice(0, i));
        next.push("48", "5", "255");
        next.push(...parts.slice(i + 3));
        return next;
      }
    }
  }
  return parts;
}

function remapAnsiBackground(input) {
  return input.replace(SGR_PATTERN, (match, params) => {
    if (params === "") return match;
    const parts = params.split(";");
    const remapped = remapBackgroundSubsequence(parts).map(remapBackgroundCode);
    return `\x1b[${remapped.join(";")}m`;
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

test("remaps 256-color palette dark bg (48;5;235 — Codex TUI)", () => {
  // Codex uses \x1b[48;5;235m for its input box (very dark gray).
  assert.equal(remapAnsiBackground("\x1b[48;5;235mtext"), "\x1b[48;5;255mtext");
});

test("remaps full grayscale ramp dark half (232-243 → 255)", () => {
  for (let n = 232; n <= 243; n++) {
    assert.equal(remapAnsiBackground(`\x1b[48;5;${n}mx`), `\x1b[48;5;255mx`, `palette ${n} should remap`);
  }
});

test("leaves bright grayscale (244-255) untouched", () => {
  assert.equal(remapAnsiBackground("\x1b[48;5;244mx"), "\x1b[48;5;244mx");
  assert.equal(remapAnsiBackground("\x1b[48;5;250mx"), "\x1b[48;5;250mx");
  assert.equal(remapAnsiBackground("\x1b[48;5;255mx"), "\x1b[48;5;255mx");
});

test("leaves saturated dark colors untouched (24-bit and palette)", () => {
  // Deep red (1) is a saturated color, leave alone even though dark
  assert.equal(remapAnsiBackground("\x1b[48;5;1mred bg"), "\x1b[48;5;1mred bg");
  // 24-bit dark red — should NOT remap (it's an explicit color, not black)
  assert.equal(
    remapAnsiBackground("\x1b[48;2;30;0;0mdarkred"),
    "\x1b[48;2;30;0;0mdarkred"
  );
});

test("remaps 256-color bg inside compound SGR with other attributes", () => {
  assert.equal(
    remapAnsiBackground("\x1b[1;48;5;235;38;5;6mbold+darkbg+cyan"),
    "\x1b[1;48;5;255;38;5;6mbold+darkbg+cyan"
  );
});

test("leaves 24-bit background colors untouched (38-bit path)", () => {
  // \x1b[48;2;R;G;Bm — RGB true color. Don't touch arbitrary colors.
  assert.equal(
    remapAnsiBackground("\x1b[48;2;0;0;0mpureblack"),
    "\x1b[48;2;0;0;0mpureblack"
  );
});