const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTerminalBlockArtModule() {
  const sourcePath = path.join(__dirname, "..", "src", "terminalBlockArt.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;

  const module = { exports: {} };
  const fn = new Function("exports", "module", "require", "__dirname", "__filename", output);
  fn(module.exports, module, require, path.dirname(sourcePath), sourcePath);
  return module.exports;
}

test("block-art smoothing only targets pure Unicode block art", () => {
  const { isTerminalBlockArtText } = loadTerminalBlockArtModule();

  assert.equal(isTerminalBlockArtText(" ▐▛███▜▌"), true);
  assert.equal(isTerminalBlockArtText("  ▘▘ ▝▝"), true);
  assert.equal(isTerminalBlockArtText("█ build output"), false);
  assert.equal(isTerminalBlockArtText("plain text"), false);
});

test("block glyph fragments describe the Claude logo quadrant cells", () => {
  const { getBlockGlyphFragments } = loadTerminalBlockArtModule();

  assert.deepEqual(getBlockGlyphFragments("█"), [{ left: 0, top: 0, width: 1, height: 1 }]);
  assert.deepEqual(getBlockGlyphFragments("▛"), [
    { left: 0, top: 0, width: 1, height: 0.5 },
    { left: 0, top: 0.5, width: 0.5, height: 0.5 }
  ]);
  assert.deepEqual(getBlockGlyphFragments("▜"), [
    { left: 0, top: 0, width: 1, height: 0.5 },
    { left: 0.5, top: 0.5, width: 0.5, height: 0.5 }
  ]);
});