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
  extractKimiText,
  extractKimiSessionId,
  stripThinkingBlocks,
  createThinkBlockFilter,
  quoteCmdArg,
  resolveSpawnSpec,
  trustworthySessionId,
  detectEngineInstall,
  detectNpmInstall,
  installSpecFor,
  installCommandLabel
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

test("codex buildArgs puts exec-level flags BEFORE resume <id>", () => {
  const args = ENGINES.codex.buildArgs({
    prompt: "describe",
    cwd: "/tmp",
    sandbox: "read-only",
    sessionId: "thread-xyz",
    attachments: [{ name: "pic.png", path: "/tmp/pic.png" }]
  });
  assert.equal(args[0], "exec");
  const resumeIdx = args.indexOf("resume");
  assert.ok(resumeIdx > 0, "resume subcommand present");
  assert.equal(args[resumeIdx + 1], "thread-xyz");
  // Every exec-level flag must precede `resume` — codex parses flags after
  // the subcommand as resume's own (unknown) options.
  for (const flag of ["--json", "-C", "--sandbox", "--image"]) {
    const flagIdx = args.indexOf(flag);
    assert.ok(flagIdx > 0 && flagIdx < resumeIdx, `${flag} comes before resume`);
  }
  assert.ok(args.includes("/tmp/pic.png"));
  // Prompt is always last
  assert.equal(args[args.length - 1], "describe");
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
  // No sessionId -> fresh session. --continue would resume whatever session
  // happened to be latest, leaking into unrelated conversations.
  assert.ok(!args.includes("--continue"));
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

// ---------------------------------------------------------------------------
// Kimi JSONL parser — format verified against the installed kimi CLI:
// prompt mode --output-format stream-json emits role-based JSON lines
// ({role:"assistant",content:"..."}, {role:"meta",type:"session.resume_hint",
// session_id:"..."}).
// ---------------------------------------------------------------------------

test("extractKimiText pulls assistant content", () => {
  const line = JSON.stringify({ role: "assistant", content: "你好，我是 Kimi。" });
  assert.equal(extractKimiText(line), "你好，我是 Kimi。");
});

test("extractKimiText ignores meta/tool/user lines and junk", () => {
  assert.equal(extractKimiText(JSON.stringify({ role: "meta", type: "system.version", version: "1.0" })), "");
  assert.equal(extractKimiText(JSON.stringify({ role: "tool", tool_call_id: "t1", content: "out" })), "");
  assert.equal(extractKimiText(JSON.stringify({ role: "user", content: [{ type: "text", text: "hi" }] })), "");
  assert.equal(extractKimiText(JSON.stringify({ role: "assistant", tool_calls: [] })), "");
  assert.equal(extractKimiText(""), "");
  assert.equal(extractKimiText("not json"), "");
});

test("extractKimiSessionId captures session.resume_hint", () => {
  const line = JSON.stringify({
    role: "meta",
    type: "session.resume_hint",
    session_id: "abc123",
    command: "kimi -r abc123"
  });
  assert.equal(extractKimiSessionId(line), "abc123");
  assert.equal(extractKimiSessionId(JSON.stringify({ role: "assistant", content: "x" })), "");
  assert.equal(extractKimiSessionId("not json"), "");
});

test("kimi buildArgs only uses flags the real CLI supports", () => {
  const args = ENGINES.kimi.buildArgs({
    prompt: "hi",
    cwd: "/tmp",
    sandbox: "default",
    sessionId: null,
    attachments: []
  });
  assert.deepEqual(args, ["-p", "hi", "--output-format", "stream-json"]);
  // claude-only flags must NOT leak into the kimi invocation
  for (const bad of ["--verbose", "--include-partial-messages", "--permission-mode", "--safe-mode"]) {
    assert.ok(!args.includes(bad), `${bad} not supported by kimi`);
  }
});

test("kimi buildArgs maps sandbox modes and resumes with --resume", () => {
  const auto = ENGINES.kimi.buildArgs({ prompt: "x", sandbox: "acceptEdits", sessionId: null, attachments: [] });
  assert.ok(auto.includes("--auto"));
  assert.ok(!auto.includes("--yolo"));
  const yolo = ENGINES.kimi.buildArgs({ prompt: "x", sandbox: "bypassPermissions", sessionId: "s1", attachments: [] });
  assert.ok(yolo.includes("--yolo"));
  const idx = yolo.indexOf("--resume");
  assert.ok(idx >= 0 && yolo[idx + 1] === "s1", "--resume carries the session id");
});

test("kimi buildArgs embeds attachment paths into the prompt", () => {
  const args = ENGINES.kimi.buildArgs({
    prompt: "summarize",
    sandbox: "default",
    sessionId: null,
    attachments: [{ name: "note.txt", path: "/tmp/note.txt" }]
  });
  const promptArg = args[args.indexOf("-p") + 1];
  assert.ok(promptArg.includes("summarize"));
  assert.ok(promptArg.includes("/tmp/note.txt"));
});

test("kimi engine exposes parseEvent and session id extraction", () => {
  assert.equal(typeof ENGINES.kimi.parseEvent, "function");
  assert.equal(typeof ENGINES.kimi.extractSessionIdFromLine, "function");
  const saved = ENGINES.kimi.saveSessionId({ id: "c1" }, "k-ses");
  assert.equal(saved.kimiSessionId, "k-ses");
  assert.equal(ENGINES.kimi.getSessionId(saved), "k-ses");
});

// ---------------------------------------------------------------------------
// trustworthySessionId — fresh conversations never resume a locally
// fabricated id; only ids captured from a real run (messages exist) resume.
// ---------------------------------------------------------------------------

test("trustworthySessionId rejects ids on conversations with no messages", () => {
  assert.equal(trustworthySessionId({ messages: [] }, "11111111-1111-4111-8111-111111111111"), "");
  assert.equal(trustworthySessionId({}, "some-id"), "");
  assert.equal(trustworthySessionId({ messages: [{ role: "user" }] }, "real-id"), "real-id");
  assert.equal(trustworthySessionId({ messages: [{ role: "user" }] }, null), "");
  assert.equal(trustworthySessionId({ messages: [{ role: "user" }] }, undefined), "");
});

// ---------------------------------------------------------------------------
// createThinkBlockFilter — <think> tags split across streamed events
// ---------------------------------------------------------------------------

test("createThinkBlockFilter strips tags split across chunks", () => {
  const filter = createThinkBlockFilter();
  let out = "";
  out += filter("answer<thi");
  out += filter("nk>secret");
  out += filter(" still secret</th");
  out += filter("ink>visible");
  assert.equal(out, "answervisible");
});

test("createThinkBlockFilter handles complete blocks and plain text", () => {
  const filter = createThinkBlockFilter();
  assert.equal(filter("a<think>x</think>b"), "ab");
  assert.equal(filter("plain"), "plain");
  assert.equal(filter(""), "");
});

test("createThinkBlockFilter drops a multi-chunk think block entirely", () => {
  const filter = createThinkBlockFilter();
  let out = "";
  out += filter("visible1<think>part1");
  out += filter("part2 part3");
  out += filter("part4</think>visible2");
  assert.equal(out, "visible1visible2");
});

// ---------------------------------------------------------------------------
// quoteCmdArg — MSVCRT / CommandLineToArgvW quoting for cmd.exe lines
// ---------------------------------------------------------------------------

test("quoteCmdArg leaves simple args untouched", () => {
  assert.equal(quoteCmdArg("claude"), "claude");
  assert.equal(quoteCmdArg("--output-format"), "--output-format");
  assert.equal(quoteCmdArg("C:\\npm\\claude.cmd"), "C:\\npm\\claude.cmd");
});

test("quoteCmdArg quotes args with spaces", () => {
  assert.equal(quoteCmdArg("hello world"), '"hello world"');
  assert.equal(quoteCmdArg("C:\\Program Files\\app\\x.cmd"), '"C:\\Program Files\\app\\x.cmd"');
  assert.equal(quoteCmdArg(""), '""');
});

test("quoteCmdArg escapes inner quotes and backslashes before quotes", () => {
  // inner " becomes \"
  assert.equal(quoteCmdArg('say "hi"'), '"say \\"hi\\""');
  // a backslash directly before an inner quote is doubled
  assert.equal(quoteCmdArg('a\\"b'), '"a\\\\\\"b"');
  // a bare trailing backslash needs no quotes (unquoted args get no
  // backslash processing from CommandLineToArgvW)
  assert.equal(quoteCmdArg("trail\\"), "trail\\");
  // ...but once quoting is required, trailing backslashes are doubled so the
  // closing quote isn't escaped
  assert.equal(quoteCmdArg("a b\\"), '"a b\\\\"');
  // backslashes NOT before a quote stay as-is
  assert.equal(quoteCmdArg("a\\b c"), '"a\\b c"');
});

// ---------------------------------------------------------------------------
// resolveSpawnSpec — Windows .cmd shim resolution
// ---------------------------------------------------------------------------

test("resolveSpawnSpec passes binaries through unchanged on non-Windows", () => {
  const spec = resolveSpawnSpec("claude", ["-p", "hi"], "darwin", () => {
    throw new Error("whereLookup must not be called off-win32");
  });
  assert.deepEqual(spec, { command: "claude", args: ["-p", "hi"], shell: false });
});

test("resolveSpawnSpec wraps a .cmd shim found by where.exe in cmd.exe", () => {
  const spec = resolveSpawnSpec("claude", ["-p", "hi"], "win32", () => [
    "C:\\Users\\x\\AppData\\Roaming\\npm\\claude",
    "C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd"
  ]);
  assert.ok(/cmd\.exe$/i.test(spec.command), "goes through cmd.exe");
  assert.deepEqual(spec.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(spec.shell, false);
  const line = spec.args[3];
  // path has no spaces -> no quoting needed (MSVCRT rules)
  assert.ok(line.startsWith("C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd "), "shim path first");
  assert.ok(line.endsWith("-p hi"), "args appended");
});

test("resolveSpawnSpec prefers a .exe when where.exe finds one", () => {
  const spec = resolveSpawnSpec("kimi", ["--version"], "win32", () => [
    "C:\\Users\\x\\.kimi-code\\bin\\kimi.exe"
  ]);
  assert.equal(spec.command, "C:\\Users\\x\\.kimi-code\\bin\\kimi.exe");
  assert.deepEqual(spec.args, ["--version"]);
  assert.equal(spec.shell, false);
});

test("resolveSpawnSpec uses explicit paths as-is (env override)", () => {
  // *_BIN pointing at a real file: no where lookup, no wrapping for .exe
  const exeSpec = resolveSpawnSpec("D:\\tools\\claude.exe", ["-p"], "win32", () => {
    throw new Error("whereLookup must not be called for explicit paths");
  });
  assert.deepEqual(exeSpec, { command: "D:\\tools\\claude.exe", args: ["-p"], shell: false });
  // ...but an explicit .cmd path still needs cmd.exe to run at all
  const cmdSpec = resolveSpawnSpec("D:\\tools\\claude.cmd", ["-p", "a b"], "win32", () => {
    throw new Error("whereLookup must not be called for explicit paths");
  });
  assert.ok(/cmd\.exe$/i.test(cmdSpec.command));
  assert.equal(cmdSpec.args[3], 'D:\\tools\\claude.cmd -p "a b"');
});

test("resolveSpawnSpec falls back to cmd.exe when nothing usable is found", () => {
  const spec = resolveSpawnSpec("missing-cli", ["--help"], "win32", () => []);
  assert.ok(/cmd\.exe$/i.test(spec.command));
  assert.equal(spec.args[3], "missing-cli --help");
});

test("resolveSpawnSpec quotes a .cmd path containing spaces", () => {
  const spec = resolveSpawnSpec("claude", ["-p", 'say "hi" there'], "win32", () => [
    "C:\\Program Files\\npm\\claude.cmd"
  ]);
  assert.equal(
    spec.args[3],
    '"C:\\Program Files\\npm\\claude.cmd" -p "say \\"hi\\" there"'
  );
});


// ---------------------------------------------------------------------------
// detectEngineInstall — env override wins, otherwise PATH lookup
// ---------------------------------------------------------------------------

test("detectEngineInstall honors an env override when the file exists", () => {
  const result = detectEngineInstall("claude", {
    platform: "win32",
    env: { CLAUDE_CODE_BIN: "D:\\tools\\claude.exe" },
    fileExists: () => true,
    pathLookup: () => {
      throw new Error("pathLookup must not run when the env override resolves");
    }
  });
  assert.deepEqual(result, { engine: "claude", installed: true, bin: "D:\\tools\\claude.exe" });
});

test("detectEngineInstall falls back from CLAUDE_CODE_BIN to CLAUDE_BIN", () => {
  const result = detectEngineInstall("claude", {
    platform: "darwin",
    env: { CLAUDE_BIN: "/opt/claude/bin/claude" },
    fileExists: (p) => p === "/opt/claude/bin/claude",
    pathLookup: () => ""
  });
  assert.equal(result.installed, true);
  assert.equal(result.bin, "/opt/claude/bin/claude");
});

test("detectEngineInstall ignores an env override pointing at a missing file", () => {
  const seen = [];
  const result = detectEngineInstall("codex", {
    platform: "win32",
    env: { CODEX_BIN: "D:\\gone\\codex.exe" },
    fileExists: () => false,
    pathLookup: (name) => {
      seen.push(name);
      return "C:\\npm\\codex.cmd";
    }
  });
  assert.deepEqual(seen, ["codex"], "falls through to PATH lookup with the bare CLI name");
  assert.equal(result.installed, true);
  assert.equal(result.bin, "C:\\npm\\codex.cmd");
});

test("detectEngineInstall reports missing when PATH lookup finds nothing", () => {
  const result = detectEngineInstall("kimi", {
    platform: "linux",
    env: {},
    fileExists: () => false,
    pathLookup: () => ""
  });
  assert.equal(result.installed, false);
  assert.equal(result.bin, "kimi", "bin falls back to the bare CLI name for display");
});

test("detectEngineInstall passes the platform through to the PATH lookup", () => {
  const calls = [];
  detectEngineInstall("opencode", {
    platform: "win32",
    env: {},
    fileExists: () => false,
    pathLookup: (name, platform) => {
      calls.push([name, platform]);
      return "";
    }
  });
  assert.deepEqual(calls, [["opencode", "win32"]]);
});

test("detectEngineInstall uses per-engine env vars and CLI names", () => {
  // kimi has exactly one override var; opencode resolves "opencode" on PATH.
  const kimi = detectEngineInstall("kimi", {
    env: { KIMI_BIN: "/x/kimi" },
    fileExists: () => true,
    pathLookup: () => ""
  });
  assert.equal(kimi.installed, true);
  const opencode = detectEngineInstall("opencode", {
    env: { KIMI_BIN: "/x/kimi" }, // wrong engine's var — must be ignored
    fileExists: () => true,
    pathLookup: () => ""
  });
  assert.equal(opencode.installed, false);
});

test("detectNpmInstall looks npm up on PATH", () => {
  const calls = [];
  const yes = detectNpmInstall({
    platform: "win32",
    pathLookup: (name, platform) => {
      calls.push([name, platform]);
      return "C:\\nodejs\\npm.cmd";
    }
  });
  assert.equal(yes, true);
  assert.deepEqual(calls, [["npm", "win32"]]);
  const no = detectNpmInstall({ pathLookup: () => "" });
  assert.equal(no, false);
});

// ---------------------------------------------------------------------------
// installSpecFor / installCommandLabel — whitelisted install commands
// ---------------------------------------------------------------------------

test("installSpecFor returns the verified npm command for each engine", () => {
  assert.deepEqual(installSpecFor("claude"), {
    command: "npm",
    args: ["install", "-g", "@anthropic-ai/claude-code"]
  });
  assert.deepEqual(installSpecFor("codex"), {
    command: "npm",
    args: ["install", "-g", "@openai/codex"]
  });
  assert.deepEqual(installSpecFor("opencode"), {
    command: "npm",
    args: ["install", "-g", "opencode-ai"]
  });
  assert.deepEqual(installSpecFor("kimi"), {
    command: "npm",
    args: ["install", "-g", "@moonshot-ai/kimi-code"]
  });
});

test("installSpecFor rejects unknown or injected engine values", () => {
  assert.equal(installSpecFor("gemini"), null);
  assert.equal(installSpecFor(""), null);
  assert.equal(installSpecFor(undefined), null);
  // Injection attempts must never reach a shell.
  assert.equal(installSpecFor("claude; rm -rf /"), null);
  assert.equal(installSpecFor("claude && calc"), null);
  // Every whitelisted command is a fixed argv list — no shell string.
  for (const spec of [installSpecFor("claude"), installSpecFor("codex"), installSpecFor("opencode"), installSpecFor("kimi")]) {
    assert.equal(spec.command, "npm");
    assert.ok(spec.args.every((arg) => !/[;&|]/.test(arg)), "no shell metacharacters in args");
  }
});

test("installCommandLabel renders the one-liner shown in the UI", () => {
  assert.equal(installCommandLabel("claude"), "npm install -g @anthropic-ai/claude-code");
  assert.equal(installCommandLabel("kimi"), "npm install -g @moonshot-ai/kimi-code");
  assert.equal(installCommandLabel("unknown"), "");
});
