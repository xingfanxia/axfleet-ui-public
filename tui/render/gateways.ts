/**
 * Gateways tab — app-level health for Factorio plus the knowledge-stack
 * host's docker gateways. Factorio reports bounded current-invocation
 * metadata; Omni and New API catch the "containers are Up but the app quietly
 * died" failure mode. Omni state thresholds come from the shared
 * OMNI_SYNC_STALE contract so this badge, the web badge, and the hub alert
 * can never disagree.
 */
import { factorioView } from '../../contracts/factorio';
import { NEWAPI_CHANNEL_STATUS, OMNI_SYNC_STALE, omniSourceHealth } from '../../contracts/types';
import type { BlogNewsletter, FactorioInfo, FleetHost, HostSnapshot, NewApiInfo, OmniInfo, Probe, RadarNewsletter } from '../../contracts/types';
import { ago, estimatedCount, lowerBoundCount } from '../../lib/format';
import { padEnd, padStart, truncate } from '../ansi';
import { paint, type ColorName } from '../theme';
import type { AppState } from '../state';

type SourceRow = OmniInfo['sources'][number];

interface SourceGlyph {
  glyph: string;
  color: ColorName;
  label: string;
}

/** glyph/color from THE shared classifier — severity mirrors the alert rule exactly */
export function sourceGlyph(s: SourceRow, now: number): SourceGlyph {
  switch (omniSourceHealth(s, now)) {
    case 'off':
      return { glyph: '○', color: 'faint', label: 'off' };
    case 'pending':
      return { glyph: '○', color: 'faint', label: 'pending' };
    case 'never-synced':
      return s.failed_since_success >= OMNI_SYNC_STALE.CRIT_FAILS
        ? { glyph: '✖', color: 'danger', label: 'never synced' }
        : { glyph: '▲', color: 'warning', label: 'never synced' };
    case 'dead':
      return { glyph: '✖', color: 'danger', label: 'dead' };
    case 'syncing':
      return { glyph: '↻', color: 'info', label: 'syncing' };
    case 'stale':
      return { glyph: '▲', color: 'warning', label: 'stale' };
    case 'flaky':
      return { glyph: '▲', color: 'warning', label: 'flaky' };
    default:
      return { glyph: '●', color: 'success', label: 'ok' };
  }
}

export function renderGateways(s: AppState, width: number): string[] {
  if (!s.fleet) return [paint(' loading…', { fg: 'faint' })];
  // deploy boundary: hub may predate radar_newsletter (hub/web deploy skew)
  const nl = s.fleet.radar_newsletter;
  // same skew guard for the blog rollup
  const bnl = s.fleet.blog_newsletter;
  const rows: Array<{ host: FleetHost; probe: Probe<OmniInfo> }> = [];
  const newapiRows: Array<{ host: FleetHost; probe: Probe<NewApiInfo> }> = [];
  const factorioRows: Array<{ host: FleetHost; probe: Probe<FactorioInfo> }> = [];
  for (const h of s.fleet.hosts) {
    // deploy boundary: pre-upgrade collectors ship snapshots without the key
    const om = (h.snapshot as HostSnapshot | null)?.omni;
    if (om) rows.push({ host: h, probe: om });
    const na = (h.snapshot as HostSnapshot | null)?.newapi;
    if (na) newapiRows.push({ host: h, probe: na });
    const factorio = (h.snapshot as HostSnapshot | null)?.factorio;
    if (factorio) factorioRows.push({ host: h, probe: factorio });
  }
  if (rows.length === 0 && newapiRows.length === 0 && factorioRows.length === 0) {
    const lines: string[] = [];
    if (bnl) lines.push(...blogNewsletterBlock(bnl));
    if (nl) {
      if (lines.length > 0) lines.push('');
      lines.push(...radarNewsletterBlock(nl));
    }
    if (lines.length > 0) lines.push('');
    lines.push(paint(' no Factorio, Omni, or New API hosts reporting', { fg: 'faint' }));
    return lines.map((l) => truncate(l, width));
  }

  const now = Date.now();
  const lines: string[] = [];
  if (bnl) lines.push(...blogNewsletterBlock(bnl));
  if (nl) {
    if (lines.length > 0) lines.push('');
    lines.push(...radarNewsletterBlock(nl));
  }
  for (const r of factorioRows) {
    if (lines.length > 0) lines.push('');
    lines.push(...factorioHost(r.host, r.probe));
  }
  for (const r of rows) {
    if (lines.length > 0) lines.push('');
    if (r.probe.data) {
      lines.push(...omniHost(r.host, r.probe.data, r.probe.checked_at, width, now));
      // a failed probe with retained last-good data still shows, flagged stale
      if (!r.probe.available) {
        lines.push(paint(` ⚠ probe failing — data above is last-good: ${r.probe.error ?? '?'}`, { fg: 'warning' }));
      }
    } else {
      // failed probe with NO retained data: say so loudly — "no omni hosts
      // reporting" during an omni outage is the false all-clear this pane exists to kill
      lines.push(paint(` omni · ${r.host.display_name}`, { fg: 'dim', bold: true }));
      lines.push(paint(` ✖ omni health unavailable — ${r.probe.error ?? 'no data yet'}`, { fg: 'danger' }));
    }
  }
  for (const r of newapiRows) {
    if (lines.length > 0) lines.push('');
    lines.push(...newapiHost(r.host, r.probe, width));
  }
  return lines.map((l) => truncate(l, width));
}

