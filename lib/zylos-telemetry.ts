import type { AgentsView, ZylosProviderQuota } from '../contracts/types';
import { usd } from './format';

export type ZylosHostView = NonNullable<AgentsView['zylos_hosts']>[number];
export type ZylosPersonaView = AgentsView['zylos'][number];
export interface TelemetryLine { text: string; warning?: boolean }

function fresh(iso: string | null | undefined, now: number, maxAge = 180_000): boolean {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(time) && now - time >= -30_000 && now - time <= maxAge;
}

function liveHost(host: ZylosHostView, now: number): boolean {
  return host.reachable && host.available && fresh(host.checked_at, now);
}

export function personaModel(persona: ZylosPersonaView, now: number): TelemetryLine {
  const observed = persona.host_reachable !== false && persona.telemetry_available !== false
    && fresh(persona.telemetry_checked_at, now) && persona.tmux_alive
    && persona.actual_model_source === 'rollout_turn_context'
    && persona.actual_model && persona.actual_reasoning_effort
    && Number.isFinite(Date.parse(persona.actual_model_observed_at ?? ''))
    && Date.parse(persona.actual_model_observed_at!) <= now + 30_000;
  if (!observed) return { text: 'actual model unknown', warning: true };
  const mismatch = (persona.configured_model && persona.configured_model !== persona.actual_model)
    || (persona.configured_reasoning_effort && persona.configured_reasoning_effort !== persona.actual_reasoning_effort);
  return { text: `${persona.actual_model} · ${persona.actual_reasoning_effort}${mismatch ? ' · policy mismatch' : ''}`, warning: Boolean(mismatch) };
}

export function quotaLines(host: ZylosHostView, quota: ZylosProviderQuota, now: number): TelemetryLine[] {
  const label = quota.provider === 'codex' ? 'Codex subscription' : `${quota.provider} subscription`;
  const valid = liveHost(host, now) && quota.available && quota.status === 'fresh'
    && fresh(quota.observed_at, now, quota.provider === 'codex' ? 180_000 : 900_000)
    && (quota.provider !== 'codex' || quota.authoritative && quota.source === 'codex-account-api');
  if (!valid) return [{ text: `${label}: unknown (${!host.reachable ? 'host offline' : quota.status === 'fresh' ? 'stale or unverified' : quota.status})`, warning: true }];
  const rows = quota.windows.filter(window => Number.isFinite(window.used_pct)
    && window.used_pct >= 0 && window.used_pct <= 100
    && window.resets_at && Date.parse(window.resets_at) > now);
  if (!rows.length) return [{ text: `${label}: unknown (window expired)`, warning: true }];
  return [
    { text: `${label}: ${rows.map(window => `${window.window} ${window.used_pct}% used`).join(' · ')}` },
    ...rows.map(window => ({ text: `${window.window} resets ${new Date(window.resets_at!).toISOString().replace('.000Z', ' UTC')}` })),
    { text: `Observed ${quota.observed_at} · ${quota.source ?? 'unknown source'}` },
  ];
}

export function budgetLines(host: ZylosHostView, now: number): TelemetryLine[] {
  const probe = host.azure_budget;
  if (!probe) return [];
  const budget = probe.data;
  if (!liveHost(host, now) || !probe.available || !budget || !fresh(probe.checked_at, now)
      || !fresh(budget.checked_at, now) || budget.month_utc !== new Date(now).toISOString().slice(0, 7)) {
    return [{ text: 'Azure shared budget: unknown (unavailable or stale)', warning: true }];
  }
  return [
    { text: `Azure shared budget · ${budget.month_utc} UTC` },
    { text: `${usd(budget.available_microusd / 1e6)} available / ${usd(budget.limit_microusd / 1e6)} monthly` },
    { text: `${usd(budget.spent_microusd / 1e6)} spent · ${usd(budget.pending_microusd / 1e6)} reserved (${budget.pending_requests} requests)` },
    { text: `Shared by ${budget.members.map(member => member.replace(/^user-/, '')).join(', ')}` },
    { text: budget.can_accept_request ? 'Azure requests allowed' : 'Azure requests blocked: reservation does not fit', warning: !budget.can_accept_request },
    { text: `Token-equivalent rates · ${usd(budget.reservation_microusd / 1e6)} request reservation` },
  ];
}

export function personaBudget(persona: ZylosPersonaView, host: ZylosHostView | undefined, now: number): string | null {
  if (!host?.azure_budget) return null;
  const probe = host.azure_budget;
  if (!liveHost(host, now) || !probe.available || !probe.data || !fresh(probe.checked_at, now)
      || !fresh(probe.data.checked_at, now)
      || probe.data.month_utc !== new Date(now).toISOString().slice(0, 7)) return 'Azure budget unknown';
  return probe.data.members.includes(persona.id) ? 'Azure shared monthly cap' : 'Azure budget exempt';
}

export function runtimePolicyLines(host: ZylosHostView): TelemetryLine[] {
  return (host.runtime_policy?.chain ?? []).map((profile, index) => ({
    text: `${index === 0 ? 'Primary policy' : 'Fallback policy'}: ${profile.profile.replace('codex-', '')} · ${profile.model ?? 'model unknown'} · ${profile.reasoning_effort ?? 'effort unknown'}`,
  }));
}
