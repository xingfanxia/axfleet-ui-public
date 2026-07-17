/**
 * axfleet app state + pure transition helpers. No IO here — index.ts owns the
 * event loop and calls these; render/* consumes the state read-only. Every
 * helper returns a NEW state (immutability per engineering rules).
 */
import type {
  FleetState,
  HostHistory,
  HostId,
  SentNotification,
  TokenRange,
  TokensDetail,
} from '../contracts/types';

export const TABS = ['fleet', 'vpn', 'agents', 'tokens', 'accounts', 'gateways', 'alerts'] as const;
export type Tab = (typeof TABS)[number];

export type ConnStatus = 'connecting' | 'live' | 'polling' | 'lost';

export interface AppState {
  tab: Tab;
  /** selected row in the current tab's primary list (fleet: host index) */
  sel: number;
  /** vertical scroll offset of the body pane */
  scroll: number;
  fleet: FleetState | null;
  fleetError: string | null;
  conn: ConnStatus;
  lastUpdate: number | null; // epoch ms of last good FleetState
  tokens: TokensDetail | null;
  tokensError: string | null;
  tokensRange: TokenRange;
  tokensFetchedAt: number | null;
  /** lark DM log (alerts tab) — lazily fetched like tokens */
  notifications: SentNotification[] | null;
  notificationsFetchedAt: number | null;
  history: Partial<Record<HostId, HostHistory>>;
  hubUrl: string;
}

export function initialState(hubUrl: string): AppState {
  return {
    tab: 'fleet',
    sel: 0,
    scroll: 0,
    fleet: null,
    fleetError: null,
    conn: 'connecting',
    lastUpdate: null,
    tokens: null,
    tokensError: null,
    tokensRange: 'today',
    tokensFetchedAt: null,
    notifications: null,
    notificationsFetchedAt: null,
    history: {},
    hubUrl,
  };
}

export function setTab(s: AppState, tab: Tab): AppState {
  if (tab === s.tab) return s;
  return { ...s, tab, sel: 0, scroll: 0 };
}

export function cycleTab(s: AppState, delta: 1 | -1): AppState {
  const i = TABS.indexOf(s.tab);
  const next = TABS[(i + delta + TABS.length) % TABS.length] ?? 'fleet';
  return setTab(s, next);
}

/** Rows selectable in the current tab (fleet + vpn have a selection cursor). */
export function selectableCount(s: AppState): number {
  if (!s.fleet) return 0;
  if (s.tab === 'fleet') return s.fleet.hosts.length;
  if (s.tab === 'vpn') {
    return s.fleet.hosts.filter((h) => h.snapshot?.singbox != null).length;
  }
  return 0;
}

export function moveSel(s: AppState, delta: number): AppState {
  const n = selectableCount(s);
  if (n === 0) return s; // nothing selectable in this tab; scroll is handled separately
  const sel = Math.min(n - 1, Math.max(0, s.sel + delta));
  return sel === s.sel ? s : { ...s, sel };
}

/**
 * Keep the selected row visible on short terminals. Fleet/vpn lists render
 * from the top of the body pane, so the selected row's pane index equals sel.
 */
export function followSel(s: AppState, bodyH: number): AppState {
  if (bodyH <= 0 || selectableCount(s) === 0) return s;
  let scroll = s.scroll;
  if (s.sel < scroll) scroll = s.sel;
  else if (s.sel >= scroll + bodyH) scroll = s.sel - bodyH + 1;
  return scroll === s.scroll ? s : { ...s, scroll };
}

export function scrollBy(s: AppState, delta: number, maxScroll: number): AppState {
  const scroll = Math.min(Math.max(0, maxScroll), Math.max(0, s.scroll + delta));
  return scroll === s.scroll ? s : { ...s, scroll };
}

