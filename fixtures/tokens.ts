/**
 * Tokens-tab fixtures — cost/usage detail per range, shaped like the hub's
 * usage-DB rollups. Daily/hourly series come from fixtures/noise so the
 * sparklines have believable texture and stay stable across refetches.
 */
import type { TokenRange, TokensDetail } from '../contracts/types';
import { TODAY_COST_USD, TODAY_TOKENS } from './fleet';
import { metric } from './noise';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (t: number): string => new Date(t).toISOString();

const RANGE_DAYS: Record<TokenRange, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };

/** Day-spaced samples need a period that isn't a small rational multiple of a
 *  day — the default 8-min period divides a day exactly 180×, which aliases
 *  the series into a visible 5-day repeat. 37 days keeps daily texture. */
const DAILY_PERIOD = { period: 37 * DAY };

export function buildTokensDetail(range: TokenRange, now: number): TokensDetail {
  const days = RANGE_DAYS[range];
  const daily = Array.from({ length: Math.max(2, days) }, (_, i) => {
    const t = now - (Math.max(2, days) - 1 - i) * DAY;
    return {
      date: iso(t).slice(0, 10),
      cost_usd: Math.round(metric('tok.daily', t, 11, 8, { min: 1.2, max: 30, ...DAILY_PERIOD }) * 100) / 100,
      total_tokens: Math.round(metric('tok.dailyTokens', t, 9, 6, { min: 1, max: 22, ...DAILY_PERIOD }) * 1e6),
    };
  });
  // The 'today' range must agree with the header KPI + summary by_host — both
  // surfaces show "today cost" and in the real system both come from the same
  // usage DB. Longer ranges sum the generated daily series.
  const totalCost = range === 'today' ? TODAY_COST_USD : daily.slice(-days).reduce((a, d) => a + d.cost_usd, 0);
  const totalTokens = range === 'today' ? TODAY_TOKENS : daily.slice(-days).reduce((a, d) => a + d.total_tokens, 0);

  const hourly = Array.from({ length: 48 }, (_, i) => {
    const t = now - (47 - i) * HOUR;
    return {
      ts: iso(t),
      cost_usd: Math.round(metric('tok.hourly', t, 0.6, 0.55, { min: 0, max: 2.4 }) * 100) / 100,
      total_tokens: Math.round(metric('tok.hourlyTokens', t, 0.5, 0.4, { min: 0, max: 1.6 }) * 1e6),
      instance_id: i % 3 === 0 ? 'forge' : i % 3 === 1 ? 'atlas' : 'basalt',
    };
  });

  return {
    range,
    as_of: iso(now - 8 * 60_000),
    totals: {
      cost_usd: Math.round(totalCost * 100) / 100,
      total_tokens: totalTokens,
      messages: Math.round(320 * days),
    },
    all_time: { cost_usd: 4_210, total_tokens: 3_100_000_000 },
    by_host: [
      { instance_id: 'forge', cost_usd: r2(totalCost * 0.42), total_tokens: Math.round(totalTokens * 0.4) },
      { instance_id: 'atlas', cost_usd: r2(totalCost * 0.28), total_tokens: Math.round(totalTokens * 0.3) },
      { instance_id: 'basalt', cost_usd: r2(totalCost * 0.23), total_tokens: Math.round(totalTokens * 0.22) },
      { instance_id: 'mica', cost_usd: r2(totalCost * 0.07), total_tokens: Math.round(totalTokens * 0.08) },
    ],
    by_client: [
      { client: 'claude-code', cost_usd: r2(totalCost * 0.61), total_tokens: Math.round(totalTokens * 0.58) },
      { client: 'codex-cli', cost_usd: r2(totalCost * 0.27), total_tokens: Math.round(totalTokens * 0.3) },
      { client: 'openclaw', cost_usd: r2(totalCost * 0.12), total_tokens: Math.round(totalTokens * 0.12) },
    ],
    by_model: [
      { model: 'claude-opus-4-8', client: 'claude-code', cost_usd: r2(totalCost * 0.45), total_tokens: Math.round(totalTokens * 0.34) },
      { model: 'claude-sonnet-5', client: 'claude-code', cost_usd: r2(totalCost * 0.16), total_tokens: Math.round(totalTokens * 0.24) },
      { model: 'gpt-5.6', client: 'codex-cli', cost_usd: r2(totalCost * 0.22), total_tokens: Math.round(totalTokens * 0.25) },
      { model: 'gpt-5.5-standard', client: 'openclaw', cost_usd: r2(totalCost * 0.1), total_tokens: Math.round(totalTokens * 0.1) },
      { model: 'gemini-3-flash', client: 'openclaw', cost_usd: r2(totalCost * 0.02), total_tokens: Math.round(totalTokens * 0.02) },
      { model: 'claude-haiku-4-5', client: 'claude-code', cost_usd: r2(totalCost * 0.05), total_tokens: Math.round(totalTokens * 0.05) },
    ],
    // merged display labels (the real hub folds per-client key formats into
    // one label per project); ranked by tokens, not cost
    by_workspace: [
      { workspace: 'apps/atlas-web', cost_usd: r2(totalCost * 0.24), total_tokens: Math.round(totalTokens * 0.27) },
      { workspace: 'tools/forge-cli', cost_usd: r2(totalCost * 0.21), total_tokens: Math.round(totalTokens * 0.22) },
      { workspace: 'services/basalt-api', cost_usd: r2(totalCost * 0.18), total_tokens: Math.round(totalTokens * 0.17) },
      { workspace: 'apps/mica-docs', cost_usd: r2(totalCost * 0.12), total_tokens: Math.round(totalTokens * 0.13) },
      { workspace: 'infra/fleet-hub', cost_usd: r2(totalCost * 0.1), total_tokens: Math.round(totalTokens * 0.09) },
      { workspace: 'labs/scratchpad', cost_usd: r2(totalCost * 0.06), total_tokens: Math.round(totalTokens * 0.05) },
    ],
    daily,
    hourly,
    // Spikes are HOURLY anomalies (>3× the 30d same-hour baseline) — absolute
    // hour costs, independent of the selected range.
    spikes: days >= 30
      ? [{ ts: iso(now - 31 * HOUR), cost_usd: 2.4, baseline_usd: 0.6 }]
      : [],
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
