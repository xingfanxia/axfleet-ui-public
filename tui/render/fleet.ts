/**
 * Fleet tab — host list + detail panel for the selected host. Layout adapts to
 * width: ≥90 shows role column, ≥76 shows inline gauges, below that a compact
 * numeric row that stays readable at ~45 cols (Moshi portrait).
 */
import type { FleetHost, FleetProblem, ServiceInfo } from '../../contracts/types';
import { ago, bytesHuman, humanDuration, primaryDisk } from '../../lib/format';
import { padEnd, padStart, truncate } from '../ansi';
import { CARET, paint, utilColor } from '../theme';
import type { AppState } from '../state';
import { badge, box, downsample, gauge, kv, sparkline } from './widgets';

export function renderFleet(s: AppState, width: number, height: number): string[] {
  if (!s.fleet) return [paint(' loading fleet…', { fg: 'faint' })];
  const hosts = s.fleet.hosts;
  const lines: string[] = [];
  hosts.forEach((h, i) => lines.push(hostRow(h, i === s.sel, width)));
  const detailRoom = height - lines.length - 1;
  const selHost = hosts[s.sel];
  if (selHost && detailRoom >= 4) {
    lines.push('');
    lines.push(...hostDetail(s, selHost, width, detailRoom - 1));
  }
  return lines;
}

function statusDot(h: FleetHost): string {
  if (h.reachable) return paint('●', { fg: 'success' });
  if (h.expected_flaky) return paint('◌', { fg: 'faint' });
  return paint('✖', { fg: 'danger', bold: true });
}

function pctCell(pct: number | null | undefined, suffix: string): string {
  if (pct == null || !Number.isFinite(pct)) return paint(`  —${suffix}`, { fg: 'faint' });
  return paint(padStart(String(Math.round(pct)), 3) + suffix, { fg: utilColor(pct) });
}

function hostRow(h: FleetHost, selected: boolean, width: number): string {
  const caret = selected ? paint(CARET, { fg: 'accent', bold: true }) : ' ';
  const snap = h.snapshot;
  const name = paint(padEnd(truncate(h.display_name, 13), 13), selected ? { fg: 'text', bold: true } : { fg: 'text' });
  const svc = svcSummary(snap?.services.data);
  const cpu = pctCell(snap?.cpu.used_pct, 'c');
  const mem = pctCell(snap?.mem.used_pct, 'm');
  const disk = snap?.disks ? pctCell(primaryDisk(snap.disks)?.used_pct, 'd') : pctCell(null, 'd');
  const base = `${caret} ${statusDot(h)} ${name}`;
  if (!h.reachable) {
    const why = h.expected_flaky ? 'asleep (expected)' : `unreachable · last seen ${h.stale_sec != null ? humanDuration(h.stale_sec) + ' ago' : 'never'}`;
    return `${base} ${paint(why, { fg: h.expected_flaky ? 'faint' : 'danger' })}`;
  }
  if (width >= 90) {
    const role = paint(padEnd(truncate(h.role, width - 62), Math.max(0, width - 62)), { fg: 'faint' });
    return `${base} ${role} ${cpu} ${mem} ${disk}  ${svc}`;
  }
  return `${base} ${cpu} ${mem} ${disk}  ${svc}`;
}

function svcSummary(services: ServiceInfo[] | undefined): string {
  if (!services) return paint('svc —', { fg: 'faint' });
  const expected = services.filter((x) => x.expected);
  const ok = expected.filter((x) => x.state === 'running').length;
  const kind = ok === expected.length ? 'ok' : ok >= expected.length - 1 ? 'warn' : 'crit';
  return badge(`svc ${ok}/${expected.length}`, expected.length === 0 ? 'off' : kind);
}

