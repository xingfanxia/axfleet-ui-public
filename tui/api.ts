/**
 * Demo data source — same surface as the real hub client (fetchFleet /
 * fetchTokens / fetchHistory / fetchNotifications / streamFleet), backed
 * entirely by fixtures instead of HTTP. The stream emits a fresh FleetState
 * every few seconds; fixture metrics are smooth functions of time, so gauges
 * drift and sparklines stay consistent between ticks — no mutable state, no
 * network, nothing real.
 */
import type {
  FleetState,
  HostHistory,
  HostId,
  SentNotification,
  TokenRange,
  TokensDetail,
} from '../contracts/types';
import { buildFleetState } from '../fixtures/fleet';
import { buildHistory } from '../fixtures/history';
import { buildNotifications } from '../fixtures/notifications';
import { buildTokensDetail } from '../fixtures/tokens';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const TICK_MS = 3_000;

export async function fetchFleet(_base?: string): Promise<ApiResult<FleetState>> {
  return { ok: true, data: buildFleetState(Date.now()) };
}

export async function fetchTokens(_base: string | undefined, range: TokenRange): Promise<ApiResult<TokensDetail>> {
  return { ok: true, data: buildTokensDetail(range, Date.now()) };
}

export async function fetchHistory(_base: string | undefined, id: HostId): Promise<ApiResult<HostHistory>> {
  return { ok: true, data: buildHistory(id, Date.now()) };
}

export async function fetchNotifications(_base?: string): Promise<ApiResult<SentNotification[]>> {
  return { ok: true, data: buildNotifications(Date.now()) };
}

export interface FleetStreamOpts {
  base?: string;
  onFleet: (s: FleetState) => void;
  onDown: (error: string) => void;
}

/**
 * Simulated SSE stream: pushes a fresh FleetState every TICK_MS until
 * abort() — the demo stream never drops, so onDown never fires (the real
 * client degrades to polling there).
 */
export function streamFleet(opts: FleetStreamOpts): { abort: () => void; done: Promise<void> } {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stop: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    stop = resolve;
  });
  timer = setInterval(() => opts.onFleet(buildFleetState(Date.now())), TICK_MS);
  const abort = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    stop?.();
  };
  return { abort, done };
}
