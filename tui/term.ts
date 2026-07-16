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
  | 'ctrl-c'
  | string; // plain printable chars come through as themselves

export interface TermEvents {
  onKey: (key: Key) => void;
  onResize: (cols: number, rows: number) => void;
}

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const HOME = '\x1b[H';
const CLEAR_LINE_RIGHT = '\x1b[K';
const CLEAR_BELOW = '\x1b[J';

/** CSI final byte per ECMA-48: 0x40–0x7E terminates the sequence. */
function isCsiFinal(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

/** Decode one stdin chunk into key events. Exported pure for tests. */
export function decodeKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < chunk.length) {
    const c = chunk[i]!;
    if (c === '\x03') {
      keys.push('ctrl-c');
      i++;
    } else if (c === '\x1b') {
      const rest = chunk.slice(i);
      if (rest.startsWith('\x1b[A') || rest.startsWith('\x1bOA')) (keys.push('up'), (i += 3));
      else if (rest.startsWith('\x1b[B') || rest.startsWith('\x1bOB')) (keys.push('down'), (i += 3));
      else if (rest.startsWith('\x1b[C') || rest.startsWith('\x1bOC')) (keys.push('right'), (i += 3));
      else if (rest.startsWith('\x1b[D') || rest.startsWith('\x1bOD')) (keys.push('left'), (i += 3));
      else if (rest.startsWith('\x1b[Z')) (keys.push('shift-tab'), (i += 3));
      else if (rest[1] === '[' || rest[1] === 'O') {
        // Unrecognized CSI/SS3 (F-keys, PageUp `\x1b[5~`, modified arrows):
        // consume THROUGH the final byte (0x40–0x7E) so its parameter digits
        // don't leak as fake number-key presses (F5 = `\x1b[15~` → tabs 1+5).
        let j = i + 2;
        while (j < chunk.length && !isCsiFinal(chunk.charCodeAt(j))) j++;
        i = Math.min(chunk.length, j + 1);
      } else i++; // lone ESC — swallow and resync
    } else if (c === '\t') {
      keys.push('tab');
      i++;
    } else if (c === '\r' || c === '\n') {
      keys.push('enter');
      i++;
    } else {
      if (c >= ' ') keys.push(c);
      i++;
    }
  }
  return keys;
}

export class Term {
  private prev: string[] = [];
  private entered = false;

  get cols(): number {
    return process.stdout.columns || 80;
  }

  get rows(): number {
    return process.stdout.rows || 24;
  }

  enter(ev: TermEvents): void {
    if (this.entered) return;
    this.entered = true;
    process.stdout.write(ENTER_ALT + HIDE_CURSOR);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string | Buffer) => {
      for (const k of decodeKeys(chunk.toString())) ev.onKey(k);
    });
    process.stdout.on('resize', () => {
      this.prev = []; // dimensions changed — force a full repaint
      ev.onResize(this.cols, this.rows);
    });
  }

  exit(): void {
    if (!this.entered) return;
    this.entered = false;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(SHOW_CURSOR + LEAVE_ALT);
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
