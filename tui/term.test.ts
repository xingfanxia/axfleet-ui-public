import { describe, expect, test } from 'bun:test';
import { decodeEvents, decodeKeys, incompleteEscapeStart, type Mouse } from './term';
import { gestureStep, type Gesture, type GestureAction } from './gesture';
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

  test('chunk-final lone ESC is the ESC key; ESC prefixing a sequence is not', () => {
    expect(decodeKeys('\x1b')).toEqual(['esc']);
    expect(decodeKeys('\x1b[A')).toEqual(['up']); // no phantom esc
    expect(decodeKeys('j\x1b')).toEqual(['j', 'esc']);
  });
});

describe('decodeEvents — SGR mouse', () => {
  const mouse = (chunk: string): Mouse[] => decodeEvents(chunk).flatMap((e) => (e.kind === 'mouse' ? [e.mouse] : []));

  test('press, drag, release (0-based coords)', () => {
    expect(mouse('\x1b[<0;12;5M')).toEqual([{ kind: 'press', x: 11, y: 4 }]);
    expect(mouse('\x1b[<32;12;7M')).toEqual([{ kind: 'drag', x: 11, y: 6 }]);
    expect(mouse('\x1b[<0;12;7m')).toEqual([{ kind: 'release', x: 11, y: 6 }]);
  });

  test('wheel: 64=up 65=down 66=left 67=right', () => {
    expect(mouse('\x1b[<64;3;3M')).toEqual([{ kind: 'wheel-up', x: 2, y: 2 }]);
    expect(mouse('\x1b[<65;3;3M')).toEqual([{ kind: 'wheel-down', x: 2, y: 2 }]);
    expect(mouse('\x1b[<66;3;3M')).toEqual([{ kind: 'wheel-left', x: 2, y: 2 }]);
    expect(mouse('\x1b[<67;3;3M')).toEqual([{ kind: 'wheel-right', x: 2, y: 2 }]);
  });

  test('mouse digits never leak as tab-switch keys; keys around survive', () => {
    expect(decodeKeys('\x1b[<0;15;3M')).toEqual([]);
    expect(decodeEvents('j\x1b[<65;1;1Mq').map((e) => e.kind)).toEqual(['key', 'mouse', 'key']);
  });

  test('motion-without-button (1003-style) is ignored', () => {
    expect(mouse('\x1b[<35;4;4M')).toEqual([]);
  });
});

describe('gestureStep', () => {
  const run = (events: Mouse[]): GestureAction[] => {
    let g: Gesture | null = null;
    const actions: GestureAction[] = [];
    for (const m of events) {
      const r = gestureStep(g, m);
      g = r.g;
      if (r.action) actions.push(r.action);
    }
    return actions;
  };

  test('tap: press+release in place (≤1 cell wobble)', () => {
    expect(run([{ kind: 'press', x: 10, y: 1 }, { kind: 'release', x: 10, y: 1 }])).toEqual([{ type: 'tap', x: 10, y: 1 }]);
    expect(run([{ kind: 'press', x: 10, y: 5 }, { kind: 'release', x: 11, y: 5 }])).toEqual([{ type: 'tap', x: 10, y: 5 }]);
  });

  test('vertical drag scrolls with the finger (up-drag → positive dy)', () => {
    const actions = run([
      { kind: 'press', x: 20, y: 15 },
      { kind: 'drag', x: 20, y: 13 },
      { kind: 'drag', x: 20, y: 10 },
      { kind: 'release', x: 20, y: 10 },
    ]);
    expect(actions).toEqual([
      { type: 'scroll', dy: 2 },
      { type: 'scroll', dy: 3 },
    ]);
  });

  test('horizontal swipe locks the axis: no scroll jitter, wobble tolerated', () => {
    // real finger swipe: crosses several rows on the way — must still swipe,
    // and must NOT emit any scroll (this was the Moshi mouse-mode failure)
    const actions = run([
      { kind: 'press', x: 30, y: 8 },
      { kind: 'drag', x: 27, y: 9 },
      { kind: 'drag', x: 22, y: 10 },
      { kind: 'drag', x: 16, y: 9 },
      { kind: 'release', x: 12, y: 10 },
    ]);
    expect(actions).toEqual([{ type: 'swipe', dir: 'left' }]);
  });

  test('fast flick reported as bare press+release still swipes', () => {
    expect(run([{ kind: 'press', x: 10, y: 8 }, { kind: 'release', x: 22, y: 8 }])).toEqual([{ type: 'swipe', dir: 'right' }]);
  });

  test('a vertically-locked drag never doubles as a swipe; drag with no press is ignored', () => {
    const actions = run([
      { kind: 'press', x: 10, y: 20 },
      { kind: 'drag', x: 14, y: 14 },
      { kind: 'release', x: 22, y: 12 },
    ]);
    expect(actions.filter((a) => a && a.type === 'swipe')).toEqual([]);
    expect(actions.some((a) => a && a.type === 'scroll')).toBe(true);
    expect(run([{ kind: 'drag', x: 5, y: 5 }])).toEqual([]);
  });

  test('sub-threshold wobble emits nothing until an axis locks', () => {
    const actions = run([
      { kind: 'press', x: 10, y: 10 },
      { kind: 'drag', x: 11, y: 10 },
      { kind: 'drag', x: 10, y: 11 },
    ]);
    expect(actions).toEqual([]);
  });
});

describe('incompleteEscapeStart — split-chunk carry-over', () => {
  test('holds back a partial SGR mouse report', () => {
    expect(incompleteEscapeStart('\x1b[<32;12')).toBe(0);
    expect(incompleteEscapeStart('j\x1b[<32;12;7')).toBe(1);
    expect(incompleteEscapeStart('\x1b[')).toBe(0);
    expect(incompleteEscapeStart('\x1bO')).toBe(0);
  });

  test('complete sequences pass whole; a chunk-final ESC is held for the timeout', () => {
    expect(incompleteEscapeStart('\x1b[A')).toBe(3);
    expect(incompleteEscapeStart('\x1b[<0;12;5M')).toBe(10);
    expect(incompleteEscapeStart('j\x1b')).toBe(1); // ESC key vs split head — Term's timer decides
    expect(incompleteEscapeStart('jkq')).toBe(3);
  });

  test('reassembled fragments decode with no digit leaks', () => {
    const whole = '\x1b[<32;12;7M';
    for (let cut = 1; cut < whole.length; cut++) {
      const head = whole.slice(0, cut);
      const start = incompleteEscapeStart(head);
      const carried = head.slice(start) + whole.slice(cut);
      const events = [...decodeEvents(head.slice(0, start)), ...decodeEvents(carried)];
      expect(events).toEqual([{ kind: 'mouse', mouse: { kind: 'drag', x: 11, y: 6 } }]);
    }
  });

  test('an over-long ESC tail is flushed, not buffered forever', () => {
    const junk = '\x1b[' + '9;'.repeat(20);
    expect(incompleteEscapeStart(junk)).toBe(junk.length);
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
