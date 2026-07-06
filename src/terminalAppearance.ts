// Font stack: Latin glyphs use Cascadia Mono (PowerShell default), CJK
// glyphs fall back to Noto Sans SC (思源黑体), HarmonyOS Sans SC, or
// Microsoft YaHei (微软雅黑). The "-Mono-" variants like "Noto Sans Mono
// CJK SC" don't ship in the basic Noto package; the SC weight variants
// are registered without the "Mono" suffix on this machine.
const WINDOWS_TERMINAL_FONT_FAMILY =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", "Noto Sans SC", "HarmonyOS Sans SC", "Microsoft YaHei", monospace';
const DEFAULT_TERMINAL_FONT_FAMILY =
  '"Cascadia Mono", "SF Mono", Menlo, Monaco, Consolas, "Cascadia Code", "DejaVu Sans Mono", "Courier New", "Noto Sans SC", "HarmonyOS Sans SC", "Microsoft YaHei", monospace';

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
