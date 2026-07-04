const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTerminalClipboardModule() {
  const sourcePath = path.join(__dirname, "..", "src", "terminalClipboard.ts");
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

test("Ctrl+C copies terminal selection and stops xterm from sending SIGINT", async () => {
  const { handleTerminalClipboardShortcut } = loadTerminalClipboardModule();
  const writes = [];
  const terminal = {
    hasSelection: () => true,
    getSelection: () => "selected terminal text",
    paste: () => {
      throw new Error("paste should not run for copy");
    }
  };

  const result = await handleTerminalClipboardShortcut(
    { type: "keydown", key: "c", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
    terminal,
    {
      writeText: async (text) => {
        writes.push(text);
        return { ok: true };
      },
      readText: async () => ({ ok: true, text: "" })
    }
  );

  assert.equal(result, false);
  assert.deepEqual(writes, ["selected terminal text"]);
});

test("Ctrl+C without terminal selection is left to xterm", async () => {
  const { handleTerminalClipboardShortcut } = loadTerminalClipboardModule();
  const writes = [];

  const result = await handleTerminalClipboardShortcut(
    { type: "keydown", key: "c", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
    { hasSelection: () => false, getSelection: () => "", paste: () => {} },
    {
      writeText: async (text) => {
        writes.push(text);
        return { ok: true };
      },
      readText: async () => ({ ok: true, text: "" })
    }
  );

  assert.equal(result, true);
  assert.deepEqual(writes, []);
});

test("Ctrl+V reads system clipboard and pastes into terminal", async () => {
  const { handleTerminalClipboardShortcut } = loadTerminalClipboardModule();
  const pasted = [];

  const result = await handleTerminalClipboardShortcut(
    { type: "keydown", key: "v", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
    { hasSelection: () => false, getSelection: () => "", paste: (text) => pasted.push(text) },
    {
      writeText: async () => ({ ok: true }),
      readText: async () => ({ ok: true, text: "from clipboard" })
    }
  );

  assert.equal(result, false);
  assert.deepEqual(pasted, ["from clipboard"]);
});

test("Ctrl+Shift+C copies terminal selection (standard terminal binding)", async () => {
  const { handleTerminalClipboardShortcut } = loadTerminalClipboardModule();
  const writes = [];

  const result = await handleTerminalClipboardShortcut(
    { type: "keydown", key: "C", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true },
    { hasSelection: () => true, getSelection: () => "shift-c selected text", paste: () => {} },
    {
      writeText: async (text) => {
        writes.push(text);
        return { ok: true };
      },
      readText: async () => ({ ok: true, text: "" })
    }
  );

  assert.equal(result, false);
  assert.deepEqual(writes, ["shift-c selected text"]);
});

test("Ctrl+Shift+V pastes from system clipboard (standard terminal binding)", async () => {
  const { handleTerminalClipboardShortcut } = loadTerminalClipboardModule();
  const pasted = [];

  const result = await handleTerminalClipboardShortcut(
    { type: "keydown", key: "V", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true },
    { hasSelection: () => false, getSelection: () => "", paste: (text) => pasted.push(text) },
    {
      writeText: async () => ({ ok: true }),
      readText: async () => ({ ok: true, text: "shift+v pasted" })
    }
  );

  assert.equal(result, false);
  assert.deepEqual(pasted, ["shift+v pasted"]);
});
