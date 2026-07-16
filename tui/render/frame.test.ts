/**
 * Frame-level layout contract: at ANY terminal size, every rendered line fits
 * the width and the frame is exactly `rows` tall — the guarantee that keeps
 * Moshi-portrait (≈45 cols) from wrapping into soup.
 */
import { describe, expect, test } from 'bun:test';
import type { ClauthUsageInfo, FleetState, OmniInfo, OpenclawInfo, SingboxInfo } from '../../contracts/types';
import { factorioInfo, healthyHost, probe, snapshot } from '../../fixtures/test-fixtures';
import { stripAnsi, visibleWidth } from '../ansi';
import { applyFleet, applyHistory, applyNotifications, applyTokens, initialState, setTab, TABS, type AppState, type Tab } from '../state';
import { initTheme } from '../theme';
import { renderFrame } from './frame';

initTheme('compat');

const singbox: SingboxInfo = {
  service_state: 'running',
  version: '1.13.14',
  update_available: false,
  latest_version: null,
  throughput: { up_bps: 152_000, down_bps: 1_830_000 },
  traffic: { daily_bytes: 4.2e9, weekly_bytes: 3.8e10, monthly_bytes: 1.2e11, total_bytes: 1.9e12 },
  connections: { active: 12 },
  clients_active: 6,
  traffic_daily: [
    { date: '2026-07-10', rx_bytes: 3.1e9, tx_bytes: 2.4e9 },
    { date: '2026-07-11', rx_bytes: 4.2e9, tx_bytes: 3.0e9 },
  ],
  cert_expiry: new Date(Date.now() + 88 * 86_400_000).toISOString(),
  interface: 'eth0',
  protocols: ['vless-reality', 'hysteria2', 'tuic'],
  subscription: { domain: 'vpn-kiku.example.dev', clash_url: 'https://vpn-kiku.example.dev/x/clash', singbox_url: 'https://vpn-kiku.example.dev/x/sb' },
};

const clauthUsage: ClauthUsageInfo = {
  schema_ok: true,
  generated_at: new Date().toISOString(),
  clauth_version: '0.9.0',
  active_profile: 'acct-backup',
  fallback_chain: ['acct-main', 'acct-work', 'acct-backup'],
  forecast: { action: 'switch', to: 'acct-main' },
  last_error: null,
  stale: false,
  profiles: [
    {
      name: 'acct-work', active: false, tier: 'Max 20x', email: 'acct-work@example.com',
      auth_status: 'expiring', fetch_status: 'Fresh',
      windows: [
        { label: '5h', used_pct: 1, resets_at: new Date(Date.now() + 4 * 3600e3).toISOString() },
        { label: '7d', used_pct: 80, resets_at: new Date(Date.now() + 4.4 * 86400e3).toISOString() },
        { label: '7d fable', used_pct: 72, resets_at: new Date(Date.now() + 4.4 * 86400e3).toISOString() },
      ],
    },
    {
      name: 'acct-backup', active: true, tier: 'Max 20x', email: 'acct-backup@example.com',
      auth_status: 'ok', fetch_status: 'Fresh',
      windows: [{ label: '5h', used_pct: 42, resets_at: new Date(Date.now() + 3 * 3600e3).toISOString() }],
    },
  ],
  tokens: {
    generated_at: new Date().toISOString(),
    periods: [
      { key: 'today', total_tokens: 123_456_789, cost_usd: 123.45, floor: false, models: [{ display: 'fable 5', total_tokens: 80_000_000, cost_usd: 90 }] },
      { key: 'lifetime', total_tokens: 12_000_000_000, cost_usd: 20000, floor: true, models: [] },
    ],
  },
};

