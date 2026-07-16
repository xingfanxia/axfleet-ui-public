/**
 * Touch/mouse gesture recognizer — pure state machine over press/drag/release
 * events (wheel events bypass this; index.ts handles them directly). Turns the
 * raw stream into three intents:
 *
 *   tap    — press+release within a 1-cell wobble → click (tab bar, host row)
 *   scroll — vertical drag; content follows the finger (dy per drag event)
 *   swipe  — horizontal release ≥5 cells and ≥2× the vertical travel → tab
 *            switch ('left' = finger moved left = next tab, mobile convention)
 */
import type { Mouse } from './term';

export interface Gesture {
  x0: number;
  y0: number;
  lastY: number;
  /** cumulative |dy| already emitted as scroll — a scrolled drag never swipes */
  scrolled: number;
}

export type GestureAction =
  | { type: 'tap'; x: number; y: number }
  | { type: 'scroll'; dy: number }
  | { type: 'swipe'; dir: 'left' | 'right' }
  | null;

const SWIPE_MIN_CELLS = 5;
const SWIPE_DOMINANCE = 2; // |dx| must be ≥ 2× |dy|
const SWIPE_MAX_SCROLLED = 2; // a swipe may wobble a row or two vertically; more = it was a scroll
const TAP_WOBBLE = 1; // cells of finger wobble still counted as a tap

export function gestureStep(g: Gesture | null, m: Mouse): { g: Gesture | null; action: GestureAction } {
  switch (m.kind) {
    case 'press':
      return { g: { x0: m.x, y0: m.y, lastY: m.y, scrolled: 0 }, action: null };
    case 'drag': {
      if (!g) return { g: null, action: null }; // drag with no press seen — ignore
      const dy = g.lastY - m.y; // finger up (y shrinks) → positive → scroll down
      if (dy === 0) return { g, action: null };
      return { g: { ...g, lastY: m.y, scrolled: g.scrolled + Math.abs(dy) }, action: { type: 'scroll', dy } };
    }
    case 'release': {
      if (!g) return { g: null, action: null };
      const dx = m.x - g.x0;
      const dyTotal = m.y - g.y0;
      if (g.scrolled <= SWIPE_MAX_SCROLLED && Math.abs(dx) >= SWIPE_MIN_CELLS && Math.abs(dx) >= SWIPE_DOMINANCE * Math.abs(dyTotal)) {
        return { g: null, action: { type: 'swipe', dir: dx < 0 ? 'left' : 'right' } };
      }
      if (Math.abs(dx) <= TAP_WOBBLE && Math.abs(dyTotal) <= TAP_WOBBLE) {
        return { g: null, action: { type: 'tap', x: g.x0, y: g.y0 } };
      }
      return { g: null, action: null };
    }
    default:
      return { g, action: null }; // wheel — not a gesture
  }
}
