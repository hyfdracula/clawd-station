const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTerminalAppearanceModule() {
  const sourcePath = path.join(__dirname, "..", "src", "terminalAppearance.ts");
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

test("Windows terminal font stack prioritizes installed glyph-safe monospace fonts", () => {
  const { getTerminalFontFamily } = loadTerminalAppearanceModule();
  const fontFamily = getTerminalFontFamily("Win32");

  assert.match(fontFamily, /^"Cascadia Mono", "Cascadia Code", Consolas, "Courier New"/);
  assert.match(fontFamily, /monospace$/);
  assert.equal(fontFamily.startsWith('"Anthropic Mono"'), false);
});
test("terminal rendering lets fonts draw block and quadrant glyphs", () => {
  const { getTerminalRenderOptions } = loadTerminalAppearanceModule();

  assert.deepEqual(getTerminalRenderOptions("Win32"), {
    customGlyphs: false,
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
    lineHeight: 1,
    rescaleOverlappingGlyphs: true
  });
});