const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ENGINES,
  getEngine,
  sandboxOptionsFor,
  extractCodexText,
  extractCodexThreadId,
  extractOpenCodeText,
  extractOpenCodeSessionId,
  stripThinkingBlocks
} = require("../electron/engines.cjs");

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test("engines registry exposes claude / codex / opencode", () => {
  assert.ok(ENGINES.claude, "claude engine registered");
  assert.ok(ENGINES.codex, "codex engine registered");
  assert.ok(ENGINES.opencode, "opencode engine registered");
  assert.equal(getEngine("claude"), ENGINES.claude);
  assert.equal(getEngine("unknown"), ENGINES.claude, "unknown engine falls back to claude");
});

test("sandboxOptionsFor returns per-engine options", () => {
  const claude = sandboxOptionsFor("claude");
  assert.deepEqual(
    claude.map((o) => o.value),
    ["default", "acceptEdits", "bypassPermissions"]
  );
  const codex = sandboxOptionsFor("codex");
  assert.deepEqual(
    codex.map((o) => o.value),
    ["read-only", "workspace-write", "danger-full-access"]
  );
  const opencode = sandboxOptionsFor("opencode");
  assert.deepEqual(
    opencode.map((o) => o.value),
    ["ask", "auto"]
  );
});

// ---------------------------------------------------------------------------
// buildArgs
// ---------------------------------------------------------------------------

test("claude buildArgs produces Claude CLI flags", () => {
  const args = ENGINES.claude.buildArgs({
    prompt: "hello",
    cwd: "/tmp",
    sandbox: "default",
    sessionId: null,
    attachments: []
  });
  assert.ok(args.includes("-p"));
  assert.ok(args.includes("hello"));
  assert.ok(args.includes("--output-format"));
  assert.ok(args.includes("stream-json"));
  assert.ok(args.includes("--permission-mode"));
  assert.ok(args.includes("default"));
  assert.ok(args.includes("--safe-mode"));
  // Session persistence is on by default — --resume is added only when
  // we already have a sessionId for this conversation.
  assert.ok(!args.includes("--no-session-persistence"));
  assert.ok(!args.includes("--resume"));
  // No --resume when sessionId is null
  assert.ok(!args.includes("--resume"));
});

test("claude buildArgs adds --resume when sessionId present", () => {
  const args = ENGINES.claude.buildArgs({
    prompt: "hello",
    cwd: "/tmp",
    sandbox: "default",
    sessionId: "abc-123",
    attachments: []
  });
  const idx = args.indexOf("--resume");
  assert.ok(idx >= 0, "has --resume");
  assert.equal(args[idx + 1], "abc-123");
});

test("codex buildArgs produces codex exec flags", () => {
  const args = ENGINES.codex.buildArgs({
    prompt: "hello",
    cwd: "/tmp",
    sandbox: "workspace-write",
    sessionId: null,
    attachments: []
  });
  assert.equal(args[0], "exec");
  assert.ok(args.includes("-C"));
  assert.ok(args.includes("/tmp"));
  assert.ok(args.includes("--json"));
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("workspace-write"));
  // Last arg is the prompt
  assert.equal(args[args.length - 1], "hello");
  // No resume subcommand when sessionId is null
  assert.ok(!args.includes("resume"));
});

test("codex buildArgs includes resume subcommand and --image for images", () => {
  const args = ENGINES.codex.buildArgs({
    prompt: "describe",
    cwd: "/tmp",
    sandbox: "read-only",
    sessionId: "thread-xyz",
    attachments: [{ name: "pic.png", path: "/tmp/pic.png" }]
  });
  assert.equal(args[0], "exec");
  assert.equal(args[1], "resume");
  assert.equal(args[2], "thread-xyz");
  assert.ok(args.includes("--image"));
  assert.ok(args.includes("/tmp/pic.png"));
});

test("codex buildArgs appends text attachments to prompt as paths", () => {
  const args = ENGINES.codex.buildArgs({
    prompt: "summarize",
    cwd: "/tmp",
    sandbox: "workspace-write",
    sessionId: null,
    attachments: [{ name: "note.txt", path: "/tmp/note.txt" }]
  });
  const last = args[args.length - 1];
  assert.ok(last.includes("summarize"));
  assert.ok(last.includes("[附件 note.txt]"));
  assert.ok(last.includes("/tmp/note.txt"));
  // No --image flag for text attachments
  assert.ok(!args.includes("--image"));
});