const omni: OmniInfo = {
  sources: [
    { name: 'Gmail', source_type: 'gmail', active: true, sync_interval_sec: 1800, last_success_at: new Date(Date.now() - 25 * 60000).toISOString(), last_run_status: 'completed', last_run_at: new Date().toISOString(), active_run_activity_at: null, last_error: null, failed_since_success: 0, docs: 121400 },
    { name: 'Slack', source_type: 'slack', active: true, sync_interval_sec: 1800, last_success_at: new Date(Date.now() - 12 * 3600e3).toISOString(), last_run_status: 'failed', last_run_at: new Date().toISOString(), active_run_activity_at: null, last_error: 'rate limited: retry_after=30', failed_since_success: 4, docs: 51200 },
    { name: 'Wiki', source_type: 'confluence', active: false, sync_interval_sec: 3600, last_success_at: null, last_run_status: 'failed', last_run_at: null, active_run_activity_at: null, last_error: 'token revoked', failed_since_success: 30, docs: 800 },
  ],
  queue: { pending: 12, processing: 74, failed: 329, failed_recent: 3 },
  stuck_runs: 0,
  docs_total: 271535,
};

const openclaw: OpenclawInfo = {
  version: '2026.6.11',
  gateway: { ok: true, event_loop_degraded: false, rss_mb: 745, nrestarts: 0, sessions: 7, heartbeat_seconds: 1800 },
  plugins: { loaded: 50, errors: [] },
  agents: [
    { id: 'main', name: '小助 (Helper)', model: 'newapi-default/gpt-5.5-standard', is_default: true, bot: { enabled: true, connected: true, running: true, last_error: null, reconnect_attempts: 0, token_status: 'available', last_inbound_at: new Date(Date.now() - 23 * 60000).toISOString(), last_outbound_at: null } },
    { id: 'bramble-agent', name: 'Bramble Agent', model: 'newapi-bramble/gpt-5.5-standard', is_default: false, bot: { enabled: true, connected: false, running: true, last_error: 'ETELEGRAM: 502', reconnect_attempts: 3, token_status: 'available', last_inbound_at: null, last_outbound_at: null } },
  ],
  cron: { total: 16, enabled: 16 },
};

function fixtureState(): FleetState {
  const hosts = [
    {
      ...healthyHost('atlas', { role: 'cockpit · 云雀 · fleet hub' }),
      snapshot: { ...snapshot('atlas'), clauth_usage: probe(clauthUsage) },
    },
    healthyHost('forge', {
      snapshot: snapshot('forge', { factorio: probe(factorioInfo(1)) }),
    }),
    { ...healthyHost('mica'), reachable: false, expected_flaky: true, snapshot: null },
    {
      ...healthyHost('vpn-kiku'),
      snapshot: { ...snapshot('vpn-kiku'), singbox: probe(singbox) },
    },
    {
      ...healthyHost('basalt'),
      snapshot: { ...snapshot('basalt'), omni: probe(omni), openclaw: probe(openclaw) },
    },
  ];
  return {
    hosts,
    problems: [
      { id: 'p1', severity: 'crit', host_id: 'forge', source: 'systemd', msg: 'api-gateway failed', since: new Date().toISOString() },
      { id: 'p2', severity: 'warn', host_id: 'fleet', source: 'tokens', msg: 'stale collector', since: new Date().toISOString() },
    ],
    kpis: { hosts_up: 3, hosts_total: 4, services_ok: 8, services_expected: 9, agents_active: 4, problems: 2, today_cost_usd: 12.4 },
    tokens: { as_of: new Date().toISOString(), today_cost_usd: 12.4, week_cost_usd: 80, month_cost_usd: 240, by_host: [], by_agent: [], stale_instances: ['old-workstation'] },
    endpoints: [
      { name: 'fleet', url: 'https://fleet.example.dev', status: 302, ok: true, latency_ms: 120, checked_at: new Date().toISOString() },
      { name: 'console', url: 'https://console.example.dev', status: 0, ok: false, latency_ms: null, checked_at: new Date().toISOString() },
    ],
    events: [{ ts: new Date().toISOString(), kind: 'host-down', host_id: 'forge', msg: 'unreachable' }],
  };
}