function hostDetail(s: AppState, h: FleetHost, width: number, maxLines: number): string[] {
  const snap = h.snapshot;
  const inner = width - 2;
  const body: string[] = [];
  if (!snap) {
    body.push(paint('no snapshot yet', { fg: 'faint' }));
    return box(body, width, { title: h.display_name });
  }
  const gw = Math.min(30, Math.max(12, inner - 34));
  body.push(kv(' cpu', gauge(snap.cpu.used_pct, gw) + paint(`  load ${snap.cpu.load1.toFixed(1)} ${snap.cpu.load5.toFixed(1)} ${snap.cpu.load15.toFixed(1)} · ${snap.cpu.cores}c`, { fg: 'dim' }), 5));
  body.push(kv(' mem', gauge(snap.mem.used_pct, gw) + paint(`  ${(snap.mem.used_mb / 1024).toFixed(1)}/${(snap.mem.total_mb / 1024).toFixed(0)} GiB`, { fg: 'dim' }), 5));
  const hist = s.history[h.host_id];
  if (hist && hist.points.length > 1) {
    const w = Math.min(inner - 10, 48);
    body.push(kv(' 48h', sparkline(downsample(hist.points.map((p) => p.cpu_pct), w), w, 'accent') + paint(' cpu', { fg: 'faint' }), 5));
  }
  const disks = snap.disks
    .map((d) => `${d.mount} ${paint(`${Math.round(d.used_pct)}%`, { fg: utilColor(d.used_pct) })} ${paint(`${bytesHuman(d.used_gb * 2 ** 30)}/${bytesHuman(d.total_gb * 2 ** 30)}`, { fg: 'faint' })}`)
    .join('  ');
  body.push(kv(' dsk', disks, 5));
  body.push(kv(' net', tailscaleLine(h), 5));
  body.push(...serviceLines(snap.services.data, inner, Math.max(1, maxLines - body.length - 3)));
  const probs = s.fleet?.problems.filter((p) => p.host_id === h.host_id) ?? [];
  for (const p of probs.slice(0, Math.max(0, maxLines - body.length - 2))) body.push(problemLine(p));
  const meta = `up ${humanDuration(snap.os.uptime_sec)} · ${snap.os.platform} · snap ${ago(snap.taken_at)} ago`;
  return box(body.slice(0, Math.max(1, maxLines - 2)), width, { title: `${h.display_name} · ${truncate(h.role, 40)}`, meta });
}

function tailscaleLine(h: FleetHost): string {
  const ts = h.snapshot?.tailscale;
  const agents = h.snapshot?.agents.data;
  const mosh = h.snapshot?.mosh.data;
  const parts: string[] = [];
  if (ts?.available && ts.data) {
    parts.push(`ts ${ts.data.self_ip}${ts.data.self_online ? '' : ' offline!'}`);
  } else if (h.tailnet_ip) {
    parts.push(`ip ${h.tailnet_ip}`);
  }
  if (agents) parts.push(`agents ${agents.claude_procs}cl/${agents.codex_procs}cx`);
  if (mosh && mosh.active_sessions > 0) parts.push(`mosh ${mosh.active_sessions}`);
  return paint(parts.join(' · '), { fg: 'dim' });
}

function serviceLines(services: ServiceInfo[] | undefined, width: number, maxLines: number): string[] {
  if (!services || maxLines <= 0) return [];
  const expected = services.filter((x) => x.expected);
  const bad = expected.filter((x) => x.state !== 'running');
  const okCount = expected.length - bad.length;
  const head = kv(' svc', bad.length === 0 ? badge(`${okCount}/${expected.length} running`, 'ok') : badge(`${okCount}/${expected.length} running · ${bad.length} down`, 'crit'), 5);
  const rows = bad.slice(0, Math.max(0, maxLines - 1)).map((x) => `      ${paint('✗', { fg: 'danger', bold: true })} ${x.name} ${paint(`${x.supervisor} · ${x.state}`, { fg: 'faint' })}`);
  if (bad.length > rows.length) rows.push(paint(`      +${bad.length - rows.length} more down`, { fg: 'danger' }));
  return [head, ...rows];
}

export function problemLine(p: FleetProblem): string {
  const sev = p.severity === 'crit' ? badge('CRIT', 'crit') : p.severity === 'warn' ? badge('WARN', 'warn') : badge('info', 'off');
  return ` ${sev} ${p.msg} ${paint(`· ${ago(p.since)}`, { fg: 'faint' })}`;
}
