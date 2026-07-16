import { describe, expect, test } from 'bun:test';
import { decodeKeys } from './term';
import { parseArgs } from './index';

describe('decodeKeys', () => {
  test('plain chars pass through', () => {
    expect(decodeKeys('qjk1')).toEqual(['q', 'j', 'k', '1']);
  });

  test('arrow keys (CSI and SS3 forms)', () => {
    expect(decodeKeys('\x1b[A\x1b[B\x1b[C\x1b[D')).toEqual(['up', 'down', 'right', 'left']);
    expect(decodeKeys('\x1bOA\x1bOB')).toEqual(['up', 'down']);
  });

  test('ctrl-c, tab, shift-tab, enter', () => {
    expect(decodeKeys('\x03')).toEqual(['ctrl-c']);
    expect(decodeKeys('\t')).toEqual(['tab']);
    expect(decodeKeys('\x1b[Z')).toEqual(['shift-tab']);
    expect(decodeKeys('\r')).toEqual(['enter']);
  });

  test('unknown escape sequences are swallowed, not leaked as chars', () => {
    const keys = decodeKeys('\x1b\x1b[Aq');
    expect(keys).toContain('up');
    expect(keys).toContain('q');
  });

  test('F-keys and PageUp/Down are consumed whole — digits never leak as tab switches', () => {
    expect(decodeKeys('\x1b[15~')).toEqual([]); // F5 — the "1" and "5" must not appear
    expect(decodeKeys('\x1b[5~')).toEqual([]); // PageUp
    expect(decodeKeys('\x1b[6~')).toEqual([]); // PageDown
    expect(decodeKeys('\x1b[1;5A')).toEqual([]); // ctrl-up (modified arrow)
    expect(decodeKeys('\x1bOP')).toEqual([]); // F1 (SS3)
    expect(decodeKeys('\x1b[15~q')).toEqual(['q']); // real key after still arrives
  });

  test('mixed burst decodes in order', () => {
    expect(decodeKeys('j\x1b[Bq')).toEqual(['j', 'down', 'q']);
  });
});

describe('parseArgs', () => {
  test('defaults', () => {
    expect(parseArgs([])).toEqual({ compat: false });
  });

  test('--compat and --help', () => {
    expect(parseArgs(['--compat'])).toEqual({ compat: true });
    expect(parseArgs(['--help'])).toBe('help');
  });
});
