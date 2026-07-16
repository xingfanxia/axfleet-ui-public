/**
 * Terminal adapter — the ONLY module that touches stdin/stdout. Owns the
 * alternate screen, raw mode, key decoding, resize events, and frame writes.
 * Everything above it is pure (state + render), per the repo's adapter rule.
 */

export type Key =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'tab'
  | 'shift-tab'
  | 'enter'
  | 'esc'
  | 'ctrl-b'
  | 'ctrl-c'
  | string; // plain printable chars come through as themselves

export type MouseKind = 'press' | 'drag' | 'release' | 'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right';

/** One SGR mouse event; x/y are 0-based terminal cells (row 0 = header). */
export interface Mouse {
  kind: MouseKind;
  x: number;
  y: number;
}

export type TermEvent = { kind: 'key'; key: Key } | { kind: 'mouse'; mouse: Mouse };

export interface TermEvents {
  onKey: (key: Key) => void;
  onMouse?: (m: Mouse) => void;
  onResize: (cols: number, rows: number) => void;
}

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const HOME = '\x1b[H';
const CLEAR_LINE_RIGHT = '\x1b[K';
const CLEAR_BELOW = '\x1b[J';
// 1000 = press/release, 1002 = + drags, 1006 = SGR encoding (unambiguous
// release + coords past col 223). Touch terminals (Moshi) translate taps and
// swipes into exactly these; terminals without support ignore them harmlessly.
const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