function loadedState(): AppState {
  let s = applyFleet(initialState('demo'), fixtureState(), Date.now(), 'sse');
  s = applyTokens(
    s,
    {
      range: 'today',
      as_of: new Date().toISOString(),
      totals: { cost_usd: 12.4, total_tokens: 1_200_000, messages: 340 },
      all_time: { cost_usd: 4812.3, total_tokens: 9_900_000_000 },
      by_host: [
        { instance_id: 'atlas', cost_usd: 6.2, total_tokens: 600_000 },
        { instance_id: 'forge', cost_usd: 3.1, total_tokens: 300_000 },
      ],
      by_client: [],
      by_model: [{ model: 'claude-fable-5', client: 'claude-code', cost_usd: 8, total_tokens: 800_000 }],
      daily: [
        { date: '2026-07-10', cost_usd: 10, total_tokens: 1e6 },
        { date: '2026-07-11', cost_usd: 12.4, total_tokens: 1.2e6 },
      ],
      hourly: [],
      spikes: [{ ts: new Date().toISOString(), cost_usd: 4, baseline_usd: 1 }],
    },
    Date.now(),
  );
  s = applyNotifications(
    s,
    [
      {
        id: 'p1@2026-07-12T03:00:00Z',
        ts: new Date().toISOString(),
        severity: 'crit',
        host_id: 'forge',
        problem_id: 'p1',
        source: 'systemd',
        msg: 'api-gateway failed',
        channel: 'lark',
        delivered: true,
        lark_message_id: 'om_x',
      },
      {
        id: 'old@2026-07-11T00:00:00Z',
        ts: new Date(Date.now() - 86_400_000).toISOString(),
        severity: 'warn',
        host_id: 'fleet',
        problem_id: 'old-problem',
        source: 'tokens',
        msg: 'stale collector',
        channel: 'lark',
        delivered: false,
        lark_message_id: null,
        error: 'auth expired',
      },
    ],
    Date.now(),
  );
  s = applyHistory(s, {
    host_id: 'atlas',
    // oldest-first (hub history is ORDER BY bucket ASC)
    points: Array.from({ length: 60 }, (_, i) => ({
      ts: new Date(Date.now() - (59 - i) * 300_000).toISOString(),
      cpu_pct: 30 + (i % 20),
      mem_pct: 60,
      reachable: true,
      up_bps: null,
      down_bps: null,
      clients: null,
    })),
  });
  return s;
}

const SIZES: Array<[number, number]> = [
  [45, 30], // Moshi portrait
  [76, 24], // small desktop / Moshi landscape
  [120, 40], // desktop
];

