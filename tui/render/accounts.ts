/**
 * Accounts tab — AI account usage, deduped: multiple hosts' daemons watch
 * the SAME provider accounts, so profiles render ONCE (windows from the
 * freshest feed via lib/accounts-merge — shared with the web pane so
 * the two can't disagree). Per-host daemon state (active/forecast/version)
 * compresses to one line each; machine tokens render per publishing host.
 * Layout mirrors ccu (bars absorb width slack; readable at 45-col Moshi).
 */
import type { AuthView, ClauthUsageInfo, CodexUsageInfo, FleetHost, HostSnapshot, Probe } from '../../contracts/types';
import { buildAuthView } from '../../lib/views';
import { mergeAccountFeeds, type AccountFeed, type MergedProfile } from '../../lib/accounts-merge';
import { codexDisplayWindows, codexFresh, codexStale, codexStillLimited, sortCodexByFreshness } from '../../lib/codex-view';
import { compactTokens, until, ago } from '../../lib/format';
import { padEnd, padStart, truncate, visibleWidth } from '../ansi';
import { paint, utilColor } from '../theme';
import type { AppState } from '../state';
import { badge } from './widgets';

export function renderAccounts(s: AppState, width: number): string[] {
  if (!s.fleet) return [paint(' loading…', { fg: 'faint' })];
  const feeds: AccountFeed[] = [];
  const broken: Array<{ host: FleetHost; probe: Probe<ClauthUsageInfo> }> = [];
  for (const h of s.fleet.hosts) {
    // deploy boundary: pre-upgrade collectors ship snapshots without the key
    const cu = (h.snapshot as HostSnapshot | null)?.clauth_usage;
    if (!cu) continue;
    if (cu.data) feeds.push({ host: h.display_name, reachable: h.reachable, u: cu.data });
    else broken.push({ host: h, probe: cu });
  }
  const codexRows: Array<{ host: string; reachable: boolean; u: CodexUsageInfo }> = [];
  const codexBroken: Array<{ host: FleetHost; probe: Probe<CodexUsageInfo> }> = [];
  for (const h of s.fleet.hosts) {
    // deploy boundary: pre-upgrade collectors ship snapshots without the key
    const cx = (h.snapshot as HostSnapshot | null)?.codex_usage;
    if (!cx) continue;
    if (cx.data) codexRows.push({ host: h.display_name, reachable: h.reachable, u: cx.data });
    else codexBroken.push({ host: h, probe: cx });
  }
  const merged = mergeAccountFeeds(feeds);
  const authRows = buildAuthView(s.fleet.hosts);
  if (
    !merged &&
    broken.length === 0 &&
    codexRows.length === 0 &&
    codexBroken.length === 0 &&
    authRows.length === 0
  )
    return [paint(' no clauth or codex usage feeds reporting', { fg: 'faint' })];

  const lines: string[] = [];
  if (merged) {
    lines.push(
      paint(' accounts', { fg: 'dim', bold: true }) +
        paint(` · windows via ${merged.source_host}`, { fg: 'faint' }),
    );
    for (const p of merged.profiles) {
      lines.push(profileHead(p, width));
      if (p.email) lines.push(paint(`   ${truncate(p.email, width - 4)}`, { fg: 'faint' }));
      for (const w of p.windows) lines.push(windowBar(w, width));
    }
    if (merged.profiles.length === 0) lines.push(paint('   no profiles in feed', { fg: 'faint' }));

    lines.push('');
    lines.push(paint(' daemons', { fg: 'dim', bold: true }));
    for (const d of merged.daemons) {
      const flags = [
        !d.schema_ok ? badge(' schema?', 'warn') : '',
        d.stale ? badge(' stale', 'warn') : '',
        !d.reachable ? paint(` asleep · ${ago(d.generated_at)} ago`, { fg: 'faint' }) : '',
        d.last_error ? paint(` err: ${truncate(d.last_error, 30)}`, { fg: 'danger' }) : '',
      ].join('');
      const fc = d.forecast ? paint(` → next ${d.forecast.action}${d.forecast.to ? ` ${d.forecast.to}` : ''}`, { fg: 'faint' }) : '';
      lines.push(
        ' ' +
          paint(padEnd(d.host, 6), { fg: 'text' }) +
          paint(padEnd(d.version ?? '?', 6), { fg: 'faint' }) +
          paint(' active ', { fg: 'faint' }) +
          paint(d.active_profile ?? '—', { fg: 'accent' }) +
          fc +
          flags,
      );
    }
    const chain = merged.daemons[0]?.fallback_chain ?? [];
    if (chain.length > 0) lines.push(paint(' chain  ', { fg: 'faint' }) + paint(chain.join(' → '), { fg: 'dim' }));

    for (const t of merged.tokens) {
      lines.push('');
      lines.push(paint(` tokens`, { fg: 'dim', bold: true }) + paint(` (${t.host}, machine-wide)`, { fg: 'faint' }));
      for (const p of t.tokens.periods) {
        const plus = p.floor ? '+' : '';
        const cost = p.cost_usd >= 1000 ? `$${Math.round(p.cost_usd).toLocaleString()}` : `$${p.cost_usd.toFixed(2)}`;
        lines.push(
          ' ' +
            paint(padEnd(p.key === 'lifetime' ? 'life' : p.key, 7), { fg: 'dim' }) +
            padStart(compactTokens(p.total_tokens) + plus, 8) +
            '  ' +
            paint(cost + plus, { fg: 'accent2' }),
        );
      }
      const today = t.tokens.periods.find((p) => p.key === 'today');
      if (today && today.models.length > 0 && width >= 60) {
        const models = today.models.map((m) => `${m.display} ${compactTokens(m.total_tokens)} $${m.cost_usd.toFixed(0)}`).join(' · ');
        lines.push(paint(` ${truncate(models, width - 2)}`, { fg: 'faint' }));
      }
    }
  }
  for (const b of broken) {
    // probe enabled but erroring — "daemon broken" must never render as "not deployed"
    if (lines.length > 0) lines.push('');
    lines.push(paint(` ${b.host.display_name}`, { fg: 'dim', bold: true }));
    lines.push(paint(` ✖ clauth feed unavailable — ${b.probe.error ?? 'no data yet'}`, { fg: 'danger' }));
  }

  // codex — per host, NEVER merged: hosts may hold different ChatGPT logins
  // and the passive feed carries no identity to dedupe on. Window rows reuse
  // windowBar so claude and codex bars can't drift apart visually.
  if (codexRows.length > 0 || codexBroken.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      paint(' codex', { fg: 'dim', bold: true }) +
        paint(' · per host — logins differ', { fg: 'faint' }),
    );
    for (const r of sortCodexByFreshness(codexRows)) {
      lines.push(codexHead(r.host, r.u, r.reachable, width));
      const wins = codexDisplayWindows(r.u, Date.now());
      for (const w of wins) lines.push(windowBar(w, width, w.reset_elapsed ? 'reset' : undefined));
      if (wins.length === 0) lines.push(paint('   no usage snapshot in recent sessions', { fg: 'faint' }));
    }
    for (const b of codexBroken) {
      lines.push(
        paint(` ✖ ${b.host.display_name} codex feed unavailable — ${b.probe.error ?? 'no data yet'}`, {
          fg: 'danger',
        }),
      );
    }
  }

  // auth posture — how each host authenticates (bookkeeping): claude oauth vs
  // long-lived setup-token, codex per home (chatgpt sub vs api key).
  if (authRows.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      paint(' auth', { fg: 'dim', bold: true }) +
        paint(' · posture per host', { fg: 'faint' }),
    );
    for (const a of authRows) lines.push(...authLines(a, width));
  }

  return lines.map((l) => truncate(l, width));
}

