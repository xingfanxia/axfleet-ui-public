/**
 * VPN tab — the sing-box boxes: list rows + a detail panel with live
 * throughput sparklines (from history up/down bps), traffic counters,
 * cert expiry, and subscription links.
 */
import type { SingboxView } from '../../contracts/types';
import { buildSingboxView } from '../../lib/views';
import { ago, bpsHuman, bytesHuman } from '../../lib/format';
import { padEnd, truncate } from '../ansi';
import { CARET, paint } from '../theme';
import type { AppState } from '../state';
import { badge, box, downsample, kv, sparkline } from './widgets';

export function renderVpn(s: AppState, width: number, height: number): string[] {
  if (!s.fleet) return [paint(' loading…', { fg: 'faint' })];
  const view = buildSingboxView(s.fleet.hosts);
  if (view.length === 0) return [paint(' no sing-box hosts reporting', { fg: 'faint' })];
  const lines: string[] = [];
  view.forEach((v, i) => lines.push(vpnRow(v, i === s.sel, width)));
  const sel = view[Math.min(s.sel, view.length - 1)];
  const room = height - lines.length - 1;
  if (sel && room >= 4) {
    lines.push('');
    lines.push(...vpnDetail(s, sel, width, room - 1));
  }
  return lines;
}

type Row = SingboxView[number];

function stateBadge(v: Row): string {
  if (!v.reachable) return badge('unreach', 'crit');
  switch (v.service_state) {
    case 'running':
      return badge('running', 'ok');
    case 'failed':
      return badge('FAILED', 'crit');
    case 'stopped':
      return badge('stopped', 'crit');
    default:
      return badge(v.service_state, 'warn');
  }
}

function certDays(v: Row): number | null {
  if (!v.cert_expiry) return null;
  const ms = Date.parse(v.cert_expiry) - Date.now();
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

function vpnRow(v: Row, selected: boolean, width: number): string {
  const caret = selected ? paint(CARET, { fg: 'accent', bold: true }) : ' ';
  const name = paint(padEnd(truncate(v.display_name, 14), 14), selected ? { fg: 'text', bold: true } : { fg: 'text' });
  const thr = paint(`↑${bpsHuman(v.throughput.up_bps)} ↓${bpsHuman(v.throughput.down_bps)}`, { fg: 'dim' });
  const conns =
    v.clients_active != null
      ? paint(`${v.clients_active} clients`, { fg: 'warning' })
      : paint(`${v.connections.active} conn`, { fg: 'dim' });
  const days = certDays(v);
  const cert = days == null ? '' : days < 14 ? badge(`cert ${days}d!`, days < 7 ? 'crit' : 'warn') : paint(`cert ${days}d`, { fg: 'faint' });
  const upd = v.update_available ? badge(`→${v.latest_version ?? 'new'}`, 'warn') : '';
  if (width >= 90) {
    const ver = paint(padEnd(`v${v.version ?? '?'}`, 9), { fg: 'faint' });
    return `${caret} ${stateBadge(v)} ${name} ${ver} ${padEnd(thr, 24)} ${padEnd(conns, 11)} ${cert} ${upd}`.trimEnd();
  }
  return `${caret} ${stateBadge(v)} ${name} ${thr} ${cert} ${upd}`.trimEnd();
}

function vpnDetail(s: AppState, v: Row, width: number, maxLines: number): string[] {
  const inner = width - 2;
  const body: string[] = [];
  const hist = s.history[v.host_id];
  const sparkW = Math.max(8, Math.min(28, Math.floor((inner - 24) / 2)));
  if (hist && hist.points.length > 1) {
    const up = downsample(hist.points.map((p) => p.up_bps), sparkW);
    const down = downsample(hist.points.map((p) => p.down_bps), sparkW);
    body.push(
      kv(' thr', `${paint('↑', { fg: 'accent' })}${sparkline(up, sparkW, 'accent')} ${paint(bpsHuman(v.throughput.up_bps), { fg: 'dim' })}`, 7),
    );
    body.push(
      kv('', `${paint('↓', { fg: 'info' })}${sparkline(down, sparkW, 'info')} ${paint(bpsHuman(v.throughput.down_bps), { fg: 'dim' })}`, 7),
    );
  } else {
    body.push(kv(' thr', paint(`↑ ${bpsHuman(v.throughput.up_bps)}  ↓ ${bpsHuman(v.throughput.down_bps)}`, { fg: 'dim' }), 7));
  }
  const clientHist = hist?.points.filter((p) => p.clients != null) ?? [];
  if (clientHist.length > 1) {
    const cw = Math.max(8, Math.min(28, inner - 30));
    const peak = Math.max(...clientHist.map((p) => p.clients ?? 0));
    body.push(
      kv(
        ' users',
        sparkline(downsample((hist?.points ?? []).map((p) => p.clients), cw), cw, 'warning') +
          paint(`  now ${v.clients_active ?? '—'} · peak ${peak}`, { fg: 'dim' }),
        7,
      ),
    );
  } else if (v.clients_active != null) {
    body.push(kv(' users', paint(`${v.clients_active} connected`, { fg: 'dim' }), 7));
  }
  const t = v.traffic;
  body.push(
    kv(' data', paint(`today ${bytesHuman(t.daily_bytes)} · wk ${bytesHuman(t.weekly_bytes)} · mo ${bytesHuman(t.monthly_bytes)} · all ${bytesHuman(t.total_bytes)}`, { fg: 'dim' }), 7),
  );
  const days = certDays(v);
  const certVal =
    v.cert_expiry == null
      ? paint('none', { fg: 'faint' })
      : days != null && days < 14
        ? badge(`${v.cert_expiry.slice(0, 10)} (${days}d left!)`, days < 7 ? 'crit' : 'warn')
        : paint(`${v.cert_expiry.slice(0, 10)} (${days}d)`, { fg: 'dim' });
  body.push(kv(' cert', certVal, 7));
  body.push(kv(' proto', paint(v.protocols.join(' · ') || '—', { fg: 'dim' }), 7));
  if (v.subscription) {
    // Full credential-bearing URLs on purpose — this renders only in the
    // operator's own terminal. Label first so a narrow-width cut truncates the
    // URL tail, not the label that tells the two lines apart.
    body.push(kv(' sub', paint('clash ', { fg: 'faint' }) + paint(v.subscription.clash_url, { fg: 'accent' }), 7));
    body.push(kv('', paint('s-box ', { fg: 'faint' }) + paint(v.subscription.singbox_url, { fg: 'accent' }), 7));
  }
  if (v.update_available) {
    body.push(kv(' upd', badge(`update available → ${v.latest_version ?? '?'} (weekly auto-updater will apply)`, 'warn'), 7));
  }
  const conn = v.clients_active != null ? `${v.clients_active} clients · ${v.connections.active} socks` : `${v.connections.active} sockets`;
  const meta = `v${v.version ?? '?'} · ${conn} · ${v.interface ?? ''}`.replace(/ · $/, '');
  return box(body.slice(0, Math.max(1, maxLines - 2)), width, { title: `${v.display_name}`, meta });
}
