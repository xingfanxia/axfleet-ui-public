/**
 * Deterministic smooth noise — the engine that makes fixture data feel alive.
 * Pure functions of (key, time): no mutable state, so the live gauges, the
 * SSE-style ticks, and the 48h history sparklines all agree with each other
 * (history sampled at t and the "current" value at t are the same number).
 */

/** FNV-1a — stable per-key phase/frequency seed. */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Smooth 0..1 noise: three incommensurate sines with key-derived phases.
 * `period` is the dominant wavelength in ms (default ~8min so a watched
 * gauge visibly drifts without flickering).
 */
export function noise(key: string, t: number, period = 480_000): number {
  const h = hashKey(key);
  const p1 = (h % 1000) / 1000;
  const p2 = ((h >>> 10) % 1000) / 1000;
  const p3 = ((h >>> 20) % 1000) / 1000;
  const w = (2 * Math.PI) / period;
  const v =
    0.5 * Math.sin(w * t + p1 * Math.PI * 2) +
    0.3 * Math.sin(w * 2.7 * t + p2 * Math.PI * 2) +
    0.2 * Math.sin(w * 0.31 * t + p3 * Math.PI * 2);
  return (v + 1) / 2; // → 0..1
}

/** base ± amp, clamped to [min, max]. */
export function metric(
  key: string,
  t: number,
  base: number,
  amp: number,
  { min = 0, max = 100, period }: { min?: number; max?: number; period?: number } = {},
): number {
  const v = base + (noise(key, t, period) - 0.5) * 2 * amp;
  return Math.min(max, Math.max(min, v));
}

/** Deterministic 0..1 value per key (no time component) — for stable jitter. */
export function stable(key: string): number {
  return (hashKey(key) % 10_000) / 10_000;
}
