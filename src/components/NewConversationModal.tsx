// Modal picker for choosing AI engine + sandbox + working directory when
// creating a new conversation. The directory step is optional — the user
// can keep the default (their home directory) by leaving the field alone.
import { useEffect, useMemo, useState } from "react";
import { FolderOpen, X } from "lucide-react";

type EngineKey = WorkbenchEngine;
type Sandbox = WorkbenchSandbox;

interface EngineInfo {
  key: EngineKey;
  name: string;
  abbr: string;
  defaultSandbox: Sandbox;
  sandboxOptions: { value: Sandbox; label: string }[];
}

interface NewConversationModalProps {
  engines: EngineInfo[];
  homeDir?: string;
  initialEngine?: EngineKey;
  initialSandbox?: Sandbox;
  initialDirectory?: string;
  onConfirm: (engine: EngineKey, sandbox: Sandbox, directory: string) => void;
  onCancel: () => void;
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || trimmed || path;
}

export function NewConversationModal({
  engines,
  homeDir,
  initialEngine,
  initialSandbox,
  initialDirectory,
  onConfirm,
  onCancel
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

  // When engine changes, snap sandbox to that engine's default (unless user already set one)
  useEffect(() => {
    if (current && !current.sandboxOptions.some((o) => o.value === sandbox)) {
      setSandbox(current.defaultSandbox);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, current]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  async function pickDirectory() {
    const picked = await window.workbench?.pickDirectory?.();
    if (picked) setDirectory(picked);
  }

  const directoryIsDefault =
    !directory || (homeDir && directory === homeDir);
  const directoryDisplay = directoryIsDefault
    ? homeDir
      ? "默认（" + basename(homeDir) + "）"
      : "默认"
    : basename(directory);

  const meta: Record<string, { abbr: string; color: string }> = {
    claude: { abbr: "C", color: "#D97757" },
    codex: { abbr: "X", color: "#10A37F" },
    opencode: { abbr: "O", color: "#6366F1" }
  };

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal-card"
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
            <label className="modal-label">引擎</label>
            <div className="engine-picker" role="radiogroup" aria-label="选择 AI 引擎">
              {engines.map((e) => {
                const m = meta[e.key] || meta.claude;
                const isActive = e.key === engine;
                return (
                  <button
                    key={e.key}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    className={`engine-option ${isActive ? "is-active" : ""}`}
                    onClick={() => setEngine(e.key)}
                  >
                    <span
                      className="engine-option-mark"
                      style={{ background: m.color }}
                      aria-hidden="true"
                    >
                      {m.abbr}
                    </span>
                    <span className="engine-option-text">
                      <strong>{e.name}</strong>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

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
            onClick={() => onConfirm(engine, sandbox, directory)}
            disabled={!current}
          >
            创建
          </button>
        </footer>
      </div>
    </div>
  );
}