// Match the font the user's local PowerShell uses so xterm output looks
// identical to what they'd see running the same command in a PowerShell
// tab. On Windows 11 that's "Cascadia Mono" (Windows Terminal default);
// older systems fall back to Consolas / Cascadia Code / Courier New.
// Source Han Sans SC / Noto Sans Mono CJK SC are added as fallbacks so
// 中文 in CLI output renders in 思源黑体 instead of 仿宋.
const WINDOWS_TERMINAL_FONT_FAMILY =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", "Source Han Sans SC", "Noto Sans Mono CJK SC", monospace';
const DEFAULT_TERMINAL_FONT_FAMILY =
  '"Cascadia Mono", "SF Mono", Menlo, Monaco, Consolas, "Cascadia Code", "DejaVu Sans Mono", "Courier New", "Source Han Sans SC", "Noto Sans Mono CJK SC", monospace';

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
