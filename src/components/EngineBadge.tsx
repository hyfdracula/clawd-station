// Small visual indicator for which AI engine a conversation is running.
// Shown in the sidebar conversation list and the workspace header.
import type { CSSProperties } from "react";

type EngineKey = "claude" | "codex" | "opencode";

interface EngineBadgeProps {
  engine?: EngineKey | string;
  size?: "sm" | "md";
}

const ENGINE_META: Record<string, { abbr: string; label: string; color: string }> = {
  claude: { abbr: "C", label: "Claude Code", color: "#D97757" },
  codex: { abbr: "X", label: "Codex CLI", color: "#10A37F" },
  opencode: { abbr: "O", label: "OpenCode", color: "#6366F1" }
};

export function EngineBadge({ engine, size = "sm" }: EngineBadgeProps) {
  const key = engine || "claude";
  const meta = ENGINE_META[key] || ENGINE_META.claude;
  const fontSize = size === "md" ? 11 : 9;
  const pad = size === "md" ? "4px 7px" : "2px 5px";

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: size === "md" ? 18 : 14,
    height: size === "md" ? 18 : 14,
    padding: pad,
    borderRadius: 4,
    background: meta.color,
    color: "#fff",
    fontSize,
    fontWeight: 600,
    letterSpacing: 0.3,
    flexShrink: 0,
    userSelect: "none"
  };

  return (
    <span style={style} title={meta.label} aria-label={meta.label}>
      {meta.abbr}
    </span>
  );
}

export function engineLabel(engine?: string): string {
  return ENGINE_META[engine || "claude"]?.label || "Claude Code";
}