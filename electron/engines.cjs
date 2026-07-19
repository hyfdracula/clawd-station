// Pluggable AI engines for Clawd Station.
// Each engine owns its own CLI invocation, JSON event parser, and session ID strategy.
// The Electron main process calls runEngine() and routes everything through the same
// IPC shape (engine:chunk / engine:done / engine:error / engine:stderr / engine:permission).

const { spawn } = require("child_process");

// ---------------------------------------------------------------------------
// Codex JSONL event parser
// Captured samples (codex exec --json):
//   {"type":"thread.started","thread_id":"019f2e26-..."}
//   {"type":"turn.started"}
//   {"type":"item.completed","item":{"id":"...","type":"agent_message","text":"Hi, hope you're doing well."}}
//   {"type":"turn.completed","usage":{...}}
// We only emit assistant text. Other event types are silently consumed.
// ---------------------------------------------------------------------------
function extractCodexText(line) {
  if (!line || !line.trim()) return "";
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return "";
  }
  if (!event || typeof event !== "object") return "";
  // item.completed with type=agent_message holds the final text
  if (event.type === "item.completed" && event.item && event.item.type === "agent_message" && typeof event.item.text === "string") {
    return event.item.text;
  }
  // Some Codex versions emit response.output_text.delta directly
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
    return event.delta;
  }
  return "";
}

function extractCodexThreadId(line) {
  if (!line || !line.trim()) return "";
  try {
    const event = JSON.parse(line);
    if (event && event.type === "thread.started" && typeof event.thread_id === "string") {
      return event.thread_id;
    }
  } catch {}
  return "";
}

// ---------------------------------------------------------------------------
// OpenCode JSONL event parser
// Captured samples (opencode run --format json):
//   {"type":"step_start","timestamp":...,"sessionID":"ses_..."}
//   {"type":"text","part":{"type":"text","text":"Hey there, 神~ ..."}}
//   {"type":"step_finish","part":{"tokens":{...}}}
// The text event includes <think>...</think> blocks. We strip those to keep
// the chat pane clean — thinking is preserved in the raw output channel.
// ---------------------------------------------------------------------------
function stripThinkingBlocks(text) {
  if (!text) return "";
  // Remove <think>...</think> (including multiline, non-greedy).
  // Do NOT trim here — chunks are concatenated and trimming per-chunk would
  // destroy inter-chunk whitespace (e.g. trailing "\n\n" used for paragraph
  // breaks across two streaming events). The renderer trims the final body.
  return text.replace(/<think>[\s\S]*?<\/think>/g, "");
}

// Longest tail of `text` that is a proper prefix of `tag` — i.e. a tag that
// may be completed by the next streaming chunk.
function partialTagTail(text, tag) {
  const max = Math.min(tag.length - 1, text.length);
  for (let length = max; length > 0; length--) {
    if (text.endsWith(tag.slice(0, length))) return text.slice(-length);
  }
  return "";
}

// Stateful <think> filter for streamed chunks. stripThinkingBlocks works per
// event, but the stream can split "<think>" / "</think>" across two events —
// e.g. "<thi" + "nk>secret</think>visible" — which the per-event regex misses.
// This filter carries tag state across chunks. A chunk that ends in a partial
// tag is held back until the next chunk resolves it; if the stream dies
// mid-tag the held-back tail is dropped (malformed stream, nothing better to
// do with it).
function createThinkBlockFilter() {
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let inThink = false;
  let pending = "";
  return function filterThinkBlocks(chunk) {
    let text = pending + (chunk || "");
    pending = "";
    let out = "";
    while (text.length > 0) {
      if (!inThink) {
        const openIndex = text.indexOf(OPEN);
        if (openIndex === -1) {
          pending = partialTagTail(text, OPEN);
          out += text.slice(0, text.length - pending.length);
          break;
        }
        out += text.slice(0, openIndex);
        text = text.slice(openIndex + OPEN.length);
        inThink = true;
      } else {
        const closeIndex = text.indexOf(CLOSE);
        if (closeIndex === -1) {
          // Still inside a think block: drop everything except a possible
          // partial close tag, which must survive into the next chunk.
          pending = partialTagTail(text, CLOSE);
          break;
        }
        text = text.slice(closeIndex + CLOSE.length);
        inThink = false;
      }
    }
    return out;
  };
}