/** Blog newsletter rollup — same 45-col-floor compact shape as the
 *  radar block; double-opt-in lifecycle (confirmed/pending) + recent momentum. */
function blogNewsletterBlock(nl: BlogNewsletter): string[] {
  const confirmed = nl.confirmed ?? '—';
  const pending = nl.pending ?? '—';
  const total = nl.total ?? '—';
  const subs7d = nl.subs_7d ?? '—';
  const last = nl.last_subscribe_at ? `${ago(nl.last_subscribe_at)} ago` : '—';
  const sep = paint(' · ', { fg: 'faint' });
  return [
    ` ${paint('blog · newsletter', { fg: 'dim', bold: true })}`,
    ' ' +
      paint(`${confirmed} confirmed`, { fg: 'success', bold: true }) +
      sep +
      paint(`${pending} pending`, { fg: 'dim' }) +
      sep +
      paint(`${total} total`, { fg: 'faint' }),
    ' ' +
      paint(`${subs7d} new 7d`, { fg: 'dim' }) +
      sep +
      paint(`last signup ${last}`, { fg: 'faint' }),
  ];
}

/** News newsletter rollup — a compact block that fits the 45-col phone floor
 *  (subscribers and delivery on their own lines). Null fields
 *  (creds unset / query failed) render '—'; failed sends flag warning. */
function radarNewsletterBlock(nl: RadarNewsletter): string[] {
  const failed = nl.failed_total ?? 0;
  const active = nl.active ?? '—';
  const pending = nl.pending ?? '—';
  const delivered = nl.delivered_total ?? '—';
  const last = nl.last_send_at ? `${ago(nl.last_send_at)} ago` : '—';
  const sep = paint(' · ', { fg: 'faint' });
  const failTxt = failed > 0 ? sep + paint(`${failed} failed`, { fg: 'warning', bold: true }) : '';
  return [
    ` ${paint('radar · newsletter', { fg: 'dim', bold: true })}`,
    ' ' +
      paint(`${active} active`, { fg: 'success', bold: true }) +
      sep +
      paint(`${pending} pending`, { fg: 'dim' }),
    ' ' +
      paint(`${delivered} delivered`, { fg: 'dim' }) +
      failTxt +
      sep +
      paint(`last send ${last}`, { fg: 'faint' }),
  ];
}

function factorioHost(host: FleetHost, probe: Probe<FactorioInfo>): string[] {
  const view = factorioView(probe, host.reachable);
  if (!view.data) return [
    paint(` Factorio · ${host.display_name}`, { fg: 'dim', bold: true }),
    paint(` ✖ telemetry unavailable — ${probe.error ?? 'no data yet'}`, { fg: 'danger' }),
  ];
  const data = view.data;
  const state = view.state === 'current'
    ? paint('● current', { fg: 'success' })
    : paint(`▲ ${view.state}`, { fg: 'warning' });
  return [
    ` ${paint(`Factorio · ${host.display_name}`, { fg: 'dim', bold: true })}  ${state}`,
    `  players ${view.players_label} · game ${data.game_version} · map ${data.save.map_version ?? 'unknown'}`,
    `  save ${data.save.loaded_file} · mods ${data.mods.length} · started ${ago(data.started_at)} ago`,
  ];
}

/** New API gateway health on the gateways tab (same docker-stack theme):
 *  a reachability line + a status row per upstream channel. auto-disabled
 *  (status 2) reads danger; manual-off (3) dim. */
