/**
 * Pure text widgets — every fn returns styled string(s), no terminal IO.
 * Layout math goes through tui/ansi.ts; colors through tui/theme.ts.
 */
import { padEnd, truncate, visibleWidth } from '../ansi';
import { paint, utilColor, type ColorName, type PaintOpts } from '../theme';

/**
 * Horizontal utilization gauge: `▮▮▮▯▯▯ 48%`. Fill color follows the
 * cloudy-ui utilization thresholds; track renders in the strong line color.
 */
export function gauge(pct: number | null | undefined, width: number): string {
  const label = pct == null || !Number.isFinite(pct) ? '   —' : `${String(Math.round(pct)).padStart(3)}%`;
  const track = Math.max(1, width - 5); // "NNN%" + space
  if (pct == null || !Number.isFinite(pct)) {
    return paint('▯'.repeat(track), { fg: 'lineStrong' }) + ' ' + paint(label, { fg: 'faint' });
  }
  const p = Math.min(100, Math.max(0, pct));
  const fill = Math.round((p / 100) * track);
  const color = utilColor(p);
  return (
    paint('▮'.repeat(fill), { fg: color }) +
    paint('▯'.repeat(track - fill), { fg: 'lineStrong' }) +
    ' ' +
    paint(label, { fg: color === 'dim' ? 'dim' : color })
  );
}

const SPARK_GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * Block-character sparkline over the last `width` samples; `null` renders as a
 * faint gap. Scale is 0..max(values) (min pinned to 0 so flat-low stays low).
 */
export function sparkline(values: Array<number | null>, width: number, color: ColorName = 'accent'): string {
  const take = values.slice(-width);
  const pad = width - take.length;
  const max = Math.max(1e-9, ...take.map((v) => (v == null || !Number.isFinite(v) ? 0 : v)));
  let out = ' '.repeat(Math.max(0, pad));
  let run = '';
  for (const v of take) {
    if (v == null || !Number.isFinite(v)) {
      run += '·';
      continue;
    }
    const i = Math.min(SPARK_GLYPHS.length - 1, Math.max(0, Math.floor((v / max) * SPARK_GLYPHS.length)));
    run += SPARK_GLYPHS[i];
  }
  return out + paint(run, { fg: color });
}

/** Small status badge: ` ok ` / ` DOWN ` — colored text, no background walls. */
export function badge(text: string, kind: 'ok' | 'warn' | 'crit' | 'off'): string {
  const style: PaintOpts =
    kind === 'ok'
      ? { fg: 'success' }
      : kind === 'warn'
        ? { fg: 'warning', bold: true }
        : kind === 'crit'
          ? { fg: 'danger', bold: true }
          : { fg: 'faint' };
  return paint(text, style);
}

export interface BoxOpts {
  title?: string;
  /** right-aligned text on the top border (e.g. uptime) */
  meta?: string;
  /** border color; defaults to hairline */
  border?: ColorName;
}

/**
 * Wrap content lines in a hairline box of exactly `width` cells. Content is
 * truncated/padded per line; title renders bold on the top border.
 */
export function box(lines: string[], width: number, opts: BoxOpts = {}): string[] {
  const bc = opts.border ?? 'line';
  const inner = width - 2;
  const top = boxTop(width, opts);
  const bottom = paint('└' + '─'.repeat(Math.max(0, inner)) + '┘', { fg: bc });
  const side = paint('│', { fg: bc });
  const body = lines.map((l) => side + padEnd(truncate(l, inner), inner) + side);
  return [top, ...body, bottom];
}

function boxTop(width: number, opts: BoxOpts): string {
  const bc = opts.border ?? 'line';
  const inner = width - 2;
  let label = '';
  if (opts.title) label = `─ ${opts.title} `;
  let meta = '';
  if (opts.meta) meta = ` ${opts.meta} ─`;
  const labelW = visibleWidth(label);
  const metaW = visibleWidth(meta);
  if (labelW + metaW >= inner) {
    // Not enough room for decorations — plain border, title truncated in.
    const t = truncate(label, Math.max(0, inner));
    return paint('┌', { fg: bc }) + paint(t, { fg: 'text', bold: true }) + paint('─'.repeat(Math.max(0, inner - visibleWidth(t))) + '┐', { fg: bc });
  }
  const mid = '─'.repeat(inner - labelW - metaW);
  return (
    paint('┌', { fg: bc }) +
    styledTitle(label) +
    paint(mid, { fg: bc }) +
    paint(meta, { fg: 'faint' }) +
    paint('┐', { fg: bc })
  );
}

/** "─ title " with the dashes in border color and the title bold. */
function styledTitle(label: string): string {
  if (!label) return '';
  const m = /^─ (.*) $/.exec(label);
  if (!m) return paint(label, { fg: 'line' });
  return paint('─ ', { fg: 'line' }) + paint(m[1] ?? '', { fg: 'text', bold: true }) + ' ';
}

/**
 * Join column blocks side by side with `gap` spaces. Blocks shorter than the
 * tallest are padded with blank lines; each block is padded to its width.
 */
export function joinColumns(cols: string[][], widths: number[], gap = 2): string[] {
  const rows = Math.max(0, ...cols.map((c) => c.length));
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols.length; c++) {
      const cell = cols[c]?.[r] ?? '';
      const w = widths[c] ?? 0;
      line += (c > 0 ? ' '.repeat(gap) : '') + padEnd(cell, w);
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Eyebrow label + value row: `label  value` with the label bold-dim. */
export function kv(label: string, value: string, labelWidth: number): string {
  return paint(padEnd(label, labelWidth), { fg: 'dim', bold: true }) + value;
}

/**
 * Bucket-average a series down to `n` points (history is 5-min buckets over
 * 48h ≈ 576 points; sparklines get 20-50 cells). All-null buckets stay null.
 */
export function downsample(values: Array<number | null>, n: number): Array<number | null> {
  if (n <= 0 || values.length === 0) return [];
  if (values.length <= n) return values;
  const out: Array<number | null> = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i * values.length) / n);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) * values.length) / n));
    let sum = 0;
    let cnt = 0;
    for (let j = lo; j < hi; j++) {
      const v = values[j];
      if (v != null && Number.isFinite(v)) {
        sum += v;
        cnt++;
      }
    }
    out.push(cnt > 0 ? sum / cnt : null);
  }
  return out;
}