describe('renderFrame layout contract', () => {
  for (const tab of TABS as readonly Tab[]) {
    for (const [cols, rows] of SIZES) {
      test(`${tab} tab fits ${cols}x${rows}`, () => {
        const s = setTab(loadedState(), tab);
        const { lines } = renderFrame(s, cols, rows);
        expect(lines).toHaveLength(rows);
        for (const l of lines) {
          expect(visibleWidth(l)).toBeLessThanOrEqual(cols);
        }
      });
    }
  }

  test('empty state (no fleet yet) still renders a full frame', () => {
    const { lines } = renderFrame(initialState('demo'), 45, 20);
    expect(lines).toHaveLength(20);
    for (const l of lines) expect(visibleWidth(l)).toBeLessThanOrEqual(45);
  });

  test('header carries KPIs and conn status', () => {
    const { lines } = renderFrame(loadedState(), 120, 30);
    const head = stripAnsi(lines[0] ?? '');
    expect(head).toContain('AXFLEET');
    expect(head).toContain('3/4 up');
    expect(head).toContain('2 problems');
    expect(head).toContain('live');
  });

  test('alerts tab badge shows problem count', () => {
    const { lines } = renderFrame(loadedState(), 120, 30);
    expect(stripAnsi(lines[1] ?? '')).toContain('Alerts(2)');
  });

  test('fleet pane shows the asleep workstation as expected, not a failure', () => {
    const s = setTab(loadedState(), 'fleet');
    const text = renderFrame(s, 120, 40).lines.map(stripAnsi).join('\n');
    expect(text).toContain('asleep (expected)');
  });

  test('vpn pane shows version, cert days and full sub URLs', () => {
    const s = setTab(loadedState(), 'vpn');
    const text = renderFrame(s, 120, 40).lines.map(stripAnsi).join('\n');
    expect(text).toContain('1.13.14');
    expect(text).toContain('cert');
    expect(text).toContain('https://vpn-kiku.example.dev/x/clash'); // full URL, not just the domain
    expect(text).toContain('https://vpn-kiku.example.dev/x/sb');
  });

  test('vpn pane shows active clients (row + detail meta)', () => {
    const s = setTab(loadedState(), 'vpn');
    const text = renderFrame(s, 120, 40).lines.map(stripAnsi).join('\n');
    expect(text).toContain('6 clients');
  });

  test('tokens pane shows the all-time total independent of range', () => {
    const s = setTab(loadedState(), 'tokens');
    const text = renderFrame(s, 120, 40).lines.map(stripAnsi).join('\n');
    expect(text).toContain('all time');
    expect(text).toContain('$4812.30');
    expect(text).toContain('9.9B tokens');
  });

  test('alerts pane shows push status: annotated problems + push log', () => {
    const s = setTab(loadedState(), 'alerts');
    const text = renderFrame(s, 120, 45).lines.map(stripAnsi).join('\n');
    expect(text).toContain('飞书✓'); // p1 is an active problem with a delivered push
    expect(text).toContain('feishu pushes (2)');
    expect(text).toContain('✗ failed'); // undelivered push surfaces its failure
    expect(text).toContain('auth expired');
  });

  test('accounts pane: deduped profiles w/ email, daemon lines, machine tokens', () => {
    const s = setTab(loadedState(), 'accounts');
    const text = renderFrame(s, 120, 45).lines.map(stripAnsi).join('\n');
    expect(text).toContain('windows via atlas'); // merged view names its freshest source
    expect(text).toContain('ACTIVE atlas'); // per-host active state survives the merge
    expect(text).toContain('acct-work@example.com'); // email line under the profile head
    expect(text).toContain('fable'); // '7d fable' window renders as 'fable'
    expect(text).toContain('80%');
    expect(text).toContain('acct-main → acct-work → acct-backup'); // chain
    expect(text).toContain('next switch acct-main'); // daemon forecast line
    expect(text).toContain('123.5M'); // today tokens
    expect(text).toContain('12.0B+'); // lifetime floor marker
    expect(text).toContain('$20,000+');
  });

  test('accounts pane at 45 cols still draws bars within width', () => {
    const s = setTab(loadedState(), 'accounts');
    const { lines } = renderFrame(s, 45, 30);
    const text = lines.map(stripAnsi).join('\n');
    expect(text).toContain('█'); // bars survive Moshi portrait
    for (const l of lines) expect(visibleWidth(l)).toBeLessThanOrEqual(45);
  });

  test('gateways pane (omni section): healthy dot, stale warning with error, off source dim', () => {
    const s = setTab(loadedState(), 'gateways');
    const text = renderFrame(s, 120, 45).lines.map(stripAnsi).join('\n');
    expect(text).toContain('omni · basalt');
    expect(text).toContain('Factorio · forge');
    expect(text).toContain('272K docs');
    expect(text).toContain('● Gmail');
    expect(text).toContain('▲ Slack'); // 12h stale on a 30m interval
    expect(text).toContain('rate limited: retry_after=30');
    expect(text).toContain('○ Wiki'); // deliberately off — never an alarm glyph
    expect(text).toContain('4 fails');
  });

  test('agents pane: openclaw gateway line + per-agent bot status', () => {
    const s = setTab(loadedState(), 'agents');
    const text = renderFrame(s, 120, 45).lines.map(stripAnsi).join('\n');
    expect(text).toContain('openclaw agents (2)');
    expect(text).toContain('gateway ok');
    expect(text).toContain('rss 745MB');
    expect(text).toContain('cron 16/16');
    expect(text).toContain('小助 (Helper)');
    expect(text).toContain('default'); // model routing key, not the full model id
    expect(text).toContain('disconnected · ETELEGRAM: 502');
    expect(text).toContain('(3 retries)');
  });

  test('7-tab bar fits 45 cols with the current-tab caret', () => {
    const { lines } = renderFrame(setTab(loadedState(), 'accounts'), 45, 30);
    const bar = stripAnsi(lines[1] ?? '');
    expect(visibleWidth(lines[1] ?? '')).toBeLessThanOrEqual(45);
    expect(bar).toContain('5Acc');
    expect(bar).toContain('7Ale(2)');
  });

  test('scroll clips the body without breaking the frame height', () => {
    let s = setTab(loadedState(), 'alerts');
    s = { ...s, scroll: 5 };
    const { lines, bodyTotal } = renderFrame(s, 76, 20);
    expect(lines).toHaveLength(20);
    expect(bodyTotal).toBeGreaterThan(0);
  });
});

