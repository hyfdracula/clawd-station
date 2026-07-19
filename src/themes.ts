// Theme registry for Clawd Station.
//
// Each theme is a complete visual world: backdrop + texture, card surfaces,
// typography, radii, accent system, and an xterm palette. The shell layout
// (floating cards over a themed backdrop) is shared — themes restyle it,
// they do not rearrange it.

export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  // ANSI 16 — shared defaults are fine for dark terminals; light terminals
  // should tune black/brightBlack so CLI output stays legible.
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface ThemeDefinition {
  id: string;
  /** 中文名 + 英文标注，展示在主题选择器里。 */
  name: string;
  /** 一句话气质描述。 */
  vibe: string;
  /** 选择器里的三色速览点：背景 / 卡片 / 强调色。 */
  swatch: [string, string, string];
  /** 注入到 :root 的 CSS 变量。 */
  vars: Record<string, string>;
  /** 主题专属覆写 CSS（纹理、辉光、特殊边框等），注入一次。 */
  extraCss: string;
  xterm: XtermTheme;
}

const MONO = '"Cascadia Code", ui-monospace, Consolas, "Microsoft YaHei", monospace';
const MONO_RAW = '"Cascadia Code", ui-monospace, Consolas, monospace';
const SANS = '"Space Grotesk Variable", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif';
const SERIF = 'Georgia, "Songti SC", "SimSun", "Noto Serif CJK SC", serif';

// Motion is intentionally NOT part of the theme: the --t-fast / --t-med /
// --t-slow / --ease tokens come from the behavior settings' motion level
// (see MOTION_PACKS in App.tsx), injected onto :root after the theme vars.
const DARK_ANSI: Partial<XtermTheme> = {
  black: "#0C0D0F",
  red: "#E06C75",
  green: "#98C379",
  yellow: "#E5C07B",
  blue: "#61AFEF",
  magenta: "#C678DD",
  cyan: "#56B6C2",
  white: "#ABB2BF",
  brightBlack: "#5C6370",
  brightRed: "#E06C75",
  brightGreen: "#98C379",
  brightYellow: "#E5C07B",
  brightBlue: "#61AFEF",
  brightMagenta: "#C678DD",
  brightCyan: "#56B6C2",
  brightWhite: "#FFFFFF"
};

