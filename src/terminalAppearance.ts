const WINDOWS_TERMINAL_FONT_FAMILY =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", SimHei, "黑体", "Microsoft YaHei", "Sarasa Mono SC", "Noto Sans Mono CJK SC", monospace';
const DEFAULT_TERMINAL_FONT_FAMILY =
  '"SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, "Cascadia Code", "DejaVu Sans Mono", SimHei, "黑体", "Microsoft YaHei", "Sarasa Mono SC", "Noto Sans Mono CJK SC", monospace';

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
