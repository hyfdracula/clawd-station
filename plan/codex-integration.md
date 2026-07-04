# Plan: Pluggable AI Engines (Claude / Codex / OpenCode)

**Target**: 让 Clawd Station 支持三种 CLI 引擎并存 — `claude` / `codex` / `opencode`，每个会话独立选引擎。
**Status**: 设计中，等待神批准后开始实现
**Last updated**: 2026-07-05

---

## 1. 目标 / 非目标

### 目标
- 每个 conversation 持久化 `engine: "claude" | "codex" | "opencode"`
- 每个 conversation 持久化 `sandbox: "default" | "acceptEdits" | "bypassPermissions"` (claude)
                              | `"read-only" | "workspace-write" | "danger-full-access"` (codex)
                              | `"ask" | "auto"` (opencode)
- 三套 spawn 流水线复用同一套 IPC 通道 (`engine:chunk` / `engine:done` / `engine:error` / `engine:stderr`)
- 侧栏小角标区分引擎（⌘C / ⌘X / ⌘O）
- 新建会话 → 弹 engine + sandbox picker
- 老会话自动 backfill `engine: "claude"`、`sandbox: "default"`

### 非目标
- 不做 session 跨引擎合并（Claude session ≠ Codex session ≠ opencode session）
- 不做引擎热切换（同会话中途切换需要新建会话）
- 不替换 mock 模式（保留 `CLAUDE_TO_CODE_MOCK=1`）

---

## 2. 数据模型变更

### Conversation 新增字段
```ts
type Engine = "claude" | "codex" | "opencode";
type Sandbox =
  | "default" | "acceptEdits" | "bypassPermissions"        // claude
  | "read-only" | "workspace-write" | "danger-full-access"  // codex
  | "ask" | "auto";                                          // opencode

interface Conversation {
  id: string;
  claudeSessionId?: string;   // 保留，向后兼容
  codexSessionId?: string;    // 新增（exec resume 用）
  opencodeSessionId?: string; // 新增（--session 用）
  title: string;
  updatedAt: string;
  directory: string;
  status: "local" | "processing" | "synced";
  pinned: boolean;
  messages: Message[];
  attachments: Attachment[];
  engine: Engine;             // 新增，默认 "claude"
  sandbox: Sandbox;           // 新增，默认按引擎走 default
}
```

### Backfill 逻辑 (`readConversations`)
- 缺 `engine` → 补 `"claude"`
- 缺 `sandbox` → 补 `"default"`
- 老的 `claudeSessionId` 保留不动

### 新增 IPC 通道（部分重命名）
- 旧: `claude:send` / `claude:permission-answer` / `claude:chunk` / `claude:done` / `claude:error` / `claude:stderr` / `claude:permission`
- 新增（通用）: `engine:send` / `engine:permission-answer` / `engine:chunk` / `engine:done` / `engine:error` / `engine:stderr` / `engine:permission`
- **保留**旧的 `claude:*` 通道（向后兼容，新代码走 `engine:*`）

---

## 3. 引擎抽象层

新建 `electron/engines.cjs`，导出三个引擎配置：

```js
const ENGINES = {
  claude: {
    name: "Claude Code",
    abbr: "C",
    resolveBinary: () => process.env.CLAUDE_CODE_BIN || process.env.CLAUDE_BIN || "claude",
    buildArgs: ({ prompt, cwd, sandbox, sessionId }) => [
      "-p", prompt,
      "--verbose",
      "--safe-mode",
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--permission-mode", sandbox,  // "default" | "acceptEdits" | "bypassPermissions"
      ...(sessionId ? ["--resume", sessionId] : []),
    ],
    parseEvent: (line) => extractStreamText(line),  // 已存在
    resolveSessionId: (conversation, output) => conversation.claudeSessionId,
    saveSessionId: (conversation, id) => ({ ...conversation, claudeSessionId: id }),
    sandboxOptions: [
      { value: "default", label: "默认（每次确认）" },
      { value: "acceptEdits", label: "自动接受编辑" },
      { value: "bypassPermissions", label: "全部放行（危险）" },
    ],
  },

  codex: {
    name: "Codex CLI",
    abbr: "X",
    resolveBinary: () => process.env.CODEX_BIN || "codex",
    buildArgs: ({ prompt, cwd, sandbox, sessionId }) => [
      "exec",
      ...(sessionId ? ["resume", sessionId] : []),
      "-C", cwd,
      "--json",
      "--sandbox", sandbox,
      prompt,
    ],
    parseEvent: (line) => extractCodexText(line),  // 新写：处理 Codex JSONL 事件
    resolveSessionId: (conversation) => conversation.codexSessionId,
    saveSessionId: (conversation, id) => ({ ...conversation, codexSessionId: id }),
    sandboxOptions: [
      { value: "read-only", label: "只读" },
      { value: "workspace-write", label: "工作区可写" },
      { value: "danger-full-access", label: "完全访问（危险）" },
    ],
  },

  opencode: {
    name: "OpenCode",
    abbr: "O",
    resolveBinary: () => process.env.OPENCODE_BIN || "opencode",
    buildArgs: ({ prompt, cwd, sandbox, sessionId, attachments }) => [
      "run",
      "--dir", cwd,
      "--format", "json",
      ...(sessionId ? ["-s", sessionId] : ["--continue"]),
      ...(sandbox === "auto" ? ["--auto"] : []),
      ...(attachments?.length ? ["--file", ...attachments.map(a => a.path)] : []),
      prompt,
    ],
    parseEvent: (line) => extractOpenCodeText(line),  // 新写
    resolveSessionId: (conversation) => conversation.opencodeSessionId,
    saveSessionId: (conversation, id) => ({ ...conversation, opencodeSessionId: id }),
    sandboxOptions: [
      { value: "ask", label: "每次询问" },
      { value: "auto", label: "自动批准" },
    ],
  },
};
```

