import { describe, expect, test } from 'bun:test';
import type { BlogNewsletter, FactorioInfo, FleetState, OmniInfo, Probe, RadarNewsletter } from '../../contracts/types';
import { factorioInfo, healthyHost, probe, snapshot } from '../../fixtures/test-fixtures';
import { stripAnsi, visibleWidth } from '../ansi';
import { initialState } from '../state';
import { initTheme } from '../theme';
import { renderGateways } from './gateways';

initTheme('compat');

const omni: OmniInfo = {
  sources: [{
    name: 'Slack',
    source_type: 'slack',
    active: true,
    sync_interval_sec: 1800,
    last_success_at: null,
    last_run_status: 'failed',
    last_run_at: null,
    active_run_activity_at: null,
    last_error: 'rate limited',
    failed_since_success: 11,
    failed_since_success_capped: true,
    docs: 10_000,
    docs_capped: true,
  }],
  queue: { pending: 5001, processing: 1, failed: 10_000, failed_recent: 11 },
  queue_capped: { pending: true, processing: false, failed: true, failed_recent: true },
  stuck_runs: 0,
  docs_total: 1_631_863,
  docs_total_estimated: true,
};

const fleet: FleetState = {
  hosts: [healthyHost('basalt', {
    snapshot: snapshot('basalt', { omni: probe(omni) }),
  })],
  problems: [],
  kpis: { hosts_up: 1, hosts_total: 1, services_ok: 0, services_expected: 0, agents_active: 0, problems: 0, today_cost_usd: null },
  tokens: { as_of: null, today_cost_usd: null, week_cost_usd: null, month_cost_usd: null, by_host: [], by_agent: [], stale_instances: [] },
  endpoints: [],
  events: [],
};

describe('renderGateways bounded Omni counts', () => {
  test('labels estimates and lower bounds instead of presenting them as exact', () => {
    const state = { ...initialState('demo'), fleet };
    const text = renderGateways(state, 120).map(stripAnsi).join('\n');

    expect(text).toContain('~1.6M docs');
    expect(text).toContain('queue ≥5001p/1a');
    expect(text).toContain('≥11 fails/1h');
    expect(text).toContain('≥10K');
    expect(text).toContain('≥11 fails');
  });
});

