import { describe, expect, test } from 'bun:test';
import { charWidth, padEnd, padStart, stripAnsi, truncate, visibleWidth } from './ansi';
import { initTheme, paint } from './theme';

initTheme('compat'); // deterministic escapes for assertions

describe('visibleWidth', () => {
  test('plain ascii', () => {
    expect(visibleWidth('atlas')).toBe(5);
  });

  test('strips ANSI codes', () => {
    expect(visibleWidth('\x1b[38;5;75matlas\x1b[0m')).toBe(5);
  });

  test('CJK counts 2 cells per char', () => {
    expect(visibleWidth('云雀')).toBe(4);
    expect(visibleWidth('cockpit · 云雀')).toBe(14);
  });

  test('zero-width chars count 0', () => {
    expect(charWidth(0x200d)).toBe(0);
    expect(charWidth(0xfe0f)).toBe(0);
  });
});

describe('truncate', () => {
  test('no-op when it fits', () => {
    expect(truncate('abc', 5)).toBe('abc');
  });

  test('cuts to width with ellipsis', () => {
    expect(truncate('abcdefgh', 5)).toBe('abcd…');
    expect(visibleWidth(truncate('abcdefgh', 5))).toBe(5);
  });

  test('never splits a wide char in half', () => {
    const out = truncate('云雀云雀', 4); // 8 cells → cut
    expect(visibleWidth(out)).toBeLessThanOrEqual(4);
    expect(out.endsWith('…')).toBe(true);
  });

  test('preserves ANSI and appends RESET on cut', () => {
    const colored = paint('abcdefgh', { fg: 'accent' });
    const out = truncate(colored, 5);
    expect(stripAnsi(out)).toBe('abcd…');
    expect(out.endsWith('\x1b[0m')).toBe(true);
  });

  test('width 0 → empty', () => {
    expect(truncate('abc', 0)).toBe('');
  });
});

describe('padEnd / padStart', () => {
  test('pads by visible width, not string length', () => {
    const colored = paint('ok', { fg: 'success' });
    expect(visibleWidth(padEnd(colored, 6))).toBe(6);
    expect(visibleWidth(padStart(colored, 6))).toBe(6);
  });

  test('over-wide input is truncated to exactly width', () => {
    expect(visibleWidth(padEnd('abcdefgh', 4))).toBe(4);
  });

  test('CJK padding is cell-exact', () => {
    expect(visibleWidth(padEnd('云雀', 7))).toBe(7);
  });

  test('padStart re-pads when a truncation cut lands on a wide char', () => {
    // 薄薄薄 = 6 cells; cut to 4 yields "薄…" (3 cells) — must re-pad to exactly 4.
    expect(visibleWidth(padStart('薄薄薄', 4))).toBe(4);
  });
});
