#!/usr/bin/env bun
/**
 * axfleet — full-screen fleet-monitoring TUI (public demo). clauth-styled,
 * responsive down to phone-terminal widths (Moshi ≈45 cols).
 *
 *   bun run tui              # run against the built-in fixture fleet
 *   bun run tui --compat     # force 256-color (no truecolor)
 *
 * This demo build renders the exact TUI from the private fleet dashboard,
 * driven by a simulated stream of fixture data (see tui/api.ts): the "SSE"
 * ticks every few seconds, gauges drift smoothly, and every tab has data.
 */
import { fetchFleet, fetchHistory, fetchNotifications, fetchTokens, streamFleet } from './api';
import {
  applyFleet,
  applyFleetError,
  applyHistory,
  applyNotifications,
  applyStreamDown,
  applyTokens,
  applyTokensError,
  cycleTab,
  cycleTokensRange,
  followSel,
  initialState,
  moveSel,
  scrollBy,
  selectableCount,
  selectedHostId,
  setTab,
  TABS,
  type AppState,
} from './state';
import { initTheme } from './theme';
import { renderFrame } from './render/frame';
import { Term, type Key } from './term';

const POLL_MS = 5_000;
const TOKENS_TTL_MS = 60_000;
const HISTORY_TTL_MS = 60_000;
const NOTIFICATIONS_TTL_MS = 30_000;
const USAGE = `axfleet — fleet monitoring TUI (fixture-data demo)
usage: axfleet [--compat] [--help]`;

interface Args {
  compat: boolean;
}

export function parseArgs(argv: string[]): Args | 'help' {
  const args: Args = { compat: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') return 'help';
    else if (a === '--compat') args.compat = true;
  }
  return args;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    console.log(USAGE);
    return;
  }
  initTheme(parsed.compat ? 'compat' : undefined);
  const hub = 'demo · fixture data';

  let state: AppState = initialState(hub);
  const term = new Term();
  let bodyTotal = 0;
  let stream: { abort: () => void } | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let historyFetched = new Map<string, number>();
  let quitting = false;

  const redraw = (): void => {
    const frame = renderFrame(state, term.cols, term.rows);
    bodyTotal = frame.bodyTotal;
    term.draw(frame.lines);
  };

  const update = (next: AppState): void => {
    if (next === state) return;
    state = next;
    redraw();
    void ensureTabData();
  };

  // --- data plumbing ---------------------------------------------------------

  const connectStream = (): void => {
    stream = streamFleet({
      onFleet: (fs) => update(applyFleet(state, fs, Date.now(), 'sse')),
      onDown: () => {
        // The demo stream only ends on quit, but keep the real reconnect shape.
        stream = null;
        update(applyStreamDown(state));
        if (!quitting) {
          void pollOnce();
          setTimeout(connectStream, 3_000);
        }
      },
    });
  };

  const pollOnce = async (): Promise<void> => {
    if (state.conn === 'live') return; // stream is healthy — nothing to do
    const res = await fetchFleet();
    update(res.ok ? applyFleet(state, res.data, Date.now(), 'poll') : applyFleetError(state, res.error));
  };

  /** Lazily fetch what the current tab needs (tokens, notifications, history). */
  let tokensInflight = false;
  let notifInflight = false;
  const ensureTabData = async (): Promise<void> => {
    const now = Date.now();
    if (
      state.tab === 'tokens' &&
      !tokensInflight &&
      (state.tokensFetchedAt == null || now - state.tokensFetchedAt > TOKENS_TTL_MS)
    ) {
      tokensInflight = true;
      const range = state.tokensRange; // capture: user may press `t` mid-flight
      try {
        const res = await fetchTokens(undefined, range);
        if (state.tokensRange !== range) {
          // Stale response for a range the user already left — drop it and
          // refetch for the current range instead of stamping the wrong data.
          tokensInflight = false;
          return ensureTabData();
        }
        update(res.ok ? applyTokens(state, res.data, Date.now()) : applyTokensError(state, res.error));
      } finally {
        tokensInflight = false;
      }
    }
    if (
      state.tab === 'alerts' &&
      !notifInflight &&
      (state.notificationsFetchedAt == null || now - state.notificationsFetchedAt > NOTIFICATIONS_TTL_MS)
    ) {
      notifInflight = true;
      try {
        const res = await fetchNotifications();
        update(applyNotifications(state, res.ok ? res.data : null, Date.now()));
      } finally {
        notifInflight = false;
      }
    }
    if (state.tab === 'fleet' || state.tab === 'vpn') {
      const id = selectedHostId(state);
      if (id && now - (historyFetched.get(id) ?? 0) > HISTORY_TTL_MS) {
        historyFetched.set(id, now);
        const res = await fetchHistory(undefined, id);
        if (res.ok) update(applyHistory(state, res.data));
      }
    }
  };

  // --- input -----------------------------------------------------------------

  const onKey = (key: Key): void => {
    if (key === 'q' || key === 'ctrl-c') {
      shutdown(0);
      return;
    }
    const tabIdx = Number(key);
    if (tabIdx >= 1 && tabIdx <= TABS.length) {
      update(setTab(state, TABS[tabIdx - 1] ?? 'fleet'));
      return;
    }
    switch (key) {
      case 'right':
      case 'l':
      case 'tab':
        update(cycleTab(state, 1));
        break;
      case 'left':
      case 'h':
      case 'shift-tab':
        update(cycleTab(state, -1));
        break;
      case 'down':
      case 'j':
        if (selectableCount(state) > 0) update(followSel(moveSel(state, 1), term.rows - 4));
        else update(scrollBy(state, 1, Math.max(0, bodyTotal - (term.rows - 4))));
        break;
      case 'up':
      case 'k':
        if (selectableCount(state) > 0) update(followSel(moveSel(state, -1), term.rows - 4));
        else update(scrollBy(state, -1, Math.max(0, bodyTotal - (term.rows - 4))));
        break;
      case 't':
        if (state.tab === 'tokens') update(cycleTokensRange(state));
        break;
      case 'r':
        historyFetched = new Map();
        update({ ...state, tokensFetchedAt: null, notificationsFetchedAt: null });
        void fetchFleet().then((res) =>
          // 'poll' is honest (this WAS a one-shot poll); the next stream frame
          // flips conn back to 'live' immediately.
          update(res.ok ? applyFleet(state, res.data, Date.now(), 'poll') : applyFleetError(state, res.error)),
        );
        break;
    }
  };

  const shutdown = (code: number): void => {
    quitting = true;
    stream?.abort();
    if (pollTimer) clearInterval(pollTimer);
    if (clockTimer) clearInterval(clockTimer);
    term.exit();
    process.exit(code);
  };

  // --- wire up ---------------------------------------------------------------

  term.enter({ onKey, onResize: () => redraw() });
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  // Any unhandled throw (renderer edge case, bad frame) must NEVER strand the
  // user in the alt screen with raw mode on — restore the terminal, then die.
  const die = (err: unknown): void => {
    term.exit();
    console.error('axfleet crashed:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  };
  process.on('uncaughtException', die);
  process.on('unhandledRejection', die);

  redraw();
  const first = await fetchFleet();
  update(first.ok ? applyFleet(state, first.data, Date.now(), 'poll') : applyFleetError(state, first.error));
  connectStream();
  pollTimer = setInterval(() => void pollOnce(), POLL_MS);
  clockTimer = setInterval(redraw, 1_000); // clock / "ago" freshness tick (line-diffed, cheap)
}

if (import.meta.main) {
  void main();
}
