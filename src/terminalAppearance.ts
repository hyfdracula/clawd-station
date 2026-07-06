// Match the font the user's local PowerShell uses so xterm output looks
// identical to what they'd see running the same command in a PowerShell
// tab. On Windows 11 that's "Cascadia Mono" (Windows Terminal default);
// older systems fall back to Consolas / Cascadia Code / Courier New.
const WINDOWS_TERMINAL_FONT_FAMILY =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';
const DEFAULT_TERMINAL_FONT_FAMILY =
  '"Cascadia Mono", "SF Mono", Menlo, Monaco, Consolas, "Cascadia Code", "DejaVu Sans Mono", "Courier New", monospace';

export function getTerminalFontFamily(
  platform: string = typeof navigator === "undefined" ? "" : navigator.platform
) {
  return /win/i.test(platform) ? WINDOWS_TERMINAL_FONT_FAMILY : DEFAULT_TERMINAL_FONT_FAMILY;
}

export function getTerminalRenderOptions(
  platform: string = typeof navigator === "undefined" ? "" : navigator.platform
) {
  return {
    customGlyphs: false,
    fontFamily: getTerminalFontFamily(platform),
    lineHeight: 1,
    rescaleOverlappingGlyphs: true
  };
}
