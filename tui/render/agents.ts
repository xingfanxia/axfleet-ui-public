/**
 * Agents tab — zylos personas, herdr-managed agents, tmux loops, openclaw.
 * Stacked sections; j/k scrolls (no row selection here).
 */
import { UNANSWERED_STUCK_MIN } from '../../contracts/types';
import { buildAgentsView } from '../../lib/views';
import { ago, compactTokens, usd } from '../../lib/format';
import { padEnd, truncate } from '../ansi';
import { paint } from '../theme';
import type { AppState } from '../state';
import { badge } from './widgets';

export function renderAgents(s: AppState, width: number): string[] {
  if (!s.fleet) return [paint(' loading…', { fg: 'faint' })];
  const view = buildAgentsView(s.fleet.hosts, s.fleet.tokens);
  const lines: string[] = [];
  const section = (t: string) => {
    if (lines.length > 0) lines.push('');
    lines.push(paint(` ${t}`, { fg: 'dim', bold: true }));
  };

  section(`zylos personas (${view.zylos.length})`);
  if (view.zylos.length === 0) lines.push(paint('   none reporting', { fg: 'faint' }));
  for (const p of view.zylos) {
    const dot = p.tmux_alive ? paint('●', { fg: p.enabled ? 'success' : 'faint' }) : paint('✖', { fg: p.enabled ? 'danger' : 'faint' });
    const name = padEnd(truncate(p.display_name || p.id, 12), 12);
    const runtime = p.runtime_profile === 'claude-subscription'
      ? 'claude/sub'
      : p.runtime_profile === 'codex-subscription'
        ? 'codex/sub'
        : p.runtime_profile === 'codex-azure'
          ? 'codex/azure'
          : p.runtime_profile ?? p.runtime;
    const rt = paint(padEnd(truncate(runtime, 18), 18), { fg: 'faint' });
    const idle = p.idle_min != null ? `idle ${p.idle_min}m` : '';
    const ctx = p.context_pct != null ? `ctx ${Math.round(p.context_pct)}%` : '';
    const lin = p.last_inbound_at ? `in ${ago(p.last_inbound_at)}` : '';
    const lout = p.last_outbound_at ? `out ${ago(p.last_outbound_at)}` : '';
    // today activity: tokens is the real signal (subscription agents bill $0);
    // append cost only when > 0. Empty when the cache has no entry for today.
    const isAzureApi = p.runtime_profile === 'codex-azure';
    const today = [
      isAzureApi
        ? (p.api_today_tokens != null ? compactTokens(p.api_today_tokens) : '')
        : (p.today_tokens != null ? compactTokens(p.today_tokens) : ''),
      isAzureApi
        ? (p.api_today_equiv_cost_usd != null ? `~${usd(p.api_today_equiv_cost_usd)} LiteLLM` : '')
        : (p.today_cost_usd != null && p.today_cost_usd > 0 ? usd(p.today_cost_usd) : ''),
    ]
      .filter(Boolean)
      .join(' ');
    const stuck = (p.unanswered ?? 0) > 0
      ? badge(` ${p.unanswered} unanswered${(p.oldest_unanswered_min ?? 0) >= UNANSWERED_STUCK_MIN ? ` ${p.oldest_unanswered_min}m!` : ''}`, (p.oldest_unanswered_min ?? 0) >= UNANSWERED_STUCK_MIN ? 'crit' : 'warn')
      : '';
    const meta = paint([idle, ctx, lin, lout, today].filter(Boolean).join(' · '), { fg: 'dim' });
    lines.push(`  ${dot} ${name} ${rt} ${meta}${stuck}`.trimEnd());
  }

  if (view.herdr.length > 0) {
    section(`herdr agents (${view.herdr.length})`);
    for (const a of view.herdr) {
      const ok = /run|ok|active|up|working|idle/i.test(a.status);
      lines.push(`  ${ok ? paint('●', { fg: 'success' }) : paint('○', { fg: 'warning' })} ${padEnd(truncate(a.name, 18), 18)} ${paint(`${a.kind} · ${a.status}`, { fg: 'dim' })}`);
    }
  }

  if (view.loops.length > 0) {
    section(`tmux loops (${view.loops.length})`);
    for (const l of view.loops) {
      // label by agent tag when present (the token-join key); fall back to session.
      const label = l.agent ?? l.session;
      // tokens is the real signal (subscription agents bill $0) — append cost only when > 0.
      const today = [
        l.today_tokens != null ? compactTokens(l.today_tokens) : '',
        l.today_cost_usd != null && l.today_cost_usd > 0 ? usd(l.today_cost_usd) : '',
      ].filter(Boolean).join(' ');
      const week = [
        l.week_tokens != null ? compactTokens(l.week_tokens) : '',
        l.week_cost_usd != null && l.week_cost_usd > 0 ? usd(l.week_cost_usd) : '',
      ].filter(Boolean).join(' ');
      const meta = [
        today ? `today ${today}` : '',
        week ? `7d ${week}` : '',
        l.since ? `since ${l.since.slice(0, 16)}` : '',
      ].filter(Boolean).join(' · ');
      lines.push(`  ${l.alive ? paint('●', { fg: 'success' }) : paint('✖', { fg: 'danger' })} ${padEnd(truncate(label, 24), 24)} ${paint(meta, { fg: 'faint' })}`.trimEnd());
    }
  }

  if (view.openclaw_agents.length > 0 || view.openclaw_gateway.length > 0) {
    // gateway rollup renders even with zero agents — RSS/event-loop/plugin
    // signals must not vanish just because the registry read came back empty
    section(`openclaw agents (${view.openclaw_agents.length})`);
    for (const g of view.openclaw_gateway) {
      const gw = g.ok ? badge('gateway ok', 'ok') : badge('GATEWAY UNHEALTHY', 'crit');
      const rss = g.rss_mb != null ? paint(` rss ${g.rss_mb}MB`, { fg: g.rss_mb > 1536 ? 'warning' : 'faint' }) : '';
      const cron = g.cron_total > 0 ? paint(` · cron ${g.cron_enabled}/${g.cron_total}`, { fg: 'faint' }) : '';
      const el = g.event_loop_degraded ? badge(' event loop!', 'warn') : '';
      const plugs = g.plugin_errors.length > 0 ? badge(` plugins: ${g.plugin_errors[0]}`, 'warn') : '';
      lines.push(`  ${gw} ${paint(`${g.host_id}${g.version ? ` v${g.version}` : ''}`, { fg: 'faint' })}${rss}${cron}${el}${plugs}`);
    }
    for (const a of view.openclaw_agents) {
      const bot = a.bot;
      const tokenBad = bot != null && bot.token_status !== null && bot.token_status !== 'available';
      const dot =
        bot === null || !bot.enabled
          ? paint('○', { fg: 'faint' })
          : !bot.connected || !bot.running
            ? paint('✖', { fg: 'danger' })
            : tokenBad
              ? paint('▲', { fg: 'warning' }) // connected but token going bad — mirrors the warn alert
              : paint('●', { fg: 'success' });
      const name = padEnd(truncate(a.name, 16), 16);
      // "newapi-alice/gpt-5.5-standard" → "alice" (the routing key is the signal)
      const key = a.model ? a.model.split('/')[0]!.replace(/^newapi-/, '') : '?';
      const state =
        bot === null
          ? paint('no bot', { fg: 'faint' })
          : !bot.enabled
            ? paint('disabled', { fg: 'faint' })
            : !bot.connected || !bot.running
              ? badge(`${bot.connected ? 'stopped' : 'disconnected'}${bot.last_error ? ` · ${bot.last_error}` : ''}`, 'crit')
              : tokenBad
                ? badge(`token ${bot.token_status}`, 'warn')
                : paint('connected', { fg: 'dim' });
      const retries = bot && bot.reconnect_attempts > 0 ? paint(` (${bot.reconnect_attempts} retries)`, { fg: 'warning' }) : '';
      lines.push(`  ${dot} ${name} ${paint(padEnd(truncate(key, 11), 11), { fg: 'faint' })} ${state}${retries}`.trimEnd());
    }
  } else if (view.openclaw.length > 0) {
    // pre-upgrade collector: fall back to the service-state rows
    section(`openclaw (${view.openclaw.length})`);
    for (const o of view.openclaw) {
      const b = o.state === 'running' ? badge('running', 'ok') : badge(o.state, o.state === 'failed' ? 'crit' : 'warn');
      lines.push(`  ${b} ${padEnd(truncate(o.name, 24), 24)} ${paint(o.host_id, { fg: 'faint' })}`);
    }
  }

  // Fleet-wide proc counts footer (from per-host agents probes).
  const totals = s.fleet.hosts.reduce(
    (acc, h) => {
      const a = h.snapshot?.agents.data;
      return a ? { cl: acc.cl + a.claude_procs, cx: acc.cx + a.codex_procs } : acc;
    },
    { cl: 0, cx: 0 },
  );
  lines.push('');
  lines.push(paint(` ${totals.cl} claude · ${totals.cx} codex processes fleet-wide`, { fg: 'faint' }));
  return lines.map((l) => truncate(l, width));
}
