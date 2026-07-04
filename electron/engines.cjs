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
      const args = [
        "-p",
        prompt,
        "--verbose",
        "--safe-mode",
        "--no-session-persistence",
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
      // codex exec [<resume subcommand>] [-C <cwd>] --json --sandbox <mode> <prompt>
      const args = ["exec"];
      if (sessionId) args.push("resume", sessionId);
      if (cwd) args.push("-C", cwd);
      args.push("--json", "--sandbox", sandbox || "workspace-write");
      // Codex --image is for images only. Text attachments are appended to the prompt.
      let fullPrompt = prompt;
      if (attachments && attachments.length) {
        const imagePaths = attachments
          .filter((a) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.path || a.name || ""))
          .map((a) => a.path);
        for (const img of imagePaths) args.push("--image", img);
        const textAttachments = attachments.filter(
          (a) => !/\.(png|jpe?g|gif|webp|bmp)$/i.test(a.path || a.name || "")
        );
        if (textAttachments.length) {
          const blob = textAttachments
            .map((a) => `[附件 ${a.name || a.path}]\n${a.path}`)
            .join("\n");
          fullPrompt = `${prompt}\n\n${blob}`;
        }
      }
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
      if (sessionId) {
        args.push("-s", sessionId);
      } else {
        args.push("--continue");
      }
      if (attachments && attachments.length) {
        for (const a of attachments) args.push("--file", a.path);
      }
      if (sandbox === "auto") args.push("--auto");
      args.push(prompt);
      return args;
    },
    parseEvent: extractOpenCodeText,
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
  stripThinkingBlocks
};