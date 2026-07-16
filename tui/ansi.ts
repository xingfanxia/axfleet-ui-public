/**
 * ANSI-aware string measurement for the frame renderer. Every layout decision
 * (pad, truncate, column join) must go through these — `String.length` counts
 * escape codes and treats CJK as width 1, both of which corrupt the layout
 * (host roles are bilingual, e.g. "cockpit · 云雀").
 */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/**
 * Terminal cell width of one code point. Pragmatic wcwidth: East-Asian wide
 * ranges (CJK, kana, Hangul, fullwidth forms, CJK punctuation) and common emoji
 * count 2; zero-width joiners/marks count 0; everything else 1.
 */
export function charWidth(cp: number): number {
  if (cp === 0x200b || cp === 0x200d || (cp >= 0x0300 && cp <= 0x036f) || cp === 0xfe0f) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // kana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) || // emoji blocks
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B+
  ) {
    return 2;
  }
  return 1;
}

/** Visible terminal width of a string (ANSI stripped, wide chars = 2 cells). */
export function visibleWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0) ?? 0);
  return w;
}

/**
 * Truncate to `width` cells, preserving ANSI codes and appending `…` when cut.
 * A RESET is appended whenever the input contained any escape, so a cut can
 * never leak color into the next cell.
 */
export function truncate(s: string, width: number): string {
  if (width <= 0) return '';
  if (visibleWidth(s) <= width) return s;
  let out = '';
  let w = 0;
  let sawAnsi = false;
  let i = 0;
  while (i < s.length) {
    const esc = matchAnsiAt(s, i);
    if (esc) {
      out += esc;
      i += esc.length;
      sawAnsi = true;
      continue;
    }
    const cp = s.codePointAt(i) ?? 0;
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (w + cw > width - 1) break; // reserve one cell for the ellipsis
    out += ch;
    w += cw;
    i += ch.length;
  }
  out += '…';
  return sawAnsi ? out + '\x1b[0m' : out;
}

function matchAnsiAt(s: string, i: number): string | null {
  if (s.charCodeAt(i) !== 0x1b) return null;
  ANSI_RE.lastIndex = i;
  const m = ANSI_RE.exec(s);
  return m && m.index === i ? m[0] : null;
}

/** Pad with trailing spaces to exactly `width` cells (truncates when over). */
export function padEnd(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w > width) return padEnd(truncate(s, width), width);
  return s + ' '.repeat(width - w);
}

/** Pad with leading spaces to exactly `width` cells (truncates when over). */
export function padStart(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w > width) return padStart(truncate(s, width), width); // re-pad: a cut on a wide char can land at width-1
  return ' '.repeat(width - w) + s;
}
