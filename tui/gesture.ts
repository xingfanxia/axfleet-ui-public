/**
 * Touch/mouse gesture recognizer — pure state machine over press/drag/release
 * events (wheel events bypass this; index.ts handles them directly). Turns the
 * raw stream into three intents:
 *
 *   tap    — press+release within a 1-cell wobble → click (tab bar, host row)
 *   scroll — vertically-locked drag; content follows the finger
 *   swipe  — horizontally-locked release ≥5 cells → tab switch ('left' =
 *            finger moved left = next tab, mobile convention)
 *
 * DIRECTION LOCK: no scroll is emitted until total travel from the press
 * exceeds LOCK_TRAVEL, at which point the gesture locks to one axis. A
 * horizontal lock suppresses scrolling entirely (no pane jitter mid-swipe) and
 * real finger swipes — which always wobble a row or two — still register.
 * Cell aspect is ~1:2 (w:h), so requiring dx ≥ 2·dy in cells ≈ a 45° physical
 * threshold.
 */
import type { Mouse } from './term';

export interface Gesture {
  x0: number;
  y0: number;
  lastY: number;
  axis: 'h' | 'v' | null;
}

export type GestureAction =
  | { type: 'tap'; x: number; y: number }
  | { type: 'scroll'; dy: number }
  | { type: 'swipe'; dir: 'left' | 'right' }
  | null;

const LOCK_TRAVEL = 2; // cells of travel from press before the axis locks
const SWIPE_MIN_CELLS = 5;
const SWIPE_DOMINANCE = 2; // |dx| must be ≥ 2× |dy| (in cells) to count as horizontal
const TAP_WOBBLE = 1; // cells of finger wobble still counted as a tap

export function gestureStep(g: Gesture | null, m: Mouse): { g: Gesture | null; action: GestureAction } {
  switch (m.kind) {
    case 'press':
      return { g: { x0: m.x, y0: m.y, lastY: m.y, axis: null }, action: null };
    case 'drag': {
      if (!g) return { g: null, action: null }; // drag with no press seen — ignore
      if (g.axis === 'h') return { g, action: null }; // locked horizontal: no scroll jitter
      const dxT = m.x - g.x0;
      const dyT = m.y - g.y0;
      if (g.axis === null) {
        if (Math.abs(dxT) < LOCK_TRAVEL && Math.abs(dyT) < LOCK_TRAVEL) return { g, action: null };
        const axis = Math.abs(dxT) >= SWIPE_DOMINANCE * Math.abs(dyT) ? 'h' : 'v';
        if (axis === 'h') return { g: { ...g, axis }, action: null };
        // vertical lock: emit the catch-up scroll from the press row
        const dy = g.lastY - m.y;
        return { g: { ...g, axis, lastY: m.y }, action: dy !== 0 ? { type: 'scroll', dy } : null };
      }
      const dy = g.lastY - m.y; // finger up (y shrinks) → positive → scroll down
      if (dy === 0) return { g, action: null };
      return { g: { ...g, lastY: m.y }, action: { type: 'scroll', dy } };
    }
    case 'release': {
      if (!g) return { g: null, action: null };
      const dx = m.x - g.x0;
      const dyTotal = m.y - g.y0;
      // Locked horizontal — or a fast flick reported as bare press+release.
      if (g.axis !== 'v' && Math.abs(dx) >= SWIPE_MIN_CELLS && Math.abs(dx) >= SWIPE_DOMINANCE * Math.abs(dyTotal)) {
        return { g: null, action: { type: 'swipe', dir: dx < 0 ? 'left' : 'right' } };
      }
      if (g.axis === null && Math.abs(dx) <= TAP_WOBBLE && Math.abs(dyTotal) <= TAP_WOBBLE) {
        return { g: null, action: { type: 'tap', x: g.x0, y: g.y0 } };
      }
      return { g: null, action: null };
    }
    default:
      return { g, action: null }; // wheel — not a gesture
  }
}