describe('renderGateways Factorio summary', () => {
  const factorioFleet: FleetState = {
    ...fleet,
    hosts: [healthyHost('forge', {
      snapshot: snapshot('forge', { factorio: probe(factorioInfo(1)) }),
    })],
  };

  test('renders compact metadata within every supported terminal width', () => {
    const factorioState = { ...initialState('demo'), fleet: factorioFleet };

    for (const width of [45, 76, 120]) {
      const lines = renderGateways(factorioState, width);
      const text = lines.map(stripAnsi).join('\n');
      expect(text).toContain('Factorio');
      expect(text).not.toContain('example-mod-01');
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  test('labels incomplete, stale, and unavailable telemetry without retained counts', () => {
    const incomplete = factorioInfo(0);
    incomplete.players = {
      complete: false, active: null, max: 10, checked_at: '2026-07-14T05:00:00.000Z',
    };
    const staleProbe = probe(factorioInfo(3));
    staleProbe.available = false;
    staleProbe.error = 'factorio journal query failed';
    const unavailable: Probe<FactorioInfo> = {
      available: false,
      error: 'factorio metadata journal query failed',
      checked_at: '2026-07-14T05:00:00.000Z',
    };

    for (const [factorio, expected, forbidden] of [
      [probe(incomplete), 'incomplete', '0/10'],
      [staleProbe, 'stale', '3/10'],
      [unavailable, 'telemetry unavailable', '3/10'],
    ] as const) {
      const state = {
        ...initialState('demo'),
        fleet: {
          ...factorioFleet,
          hosts: [healthyHost('forge', {
            snapshot: snapshot('forge', { factorio }),
          })],
        },
      };
      const text = renderGateways(state, 76).map(stripAnsi).join('\n');
      expect(text).toContain(expected);
      expect(text).not.toContain(forbidden);
    }
  });

  test('names every supported gateway when no host is reporting yet', () => {
    const state = {
      ...initialState('demo'),
      fleet: { ...fleet, hosts: [] },
    };
    const text = renderGateways(state, 76).map(stripAnsi).join('\n').toLowerCase();

    expect(text).toContain('factorio');
    expect(text).toContain('omni');
    expect(text).toContain('new api');
  });
});

describe('renderGateways radar newsletter', () => {
  const nl: RadarNewsletter = {
    active: 128,
    pending: 7,
    unsubscribed: 12,
    delivered_total: 940,
    failed_total: 3,
    last_send_at: '2026-07-16T09:30:00.000Z',
    as_of: '2026-07-16T12:00:00.000Z',
  };

  test('renders the block within every supported terminal width (incl. 45-col phone)', () => {
    const state = { ...initialState('demo'), fleet: { ...fleet, radar_newsletter: nl } };
    for (const width of [45, 76, 120]) {
      const lines = renderGateways(state, width);
      const text = lines.map(stripAnsi).join('\n');
      expect(text).toContain('radar · newsletter');
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  test('shows subscriber counts + delivery totals at a full-width terminal', () => {
    const state = { ...initialState('demo'), fleet: { ...fleet, radar_newsletter: nl } };
    const text = renderGateways(state, 120).map(stripAnsi).join('\n');
    expect(text).toContain('128 active');
    expect(text).toContain('7 pending');
    expect(text).toContain('940 delivered');
    expect(text).toContain('3 failed');
  });

  test('shows the block even when no gateway host is reporting', () => {
    const state = { ...initialState('demo'), fleet: { ...fleet, hosts: [], radar_newsletter: nl } };
    const text = renderGateways(state, 76).map(stripAnsi).join('\n');
    expect(text).toContain('radar · newsletter');
    expect(text).toContain('no Factorio, Omni, or New API hosts reporting');
  });

  test('reads defensively: absent radar_newsletter renders no block', () => {
    const state = { ...initialState('demo'), fleet };
    const text = renderGateways(state, 76).map(stripAnsi).join('\n');
    expect(text).not.toContain('radar · newsletter');
  });

  test('null fields render em dashes, not zeros or a crash', () => {
    const empty: RadarNewsletter = {
      active: null, pending: null, unsubscribed: null,
      delivered_total: null, failed_total: null, last_send_at: null, as_of: null,
    };
    const state = { ...initialState('demo'), fleet: { ...fleet, hosts: [], radar_newsletter: empty } };
    const text = renderGateways(state, 76).map(stripAnsi).join('\n');
    expect(text).toContain('radar · newsletter');
    expect(text).toContain('— active');
    expect(text).toContain('last send —');
  });
});

describe('renderGateways blog newsletter', () => {
  const bnl: BlogNewsletter = {
    total: 42, confirmed: 30, pending: 12, subs_7d: 5,
    last_subscribe_at: '2026-07-16T09:30:00Z', as_of: '2026-07-16T12:00:00.000Z',
  };

  test('renders confirmed/pending/total and 7d momentum', () => {
    const state = { ...initialState('demo'), fleet: { ...fleet, blog_newsletter: bnl } };
    const text = renderGateways(state, 76).map(stripAnsi).join('\n');
    expect(text).toContain('blog · newsletter');
    expect(text).toContain('30 confirmed');
    expect(text).toContain('12 pending');
    expect(text).toContain('42 total');
    expect(text).toContain('5 new 7d');
  });

  test('reads defensively: absent blog_newsletter renders no block', () => {
    const state = { ...initialState('demo'), fleet };
    const text = renderGateways(state, 76).map(stripAnsi).join('\n');
    expect(text).not.toContain('blog · newsletter');
  });

  test('null fields render em dashes, not zeros or a crash', () => {
    const empty: BlogNewsletter = {
      total: null, confirmed: null, pending: null, subs_7d: null,
      last_subscribe_at: null, as_of: null,
    };
    const state = { ...initialState('demo'), fleet: { ...fleet, hosts: [], blog_newsletter: empty } };
    const text = renderGateways(state, 76).map(stripAnsi).join('\n');
    expect(text).toContain('blog · newsletter');
    expect(text).toContain('— confirmed');
  });
});