### `runEngine(conversation, prompt, attachments)` 统一入口
代替 `runClaude` / `runCodex` / `runOpenCode`，根据 `conversation.engine` 走对应配置：

```js
function runEngine({ conversationId, prompt, attachments }) {
  const conversation = findConversation(conversationId);
  const engine = ENGINES[conversation.engine];
  if (!engine) throw new Error(`Unknown engine: ${conversation.engine}`);

  const args = engine.buildArgs({
    prompt: buildEnginePrompt(conversation, normalizePrompt(prompt, attachments)),
    cwd: resolveCwd(conversation.directory),
    sandbox: conversation.sandbox,
    sessionId: engine.resolveSessionId(conversation),
    attachments,
  });

  const child = spawn(engine.resolveBinary(), args, {
    cwd: resolveCwd(conversation.directory),
    env: { ...process.env, FORCE_COLOR: "0" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // stdout / stderr / close 监听器照搬 Claude 的，但 parseEvent 走 engine.parseEvent
  child.stdout.on("data", buffer => {
    for (const line of splitLines(buffer)) {
      const chunk = engine.parseEvent(line);
      if (chunk) sendToRenderer("engine:chunk", { conversationId, messageId, chunk });
    }
  });

  child.on("close", code => {
    sendToRenderer(code === 0 ? "engine:done" : "engine:error", { ... });
  });
}
```

### Codex JSONL 事件解析

```js
function extractCodexText(line) {
  // Codex --json 输出形如:
  // {"type":"response.output_text.delta","delta":"..."}
  // {"type":"response.output_item.added","item":{"type":"message",...}}
  // {"type":"response.completed",...}
  try {
    const event = JSON.parse(line);
    if (event.type === "response.output_text.delta") return event.delta;
    if (event.type === "item.agent_message" && typeof event.item?.text === "string") return event.item.text;
  } catch {}
  return "";
}
```

### OpenCode JSONL 事件解析

```js
function extractOpenCodeText(line) {
  // opencode --format json 输出形如:
  // {"type":"text","content":"..."}
  // {"type":"step_start",...}
  // {"type":"step_finish",...}
  // {"type":"message","message":{"role":"assistant","content":...}}
  try {
    const event = JSON.parse(line);
    if (event.type === "text" && event.content) return event.content;
    if (event.type === "message" && event.message?.role === "assistant") {
      const c = event.message.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.filter(x => x.type === "text").map(x => x.text).join("");
    }
  } catch {}
  return "";
}
```

### Mock 模式扩展
- `CLAUDE_TO_CODE_MOCK=1` → 走 Claude mock（保留）
- `CLAWDS_MOCK_CODEX=1` → 走 Codex mock
- `CLAWDS_MOCK_OPENCODE=1` → 走 OpenCode mock

---

## 4. UI 变更

### 新建会话 picker (`src/components/NewConversationModal.tsx`)
- 三个按钮：⌘C Claude Code / ⌘X Codex CLI / ⌘O OpenCode
- 选中后弹 sandbox picker（按引擎显示对应选项）
- 确认后创建 conversation

