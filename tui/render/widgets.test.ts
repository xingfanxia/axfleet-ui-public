import { describe, expect, test } from 'bun:test';
import { stripAnsi, visibleWidth } from '../ansi';
import { initTheme } from '../theme';
import { badge, box, gauge, joinColumns, kv, sparkline } from './widgets';

initTheme('compat');

describe('gauge', () => {
  test('is exactly the requested width', () => {
    for (const pct of [0, 48, 60, 99, 100]) {
      expect(visibleWidth(gauge(pct, 20))).toBe(20);
    }
  });

  test('null renders an em-dash label at full width', () => {
    const g = gauge(null, 20);
    expect(visibleWidth(g)).toBe(20);
    expect(stripAnsi(g)).toContain('—');
  });

  test('fill scales with pct', () => {
    const low = stripAnsi(gauge(10, 20));
    const high = stripAnsi(gauge(90, 20));
    const count = (s: string) => [...s].filter((c) => c === '▮').length;
    expect(count(high)).toBeGreaterThan(count(low));
  });
});

describe('sparkline', () => {
  test('exact width, right-aligned when short', () => {
    const s = sparkline([1, 2, 3], 8);
    expect(visibleWidth(s)).toBe(8);
    expect(stripAnsi(s).startsWith('     ')).toBe(true);
  });

  test('nulls render as gaps, not crashes', () => {
    const s = stripAnsi(sparkline([1, null, 3], 3));
    expect(s).toContain('·');
  });

  test('all-zero series stays at the floor glyph', () => {
    const s = stripAnsi(sparkline([0, 0, 0], 3));
    expect(s).toBe('▁▁▁');
  });
});

describe('box', () => {
  test('every line is exactly width cells', () => {
    const lines = box(['hello', '云雀 gauge'], 30, { title: 'atlas', meta: 'up 12d' });
    for (const l of lines) expect(visibleWidth(l)).toBe(30);
  });

  test('title + meta land on the top border', () => {
    const [top] = box([], 40, { title: 'kiku', meta: 'up 3d' });
    expect(stripAnsi(top ?? '')).toContain('kiku');
    expect(stripAnsi(top ?? '')).toContain('up 3d');
  });

  test('overlong content is truncated, not overflowed', () => {
    const lines = box(['x'.repeat(100)], 20);
    for (const l of lines) expect(visibleWidth(l)).toBe(20);
  });

  test('narrow box with long title does not throw or overflow', () => {
    const lines = box(['a'], 12, { title: 'a very long host title', meta: 'up 100d' });
    for (const l of lines) expect(visibleWidth(l)).toBe(12);
  });
});

describe('joinColumns', () => {
  test('pads shorter columns with blanks', () => {
    const out = joinColumns([['a', 'b'], ['c']], [3, 3], 1);
    expect(out).toHaveLength(2);
    expect(stripAnsi(out[0] ?? '')).toBe('a   c');
    expect(stripAnsi(out[1] ?? '')).toBe('b');
  });
});

describe('badge / kv', () => {
  test('badge keeps the text', () => {
    expect(stripAnsi(badge('running', 'ok'))).toBe('running');
  });

  test('kv aligns the label column', () => {
    expect(stripAnsi(kv('cpu', 'x', 6))).toBe('cpu   x');
  });
});
