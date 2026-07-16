/**
 * Tokens tab — cost + usage from the hub's Turso-backed tokens surface.
 * `t` cycles the range (today/7d/30d/90d); bars scale to the max row.
 */
import type { TokensDetail } from '../../contracts/types';
import { ago, compactTokens, usd } from '../../lib/format';
import { padEnd, padStart, truncate } from '../ansi';
import { paint } from '../theme';
import type { AppState } from '../state';
import { sparkline } from './widgets';

export function renderTokens(s: AppState, width: number): string[] {
  const lines: string[] = [];
  const rangeLabel = s.tokensRange === 'today' ? 'today (UTC)' : s.tokensRange;
  const head = ` range ${paint(rangeLabel, { fg: 'accent', bold: true })} ${paint('(t to cycle)', { fg: 'faint' })}`;
  if (!s.tokens) {
    lines.push(head);
    lines.push(s.tokensError ? paint(` tokens unavailable: ${s.tokensError}`, { fg: 'warning' }) : paint(' loading tokens…', { fg: 'faint' }));
    return lines;
  }
  const d = s.tokens;
  lines.push(head + paint(`   as of ${d.as_of ? `${ago(d.as_of)} ago` : '—'}`, { fg: 'faint' }));
  lines.push('');
  lines.push(
    ` ${paint(usd(d.totals.cost_usd), { fg: 'text', bold: true })} ${paint(`· ${compactTokens(d.totals.total_tokens)} tokens · ${d.totals.messages} messages`, { fg: 'dim' })}`,
  );
  if (d.all_time) {
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
  lines.push(paint(' by model', { fg: 'dim', bold: true }));
  const models = [...d.by_model].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 6);
  lines.push(...barTable(models.map((r) => ({ label: `${r.model} ${paint(`(${r.client})`, { fg: 'faint' })}`, cost: r.cost_usd, tokens: r.total_tokens })), width));

  if (s.fleet?.tokens.stale_instances.length) {
    lines.push('');
    lines.push(paint(` stale collectors: ${s.fleet.tokens.stale_instances.join(', ')}`, { fg: 'warning' }));
  }
  return lines.map((l) => truncate(l, width));
}

function barTable(rows: Array<{ label: string; cost: number; tokens: number }>, width: number): string[] {
  if (rows.length === 0) return [paint('   none', { fg: 'faint' })];
  const max = Math.max(1e-9, ...rows.map((r) => r.cost));
  const labelW = 16;
  const barW = Math.max(6, Math.min(24, width - labelW - 22));
  return rows.map((r) => {
    const fill = Math.max(r.cost > 0 ? 1 : 0, Math.round((r.cost / max) * barW));
    const bar = paint('▮'.repeat(fill), { fg: 'accent' }) + paint('▯'.repeat(barW - fill), { fg: 'lineStrong' });
    return `   ${padEnd(truncate(r.label, labelW), labelW)} ${bar} ${padStart(usd(r.cost), 8)} ${paint(padStart(compactTokens(r.tokens), 7), { fg: 'faint' })}`;
  });
}