### 侧栏小角标 (`src/components/ConversationList.tsx`)
- 每个会话标题前显示 `C` / `X` / `O` 小标（彩色或灰底白字）
- 鼠标悬停 tooltip：完整引擎名 + sandbox 模式

### 会话头部 (`src/App.tsx`)
- 显示 `Engine: Claude Code · Sandbox: 默认` 这种状态条
- 工作目录下面一行

### 设置页 (`src/App.tsx` 或独立组件)
- 显示三个引擎的版本 + 路径
- `claude --version` / `codex --version` / `opencode --version` 检测结果

---

## 5. 文件改动清单

| 文件 | 改动 | 行数估计 |
|---|---|---|
| `electron/main.cjs` | 新增 `runEngine` 通用入口；保留 `runClaude` 走 mock；新增 IPC `engine:*` | +150, -50 |
| `electron/engines.cjs` | **新建** — 三引擎配置 + 解析器 | +250 |
| `electron/preload.cjs` | 暴露 `engine:send` 等新通道 | +20 |
| `src/App.tsx` | 新建会话流程加 picker；侧栏小角标；头部引擎状态 | +80 |
| `src/components/NewConversationModal.tsx` | **新建** | +120 |
| `src/components/EngineBadge.tsx` | **新建** — 复用小角标 | +30 |
| `src/components/Settings.tsx`（如有） | 加引擎版本检测 | +50 |

总改动 ≈ +700 / -50

---

## 6. 实施阶段

### Phase 1: 数据模型 + backfill（无 UI 改动）
- `Conversation` 加 `engine` / `sandbox` / `codexSessionId` / `opencodeSessionId` 字段
- `readConversations` backfill 逻辑
- 验证：老 `conversations.json` 加载不报错

### Phase 2: 引擎抽象层（main 进程）
- 新建 `electron/engines.cjs`
- 新增 `runEngine`，保留 `runClaude` 兼容路径
- `extractCodexText` / `extractOpenCodeText` 解析器
- 新增 IPC 通道 `engine:*`
- 验证：`claude --version` 仍走原路径，新 `engine:send` 跑通 Claude

### Phase 3: UI picker + 角标
- `NewConversationModal` — engine + sandbox 选
- `EngineBadge` — 侧栏显示
- 头部引擎状态条
- 验证：能新建 Codex / OpenCode 会话，能看到角标

### Phase 4: 测试 + 文档
- `tests/` 加 `engines.test.cjs`（解析器单元测试）
- 跑 mock 模式验证三种引擎 UI 都正常
- 更新 README（新增"支持引擎"章节）

---

## 7. 风险与边界

| 风险 | 缓解 |
|---|---|
| Codex `--json` 事件 schema 可能跨版本变化 | 解析失败时回退到原始 stdout（不破坏，但失去流式） |
| OpenCode `run` 命令还在演进（v1.17 还算新） | 加 `--pure` 排除插件干扰；解析失败时打印原始 stderr 调试 |
| 三引擎并发跑 → 端口/PTY 资源 | PTY 是 per-session 的，spawn 走独立 stdio，问题不大 |
| 老的 `claude:permission` UI 逻辑要不要也引擎化 | 保留，仅 Claude 走；Codex/OpenCode sandbox 是会话级，不需要弹窗 |
| 沙盒选项语义不一致（"default" 在 Claude 是"每次确认"，在 Codex 是"只读"） | UI 上按引擎分组显示，避免混乱 |

---

## 8. 验证清单

- [ ] 老 `conversations.json` 加载不报错
- [ ] 新建 Claude 会话跑通（旧行为不变）
- [ ] 新建 Codex 会话跑通：`codex exec ... --json` 出流式文本
- [ ] 新建 OpenCode 会话跑通：`opencode run ... --format json` 出流式文本
- [ ] 三种引擎 mock 模式 UI 都正常
- [ ] 设置页能看到三个引擎的 `--version`
- [ ] 侧栏角标 + tooltip 正确
- [ ] 删除会话同步删除 transcript + 附件目录
- [ ] 桌面双击 .bat 启动正常（Windows 移植不破）
- [ ] `npm run package:win` 仍能出包

---

## 9. 不做（克制清单）

- ❌ 跨引擎 session 合并 / 迁移
- ❌ 同会话中途切换引擎
- ❌ 自动检测"哪个引擎最适合这个任务"
- ❌ 引擎配置 profile（每个用户多个 Codex profile）
- ❌ 引擎热更新（cli 升级检测）

---

## 关联

- [[project-clawd-station]] 项目记忆
- [[pdf-extract-skill]]（如需解析器测试 fixture）