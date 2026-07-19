// Modal picker for choosing AI engine + sandbox + working directory (plus an
// optional output directory) when creating a new conversation. The directory
// step is optional — the user can keep the default (their home directory) by
// leaving the field alone.
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";

type EngineKey = WorkbenchEngine;
type Sandbox = WorkbenchSandbox;

// One-line pitch shown in the install guide when an engine's CLI is missing.
const ENGINE_BLURBS: Record<EngineKey, string> = {
  claude: "Anthropic 官方 CLI，Claude 模型驱动的终端编码助手。",
  codex: "OpenAI 官方 CLI，在终端里完成多文件编码任务。",
  opencode: "开源终端 AI 编码助手，可接入多家模型提供商。",
  kimi: "月之暗面官方 CLI，Kimi 模型驱动的终端编码助手。"
};

type EngineInstallStatus = "checking" | "installed" | "missing" | "unknown";

interface InstallRunState {
  engine: EngineKey;
  log: string;
  status: "running" | "done";
  code?: number;
  error?: string;
}

interface EngineInfo {
  key: EngineKey;
  name: string;
  abbr: string;
  defaultSandbox: Sandbox;
  sandboxOptions: { value: Sandbox; label: string }[];
}

interface NewConversationModalProps {
  /** Always mounted; `open` drives the .is-open enter/exit animation. */
  open: boolean;
  engines: EngineInfo[];
  homeDir?: string;
  initialEngine?: EngineKey;
  initialSandbox?: Sandbox;
  initialDirectory?: string;
  onConfirm: (engine: EngineKey, sandbox: Sandbox, directory: string, outputDir: string) => void;
  onCancel: () => void;
  /** Fired after the user picks an output directory — App shows the explainer. */
  onOutputDirPicked?: () => void;
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || trimmed || path;
}

