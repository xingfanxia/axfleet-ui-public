/**
 * Merge multiple hosts' clauth-usage feeds into ONE deduped account view.
 *
 * Multiple hosts' daemons watch the SAME provider accounts — rate-limit
 * windows are account-level server-side state, so rendering each feed as its
 * own section would show every account twice with skewed numbers (feeds fetch
 * at different times). What IS host-specific: which profile each daemon has
 * active, its switch forecast, version, staleness, and the machine-wide
 * tokens feed. So: one profile list from the freshest feed + one compact
 * "daemon" line per host. Pure — shared by the web pane and the TUI tab so
 * the two can't disagree.
 */
import type { ClauthUsageInfo } from '../contracts/types';

export interface AccountFeed {
  host: string;
  reachable: boolean;
  u: ClauthUsageInfo;
}

export type MergedProfile = ClauthUsageInfo['profiles'][number] & {
  /** hosts whose daemon currently has this profile active */
  active_on: string[];
};

export interface DaemonLine {
  host: string;
  version: string | null;
  active_profile: string | null;
  forecast: ClauthUsageInfo['forecast'];
  fallback_chain: string[];
  stale: boolean;
  schema_ok: boolean;
  reachable: boolean;
  last_error: string | null;
  generated_at: string | null;
}

export interface MergedAccounts {
  /** deduped profiles, windows from the freshest feed (secondary-only ones appended) */
  profiles: MergedProfile[];
  /** which feed the window data came from */
  source_host: string;
  daemons: DaemonLine[];
  /** machine-wide token feeds, per host that publishes one */
  tokens: Array<{ host: string; tokens: NonNullable<ClauthUsageInfo['tokens']> }>;
}

/** Freshest first: non-stale beats stale, then newer generated_at. */
function rank(a: AccountFeed, b: AccountFeed): number {
  if (a.u.stale !== b.u.stale) return a.u.stale ? 1 : -1;
  const at = a.u.generated_at ? Date.parse(a.u.generated_at) : 0;
  const bt = b.u.generated_at ? Date.parse(b.u.generated_at) : 0;
  return bt - at;
}

export function mergeAccountFeeds(feeds: AccountFeed[]): MergedAccounts | null {
  const ordered = [...feeds].sort(rank);
  const primary = ordered[0];
  if (!primary) return null;

  const activeOn = (name: string): string[] =>
    ordered
      .filter((f) => f.u.profiles.find((p) => p.name === name)?.active || f.u.active_profile === name)
      .map((f) => f.host);

  const profiles: MergedProfile[] = primary.u.profiles.map((p) => ({ ...p, active_on: activeOn(p.name) }));
  const seen = new Set(profiles.map((p) => p.name));
  for (const f of ordered.slice(1)) {
    for (const p of f.u.profiles) {
      if (seen.has(p.name)) continue; // primary's copy wins — same account, fresher windows
      seen.add(p.name);
      profiles.push({ ...p, active_on: activeOn(p.name) });
    }
  }

  return {
    profiles,
    source_host: primary.host,
    daemons: ordered.map((f) => ({
      host: f.host,
      version: f.u.clauth_version,
      active_profile: f.u.active_profile,
      forecast: f.u.forecast,
      fallback_chain: f.u.fallback_chain,
      stale: f.u.stale,
      schema_ok: f.u.schema_ok,
      reachable: f.reachable,
      last_error: f.u.last_error,
      generated_at: f.u.generated_at,
    })),
    tokens: ordered.flatMap((f) => (f.u.tokens ? [{ host: f.host, tokens: f.u.tokens }] : [])),
  };
}