function extractOpenCodeText(line) {
  if (!line || !line.trim()) return "";
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return "";
  }
  if (!event || typeof event !== "object") return "";
  if (event.type === "text" && event.part && event.part.type === "text" && typeof event.part.text === "string") {
    return stripThinkingBlocks(event.part.text);
  }
  return "";
}

function extractOpenCodeSessionId(line) {
  if (!line || !line.trim()) return "";
  try {
    const event = JSON.parse(line);
    if (event && typeof event.sessionID === "string") {
      return event.sessionID;
    }
  } catch {}
  return "";
}

// ---------------------------------------------------------------------------
// Kimi JSONL event parser
// Verified against the installed kimi CLI (kimi --help + embedded sources):
// prompt mode with --output-format stream-json emits one JSON object per line:
//   {"role":"meta","type":"system.version","version":"..."}
//   {"role":"user","content":[...]}
//   {"role":"assistant","content":"...","tool_calls":[...]}   (content is a full
//      segment, flushed at tool boundaries and at finish — NOT a delta)
//   {"role":"tool","tool_call_id":"...","content":"..."}
//   {"role":"meta","type":"session.resume_hint","session_id":"...","command":"kimi -r <id>"}
// We only emit assistant text; tool/meta lines are silently consumed.
// ---------------------------------------------------------------------------
function extractKimiText(line) {
  if (!line || !line.trim()) return "";
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return "";
  }
  if (!event || typeof event !== "object") return "";
  if (event.role === "assistant" && typeof event.content === "string") {
    return event.content;
  }
  return "";
}

function extractKimiSessionId(line) {
  if (!line || !line.trim()) return "";
  try {
    const event = JSON.parse(line);
    if (event && event.role === "meta" && typeof event.session_id === "string" && event.session_id) {
      return event.session_id;
    }
  } catch {}
  return "";
}

// ---------------------------------------------------------------------------
// Windows spawn resolution
// npm-global CLIs install as `<name>.cmd` shims on Windows. Spawning the bare
// name with shell:false only gets a `.exe` suffix appended by libuv, so it
// fails with ENOENT. resolveSpawnSpec() locates the real binary via where.exe
// and wraps .cmd/.bat shims in `cmd.exe /d /s /c` with MSVCRT-style quoting
// (same approach as uv/cross-spawn). macOS/Linux behavior is unchanged.
// ---------------------------------------------------------------------------

// Quote one argument for a cmd.exe command line, following the MSVCRT /
// CommandLineToArgvW rules: quote only when the arg contains whitespace or a
// double quote (or is empty); inside quotes, backslashes are doubled only
// when they precede a double quote or the closing quote, and inner double
// quotes are backslash-escaped.
function quoteCmdArg(arg) {
  const value = String(arg);
  if (value.length > 0 && !/[\s"]/.test(value)) return value;
  let out = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\") {
      backslashes++;
      continue;
    }
    if (char === '"') {
      out += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    if (backslashes > 0) {
      out += "\\".repeat(backslashes);
      backslashes = 0;
    }
    out += char;
  }
  out += "\\".repeat(backslashes * 2) + '"';
  return out;
}

function cmdShimSpec(scriptPath, args) {
  const commandLine = [scriptPath, ...args].map(quoteCmdArg).join(" ");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
    shell: false
  };
}

