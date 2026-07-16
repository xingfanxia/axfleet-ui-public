/**
 * Alerts tab — active problems (annotated with feishu push status), the lark
 * DM log, endpoint health, and the rolling event log. j/k scrolls.
 * Mirrors the web alerts pane: same sections, same annotation semantics.
 */
import type { SentNotification } from '../../contracts/types';
import { ago } from '../../lib/format';
import { padEnd, truncate, wrapPlain } from '../ansi';
import { paint } from '../theme';
import type { AppState } from '../state';
import { badge } from './widgets';
import { problemLine } from './fleet';

export function renderAlerts(s: AppState, width: number): string[] {
  if (!s.fleet) return [paint(' loading…', { fg: 'faint' })];
  // Narrow (phone) mode: the message IS the signal on this tab — stack it on
  // wrapped continuation lines under each row instead of truncating it away.
  const narrow = width < 60;
  const lines: string[] = [];
  const section = (t: string) => {
    if (lines.length > 0) lines.push('');
    lines.push(paint(` ${t}`, { fg: 'dim', bold: true }));
  };

  // problem_id → its most recent lark notification (rows arrive newest-first).
  const larked = new Map<string, SentNotification>();
  for (const n of s.notifications ?? []) {
    if (!larked.has(n.problem_id)) larked.set(n.problem_id, n);
  }

  section(`problems (${s.fleet.problems.length})`);
  if (s.fleet.problems.length === 0) lines.push(paint('   all clear ✓', { fg: 'success' }));
  for (const p of s.fleet.problems) {
    const n = larked.get(p.id);
    const push = n ? (n.delivered ? badge(' 飞书✓', 'ok') : badge(' 飞书✗', 'crit')) : '';
    if (narrow) {
      const sev = p.severity === 'crit' ? badge('CRIT', 'crit') : p.severity === 'warn' ? badge('WARN', 'warn') : badge('info', 'off');
      lines.push(` ${sev} ${paint(String(p.host_id), { fg: 'faint' })} ${paint(`· ${ago(p.since)} ago`, { fg: 'faint' })}${push}`);
      for (const w of wrapPlain(p.msg, width - 4)) lines.push(`   ${w}`);
    } else {
      lines.push(` ${paint(padEnd(p.host_id, 12), { fg: 'faint' })}${problemLine(p)}${push}`);
    }
  }

  section(`feishu pushes (${s.notifications?.length ?? '…'})`);
  if (!s.notifications) {
    lines.push(paint('   loading…', { fg: 'faint' }));
  } else if (s.notifications.length === 0) {
    lines.push(paint('   none sent', { fg: 'faint' }));
  } else {
    for (const n of s.notifications) {
      const del = n.delivered ? badge('✓', 'ok') : badge('✗ failed', 'crit');
      const sev = n.severity === 'crit' ? badge('CRIT', 'crit') : n.severity === 'warn' ? badge('WARN', 'warn') : badge('info', 'off');
      // resolved = the paged condition has cleared; render muted so it no longer
      // reads as a live alert (mirrors the web pane's greyed row).
      const state = n.resolved ? badge('resolved', 'off') : badge('active', 'warn');
      if (narrow) {
        lines.push(`   ${del} ${paint(`${ago(n.ts)} ago`, { fg: 'faint' })} ${state} ${sev} ${paint(String(n.host_id), { fg: 'dim' })}`);
        const full = n.msg + (n.error ? ` — ${n.error}` : '');
        for (const w of wrapPlain(full, width - 6)) lines.push(n.resolved ? paint(`     ${w}`, { fg: 'faint' }) : `     ${w}`);
      } else {
        const msg = n.resolved ? paint(n.msg, { fg: 'faint' }) : n.msg;
        lines.push(
          `   ${del} ${paint(padEnd(`${ago(n.ts)} ago`, 8), { fg: 'faint' })} ${state} ${sev} ${paint(padEnd(String(n.host_id), 12), { fg: 'dim' })} ${msg}${n.error ? paint(` — ${n.error}`, { fg: 'danger' }) : ''}`,
        );
      }
    }
  }

  section('endpoints');
  for (const e of s.fleet.endpoints) {
    const b = e.ok ? badge('up', 'ok') : badge('DOWN', 'crit');
    const lat = e.latency_ms != null ? paint(`${e.latency_ms}ms`, { fg: 'faint' }) : '';
    lines.push(`   ${b} ${padEnd(e.name, 10)} ${lat}`.trimEnd());
  }

  section('recent events');
  const events = s.fleet.events.slice(0, 30);
  if (events.length === 0) lines.push(paint('   none', { fg: 'faint' }));
  for (const ev of events) {
    const t = paint(ev.ts.slice(11, 16), { fg: 'faint' });
    const kindColor = ev.kind === 'host-down' || ev.kind === 'problem' ? 'danger' : ev.kind === 'host-up' || ev.kind === 'resolved' ? 'success' : 'faint';
    if (narrow) {
      lines.push(`   ${t} ${paint(ev.kind, { fg: kindColor })} ${paint(String(ev.host_id), { fg: 'dim' })}`);
      for (const w of wrapPlain(ev.msg, width - 9)) lines.push(`         ${w}`);
    } else {
      lines.push(`   ${t} ${paint(padEnd(ev.kind, 9), { fg: kindColor })} ${paint(padEnd(String(ev.host_id), 12), { fg: 'dim' })} ${ev.msg}`);
    }
  }

  return lines.map((l) => truncate(l, width));
}
