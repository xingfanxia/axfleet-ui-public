/**
 * Shared codex display transforms — the web pane and the TUI tab both import
 * these so the two surfaces can't drift (same pattern as accounts-merge).
 *
 * The codex feed is passive: it only refreshes while codex runs on that host,
 * so display must (a) transform a window whose reset instant has already
 * passed into ~0% — the stored pct describes a dead window, and rendering it
 * would send the operator away from usable headroom — and (b) grade snapshot
 * freshness so an idle host's ancient numbers read as history, not live state.
 */
import type { CodexUsageInfo } from '../contracts/types';

export interface CodexDisplayWindow {
  label: string;
  used_pct: number;
  resets_at: string | null;
  /** the snapshot predates this window's own reset — pct forced to 0 */
  reset_elapsed: boolean;
}

export function codexDisplayWindows(u: CodexUsageInfo, nowMs: number): CodexDisplayWindow[] {
  return u.windows.map((w) => {
    const resetMs = w.resets_at !== null ? Date.parse(w.resets_at) : NaN;
    const elapsed = Number.isFinite(resetMs) && resetMs <= nowMs;
    return {
      label: w.label,
      used_pct: elapsed ? 0 : w.used_pct,
      resets_at: w.resets_at,
      reset_elapsed: elapsed,
    };
  });
}

/** A snapshot younger than this reads as "codex actively in use" on the host. */
export const CODEX_FRESH_MS = 10 * 60 * 1000;

/** A snapshot older than this is stale — the host hasn't run codex in hours, so
 *  its stored numbers are history; the row is dimmed rather than read as live. */
export const CODEX_STALE_MS = 6 * 60 * 60 * 1000;

/** snapshot_at as epoch ms; NaN when never captured. */
export function codexSnapshotMs(u: CodexUsageInfo): number {
  return u.snapshot_at !== null ? Date.parse(u.snapshot_at) : NaN;
}

export function codexFresh(u: CodexUsageInfo, nowMs: number): boolean {
  const t = codexSnapshotMs(u);
  return Number.isFinite(t) && nowMs - t <= CODEX_FRESH_MS;
}

/** No snapshot, or one older than CODEX_STALE_MS — render greyed/dim. */
export function codexStale(u: CodexUsageInfo, nowMs: number): boolean {
  const t = codexSnapshotMs(u);
  return !Number.isFinite(t) || nowMs - t > CODEX_STALE_MS;
}

/** Freshest snapshot first; never-captured (NaN) sinks to the bottom. Pure, stable
 *  (returns a new array). Shared by the web pane and the TUI so ordering can't drift. */
export function sortCodexByFreshness<T extends { u: CodexUsageInfo }>(rows: readonly T[]): T[] {
  return rows
    .map((r, i) => ({ r, i, t: codexSnapshotMs(r.u) }))
    .sort((a, b) => {
      const va = Number.isFinite(a.t) ? a.t : -Infinity;
      const vb = Number.isFinite(b.t) ? b.t : -Infinity;
      return vb - va || a.i - b.i; // stable within equal/never timestamps
    })
    .map((x) => x.r);
}

/**
 * Does the snapshot's rate-limit claim still describe the present? A limit
 * whose own window has since reset is dead information — badging it would
 * tell the operator they're blocked when the window is usable (the same
 * misdirection codexDisplayWindows guards against for the percent). Unknown
 * kinds and missing windows stay loud: a false badge beats a hidden real one.
 */
export function codexStillLimited(u: CodexUsageInfo, nowMs: number): boolean {
  if (u.rate_limit_reached_type === null) return false;
  const label =
    u.rate_limit_reached_type === 'primary' ? '5h' : u.rate_limit_reached_type === 'secondary' ? '7d' : null;
  if (label === null) return true;
  const w = u.windows.find((x) => x.label === label);
  const resetMs = w?.resets_at != null ? Date.parse(w.resets_at) : NaN;
  return Number.isFinite(resetMs) ? resetMs > nowMs : true;
}
