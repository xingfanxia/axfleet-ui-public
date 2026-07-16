/**
 * axfleet palette — a direct port of clauth's cloudy-ui theme (src/tui/theme.rs).
 * Catppuccin Mocha is the only palette. Two capability tiers select color depth:
 * `full` uses 24-bit RGB; `compat` uses the nearest xterm-256 index. Every color
 * in the TUI comes from this module — raw escape codes anywhere else are a bug.
 */

export type Tier = 'full' | 'compat';

let activeTier: Tier | null = null;

/** `$COLORTERM=truecolor|24bit` → full; anything else → compat (xterm-256). */
export function detectTier(env: Record<string, string | undefined> = process.env): Tier {
  const ct = (env['COLORTERM'] ?? '').toLowerCase();
  return ct === 'truecolor' || ct === '24bit' ? 'full' : 'compat';
}

/** Seed at startup (CLI `--compat` forces 256-color). Falls back to detect. */
export function initTheme(override?: Tier): void {
  activeTier = override ?? detectTier();
}

export function tier(): Tier {
  return activeTier ?? detectTier();
}

/** One palette entry: truecolor RGB + nearest xterm-256 index (from clauth). */
interface Col {
  rgb: readonly [number, number, number];
  idx: number;
}

const PALETTE = {
  // surfaces
  bg: { rgb: [30, 30, 46], idx: 235 },
  bgSunken: { rgb: [17, 17, 27], idx: 233 },
  bgHover: { rgb: [40, 40, 56], idx: 236 },
  // lines
  line: { rgb: [49, 50, 68], idx: 238 },
  lineStrong: { rgb: [69, 71, 90], idx: 240 },
  // text
  text: { rgb: [205, 214, 244], idx: 189 },
  dim: { rgb: [166, 173, 200], idx: 145 },
  faint: { rgb: [127, 132, 156], idx: 102 },
  // accents — sapphire primary; Claude orange secondary ("once per screen max")
  accent: { rgb: [67, 171, 229], idx: 75 },
  accent2: { rgb: [217, 119, 87], idx: 173 },
  // semantic
  success: { rgb: [166, 227, 161], idx: 151 },
  warning: { rgb: [249, 226, 175], idx: 223 },
  danger: { rgb: [243, 139, 168], idx: 211 },
  info: { rgb: [116, 199, 236], idx: 117 },
  // banner washes
  bgDanger: { rgb: [75, 35, 44], idx: 52 },
  bgWarning: { rgb: [74, 60, 33], idx: 58 },
} as const satisfies Record<string, Col>;

export type ColorName = keyof typeof PALETTE;

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';

function sgr(c: Col, layer: 38 | 48): string {
  if (tier() === 'full') {
    const [r, g, b] = c.rgb;
    return `\x1b[${layer};2;${r};${g};${b}m`;
  }
  return `\x1b[${layer};5;${c.idx}m`;
}

/** Foreground escape for a palette color. */
export function fg(name: ColorName): string {
  return sgr(PALETTE[name], 38);
}

/** Background escape for a palette color. */
export function bg(name: ColorName): string {
  return sgr(PALETTE[name], 48);
}

export interface PaintOpts {
  fg?: ColorName;
  bg?: ColorName;
  bold?: boolean;
}

/** Wrap `s` in the requested style and a trailing RESET. No-op when unstyled. */
export function paint(s: string, opts: PaintOpts): string {
  let pre = '';
  if (opts.bold) pre += BOLD;
  if (opts.fg) pre += fg(opts.fg);
  if (opts.bg) pre += bg(opts.bg);
  return pre ? `${pre}${s}${RESET}` : s;
}

/** Utilization color per cloudy-ui: dim <60%, warning 60–80%, danger ≥80%. */
export function utilColor(pct: number): ColorName {
  const p = Math.min(100, Math.max(0, pct));
  if (p >= 80) return 'danger';
  if (p >= 60) return 'warning';
  return 'dim';
}

/** Selection caret used on the active row / tab (clauth's `❯`). */
export const CARET = '❯';
