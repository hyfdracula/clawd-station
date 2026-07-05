// Remap ANSI SGR background colors to keep dark CLI TUIs (Codex, OpenCode)
// from drawing stark black input boxes that clash with Clawd Station's
// warm cream surface.
//
// Only BACKGROUND codes are touched — foreground colors, bold, underline,
// and other attributes pass through untouched so the CLI's own styling
// (warnings, syntax highlighting, prompts) still reads correctly.
//
// Mappings:
//   40  (black bg)           → 47  (white bg)
//   100 (bright black / gray) → 107 (bright white)
//
// Bright black (100) is usually used for "subtle" dark surfaces in modern
// TUIs; remapping it to bright white keeps that visual hierarchy.

const SGR_PATTERN = /\x1b\[([0-9;]*)m/g;

export function remapAnsiBackground(input: string): string {
  return input.replace(SGR_PATTERN, (match, params: string) => {
    if (params === "") return match; // \x1b[m is a full reset — leave it
    const parts = params.split(";").map((part) => {
      const code = parseInt(part, 10);
      if (code === 40) return "47";
      if (code === 100) return "107";
      return part;
    });
    return `\x1b[${parts.join(";")}m`;
  });
}