function newapiHost(host: FleetHost, probe: Probe<NewApiInfo>, width: number): string[] {
  const out: string[] = [];
  if (!probe.data) {
    out.push(paint(` newapi · ${host.display_name}`, { fg: 'dim', bold: true }));
    out.push(paint(` ✖ gateway health unavailable — ${probe.error ?? 'no data yet'}`, { fg: 'danger' }));
    return out;
  }
  const { reachable, channels } = probe.data;
  const dot = reachable ? paint('●', { fg: 'success' }) : paint('✖', { fg: 'danger' });
  out.push(
    ` ${dot} ` +
      paint(`newapi · ${host.display_name}`, { fg: 'dim', bold: true }) +
      paint(reachable ? '  reachable' : '  DOWN', { fg: reachable ? 'faint' : 'danger' }),
  );
  for (const c of channels) {
    const label = NEWAPI_CHANNEL_STATUS[c.status] ?? String(c.status);
    const color: Parameters<typeof paint>[1]['fg'] = c.status === 2 ? 'danger' : c.status === 3 ? 'faint' : 'success';
    const lat = c.response_time_ms ? `${c.response_time_ms}ms` : '—';
    out.push(
      '   ' +
        padEnd(truncate(c.name, 34), 34) +
        paint(padEnd(label, 14), { fg: color }) +
        paint(padStart(lat, 8), { fg: 'faint' }),
    );
  }
  if (!probe.available) {
    out.push(paint(` ⚠ probe failing — data above is last-good: ${probe.error ?? '?'}`, { fg: 'warning' }));
  }
  return out;
}

function omniHost(host: FleetHost, o: OmniInfo, checkedAt: string, width: number, now: number): string[] {
  const lines: string[] = [];
  const flag = !host.reachable ? paint(' · last known', { fg: 'warning' }) : '';
  lines.push(
    paint(` omni · ${host.display_name}`, { fg: 'dim', bold: true }) +
      paint(` · checked ${ago(checkedAt)} ago`, { fg: 'faint' }) +
      flag,
  );

  const q = o.queue;
  const qCapped = o.queue_capped;
  const failRecent = lowerBoundCount(q.failed_recent, qCapped?.failed_recent);
  const failTxt = q.failed_recent > 0 ? paint(`${failRecent} fails/1h`, { fg: 'warning', bold: true }) : paint('0 fails/1h', { fg: 'dim' });
  const stuckTxt = o.stuck_runs > 0 ? paint(`${o.stuck_runs} stuck`, { fg: 'warning', bold: true }) : paint('0 stuck', { fg: 'dim' });
  lines.push(
    ' ' +
      paint(`${estimatedCount(o.docs_total, o.docs_total_estimated, true)} docs`, { fg: 'dim' }) +
      paint(' · ', { fg: 'faint' }) +
      paint(`queue ${lowerBoundCount(q.pending, qCapped?.pending)}p/${lowerBoundCount(q.processing, qCapped?.processing)}a`, { fg: 'dim' }) +
      paint(' · ', { fg: 'faint' }) +
      failTxt +
      paint(' · ', { fg: 'faint' }) +
      stuckTxt,
  );
  lines.push('');

  const wide = width >= 76;
  for (const src of o.sources) {
    const st = sourceGlyph(src, now);
    const dot = paint(st.glyph, { fg: st.color });
    const name = padEnd(truncate(src.name, wide ? 22 : 13), wide ? 22 : 13);
    const okAge = src.last_success_at ? `${ago(src.last_success_at)} ago` : '—';
    const agePart = paint(padStart(okAge, 8), st.color === 'success' || st.color === 'faint' ? { fg: 'dim' } : { fg: st.color });
    // fails only for ACTIVE, non-syncing sources — an off connector's stale streak is
    // history, and a syncing source is recovering, so its pre-recovery streak is not signal
    const fails =
      src.active && st.label !== 'syncing' && src.failed_since_success > 0
        ? paint(`  ${lowerBoundCount(src.failed_since_success, src.failed_since_success_capped)} fail${src.failed_since_success > 1 ? 's' : ''}`, { fg: 'warning' })
        : '';
    if (wide) {
      const docs = paint(padStart(lowerBoundCount(src.docs, src.docs_capped, true), 6), { fg: 'faint' });
      const type = paint(padEnd(src.source_type, 13), { fg: 'faint' });
      lines.push(` ${dot} ${name} ${type} ${docs} ${agePart}${fails}`.trimEnd());
    } else {
      lines.push(` ${dot} ${name} ${agePart}${fails}`.trimEnd());
    }
    // error detail on its own faint line, only for degraded ACTIVE sources.
    // Not on `syncing` — a resolved-and-recrawling source must not show the stale
    // pre-recovery error next to a healthy badge (the signal that confused this in the first place).
    if (src.last_error && st.label !== 'ok' && st.label !== 'off' && st.label !== 'syncing') {
      lines.push(paint(`     ${truncate(src.last_error, width - 6)}`, { fg: 'faint' }));
    }
  }
  return lines;
}
