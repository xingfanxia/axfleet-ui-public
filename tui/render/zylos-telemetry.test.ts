import { describe, expect, test } from 'bun:test';
import { buildFleetState } from '../../fixtures/fleet';
import { buildAgentsView } from '../../lib/views';
import { budgetLines, personaBudget, personaModel, quotaLines } from '../../lib/zylos-telemetry';
import { storageView } from '../../contracts/storage';
import { applyFleet, initialState } from '../state';
import { stripAnsi, visibleWidth } from '../ansi';
import { initTheme } from '../theme';
import { renderAgents } from './agents';
import { renderGateways } from './gateways';

initTheme('compat');
const now = Date.parse('2026-09-07T12:00:00Z');
function fixture() {
  const fleet = buildFleetState(now);
  const view = buildAgentsView(fleet.hosts);
  const host = view.zylos_hosts!.find(row => row.host_id === 'forge')!;
  const alice = view.zylos.find(row => row.id === 'user-alice')!;
  const admin = view.zylos.find(row => row.id === 'admin')!;
  return { fleet, view, host, alice, admin };
}

describe('synthetic Zylos model, quota and budget states', () => {
  test('actual idle-turn model is distinct from configured policy and freshness', () => {
    const { alice } = fixture();
    expect(personaModel(alice, now)).toEqual({ text: 'gpt-6-astra · high', warning: false });
    expect(personaModel({ ...alice, configured_reasoning_effort: 'xhigh' }, now).text).toContain('policy mismatch');
    for (const patch of [{ host_reachable: false }, { tmux_alive: false }, { actual_model: undefined },
      { telemetry_checked_at: '2020-01-01T00:00:00Z' }]) {
      expect(personaModel({ ...alice, ...patch }, now).text).toBe('actual model unknown');
    }
  });
  test('only the three fictional members share the cap; unknown budget never implies exemption', () => {
    const { view, host, admin } = fixture();
    for (const id of ['user-alice', 'user-bob', 'user-carol']) {
      expect(personaBudget(view.zylos.find(row => row.id === id)!, host, now)).toBe('Azure shared monthly cap');
    }
    expect(personaBudget(admin, host, now)).toBe('Azure budget exempt');
    expect(personaBudget(admin, { ...host, reachable: false }, now)).toBe('Azure budget unknown');
    expect(budgetLines({ ...host, azure_budget: { ...host.azure_budget!, available: false } }, now)[0]!.text).toContain('unknown');
    const budget = host.azure_budget!.data!;
    const low = { ...host, azure_budget: { ...host.azure_budget!, data: { ...budget,
      spent_microusd: 970_000_000, pending_microusd: 0, pending_requests: 0, available_microusd: 30_000_000, can_accept_request: false } } };
    expect(budgetLines(low, now).some(row => row.warning && row.text.includes('blocked'))).toBe(true);
  });
  test('subscription windows reject historical authority, stale readings and expired resets', () => {
    const { host } = fixture();
    const quota = host.provider_quotas![0]!;
    expect(quotaLines(host, quota, now)[0]!.text).toContain('7d 24% used');
    for (const patch of [{ authoritative: false }, { source: 'legacy-rollout' }, { observed_at: '2020-01-01T00:00:00Z' },
      { windows: [{ ...quota.windows[0]!, resets_at: '2020-01-01T00:00:00Z' }] }]) {
      expect(quotaLines(host, { ...quota, ...patch }, now)[0]!.text).toContain('unknown');
    }
  });
  test('new details render at phone and desktop widths without production fixtures', () => {
    const { fleet } = fixture();
    const state = applyFleet(initialState('fixture'), fleet, now, 'sse');
    for (const width of [45, 76, 120]) {
      const lines = renderAgents(state, width, now);
      expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
      const text = lines.map(stripAnsi).join('\n');
      expect(text).toContain('gpt-6-astra');
      expect(text).toContain('alice, bob, carol');
      expect(text).toContain('Fallback policy');
    }
    const gateways = renderGateways(state, 120).map(stripAnsi).join('\n');
    expect(gateways).toContain('version demo-1.0.0');
    expect(gateways).toContain('Models: gpt-6-astra, gpt-5.6-sol');
  });
  test('storage checks become unknown with stale or offline fixture data', () => {
    const { fleet } = fixture();
    const basalt = fleet.hosts.find(host => host.host_id === 'basalt')!;
    expect(storageView(basalt, now)?.status).toBe('healthy');
    expect(storageView({ ...basalt, reachable: false }, now)?.status).toBe('unknown');
    expect(storageView(basalt, now + 200_000)?.status).toBe('unknown');
  });
  test('the public API adapter stays fixture-only', async () => {
    const source = await Bun.file(new URL('../api.ts', import.meta.url)).text();
    expect(source).not.toMatch(/\bfetch\s*\(|new\s+(WebSocket|EventSource)|https?:\/\//);
    expect(source).toContain("from '../fixtures/fleet'");
  });
});
