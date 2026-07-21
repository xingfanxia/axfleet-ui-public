/**
 * Tokens tab — cost + usage from the hub's Turso-backed tokens surface.
 * `t` and a tap on the range header always cycle the range
 * (today/7d/30d/90d/all); a vertical swipe cycles only when the body fits the
 * pane (when it overflows, swipes scroll — see tokensSwipeIntent), so the
 * header hint advertises swipe only in the fits case. Bars scale to the max
 * row.
 */
import type { TokensDetail } from '../../contracts/types';
import { ago, compactTokens, usd } from '../../lib/format';
import { padEnd, padStart, truncate } from '../ansi';
import { paint } from '../theme';
import type { AppState } from '../state';
import { sparkline } from './widgets';

export function renderTokens(s: AppState, width: number, bodyH: number): string[] {
  const narrow = width < 60;
  const lines: string[] = [];
  const rangeLabel = s.tokensRange === 'today' ? 'today (UTC)' : s.tokensRange === 'all' ? 'all time' : s.tokensRange;
  const head = (hint: string): string =>
    ` range ${paint(rangeLabel, { fg: 'accent', bold: true })} ${paint(hint, { fg: 'faint' })}`;
  if (!s.tokens) {
    lines.push(head('(t/swipe/tap to cycle)'));
    lines.push(s.tokensError ? paint(` tokens unavailable: ${s.tokensError}`, { fg: 'warning' }) : paint(' loading tokens…', { fg: 'faint' }));
    return lines;
  }
  const d = s.tokens;
  const asOf = paint(`as of ${d.as_of ? `${ago(d.as_of)} ago` : '—'}`, { fg: 'faint' });
  const headLine = (hint: string): string => (narrow ? head(hint) : head(hint) + '   ' + asOf);
  lines.push(headLine('(t/swipe/tap to cycle)'));
  if (narrow) lines.push(' ' + asOf);
  lines.push('');
  lines.push(
    ` ${paint(usd(d.totals.cost_usd), { fg: 'text', bold: true })} ${paint(`· ${compactTokens(d.totals.total_tokens)} tokens · ${d.totals.messages} messages`, { fg: 'dim' })}`,
  );
  if (d.all_time && s.tokensRange !== 'all') {
    lines.push(
      ` ${paint('all time', { fg: 'faint' })} ${paint(usd(d.all_time.cost_usd), { fg: 'accent2' })} ${paint(`· ${compactTokens(d.all_time.total_tokens)} tokens`, { fg: 'faint' })}`,
    );
  }

  if (d.daily.length > 1) {
    const w = Math.min(width - 20, Math.max(8, d.daily.length));
    lines.push(
      ` daily ${sparkline(d.daily.map((x) => x.cost_usd), w, 'accent2')} ${paint(`peak ${usd(Math.max(...d.daily.map((x) => x.cost_usd)))}`, { fg: 'faint' })}`,
    );
  }
  if (d.spikes.length > 0) {
    lines.push(paint(` ⚡ ${d.spikes.length} hour(s) >3× the 30d same-hour baseline`, { fg: 'warning' }));
  }

  lines.push('');
  lines.push(paint(' by host', { fg: 'dim', bold: true }));
  lines.push(...barTable(d.by_host.map((r) => ({ label: r.instance_id, cost: r.cost_usd, tokens: r.total_tokens })), width));

  lines.push('');
  lines.push(paint(' by harness', { fg: 'dim', bold: true }));
  lines.push(...barTable(d.by_client.map((r) => ({ label: r.client, cost: r.cost_usd, tokens: r.total_tokens })), width));

  lines.push('');
  lines.push(paint(' by model', { fg: 'dim', bold: true }));
  const models = [...d.by_model].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 6);
  // narrow drops the (harness) suffix — the model name is the signal and the
  // suffix is what used to push it off the edge
  lines.push(...barTable(models.map((r) => ({ label: narrow ? r.model : `${r.model} ${paint(`(${(r.harnesses ?? [r.client]).join(' + ')})`, { fg: 'faint' })}`, cost: r.cost_usd, tokens: r.total_tokens })), width));

  // by_workspace absent on a pre-upgrade hub — read defensively. Ranked and
  // bar-scaled by TOKENS (the ask), unlike the cost-scaled tables above.
  const workspaces = (d.by_workspace ?? []).slice(0, 10);
  if (workspaces.length > 0) {
    lines.push('');
    lines.push(paint(' by workspace · top 10 by tokens', { fg: 'dim', bold: true }));
    lines.push(...barTable(workspaces.map((r) => ({ label: r.workspace, cost: r.cost_usd, tokens: r.total_tokens })), width, 'tokens'));
  }

  if (s.fleet?.tokens.stale_instances.length) {
    lines.push('');
    lines.push(paint(` stale collectors: ${s.fleet.tokens.stale_instances.join(', ')}`, { fg: 'warning' }));
  }
  // Overflowing body → swipes scroll instead of cycling, so don't advertise
  // swipe-to-cycle (review catch: the unconditional hint read as broken).
  if (lines.length > bodyH) lines[0] = headLine('(t/tap to cycle)');
  return lines.map((l) => truncate(l, width));
}

function barTable(
  rows: Array<{ label: string; cost: number; tokens: number }>,
  width: number,
  barBy: 'cost' | 'tokens' = 'cost',
): string[] {
  if (rows.length === 0) return [paint('   none', { fg: 'faint' })];
  const max = Math.max(1e-9, ...rows.map((r) => r[barBy]));
  // Narrow: the bar shrinks before the label does — a readable name beats
  // two extra bar cells on a phone.
  const narrow = width < 60;
  const barW = narrow ? 5 : Math.max(6, Math.min(24, width - 16 - 22));
  const labelW = narrow ? Math.max(12, width - barW - 22) : 16;
  return rows.map((r) => {
    const fill = Math.max(r[barBy] > 0 ? 1 : 0, Math.round((r[barBy] / max) * barW));
    const bar = paint('▮'.repeat(fill), { fg: 'accent' }) + paint('▯'.repeat(barW - fill), { fg: 'lineStrong' });
    return `   ${padEnd(truncate(r.label, labelW), labelW)} ${bar} ${padStart(usd(r.cost), 8)} ${paint(padStart(compactTokens(r.tokens), 7), { fg: 'faint' })}`;
  });
}