/** ` basalt  claude setup-token · max · 350d` + an indented codex line. The
 *  setup-token (pinned, non-rotating) is the notable posture, so it reads in
 *  accent; an api-key codex home (e.g. a bot's provider key) likewise. */
function authLines(a: AuthView[number], width: number): string[] {
  const out: string[] = [];
  const head = ' ' + paint(padEnd(a.display_name, 10), { fg: 'text', bold: true });
  if (a.claude) {
    const m = a.claude.method;
    const methodTag = paint(m, { fg: m === 'oauth' ? 'success' : 'accent' });
    const meta = [
      a.claude.subscription,
      // expiry is only meaningful for a setup-token (the ~1yr pinned expiry).
      // For oauth it's the short-lived access-token expiry (often already
      // lapsed → a misleading negative countdown), so omit it.
      m === 'setup-token' && a.claude.days_to_expiry != null ? `${a.claude.days_to_expiry}d` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    out.push(head + paint('claude ', { fg: 'faint' }) + methodTag + (meta ? paint(` · ${meta}`, { fg: 'faint' }) : ''));
  } else {
    out.push(head + paint('claude —', { fg: 'faint' }));
  }
  if (a.codex.length > 0) {
    const chatgpt = a.codex.filter((c) => c.method === 'chatgpt').length;
    const apikeys = a.codex.filter((c) => c.method === 'apikey');
    const parts = [
      chatgpt > 0 ? paint(`chatgpt ×${chatgpt}`, { fg: 'text' }) : '',
      apikeys.length > 0
        ? paint(`apikey ×${apikeys.length}`, { fg: 'accent2' }) +
          paint(` (${apikeys.map((c) => c.label).join(', ')})`, { fg: 'faint' })
        : '',
    ].filter(Boolean);
    out.push('           ' + paint('codex  ', { fg: 'faint' }) + parts.join(paint(' · ', { fg: 'faint' })));
  }
  return out;
}

/** ` ● mica  pro  RATE-LIMITED  3m ago` — the badge survives narrow widths,
 *  decoration (plan/asleep/age) drops whole. The dot: red = limit still in
 *  force (codexStillLimited — a limit whose window has reset is dead info),
 *  green = snapshot fresh (codex actively running), dim = idle/stale. */
function codexHead(host: string, u: CodexUsageInfo, reachable: boolean, width: number): string {
  const nowMs = Date.now();
  const limited = codexStillLimited(u, nowMs);
  const fresh = codexFresh(u, nowMs);
  const stale = codexStale(u, nowMs);
  const dot = limited
    ? paint('●', { fg: 'danger' })
    : fresh
      ? paint('●', { fg: 'success' })
      : paint('○', { fg: 'faint' });
  // >6h-stale rows dim (faint, non-bold name) so old headroom reads as history,
  // not live; a still-active limit stays loud regardless of snapshot age.
  const dim = stale && !limited;
  const name = paint(host, { fg: dim ? 'faint' : 'text', bold: !dim });
  const plan = u.plan_type ? paint(`  ${u.plan_type}`, { fg: 'faint' }) : '';
  const freshTag = fresh && !limited ? badge('  fresh', 'ok') : '';
  const lim = limited ? badge('  RATE-LIMITED', 'crit') : '';
  const asleep = !reachable ? paint('  asleep', { fg: 'faint' }) : '';
  const age = u.snapshot_at
    ? paint(`  ${ago(u.snapshot_at)} ago`, { fg: 'faint' })
    : paint('  no snapshot yet', { fg: 'faint' });
  const full = ` ${dot} ${name}${plan}${freshTag}${lim}${asleep}${age}`;
  return visibleWidth(full) <= width ? full : ` ${dot} ${name}${freshTag}${lim}`;
}

function profileHead(p: MergedProfile, width: number): string {
  const active = p.active_on.length > 0;
  const dot = active ? paint('●', { fg: 'success' }) : paint('○', { fg: 'faint' });
  const name = paint(p.name, { fg: 'text', bold: true });
  const tier = p.tier ? paint(`  ${p.tier}`, { fg: 'faint' }) : '';
  const activeTag = active ? badge(`  ACTIVE ${p.active_on.join('+')}`, 'ok') : '';
  const state =
    p.auth_status === 'auth_broken'
      ? badge('  AUTH BROKEN', 'crit')
      : p.auth_status === 'expiring'
        ? badge('  expiring', 'warn')
        : p.fetch_status === 'RateLimited'
          ? badge('  rate limited', 'warn')
          : '';
  // tier drops before the state badges on narrow widths (ccu's rule)
  const full = ` ${dot} ${name}${tier}${activeTag}${state}`;
  return visibleWidth(full) <= width ? full : ` ${dot} ${name}${activeTag}${state}`;
}

/** ` 5h    ██████░░░░░░░░  25%  2h41m` — bar absorbs the slack. `resetText`
 *  overrides the countdown (codex uses `reset` for an elapsed window). */
function windowBar(
  w: Pick<MergedProfile['windows'][number], 'label' | 'used_pct' | 'resets_at'>,
  width: number,
  resetText?: string,
): string {
  const label = w.label === '7d' || w.label === '5h' ? w.label : w.label.replace(/^7d /, ''); // '7d fable' → 'fable'
  const pct = Math.min(100, Math.max(0, w.used_pct));
  const pctTxt = `${Math.round(pct)}%`.padStart(4);
  const reset = (resetText ?? until(w.resets_at)).padStart(6);
  // ' ' + label(6) + bar + pctTxt(4) + '  ' + reset(6)
  const barW = Math.max(6, width - 1 - 6 - 4 - 2 - 6 - 1);
  const fill = Math.round((pct / 100) * barW);
  const color = utilColor(pct);
  const bar = paint('█'.repeat(fill), { fg: color }) + paint('░'.repeat(barW - fill), { fg: 'lineStrong' });
  if (width < 34) {
    // below bar-viability (ccu gives way to bare percentages)
    return ' ' + paint(padEnd(label, 6), { fg: 'dim' }) + paint(pctTxt.trim(), { fg: color });
  }
  return ' ' + paint(padEnd(label, 6), { fg: 'dim' }) + bar + paint(pctTxt, { fg: color }) + '  ' + paint(reset, { fg: 'faint' });
}