test("opencode buildArgs produces opencode run flags", () => {
  const args = ENGINES.opencode.buildArgs({
    prompt: "hi",
    cwd: "/tmp",
    sandbox: "ask",
    sessionId: null,
    attachments: []
  });
  assert.equal(args[0], "run");
  assert.ok(args.includes("--dir"));
  assert.ok(args.includes("/tmp"));
  assert.ok(args.includes("--format"));
  assert.ok(args.includes("json"));
  // No sessionId -> uses --continue
  assert.ok(args.includes("--continue"));
  // ask sandbox does NOT add --auto
  assert.ok(!args.includes("--auto"));
  // Last arg is the prompt
  assert.equal(args[args.length - 1], "hi");
});

test("opencode buildArgs uses -s when sessionId present and adds --auto for sandbox=auto", () => {
  const args = ENGINES.opencode.buildArgs({
    prompt: "hi",
    cwd: "/tmp",
    sandbox: "auto",
    sessionId: "ses_xyz",
    attachments: [{ name: "f.txt", path: "/tmp/f.txt" }]
  });
  assert.ok(args.includes("-s"));
  assert.ok(args.includes("ses_xyz"));
  assert.ok(args.includes("--auto"));
  // --file flag present for attachments
  assert.ok(args.includes("--file"));
  assert.ok(args.includes("/tmp/f.txt"));
  // No --continue when sessionId given
  assert.ok(!args.includes("--continue"));
});

// ---------------------------------------------------------------------------
// Session ID getters / setters
// ---------------------------------------------------------------------------

test("engines save/get session id into the correct field per engine", () => {
  const baseConv = { id: "c1" };

  const c1 = ENGINES.codex.saveSessionId(baseConv, "thread-1");
  assert.equal(c1.codexSessionId, "thread-1");
  assert.equal(ENGINES.codex.getSessionId(c1), "thread-1");
  assert.equal(ENGINES.claude.getSessionId(c1), undefined);

  const c2 = ENGINES.opencode.saveSessionId(baseConv, "ses_2");
  assert.equal(c2.opencodeSessionId, "ses_2");
  assert.equal(ENGINES.opencode.getSessionId(c2), "ses_2");
  assert.equal(ENGINES.codex.getSessionId(c2), undefined);

  const c3 = ENGINES.claude.saveSessionId(baseConv, "claude-uuid");
  assert.equal(c3.claudeSessionId, "claude-uuid");
});

// ---------------------------------------------------------------------------
// Codex JSONL parser
// ---------------------------------------------------------------------------

test("extractCodexText pulls text from item.completed agent_message", () => {
  const line = JSON.stringify({
    type: "item.completed",
    item: { id: "item_0", type: "agent_message", text: "Hi, hope you're doing well." }
  });
  assert.equal(extractCodexText(line), "Hi, hope you're doing well.");
});

test("extractCodexText returns empty string for non-text events", () => {
  assert.equal(extractCodexText('{"type":"thread.started","thread_id":"abc"}'), "");
  assert.equal(extractCodexText('{"type":"turn.started"}'), "");
  assert.equal(extractCodexText('{"type":"turn.completed","usage":{}}'), "");
  assert.equal(extractCodexText(""), "");
  assert.equal(extractCodexText("not json"), "");
});

test("extractCodexText supports response.output_text.delta as fallback", () => {
  const line = JSON.stringify({ type: "response.output_text.delta", delta: "world" });
  assert.equal(extractCodexText(line), "world");
});

test("extractCodexThreadId extracts thread id from thread.started event", () => {
  const line = JSON.stringify({ type: "thread.started", thread_id: "019f2e26-abcd" });
  assert.equal(extractCodexThreadId(line), "019f2e26-abcd");
  assert.equal(extractCodexThreadId('{"type":"turn.started"}'), "");
  assert.equal(extractCodexThreadId("not json"), "");
});