export function NewConversationModal({
  open,
  engines,
  homeDir,
  initialEngine,
  initialSandbox,
  initialDirectory,
  onConfirm,
  onCancel,
  onOutputDirPicked
}: NewConversationModalProps) {
  const [engine, setEngine] = useState<EngineKey>(
    initialEngine || engines[0]?.key || "claude"
  );
  const current = useMemo(
    () => engines.find((e) => e.key === engine) || engines[0],
    [engines, engine]
  );
  const [sandbox, setSandbox] = useState<Sandbox>(
    initialSandbox || current?.defaultSandbox || "default"
  );
  // Working directory for the new conversation. Empty string = use default
  // (which the main process will resolve to the user's home directory).
  const [directory, setDirectory] = useState<string>(initialDirectory || "");
  // Optional output directory for generated files. Empty = follow the working
  // directory; when set, the CLI is told about it once at terminal spawn.
  const [outputDir, setOutputDir] = useState<string>("");

  // CLI install detection — runs each time the modal opens (main caches the
  // result). detectFailed means the IPC itself broke; in that case we show no
  // badges and never block creation on a guess. The modal stays mounted
  // across opens, so this is keyed on `open` rather than mount.
  const [detect, setDetect] = useState<EngineDetectResult | null>(null);
  const [detectFailed, setDetectFailed] = useState(false);
  // Live install run for the selected engine (log streamed from main).
  const [install, setInstall] = useState<InstallRunState | null>(null);
  const [copied, setCopied] = useState(false);
  const installLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    if (!window.workbench?.detectEngines) {
      setDetectFailed(true);
      return;
    }
    window.workbench
      .detectEngines()
      .then((result) => {
        if (mounted) setDetect(result);
      })
      .catch(() => {
        if (mounted) setDetectFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, [open]);

  // Streamed installer output. On success the detection state is refreshed so
  // the guide block flips to "installed" on its own.
  useEffect(() => {
    if (!window.workbench?.onEngineInstallProgress) return;
    const off = window.workbench.onEngineInstallProgress((event) => {
      setInstall((current) => {
        if (!current || current.engine !== event.engine) return current;
        if (event.done) {
          return { ...current, status: "done", code: event.code, error: event.error };
        }
        if (event.chunk) {
          // Cap the log so a long npm run can't grow the DOM unbounded.
          return { ...current, log: (current.log + event.chunk).slice(-20000) };
        }
        return current;
      });
      if (event.done && event.code === 0 && window.workbench?.detectEngines) {
        void window.workbench
          .detectEngines(true)
          .then((result) => setDetect(result))
          .catch(() => {});
      }
    });
    return off;
  }, []);

  // Keep the install log pinned to the bottom as output streams in.
  useEffect(() => {
    const node = installLogRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [install?.log, install?.status]);

  function statusFor(key: EngineKey): EngineInstallStatus {
    if (!detect) return detectFailed ? "unknown" : "checking";
    const entry = detect.engines.find((item) => item.engine === key);
    if (!entry) return "unknown";
    return entry.installed ? "installed" : "missing";
  }

  const selectedStatus = statusFor(engine);
  const selectedEntry = detect?.engines.find((item) => item.engine === engine);
  // Creation is blocked only on a definitive "not installed" — never while
  // checking and never when detection failed (would dead-end the button).
  const createBlocked = selectedStatus === "missing";
  const installForSelected = install && install.engine === engine ? install : null;

  async function startInstall() {
    if (!window.workbench?.installEngine) return;
    setInstall({ engine, log: "", status: "running" });
    const result = await window.workbench.installEngine(engine);
    if (!result.ok) {
      setInstall({ engine, log: "", status: "done", code: -1, error: result.error || "安装启动失败" });
    }
  }

  async function copyInstallCommand() {
    const command = selectedEntry?.install;
    if (!command) return;
    try {
      if (window.workbench?.clipboardWriteText) {
        await window.workbench.clipboardWriteText(command);
      } else {
        await navigator.clipboard.writeText(command);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  // When engine changes, snap sandbox to that engine's default (unless user already set one)
  useEffect(() => {
    if (current && !current.sandboxOptions.some((o) => o.value === sandbox)) {
      setSandbox(current.defaultSandbox);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, current]);

  // ESC to close (only while open — the modal stays mounted when closed)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  async function pickDirectory() {
    const picked = await window.workbench?.pickDirectory?.();
    if (picked) setDirectory(picked);
  }

  async function pickOutputDir() {
    const picked = await window.workbench?.pickDirectory?.();
    if (picked) {
      setOutputDir(picked);
      onOutputDirPicked?.();
    }
  }

  const directoryIsDefault =
    !directory || (homeDir && directory === homeDir);
  const directoryDisplay = directoryIsDefault
    ? homeDir
      ? "默认（" + basename(homeDir) + "）"
      : "默认"
    : basename(directory);

  // Keep in sync with EngineBadge's ENGINE_META (kimi included).
  const meta: Record<string, { abbr: string; color: string }> = {
    claude: { abbr: "C", color: "#D97757" },
    codex: { abbr: "X", color: "#10A37F" },
    opencode: { abbr: "O", color: "#6366F1" },
    kimi: { abbr: "K", color: "#141414" }
  };

  return (
    <div
      className={`modal-overlay ${open ? "is-open" : ""}`}
      aria-hidden={!open}
      onClick={open ? onCancel : undefined}
      role="presentation"
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-conv-title"
      >
        <header className="modal-header">
          <h3 id="new-conv-title">新建会话</h3>
          <button
            className="icon-button"
            type="button"
            onClick={onCancel}
            aria-label="关闭"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="modal-body">
          <section className="modal-section">
            <label className="modal-label">工作目录</label>
            <div className="directory-picker">
              <button
                type="button"
                className="directory-picker-current"
                onClick={pickDirectory}
                title="点击选择工作目录"
              >
                <FolderOpen aria-hidden="true" />
                <span className="directory-picker-name">{directoryDisplay}</span>
              </button>
              <div className="directory-picker-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={pickDirectory}
                >
                  选择…
                </button>
                {directory ? (
                  <button
                    type="button"
                    className="button-secondary subtle"
                    onClick={() => setDirectory("")}
                  >
                    用默认
                  </button>
                ) : null}
              </div>
            </div>
            <p className="directory-picker-hint">
              CLI 的工作目录就是这里选择的；输出文件、附件、git 操作都在这里面。
            </p>
          </section>

          <section className="modal-section">
            <label className="modal-label">输出目录（可选）</label>
            <div className="directory-picker">
              <button
                type="button"
                className="directory-picker-current"
                onClick={pickOutputDir}
                title={outputDir ? outputDir : "跟随工作目录"}
              >
                <FolderOpen aria-hidden="true" />
                <span className="directory-picker-name">{outputDir ? basename(outputDir) : "跟随工作目录"}</span>
              </button>
              <div className="directory-picker-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={pickOutputDir}
                >
                  选择…
                </button>
                {outputDir ? (
                  <button
                    type="button"
                    className="button-secondary subtle"
                    onClick={() => setOutputDir("")}
                    aria-label="清除输出目录"
                    title="清除输出目录"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            </div>
            <p className="directory-picker-hint">
              设置后，CLI 启动时会收到一条指令，把它生成的文件默认保存到这里。
            </p>
          </section>

          <section className="modal-section">
            <label className="modal-label">引擎</label>
            <div className="engine-picker" role="radiogroup" aria-label="选择 AI 引擎">
              {engines.map((e) => {
                const m = meta[e.key] || meta.claude;
                const isActive = e.key === engine;
                const status = statusFor(e.key);
                return (
                  <button
                    key={e.key}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    className={`engine-option ${isActive ? "is-active" : ""} ${status === "missing" ? "is-missing" : ""}`}
                    onClick={() => setEngine(e.key)}
                  >
                    {status === "checking" ? (
                      <span className="engine-option-dot is-checking" aria-hidden="true" />
                    ) : null}
                    {status === "missing" ? <span className="engine-option-dot" aria-hidden="true" /> : null}
                    <span
                      className="engine-option-mark"
                      style={{ background: m.color }}
                      aria-hidden="true"
                    >
                      {m.abbr}
                    </span>
                    <span className="engine-option-text">
                      <strong>{e.name}</strong>
                      {status === "missing" ? <small className="engine-option-state">未安装</small> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Install guide — only for a selected engine whose CLI is known
              missing. During an install it switches to the live log view. */}
          {selectedStatus === "missing" && selectedEntry ? (
            <section className="modal-section">
              {installForSelected ? (
                <div className="engine-install" aria-live="polite">
                  <div className="engine-install-log" ref={installLogRef}>
                    <pre>{installForSelected.log || "正在启动安装…\n"}</pre>
                  </div>
                  {installForSelected.status === "running" ? (
                    <p className="engine-install-status">正在安装，npm 全局安装可能需要一两分钟…</p>
                  ) : installForSelected.code === 0 ? (
                    <p className="engine-install-status is-ok">安装完成，正在刷新状态…</p>
                  ) : (
                    <div className="engine-install-status is-fail">
                      <p>
                        安装失败
                        {typeof installForSelected.code === "number" && installForSelected.code >= 0
                          ? `（退出码 ${installForSelected.code}）`
                          : ""}
                        {installForSelected.error ? `：${installForSelected.error}` : ""}
                      </p>
                      <button className="button-secondary" type="button" onClick={startInstall}>
                        重试
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="engine-guide">
                  <p className="engine-guide-desc">{ENGINE_BLURBS[engine]}</p>
                  <code className="engine-guide-command">{selectedEntry.install}</code>
                  <div className="engine-guide-actions">
                    <button className="button-secondary" type="button" onClick={copyInstallCommand}>
                      {copied ? "已复制" : "复制命令"}
                    </button>
                    <button
                      className="button-primary"
                      type="button"
                      onClick={startInstall}
                      disabled={!detect?.npm}
                      title={detect?.npm ? undefined : "需要 Node.js（未检测到 npm）"}
                    >
                      立即安装
                    </button>
                  </div>
                  {detect && !detect.npm ? (
                    <p className="engine-guide-npm">
                      未检测到 npm，自动安装需要 Node.js。请先到
                      {/* window.open is denied as a window by the main process
                          and forwarded to the system browser instead. */}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => window.open("https://nodejs.org", "_blank")}
                      >
                        nodejs.org
                      </button>
                      安装，或复制命令稍后手动执行。
                    </p>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {current && (
            <section className="modal-section">
              <label className="modal-label">权限模式</label>
              <div className="sandbox-picker" role="radiogroup" aria-label="选择权限模式">
                {current.sandboxOptions.map((opt) => {
                  const isActive = opt.value === sandbox;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      className={`sandbox-option ${isActive ? "is-active" : ""}`}
                      onClick={() => setSandbox(opt.value)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <footer className="modal-footer">
          <button className="button-secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="button-primary"
            type="button"
            onClick={() => onConfirm(engine, sandbox, directory, outputDir)}
            disabled={!current || createBlocked}
            title={createBlocked ? "该引擎的 CLI 未安装，请先在上方按引导安装" : undefined}
          >
            创建
          </button>
        </footer>
      </div>
    </div>
  );
}