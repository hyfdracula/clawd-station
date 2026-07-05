// Remap ANSI SGR background colors to keep dark CLI TUIs (Codex, OpenCode)
// from drawing stark black input boxes that clash with Clawd Station's
// warm cream surface.
//
// Only BACKGROUND codes are touched — foreground colors, bold, underline,
// and other attributes pass through untouched so the CLI's own styling
// (warnings, syntax highlighting, prompts) still reads correctly.
//
// Mappings (any of these triggers → remap the bg to a light equivalent):
//   Palette black bg:
//     40          → 47  (black bg → white bg)
//     100         → 107 (bright black bg → bright white bg)
//   256-color palette (modern TUIs prefer these over 16-color palette):
//     48;5;0      → 48;5;255  (basic-palette black via 256-color path)
//     48;5;8      → 48;5;255  (basic-palette bright black via 256-color path)
//     48;5;232–243 → 48;5;255 (grayscale ramp — dark half remapped to white)
//
// Heuristic: any background "darker than mid-gray" is treated as a black
// surface and lifted to white. Saturated dark colors (deep red, etc.) are
// preserved — only the dark neutrals clash with the cream UI.

const SGR_PATTERN = /\x1b\[([0-9;]*)m/g;

const DARK_256_PALETTE = new Set<number>([
  0, 8, // basic palette black / bright black
  232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243 // grayscale ramp dark half
]);

function remapBackgroundCode(part: string): string {
  const code = parseInt(part, 10);
  if (code === 40) return "47";
  if (code === 100) return "107";
  return part;
}

function remapBackgroundSubsequence(parts: string[]): string[] {
  // Look for 48;5;N pattern (set bg via 256-color palette) and remap dark N.
  for (let i = 0; i + 2 < parts.length; i++) {
    if (parts[i] === "48" && parts[i + 1] === "5") {
      const paletteIndex = parseInt(parts[i + 2], 10);
      if (DARK_256_PALETTE.has(paletteIndex)) {
        const next: string[] = [];
        next.push(...parts.slice(0, i));
        next.push("48", "5", "255");
        next.push(...parts.slice(i + 3));
        return next;
      }
    }
  }
  return parts;
}

export function remapAnsiBackground(input: string): string {
  return input.replace(SGR_PATTERN, (match, params: string) => {
    if (params === "") return match; // \x1b[m is a full reset — leave it
    const parts = params.split(";");
    const remapped = remapBackgroundSubsequence(parts).map(remapBackgroundCode);
    return `\x1b[${remapped.join(";")}m`;
  });
}