export const THEMES: ThemeDefinition[] = [
  {
    id: "console",
    name: "墨岩 Console",
    vibe: "默认 · 暗色编辑器控制台",
    swatch: ["#0C0D0F", "#121316", "#E8703A"],
    vars: {
      "--font-ui": SANS,
      "--font-mono": MONO_RAW,
      "--backdrop": "#0C0D0F",
      "--surface": "#121316",
      "--surface-2": "#191C21",
      "--line": "rgb(255 255 255 / 0.07)",
      "--line-strong": "rgb(255 255 255 / 0.13)",
      "--ink": "#E9E7E4",
      "--dim": "#9C978F",
      "--faint": "#625E59",
      "--accent": "#E8703A",
      "--accent-2": "#FFB48A",
      "--accent-ink": "#0C0D0F",
      "--active-bg": "rgb(232 112 58 / 0.14)",
      "--inset": "#0A0B0D",
      "--radius": "10px",
      "--card-shadow": "0 12px 40px rgb(0 0 0 / 0.45)",
      "--danger": "#DA6157",
      "--ok": "#55A883"
    },
    extraCss: "",
    xterm: { background: "#0C0D0F", foreground: "#E9E7E4", cursor: "#E8703A", cursorAccent: "#0C0D0F", selectionBackground: "#3B3733", ...DARK_ANSI }
  },

  {
    id: "iron",
    name: "玄铁 Industrial",
    vibe: "工业钢灰 · 等宽字体 · 直角",
    swatch: ["#14161A", "#1B1E24", "#F0A53A"],
    vars: {
      "--font-ui": MONO,
      "--font-mono": MONO_RAW,
      "--backdrop": "#0F1114",
      "--surface": "#1B1E24",
      "--surface-2": "#22262E",
      "--line": "#2E333D",
      "--line-strong": "#3D434F",
      "--ink": "#D7DBE2",
      "--dim": "#7D8590",
      "--faint": "#4E5560",
      "--accent": "#F0A53A",
      "--accent-2": "#5B8DD9",
      "--accent-ink": "#14161A",
      "--active-bg": "#262B33",
      "--inset": "#101216",
      "--radius": "2px",
      "--card-shadow": "0 10px 32px rgb(0 0 0 / 0.5)",
      "--danger": "#E06C6C",
      "--ok": "#7FBF7F"
    },
    extraCss: `
      .search-field input, .session-item, .engine-guide, .modal { letter-spacing: 0.03em; }
    `,
    xterm: { background: "#14161A", foreground: "#D7DBE2", cursor: "#F0A53A", cursorAccent: "#14161A", selectionBackground: "#333A45", ...DARK_ANSI }
  },

  {
    id: "sakura",
    name: "樱语 Sakura",
    vibe: "奶白樱粉 · 柔和大圆角",
    swatch: ["#F3E6EA", "#FFFBFC", "#E5739A"],
    vars: {
      "--font-ui": SANS,
      "--font-mono": MONO_RAW,
      "--backdrop": "#F3E6EA",
      "--surface": "#FFFBFC",
      "--surface-2": "#F9EFF3",
      "--line": "#F0D8E0",
      "--line-strong": "#E3C2CE",
      "--ink": "#523943",
      "--dim": "#B08E9A",
      "--faint": "#CFB4BF",
      "--accent": "#E5739A",
      "--accent-2": "#9C86D9",
      "--accent-ink": "#FFFFFF",
      "--active-bg": "#FBE3EC",
      "--inset": "#F7EDF1",
      "--radius": "24px",
      "--card-shadow": "0 10px 30px rgb(196 110 140 / 0.16)",
      "--danger": "#D95F6E",
      "--ok": "#5FA87C"
    },
    extraCss: `
      body { background-image: radial-gradient(circle at 12% 20%, rgb(229 115 154 / 0.10), transparent 40%), radial-gradient(circle at 85% 80%, rgb(156 134 217 / 0.10), transparent 45%); }
    `,
    xterm: { background: "#2E232A", foreground: "#F4E9ED", cursor: "#E5739A", cursorAccent: "#2E232A", selectionBackground: "#5A4049", ...DARK_ANSI, black: "#2E232A", brightBlack: "#6B525C" }
  },

  {
    id: "rose",
    name: "蔷薇 Rosé",
    vibe: "干枯玫瑰 · 玫瑰金",
    swatch: ["#F5EBE6", "#FDF7F3", "#C4717B"],
    vars: {
      "--font-ui": SANS,
      "--font-mono": MONO_RAW,
      "--backdrop": "#F5EBE6",
      "--surface": "#FDF7F3",
      "--surface-2": "#F8EEE8",
      "--line": "#EBD8D2",
      "--line-strong": "#DDBFC0",
      "--ink": "#503A3E",
      "--dim": "#A98A8C",
      "--faint": "#CBAFB1",
      "--accent": "#C4717B",
      "--accent-2": "#D9A441",
      "--accent-ink": "#FFFFFF",
      "--active-bg": "#F7E3E1",
      "--inset": "#F7ECE6",
      "--radius": "20px",
      "--card-shadow": "0 10px 28px rgb(183 110 121 / 0.16)",
      "--danger": "#C25B5B",
      "--ok": "#7A9E7E"
    },
    extraCss: `
      body { background-image: radial-gradient(circle at 16% 12%, rgb(196 113 123 / 0.10), transparent 42%), radial-gradient(circle at 84% 88%, rgb(217 164 65 / 0.09), transparent 46%); }
    `,
    xterm: { background: "#2B1E20", foreground: "#F2E4E0", cursor: "#C4717B", cursorAccent: "#2B1E20", selectionBackground: "#4E3338", ...DARK_ANSI, black: "#2B1E20", brightBlack: "#6B4A4E" }
  },

  {
    id: "neon",
    name: "霓光 Neon",
    vibe: "赛博纯黑 · 青品红辉光",
    swatch: ["#05060A", "#080B13", "#22E6FF"],
    vars: {
      "--font-ui": MONO,
      "--font-mono": MONO_RAW,
      "--backdrop": "#05060A",
      "--surface": "#080B13",
      "--surface-2": "#0D1120",
      "--line": "#1B2440",
      "--line-strong": "#2A3860",
      "--ink": "#D9F4FF",
      "--dim": "#5B6B8C",
      "--faint": "#3A4763",
      "--accent": "#22E6FF",
      "--accent-2": "#FF3DF0",
      "--accent-ink": "#05060A",
      "--active-bg": "rgb(34 230 255 / 0.10)",
      "--inset": "#05070C",
      "--radius": "4px",
      "--card-shadow": "0 0 0 1px rgb(34 230 255 / 0.12), 0 10px 34px rgb(0 0 0 / 0.6)",
      "--danger": "#FF4D6D",
      "--ok": "#39FF9C"
    },
    extraCss: `
      body { background-image: linear-gradient(rgb(34 230 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(34 230 255 / 0.05) 1px, transparent 1px); background-size: 34px 34px; }
      .card { box-shadow: 0 0 0 1px rgb(34 230 255 / 0.14), 0 0 24px rgb(34 230 255 / 0.07), var(--card-shadow); }
      .session-item.is-active { box-shadow: inset 0 0 0 1px var(--accent), 0 0 16px rgb(34 230 255 / 0.30); }
      .brand-mark { filter: drop-shadow(0 0 6px rgb(34 230 255 / 0.6)); }
    `,
    xterm: { background: "#05060A", foreground: "#D9F4FF", cursor: "#22E6FF", cursorAccent: "#05060A", selectionBackground: "#1E3A55", ...DARK_ANSI, green: "#39FF9C", brightGreen: "#39FF9C" }
  },

  {
    id: "scholar",
    name: "墨香 Scholar",
    vibe: "宣纸衬线 · 朱砂印章",
    swatch: ["#F1EBDC", "#F8F3E7", "#B03A2E"],
    vars: {
      "--font-ui": SERIF,
      "--font-mono": 'Consolas, "Songti SC", "SimSun", serif',
      "--backdrop": "#E9E1CC",
      "--surface": "#F8F3E7",
      "--surface-2": "#F1EAD8",
      "--line": "#D9CEB2",
      "--line-strong": "#C4B595",
      "--ink": "#2C2620",
      "--dim": "#93876D",
      "--faint": "#BDB295",
      "--accent": "#B03A2E",
      "--accent-2": "#1F3A5F",
      "--accent-ink": "#F8F3E7",
      "--active-bg": "rgb(176 58 46 / 0.08)",
      "--inset": "#EDE5D0",
      "--radius": "3px",
      "--card-shadow": "0 8px 28px rgb(90 74 40 / 0.18)",
      "--danger": "#B03A2E",
      "--ok": "#3F6B4F"
    },
    extraCss: `
      body { background-image: radial-gradient(rgb(44 38 32 / 0.05) 1px, transparent 1px); background-size: 5px 5px; }
      .card { border: 1px solid var(--line); }
      .brand-name { letter-spacing: 0.18em; }
    `,
    xterm: {
      background: "#FBF7EC", foreground: "#33291C", cursor: "#B03A2E", cursorAccent: "#FBF7EC", selectionBackground: "#E4D8B8",
      black: "#33291C", red: "#B03A2E", green: "#3F6B4F", yellow: "#9A7B24", blue: "#1F3A5F", magenta: "#7C4A72", cyan: "#2F6F6A", white: "#EFE7D2",
      brightBlack: "#93876D", brightRed: "#C24A3C", brightGreen: "#4F8263", brightYellow: "#B2922E", brightBlue: "#2C4F7C", brightMagenta: "#935A87", brightCyan: "#3A8580", brightWhite: "#FBF7EC"
    }
  },

  {
    id: "meadow",
    name: "青野 Meadow",
    vibe: "苔绿燕麦 · 自然有机",
    swatch: ["#E9F0E2", "#F6FAF0", "#5D8F54"],
    vars: {
      "--font-ui": SANS,
      "--font-mono": MONO_RAW,
      "--backdrop": "#E9F0E2",
      "--surface": "#F6FAF0",
      "--surface-2": "#EDF4E4",
      "--line": "#D3DFC6",
      "--line-strong": "#BCCBAD",
      "--ink": "#35422E",
      "--dim": "#82936F",
      "--faint": "#ADBC9C",
      "--accent": "#5D8F54",
      "--accent-2": "#C98F4E",
      "--accent-ink": "#FFFFFF",
      "--active-bg": "#E2EFD8",
      "--inset": "#EDF3E4",
      "--radius": "26px",
      "--card-shadow": "0 8px 26px rgb(93 143 84 / 0.16)",
      "--danger": "#C25B4E",
      "--ok": "#5D8F54"
    },
    extraCss: `
      body { background-image: radial-gradient(circle at 80% 10%, rgb(201 143 78 / 0.10), transparent 45%), radial-gradient(circle at 15% 85%, rgb(93 143 84 / 0.12), transparent 40%); }
      .session-item.is-active { box-shadow: inset 0 0 0 1.5px #9CCB7F; }
    `,
    xterm: { background: "#26301F", foreground: "#E9F0DC", cursor: "#9CCB7F", cursorAccent: "#26301F", selectionBackground: "#3E4E33", ...DARK_ANSI, black: "#26301F", brightBlack: "#5A6B4C", green: "#9CCB7F", brightGreen: "#9CCB7F" }
  },

  {
    id: "abyss",
    name: "深海 Abyss",
    vibe: "海军蓝玻璃 · 海沫青光",
    swatch: ["#071321", "#0B1E31", "#35D0BA"],
    vars: {
      "--font-ui": SANS,
      "--font-mono": MONO_RAW,
      "--backdrop": "#071321",
      "--surface": "#0B1E31",
      "--surface-2": "#102840",
      "--line": "#16344C",
      "--line-strong": "#1F4A6B",
      "--ink": "#D4E7F5",
      "--dim": "#5F8199",
      "--faint": "#3E5B70",
      "--accent": "#35D0BA",
      "--accent-2": "#4F9CF0",
      "--accent-ink": "#06232A",
      "--active-bg": "rgb(53 208 186 / 0.10)",
      "--inset": "#081627",
      "--radius": "10px",
      "--card-shadow": "0 12px 36px rgb(0 0 0 / 0.5)",
      "--danger": "#E0606E",
      "--ok": "#4ADE80"
    },
    extraCss: `
      body { background-image: radial-gradient(ellipse 90% 60% at 50% 115%, rgb(53 208 186 / 0.12), transparent 60%); }
      .card { background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: blur(6px); }
    `,
    xterm: { background: "#071321", foreground: "#D4E7F5", cursor: "#35D0BA", cursorAccent: "#071321", selectionBackground: "#1D3D55", ...DARK_ANSI }
  },

  {
    id: "cream",
    name: "暖阳 Cream",
    vibe: "奶油焦糖 · 晨间暖光",
    swatch: ["#F7F1E4", "#FFFAF0", "#D97B36"],
    vars: {
      "--font-ui": SANS,
      "--font-mono": MONO_RAW,
      "--backdrop": "#F1E7D2",
      "--surface": "#FFFAF0",
      "--surface-2": "#F8EFDD",
      "--line": "#E7DAC0",
      "--line-strong": "#D8C6A4",
      "--ink": "#473B2A",
      "--dim": "#A49372",
      "--faint": "#C6B797",
      "--accent": "#D97B36",
      "--accent-2": "#7A9E7E",
      "--accent-ink": "#FFFFFF",
      "--active-bg": "#F5E7CF",
      "--inset": "#F3EAD7",
      "--radius": "12px",
      "--card-shadow": "0 10px 28px rgb(150 110 60 / 0.16)",
      "--danger": "#C25B4E",
      "--ok": "#6FA06A"
    },
    extraCss: `
      body { background-image: radial-gradient(circle at 75% 15%, rgb(217 123 54 / 0.10), transparent 45%); }
    `,
    xterm: { background: "#33291C", foreground: "#F3E9D5", cursor: "#D97B36", cursorAccent: "#33291C", selectionBackground: "#57462F", ...DARK_ANSI, black: "#33291C", brightBlack: "#6B5A41" }
  },

  {
    id: "violet",
    name: "紫霄 Ultraviolet",
    vibe: "暗夜紫罗兰 · 星点辉光",
    swatch: ["#100A1E", "#18102C", "#A06BFF"],
    vars: {
      "--font-ui": SANS,
      "--font-mono": MONO_RAW,
      "--backdrop": "#100A1E",
      "--surface": "#18102C",
      "--surface-2": "#1F1638",
      "--line": "#2C1E4E",
      "--line-strong": "#3E2A68",
      "--ink": "#E6DCFF",
      "--dim": "#8571B8",
      "--faint": "#554380",
      "--accent": "#A06BFF",
      "--accent-2": "#FF6BD6",
      "--accent-ink": "#FFFFFF",
      "--active-bg": "rgb(160 107 255 / 0.12)",
      "--inset": "#0D0819",
      "--radius": "12px",
      "--card-shadow": "0 12px 36px rgb(0 0 0 / 0.55)",
      "--danger": "#E0566E",
      "--ok": "#6EE7B7"
    },
    extraCss: `
      body { background-image: radial-gradient(rgb(230 220 255 / 0.12) 1px, transparent 1.2px), radial-gradient(ellipse 100% 55% at 50% 120%, rgb(160 107 255 / 0.16), transparent 65%); background-size: 90px 90px, 100% 100%; }
      .session-item.is-active { box-shadow: inset 0 0 0 1px var(--accent), 0 0 18px rgb(160 107 255 / 0.25); }
    `,
    xterm: { background: "#100A1E", foreground: "#E6DCFF", cursor: "#A06BFF", cursorAccent: "#100A1E", selectionBackground: "#3A2A63", ...DARK_ANSI }
  },

  {
    id: "mono",
    name: "银翼 Mono",
    vibe: "极简灰阶 · 一点蓝",
    swatch: ["#FAFAFA", "#FFFFFF", "#2563EB"],
    vars: {
      "--font-ui": SANS,
      "--font-mono": MONO_RAW,
      "--backdrop": "#ECECEF",
      "--surface": "#FFFFFF",
      "--surface-2": "#F4F4F5",
      "--line": "#E4E4E7",
      "--line-strong": "#CFCFD6",
      "--ink": "#18181B",
      "--dim": "#9494A0",
      "--faint": "#C2C2CB",
      "--accent": "#2563EB",
      "--accent-2": "#18181B",
      "--accent-ink": "#FFFFFF",
      "--active-bg": "#EFF4FE",
      "--inset": "#F4F4F5",
      "--radius": "8px",
      "--card-shadow": "0 8px 26px rgb(24 24 27 / 0.10)",
      "--danger": "#DC2626",
      "--ok": "#16A34A"
    },
    extraCss: `
      .session-item.is-active { box-shadow: inset 2px 0 0 var(--accent); }
    `,
    xterm: { background: "#18181B", foreground: "#E4E4E7", cursor: "#2563EB", cursorAccent: "#18181B", selectionBackground: "#3F3F46", ...DARK_ANSI }
  },

  {
    id: "ember",
    name: "熔岩 Ember",
    vibe: "锻造炭黑 · 岩浆橙光",
    swatch: ["#170F0C", "#221511", "#FF5C1F"],
    vars: {
      "--font-ui": SANS,
      "--font-mono": MONO_RAW,
      "--backdrop": "#170F0C",
      "--surface": "#221511",
      "--surface-2": "#2B1A14",
      "--line": "#3C241B",
      "--line-strong": "#553324",
      "--ink": "#F0E2D8",
      "--dim": "#A08070",
      "--faint": "#6B544A",
      "--accent": "#FF5C1F",
      "--accent-2": "#FFB347",
      "--accent-ink": "#170F0C",
      "--active-bg": "rgb(255 92 31 / 0.10)",
      "--inset": "#140C09",
      "--radius": "6px",
      "--card-shadow": "0 12px 36px rgb(0 0 0 / 0.55)",
      "--danger": "#E05656",
      "--ok": "#A3E635"
    },
    extraCss: `
      body { background-image: radial-gradient(circle at 20% 95%, rgb(255 92 31 / 0.14), transparent 35%), radial-gradient(circle at 65% 98%, rgb(255 179 71 / 0.10), transparent 30%), radial-gradient(rgb(255 150 80 / 0.08) 1px, transparent 1.4px); background-size: 100% 100%, 100% 100%, 120px 120px; }
      .session-item.is-active { box-shadow: inset 2px 0 0 var(--accent); }
    `,
    xterm: { background: "#1C100B", foreground: "#F0DFCF", cursor: "#FF5C1F", cursorAccent: "#1C100B", selectionBackground: "#4A2B1C", ...DARK_ANSI, black: "#1C100B", brightBlack: "#6B4A3A" }
  }
];

export const DEFAULT_THEME_ID = "console";

export function getTheme(id: string | undefined | null): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