/** CSI final byte per ECMA-48: 0x40–0x7E terminates the sequence. */
function isCsiFinal(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

/** SGR mouse report: `\x1b[<code;col;row(M=press/drag|m=release)`. */
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

function sgrMouse(code: number, col: number, row: number, final: string): Mouse | null {
  const pos = { x: col - 1, y: row - 1 }; // SGR is 1-based
  if (code & 64) {
    const kind = (['wheel-up', 'wheel-down', 'wheel-left', 'wheel-right'] as const)[code & 3]!;
    return { kind, ...pos };
  }
  if ((code & 3) === 3) return null; // motion with no button held (mode 1003) — not ours
  if (final === 'm') return { kind: 'release', ...pos };
  return { kind: code & 32 ? 'drag' : 'press', ...pos };
}

/** Decode one stdin chunk into key + mouse events. Exported pure for tests. */
export function decodeEvents(chunk: string): TermEvent[] {
  const events: TermEvent[] = [];
  const key = (k: Key) => events.push({ kind: 'key', key: k });
  let i = 0;
  while (i < chunk.length) {
    const c = chunk[i]!;
    if (c === '\x03') {
      key('ctrl-c');
      i++;
    } else if (c === '\x02') {
      // tmux/herdr prefix — Moshi's swipe gesture sends <prefix> n/p when it
      // detects a multiplexer, so speaking the chord makes swipe reachable.
      key('ctrl-b');
      i++;
    } else if (c === '\x1b') {
      const rest = chunk.slice(i);
      const mouse = SGR_MOUSE_RE.exec(rest);
      if (mouse) {
        const m = sgrMouse(Number(mouse[1]), Number(mouse[2]), Number(mouse[3]), mouse[4]!);
        if (m) events.push({ kind: 'mouse', mouse: m });
        i += mouse[0].length;
      } else if (rest.startsWith('\x1b[A') || rest.startsWith('\x1bOA')) (key('up'), (i += 3));
      else if (rest.startsWith('\x1b[B') || rest.startsWith('\x1bOB')) (key('down'), (i += 3));
      else if (rest.startsWith('\x1b[C') || rest.startsWith('\x1bOC')) (key('right'), (i += 3));
      else if (rest.startsWith('\x1b[D') || rest.startsWith('\x1bOD')) (key('left'), (i += 3));
      else if (rest.startsWith('\x1b[Z')) (key('shift-tab'), (i += 3));
      else if (rest[1] === '[' || rest[1] === 'O') {
        // Unrecognized CSI/SS3 (F-keys, PageUp `\x1b[5~`, modified arrows):
        // consume THROUGH the final byte (0x40–0x7E) so its parameter digits
        // don't leak as fake number-key presses (F5 = `\x1b[15~` → tabs 1+5).
        let j = i + 2;
        while (j < chunk.length && !isCsiFinal(chunk.charCodeAt(j))) j++;
        i = Math.min(chunk.length, j + 1);
      } else if (rest.length === 1) {
        // Chunk-final lone ESC = the ESC key. (An ESC that PREFIXES an escape
        // sequence always arrives with its tail in the same chunk.)
        key('esc');
        i++;
      } else i++; // ESC glued to something unrecognized — swallow and resync
    } else if (c === '\t') {
      key('tab');
      i++;
    } else if (c === '\r' || c === '\n') {
      key('enter');
      i++;
    } else {
      if (c >= ' ') key(c);
      i++;
    }
  }
  return events;
}

/** Keys-only view of decodeEvents (mouse events dropped). */
export function decodeKeys(chunk: string): Key[] {
  return decodeEvents(chunk).flatMap((e) => (e.kind === 'key' ? [e.key] : []));
}

/**
 * Index where a trailing POSSIBLY-INCOMPLETE escape sequence begins, or
 * s.length. Fast drags flood dozens of SGR reports and mosh/SSH can split one
 * across read chunks — without holding the fragment back, `\x1b[<32;12` +
 * `;5M` decodes as garbage AND leaks the digit '5' as a tab-switch key (or
 * worse: a chunk split right after the ESC byte reads as the ESC key → quit).
 * The held fragment is disambiguated by Term's escape timeout: if no
 * continuation arrives within ESC_FLUSH_MS it's flush-decoded as-is (a lone
 * `\x1b` then becomes the ESC key). A "sequence" longer than 24 cells isn't
 * one — flushed immediately rather than buffered as junk.
 */
export function incompleteEscapeStart(s: string): number {
  const i = s.lastIndexOf('\x1b');
  if (i === -1 || s.length - i > 24) return s.length;
  const tail = s.slice(i);
  if (tail === '\x1b' || /^\x1b(\[[<0-9;]*|O)$/.test(tail)) return i;
  return s.length;
}

/** How long a trailing escape fragment may wait for its continuation. */
export const ESC_FLUSH_MS = 40;

export class Term {
  private prev: string[] = [];
  private entered = false;
  /** trailing escape-sequence fragment held over from the previous stdin chunk */
  private pending = '';
  private escTimer: ReturnType<typeof setTimeout> | null = null;

  get cols(): number {
    return process.stdout.columns || 80;
  }

  get rows(): number {
    return process.stdout.rows || 24;
  }

  enter(ev: TermEvents): void {
    if (this.entered) return;
    this.entered = true;
    process.stdout.write(ENTER_ALT + HIDE_CURSOR + MOUSE_ON);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const dispatch = (input: string): void => {
      for (const e of decodeEvents(input)) {
        if (e.kind === 'key') ev.onKey(e.key);
        else ev.onMouse?.(e.mouse);
      }
    };
    process.stdin.on('data', (chunk: string | Buffer) => {
      if (this.escTimer) {
        clearTimeout(this.escTimer);
        this.escTimer = null;
      }
      const data = this.pending + chunk.toString();
      const cut = incompleteEscapeStart(data);
      this.pending = data.slice(cut);
      dispatch(data.slice(0, cut));
      if (this.pending) {
        // Escape timeout: a fragment whose continuation never comes is real
        // input (a lone ESC = the ESC key), not a split sequence — flush it.
        this.escTimer = setTimeout(() => {
          this.escTimer = null;
          const held = this.pending;
          this.pending = '';
          dispatch(held);
        }, ESC_FLUSH_MS);
      }
    });
    process.stdout.on('resize', () => {
      this.prev = []; // dimensions changed — force a full repaint
      ev.onResize(this.cols, this.rows);
    });
  }

  exit(): void {
    if (!this.entered) return;
    this.entered = false;
    if (this.escTimer) {
      clearTimeout(this.escTimer);
      this.escTimer = null;
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(MOUSE_OFF + SHOW_CURSOR + LEAVE_ALT);
  }

  /**
   * Paint a frame. Line-diffed against the previous frame: only changed rows
   * are rewritten (cursor-addressed), so a 1s clock tick costs a few bytes,
   * not a whole screen — kind to slow SSH links (mosh diffs again on top).
   */
  draw(lines: string[]): void {
    if (!this.entered) return;
    let out = '';
    const n = Math.max(lines.length, this.prev.length);
    if (this.prev.length === 0) {
      out = HOME + lines.map((l) => l + CLEAR_LINE_RIGHT).join('\r\n') + CLEAR_BELOW;
    } else {
      for (let i = 0; i < n; i++) {
        const line = lines[i] ?? '';
        if (line === this.prev[i]) continue;
        out += `\x1b[${i + 1};1H` + line + CLEAR_LINE_RIGHT;
      }
    }
    if (out) process.stdout.write(out);
    this.prev = [...lines];
  }
}