function defaultWhereLookup(name) {
  try {
    const output = require("child_process").execFileSync("where.exe", [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000
    });
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Resolve how a CLI binary should be spawned.
// - Non-Windows: spawn the binary as-is.
// - Explicit paths (env override like CLAUDE_BIN, or anything with a path
//   separator or extension): used as given — .cmd/.bat still needs cmd.exe.
// - Bare command names on Windows: resolved via whereLookup (where.exe).
//   .exe wins; otherwise a .cmd/.bat shim is wrapped in cmd.exe; if nothing
//   usable is found we still go through cmd.exe so its own PATH/PATHEXT
//   resolution gets a chance.
// `whereLookup` is injectable for tests.
function resolveSpawnSpec(binary, args = [], platform = process.platform, whereLookup = defaultWhereLookup) {
  if (platform !== "win32") return { command: binary, args: [...args], shell: false };
  const looksLikePath = /[\\/]/.test(binary) || /\.[a-z0-9]+$/i.test(binary);
  if (looksLikePath) {
    if (/\.(cmd|bat)$/i.test(binary)) return cmdShimSpec(binary, args);
    return { command: binary, args: [...args], shell: false };
  }
  const candidates = whereLookup(binary);
  const exe = candidates.find((candidate) => /\.exe$/i.test(candidate));
  if (exe) return { command: exe, args: [...args], shell: false };
  const script = candidates.find((candidate) => /\.(cmd|bat)$/i.test(candidate));
  if (script) return cmdShimSpec(script, args);
  // Nothing spawnable directly (empty result or extensionless shim only):
  // let cmd.exe resolve the bare name itself.
  return cmdShimSpec(binary, args);
}

// ---------------------------------------------------------------------------
// Install detection + official install commands
// Detection is deliberately shallow: env-override file check + PATH lookup
// (where.exe / which, both millisecond-fast). We never spawn `<cli> --version`
// for detection — CLIs can hang on first run or prompt for login.
// ---------------------------------------------------------------------------

// Env vars that override each engine's binary (mirrors resolveBinary()).
const ENGINE_BIN_ENV_VARS = {
  claude: ["CLAUDE_CODE_BIN", "CLAUDE_BIN"],
  codex: ["CODEX_BIN"],
  opencode: ["OPENCODE_BIN"],
  kimi: ["KIMI_BIN"]
};

// Bare CLI name looked up on PATH when no env override is set.
const ENGINE_CLI_NAMES = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
  kimi: "kimi"
};

function defaultFileExists(filePath) {
  try {
    return require("fs").existsSync(filePath);
  } catch {
    return false;
  }
}

// First PATH hit for a bare command name, or "" when not found.
function defaultPathLookup(name, platform = process.platform) {
  if (platform === "win32") return defaultWhereLookup(name)[0] || "";
  try {
    const output = require("child_process").execFileSync("which", [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000
    });
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}

// Detect whether one engine's CLI is installed: an env override (*_BIN)
// pointing at an existing file wins; otherwise the bare name is looked up on
// PATH. `bin` is the resolved path when found, otherwise the bare CLI name.
// Deps are injectable for tests.
function detectEngineInstall(
  engine,
  { platform = process.platform, env = process.env, fileExists = defaultFileExists, pathLookup = defaultPathLookup } = {}
) {
  const envVars = ENGINE_BIN_ENV_VARS[engine] || [];
  for (const name of envVars) {
    const value = env[name];
    if (value && fileExists(value)) {
      return { engine, installed: true, bin: value };
    }
  }
  const cliName = ENGINE_CLI_NAMES[engine] || engine;
  const found = pathLookup(cliName, platform);
  return { engine, installed: Boolean(found), bin: found || cliName };
}

// npm itself is detected with the same PATH lookup (no env override).
function detectNpmInstall({ platform = process.platform, pathLookup = defaultPathLookup } = {}) {
  return Boolean(pathLookup("npm", platform));
}

// Official install commands, all verified against the npm registry on
// 2026-07-19 (`npm view <pkg> version`):
//   @anthropic-ai/claude-code  -> 2.1.215
//   @openai/codex              -> 0.144.6
//   opencode-ai                -> 1.18.3
//   @moonshot-ai/kimi-code     -> 0.27.0, bin {"kimi": ...}, repository
//     github.com/MoonshotAI/kimi-code (official MoonshotAI org)
// Kimi note: the originally suggested candidates do NOT exist —
// `@moonshot-ai/kimi-cli` is 404 on npm, `pip install kimi-cli` has no
// matching distribution on PyPI, and npm's bare `kimi-cli` (v0.0.2,
// "front-end tools" by Johnsstt) is an unrelated placeholder. The official
// Kimi Code CLI is distributed as @moonshot-ai/kimi-code.
// All four are npm-global installs, so every spec requires npm.
const INSTALL_COMMANDS = {
  claude: { command: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"] },
  codex: { command: "npm", args: ["install", "-g", "@openai/codex"] },
  opencode: { command: "npm", args: ["install", "-g", "opencode-ai"] },
  kimi: { command: "npm", args: ["install", "-g", "@moonshot-ai/kimi-code"] }
};

// Whitelisted lookup — unknown engines return null so the IPC layer rejects
// them (the renderer must never be able to inject an arbitrary command).
function installSpecFor(engine) {
  return INSTALL_COMMANDS[engine] || null;
}

// Human-readable one-liner for the install guide (e.g. "npm install -g ...").
function installCommandLabel(engine) {
  const spec = installSpecFor(engine);
  return spec ? [spec.command, ...spec.args].join(" ") : "";
}

// ---------------------------------------------------------------------------
// Session-id trust check
// New conversations used to get a locally generated random UUID as their
// session id (both here and in the renderer). Passing that to --resume makes
// the CLI fail with "session not found". A stored id is only trustworthy once
// the conversation has at least one message — i.e. one real run happened and
// the id was captured from the CLI's own event stream. First sends never
// resume; the real id captured mid-stream is saved back and resumes later.
// ---------------------------------------------------------------------------
function trustworthySessionId(conversation, sessionId) {
  if (!sessionId || typeof sessionId !== "string") return "";
  return (conversation.messages || []).length > 0 ? sessionId : "";
}

// ---------------------------------------------------------------------------
// Sandbox option descriptors (for the UI picker)
// ---------------------------------------------------------------------------
const SANDBOX_OPTIONS = {
  claude: [
    { value: "default", label: "默认（每次确认）" },
    { value: "acceptEdits", label: "自动接受编辑" },
    { value: "bypassPermissions", label: "全部放行（危险）" }
  ],
  codex: [
    { value: "read-only", label: "只读" },
    { value: "workspace-write", label: "工作区可写" },
    { value: "danger-full-access", label: "完全访问（危险）" }
  ],
  kimi: [
    { value: "default", label: "默认（每次确认）" },
    { value: "acceptEdits", label: "自动接受编辑" },
    { value: "bypassPermissions", label: "全部放行（危险）" }
  ],
  opencode: [
    { value: "ask", label: "每次询问" },
    { value: "auto", label: "自动批准" }
  ]
};

// Engines: buildArg lists + session ID getters/setters + per-engine sandbox defaults
const ENGINES = {
  claude: {
    name: "Claude Code",
    abbr: "C",
    resolveBinary() {
      return process.env.CLAUDE_CODE_BIN || process.env.CLAUDE_BIN || "claude";
    },
    buildArgs({ prompt, cwd, sandbox, sessionId, attachments }) {
      // Attachments go in as plain prompt text (mirrors existing Clawd Station behavior).
      // --append-system-prompt is kept for persona consistency with prior releases.
      // Session persistence: when we already have a sessionId for this conversation,
      // --resume picks it up. Otherwise Claude Code auto-persists and emits the new
      // session id in the system/result events, which we capture and save back.
      const args = [
        "-p",
        prompt,
        "--verbose",
        "--safe-mode",
        "--append-system-prompt",
        "你正在 Clawd Station 桌面壳中运行。请以 Claude Code/Claude 的身份回答，不要自称 Kiro，也不要引用 Kiro 开发环境的身份说明，除非用户明确询问 Kiro。输出给用户的正文不要使用 Markdown 标题井号 #，也不要使用星号 * 或 ** 做加粗/斜体；需要分段时直接写自然段，列表优先用数字编号或普通短横线。",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--permission-mode",
        sandbox || "default"
      ];
      if (sessionId) args.push("--resume", sessionId);
      // Attachments are already embedded in `prompt` by the caller; nothing extra here.
      void attachments;
      return args;
    },
    parseEvent: null, // Claude parser lives in main.cjs (extractStreamText)
    getSessionId(conversation) {
      return conversation.claudeSessionId;
    },
    saveSessionId(conversation, id) {
      return { ...conversation, claudeSessionId: id };
    },
    defaultSandbox: "default"
  },

  codex: {
    name: "Codex CLI",
    abbr: "X",
    resolveBinary() {
      return process.env.CODEX_BIN || "codex";
    },
    buildArgs({ prompt, cwd, sandbox, sessionId, attachments }) {
      // codex exec <exec-level flags> [resume <id>] <prompt>
      // `resume` is a subcommand of `exec`: every exec-level flag (--json,
      // -C, --sandbox, --image) must come BEFORE `resume <id>`.
      const args = ["exec", "--json"];
      if (cwd) args.push("-C", cwd);
      args.push("--sandbox", sandbox || "workspace-write");
      // Codex --image is for images only. Text attachments are appended to the prompt.
      let fullPrompt = prompt;
      if (attachments && attachments.length) {
        const isImage = (a) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.path || "");
        const imagePaths = attachments.filter(isImage).map((a) => a.path);
        for (const img of imagePaths) args.push("--image", img);
        const textAttachments = attachments.filter((a) => !isImage(a));
        if (textAttachments.length) {
          const blob = textAttachments
            .map((a) => `[附件 ${a.name || a.path}]\n${a.path}`)
            .join("\n");
          fullPrompt = `${prompt}\n\n${blob}`;
        }
      }
      if (sessionId) args.push("resume", sessionId);
      args.push(fullPrompt);
      return args;
    },
    parseEvent: extractCodexText,
    getSessionId(conversation) {
      return conversation.codexSessionId;
    },
    saveSessionId(conversation, id) {
      return { ...conversation, codexSessionId: id };
    },
    defaultSandbox: "workspace-write",
    extractSessionIdFromLine: extractCodexThreadId
  },

  kimi: {
    name: "Kimi CLI",
    abbr: "K",
    resolveBinary() {
      return process.env.KIMI_BIN || "kimi";
    },
    buildArgs({ prompt, cwd, sandbox, sessionId, attachments }) {
      // Verified against `kimi --help`: prompt mode supports
      // `-p/--prompt`, `--output-format stream-json`, `-S/--session [id]`
      // (hidden alias: --resume) and permission flags `--auto` / `--yolo`.
      // It does NOT support claude's --verbose / --include-partial-messages /
      // --permission-mode — passing them makes the CLI exit with an
      // "unknown option" error.
      const args = ["-p", prompt, "--output-format", "stream-json"];
      // Sandbox mapping: default asks each time (no flag), acceptEdits starts
      // in auto permission mode, bypassPermissions approves everything.
      if (sandbox === "acceptEdits") args.push("--auto");
      else if (sandbox === "bypassPermissions") args.push("--yolo");
      if (sessionId) args.push("--resume", sessionId);
      // Kimi has no --file flag: attachment paths go into the prompt text.
      let fullPrompt = prompt;
      if (attachments && attachments.length) {
        const blob = attachments.map((a) => `[附件 ${a.name || a.path}]\n${a.path}`).join("\n");
        fullPrompt = `${prompt}\n\n${blob}`;
      }
      args[1] = fullPrompt;
      void cwd;
      return args;
    },
    parseEvent: extractKimiText,
    getSessionId(conversation) {
      return conversation.kimiSessionId;
    },
    saveSessionId(conversation, id) {
      return { ...conversation, kimiSessionId: id };
    },
    defaultSandbox: "default",
    extractSessionIdFromLine: extractKimiSessionId
  },

  opencode: {
    name: "OpenCode",
    abbr: "O",
    resolveBinary() {
      return process.env.OPENCODE_BIN || "opencode";
    },
    buildArgs({ prompt, cwd, sandbox, sessionId, attachments }) {
      // opencode run [--dir <cwd>] [--format json] [-s <id>|--continue] [--file ...] [--auto] <prompt>
      const args = ["run"];
      if (cwd) args.push("--dir", cwd);
      args.push("--format", "json");
      // No session id → start a FRESH session. (--continue here used to resume
      // whatever session happened to be latest, leaking across conversations.)
      if (sessionId) args.push("-s", sessionId);
      if (attachments && attachments.length) {
        for (const a of attachments) args.push("--file", a.path);
      }
      if (sandbox === "auto") args.push("--auto");
      args.push(prompt);
      return args;
    },
    parseEvent: extractOpenCodeText,
    // Stream-level <think> stripping: tags can be split across JSONL events,
    // which the per-event regex in extractOpenCodeText cannot catch.
    createTextFilter: createThinkBlockFilter,
    getSessionId(conversation) {
      return conversation.opencodeSessionId;
    },
    saveSessionId(conversation, id) {
      return { ...conversation, opencodeSessionId: id };
    },
    defaultSandbox: "ask",
    extractSessionIdFromLine: extractOpenCodeSessionId
  }
};

function getEngine(name) {
  return ENGINES[name] || ENGINES.claude;
}

function sandboxOptionsFor(name) {
  return SANDBOX_OPTIONS[name] || SANDBOX_OPTIONS.claude;
}

module.exports = {
  ENGINES,
  SANDBOX_OPTIONS,
  getEngine,
  sandboxOptionsFor,
  extractCodexText,
  extractOpenCodeText,
  extractCodexThreadId,
  extractOpenCodeSessionId,
  extractKimiText,
  extractKimiSessionId,
  stripThinkingBlocks,
  createThinkBlockFilter,
  quoteCmdArg,
  resolveSpawnSpec,
  trustworthySessionId,
  ENGINE_BIN_ENV_VARS,
  ENGINE_CLI_NAMES,
  INSTALL_COMMANDS,
  detectEngineInstall,
  detectNpmInstall,
  installSpecFor,
  installCommandLabel
};