export function applyFleet(s: AppState, fleet: FleetState, now: number, via: 'sse' | 'poll'): AppState {
  const sel = Math.min(s.sel, Math.max(0, fleet.hosts.length - 1));
  return { ...s, fleet, fleetError: null, sel, conn: via === 'sse' ? 'live' : 'polling', lastUpdate: now };
}

export function applyFleetError(s: AppState, error: string): AppState {
  // Keep the last good state on screen; the header shows the lost link.
  return { ...s, fleetError: error, conn: 'lost' };
}

/**
 * SSE stream ended — an EXPECTED event (runtime fetch timeouts, idle NAT
 * drops, hub restarts), NOT an error. Degrade live → polling quietly; the
 * red 'lost' state is reserved for actual fetch failures (applyFleetError),
 * i.e. "polling can't get data either".
 */
export function applyStreamDown(s: AppState): AppState {
  return s.conn === 'live' ? { ...s, conn: 'polling' } : s;
}

export function applyTokens(s: AppState, tokens: TokensDetail, now: number): AppState {
  return { ...s, tokens, tokensError: null, tokensFetchedAt: now };
}

export function applyTokensError(s: AppState, error: string, now?: number): AppState {
  // Stamp fetchedAt on failure too — errors back off on the same TTL instead
  // of refetching on every state change.
  return { ...s, tokensError: error, tokensFetchedAt: now ?? Date.now() };
}

export function cycleTokensRange(s: AppState, delta: 1 | -1 = 1): AppState {
  const ranges: TokenRange[] = ['today', '7d', '30d', '90d'];
  const next = ranges[(ranges.indexOf(s.tokensRange) + delta + ranges.length) % ranges.length] ?? 'today';
  // Invalidate the cache so the loop refetches for the new range, and reset
  // scroll — a range cycled via `t`/tap while scrolled down must start at the
  // top, not at a stale offset into content that's about to be replaced.
  return { ...s, tokensRange: next, tokensFetchedAt: null, scroll: 0 };
}

/**
 * Vertical-swipe routing on the tokens tab. When the body OVERFLOWS the pane,
 * a swipe always scrolls and the edges clamp exactly like every other tab —
 * cycling at an edge was rejected in review: the tab opens at the top edge, so
 * a reflexive desktop wheel-up would instantly flip the range (and refetch),
 * and a bottom overshoot would throw away the reading position. When the body
 * FITS (the normal phone-portrait case), there is nothing to scroll, so a
 * settled swipe cycles the range. `settled` is the caller's debounce verdict —
 * a phone swipe arrives as a BURST of wheel events, so only a gesture
 * separated from prior swipe activity by a quiet window may cycle; the rest
 * of the burst is swallowed (a cycle drops the tokens cache and refetches, so
 * one gesture must mean one cycle).
 */
export function tokensSwipeIntent(maxScroll: number, settled: boolean): 'scroll' | 'cycle' | 'ignore' {
  if (maxScroll > 0) return 'scroll'; // scrollBy clamps at the edges (identity → no redraw)
  return settled ? 'cycle' : 'ignore';
}

export function applyHistory(s: AppState, h: HostHistory): AppState {
  return { ...s, history: { ...s.history, [h.host_id]: h } };
}

/** On fetch failure `rows` is null — the stamp still backs off the retry TTL. */
export function applyNotifications(s: AppState, rows: SentNotification[] | null, now: number): AppState {
  return { ...s, notifications: rows ?? s.notifications, notificationsFetchedAt: now };
}

/** The host the cursor is on (fleet tab), for the detail panel + history fetch. */
export function selectedHostId(s: AppState): HostId | null {
  if (!s.fleet) return null;
  if (s.tab === 'fleet') return s.fleet.hosts[s.sel]?.host_id ?? null;
  if (s.tab === 'vpn') {
    const vpn = s.fleet.hosts.filter((h) => h.snapshot?.singbox != null);
    return vpn[s.sel]?.host_id ?? null;
  }
  return null;
}