describe('narrow (phone) mode — stacked rows keep full information at 45 cols', () => {
  const textAt = (tab: Tab, cols = 45, rows = 40): string =>
    renderFrame(setTab(loadedState(), tab), cols, rows).lines.map(stripAnsi).join('\n');

  test('alerts: push messages and errors survive (used to truncate off)', () => {
    const text = textAt('alerts');
    expect(text).toContain('api-gateway failed');
    expect(text).toContain('auth expired');
  });

  test('agents: openclaw bot failure detail survives', () => {
    const text = textAt('agents');
    expect(text).toContain('ETELEGRAM: 502');
  });

  test('accounts: daemon switch forecast survives', () => {
    const text = textAt('accounts');
    expect(text).toContain('next switch acct-main');
  });

  test('tokens: model name is not sacrificed to the bar', () => {
    const text = textAt('tokens');
    expect(text).toContain('claude-fable-5');
  });

  test('wide layouts are byte-identical to before (narrow paths gated)', () => {
    const text = textAt('alerts', 120, 45);
    expect(text).toContain('api-gateway failed');
  });
});

describe('failed-probe honesty', () => {
  const failed = <T,>(): { available: false; error: string; checked_at: string } => ({
    available: false, error: 'docker exec timed out', checked_at: new Date().toISOString(),
  });

  test('gateways tab: failing probe with no retained data renders the error, never "no omni hosts"', () => {
    const fs = fixtureState();
    fs.hosts = fs.hosts.map((h) =>
      h.host_id === 'basalt' ? { ...h, snapshot: { ...h.snapshot!, omni: failed() } } : h,
    );
    const s = setTab(applyFleet(initialState('demo'), fs, Date.now(), 'sse'), 'gateways');
    const text = renderFrame(s, 100, 30).lines.map(stripAnsi).join('\n');
    expect(text).toContain('omni health unavailable — docker exec timed out');
    expect(text).not.toContain('no omni hosts reporting');
  });

  test('accounts tab: failing probe renders the error instead of vanishing', () => {
    const fs = fixtureState();
    fs.hosts = fs.hosts.map((h) =>
      h.host_id === 'atlas' ? { ...h, snapshot: { ...h.snapshot!, clauth_usage: failed() } } : h,
    );
    const s = setTab(applyFleet(initialState('demo'), fs, Date.now(), 'sse'), 'accounts');
    const text = renderFrame(s, 100, 30).lines.map(stripAnsi).join('\n');
    expect(text).toContain('clauth feed unavailable — docker exec timed out');
  });

  test('agents tab: gateway rollup renders even when the agents registry is empty', () => {
    const fs = fixtureState();
    fs.hosts = fs.hosts.map((h) =>
      h.host_id === 'basalt'
        ? { ...h, snapshot: { ...h.snapshot!, openclaw: probe({ ...openclaw, agents: [] }) } }
        : h,
    );
    const s = setTab(applyFleet(initialState('demo'), fs, Date.now(), 'sse'), 'agents');
    const text = renderFrame(s, 120, 40).lines.map(stripAnsi).join('\n');
    expect(text).toContain('gateway ok');
    expect(text).toContain('rss 745MB');
  });

  test('agents tab: connected bot with a bad token renders the warn, not green-connected', () => {
    const fs = fixtureState();
    const badToken: OpenclawInfo = {
      ...openclaw,
      agents: [{ id: 'main', name: '小助', model: null, is_default: true, bot: {
        enabled: true, connected: true, running: true, last_error: null,
        reconnect_attempts: 0, token_status: 'missing', last_inbound_at: null, last_outbound_at: null,
      } }],
    };
    fs.hosts = fs.hosts.map((h) =>
      h.host_id === 'basalt' ? { ...h, snapshot: { ...h.snapshot!, openclaw: probe(badToken) } } : h,
    );
    const s = setTab(applyFleet(initialState('demo'), fs, Date.now(), 'sse'), 'agents');
    const text = renderFrame(s, 120, 40).lines.map(stripAnsi).join('\n');
    expect(text).toContain('token missing');
  });
});