// ---------------------------------------------------------------------------
// OpenCode JSONL parser
// ---------------------------------------------------------------------------

test("extractOpenCodeText pulls text and strips <think> blocks", () => {
  const line = JSON.stringify({
    type: "text",
    part: { type: "text", text: "answer<think>some internal</think>after" }
  });
  assert.equal(extractOpenCodeText(line), "answerafter");
});

test("extractOpenCodeText returns empty string for non-text events", () => {
  assert.equal(extractOpenCodeText('{"type":"step_start","sessionID":"x"}'), "");
  assert.equal(extractOpenCodeText('{"type":"step_finish","part":{}}'), "");
  assert.equal(extractOpenCodeText(""), "");
  assert.equal(extractOpenCodeText("not json"), "");
});

test("extractOpenCodeText handles text without think blocks unchanged", () => {
  const line = JSON.stringify({
    type: "text",
    part: { type: "text", text: "plain response" }
  });
  assert.equal(extractOpenCodeText(line), "plain response");
});

test("extractOpenCodeSessionId extracts sessionID from any event", () => {
  const line = JSON.stringify({ type: "text", sessionID: "ses_abc" });
  assert.equal(extractOpenCodeSessionId(line), "ses_abc");
  assert.equal(extractOpenCodeSessionId('{"type":"step_start"}'), "");
  assert.equal(extractOpenCodeSessionId("not json"), "");
});

test("stripThinkingBlocks handles multiline think blocks", () => {
  const input = "before<think>line1\nline2\nline3</think>after";
  assert.equal(stripThinkingBlocks(input), "beforeafter");
});

test("stripThinkingBlocks leaves text without think untouched", () => {
  assert.equal(stripThinkingBlocks("plain"), "plain");
  assert.equal(stripThinkingBlocks(""), "");
});

// ---------------------------------------------------------------------------
// Mock event stream — exercises the parsers with the exact JSONL shape that
// runMockCodex / runMockOpencode emit. If the real CLI changes format, this
// suite should be updated alongside the mock functions.
// ---------------------------------------------------------------------------

test("mock codex event stream produces a coherent multi-chunk reply", () => {
  const events = [
    JSON.stringify({ type: "thread.started", thread_id: "mock-thread-1" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "收到。" } }),
    JSON.stringify({ type: "item.completed", item: { id: "i2", type: "agent_message", text: "这是 mock 模式下的 Codex 假回复，" } }),
    JSON.stringify({ type: "item.completed", item: { id: "i3", type: "agent_message", text: "用来在没有 codex CLI 的机器上演示流式输出。" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 0, output_tokens: 0 } })
  ];

  let body = "";
  let capturedThreadId = "";
  for (const line of events) {
    capturedThreadId = capturedThreadId || extractCodexThreadId(line);
    const chunk = extractCodexText(line);
    if (chunk) body += chunk;
  }

  assert.equal(capturedThreadId, "mock-thread-1");
  assert.equal(
    body,
    "收到。这是 mock 模式下的 Codex 假回复，用来在没有 codex CLI 的机器上演示流式输出。"
  );
});

test("mock opencode event stream produces a coherent reply with <think> stripped", () => {
  const events = [
    JSON.stringify({ type: "step_start", sessionID: "mock-ses-1" }),
    JSON.stringify({ type: "text", part: { type: "text", text: "Hi 神~ " } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "这是 mock 模式跑的 opencode 假回复，\n\n" } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "<think>让我想想怎么回比较有意思</think>你应该只看到这一句。" } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish", tokens: {} } })
  ];

  let body = "";
  let capturedSessionId = "";
  for (const line of events) {
    capturedSessionId = capturedSessionId || extractOpenCodeSessionId(line);
    const chunk = extractOpenCodeText(line);
    if (chunk) body += chunk;
  }

  assert.equal(capturedSessionId, "mock-ses-1");
  assert.equal(body, "Hi 神~ 这是 mock 模式跑的 opencode 假回复，\n\n你应该只看到这一句。");
  assert.ok(!body.includes("让我想想"), "thinking content must not appear in body");
  assert.ok(!body.includes("<think>"), "think tag must be stripped");
});