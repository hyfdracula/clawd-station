// Modal picker for choosing AI engine + sandbox when creating a new conversation.
// Lists the engines registered in the main process and lets the user pick
// a sandbox mode appropriate for that engine.
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

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
  initialEngine?: EngineKey;
  initialSandbox?: Sandbox;
  onConfirm: (engine: EngineKey, sandbox: Sandbox) => void;
  onCancel: () => void;
}

export function NewConversationModal({
  engines,
  initialEngine,
  initialSandbox,
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
            onClick={() => onConfirm(engine, sandbox)}
            disabled={!current}
          >
            创建
          </button>
        </footer>
      </div>
    </div>
  );
}