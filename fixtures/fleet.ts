/**
 * The demo fleet — six imaginary hosts that exercise every pane of the TUI:
 *
 *   atlas      cockpit · hub, single zylos persona (云雀), clauth feed
 *   forge      agent runner · persona fleet, Factorio server, docker app stack
 *   basalt     knowledge stack · omni indexing, New API gateway, openclaw, codex loops
 *   mica       workstation · asleep by design (expected_flaky), stale feeds
 *   vpn-kiku   sing-box VPN box (tokyo)
 *   vpn-cedar  sing-box VPN box (oregon) — pending update, cert nearing expiry
 *
 * Everything is generated relative to `now`, so ages/countdowns always read
 * sensibly, and gauge values come from fixtures/noise so they drift smoothly
 * between refresh ticks. All of it is fake: names, IPs (CGNAT range),
 * example.dev domains, costs, and every token.
 */
import type {
  AgentsInfo,
  AuthInfo,
  ClauthUsageInfo,
  CodexUsageInfo,
  FactorioInfo,
  FleetEvent,
  FleetHost,
  FleetProblem,
  FleetState,
  HostId,
  HostSnapshot,
  NewApiInfo,
  OmniInfo,
  OpenclawInfo,
  Probe,
  ServiceInfo,
  SingboxInfo,
  TailscaleInfo,
  TokensSummary,
  TunnelInfo,
  ZylosInfo,
} from '../contracts/types';
import { CONTRACT_VERSION, pm2InstanceId } from '../contracts/types';
import { metric, stable } from './noise';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Single source for "today's cost/tokens" — the header KPI, the tokens
 *  summary, and buildTokensDetail('today') all render this, so the two
 *  "today" numbers visible in the UI can never disagree. */
export const TODAY_COST_USD = 14.62;
export const TODAY_TOKENS = 27_600_000;

const iso = (t: number): string => new Date(t).toISOString();

function probe<T>(data: T, now: number, ageMs = 8_000): Probe<T> {
  return { available: true, data, checked_at: iso(now - ageMs) };
}

function svc(
  name: string,
  supervisor: ServiceInfo['supervisor'],
  group: string,
  over: Partial<ServiceInfo> = {},
): ServiceInfo {
  return {
    name,
    supervisor,
    state: 'running',
    expected: true,
    uptime_sec: Math.round((3 + stable(name) * 40) * 86_400),
    restarts: stable(name) > 0.85 ? 2 : 0,
    memory_mb: Math.round(40 + stable(name) * 400),
    cpu_pct: Math.round(stable(name) * 4 * 10) / 10,
    group,
    ...over,
  };
}

function pm2Set(home: string, names: string[], group = 'zylos'): ServiceInfo[] {
  return names.map((n) =>
    svc(n, 'pm2', group, { instance_id: pm2InstanceId(home, n), detail: home }),
  );
}

const TAILNET: Array<{ host_name: string; ip: string; os: string }> = [
  { host_name: 'atlas', ip: '100.64.0.11', os: 'linux' },
  { host_name: 'forge', ip: '100.64.0.12', os: 'linux' },
  { host_name: 'basalt', ip: '100.64.0.13', os: 'linux' },
  { host_name: 'mica', ip: '100.64.0.14', os: 'macOS' },
];

function tailscale(self: string, now: number): TailscaleInfo {
  const me = TAILNET.find((t) => t.host_name === self)!;
  return {
    self_ip: me.ip,
    self_online: true,
    peers: TAILNET.filter((t) => t.host_name !== self).map((t) => ({
      host_name: t.host_name,
      ip: t.ip,
      os: t.os,
      online: t.host_name !== 'mica',
      ...(t.host_name === 'mica' ? { last_seen: iso(now - 6 * HOUR) } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// atlas — cockpit · hub
// ---------------------------------------------------------------------------

function atlasSnapshot(now: number): HostSnapshot {
  const zylos: ZylosInfo = {
    root: '/home/demo/zylos',
    personas: [
      {
        id: 'yunque',
        display_name: '云雀',
        type: 'dedicated',
        enabled: true,
        runtime: 'claude',
        runtime_profile: 'claude-subscription',
        runtime_profile_changed_at: iso(now - 26 * HOUR),
        runtime_profile_change_reason: 'preferred_provider_recovered:claude',
        tmux_session: 'claude-main',
        tmux_alive: true,
        status: 'idle',
        idle_min: 3,
        context_pct: Math.round(metric('yunque.ctx', now, 34, 3)),
        today_tokens: 2_140_000,
        week_tokens: 15_800_000,
        last_inbound_at: iso(now - 18 * MIN),
        last_outbound_at: iso(now - 17 * MIN),
        unanswered: 0,
      },
    ],
    provider_windows: [
      { provider: 'claude', window: '5h', used_pct: Math.round(metric('atlas.cl5h', now, 22, 4)), resets_at: iso(now + 2.4 * HOUR) },
      { provider: 'claude', window: '7d', used_pct: 61, resets_at: iso(now + 2.2 * DAY) },
    ],
    scheduler_upcoming: 4,
    console_url: 'https://console.example.dev',
  };

  const clauthUsage: ClauthUsageInfo = {
    schema_ok: true,
    generated_at: iso(now - 90_000),
    clauth_version: '0.9.2',
    active_profile: 'aria-max',
    fallback_chain: ['aria-max', 'nimbus-pro'],
    forecast: { action: 'hold', to: null },
    last_error: null,
    stale: false,
    profiles: [
      {
        name: 'aria-max',
        active: true,
        tier: 'max20x',
        email: 'aria@example.com',
        auth_status: 'ok',
        fetch_status: 'Fresh',
        windows: [
          { label: '5h', used_pct: Math.round(metric('aria.5h', now, 22, 4)), resets_at: iso(now + 2.4 * HOUR) },
          { label: '7d', used_pct: 61, resets_at: iso(now + 2.2 * DAY) },
          { label: '7d fable', used_pct: 34, resets_at: iso(now + 2.2 * DAY) },
        ],
      },
      {
        name: 'nimbus-pro',
        active: false,
        tier: 'pro',
        email: 'nimbus@example.com',
        auth_status: 'ok',
        fetch_status: 'Fresh',
        windows: [
          { label: '5h', used_pct: Math.round(metric('nimbus.5h', now, 6, 3)), resets_at: iso(now + 4.1 * HOUR) },
          { label: '7d', used_pct: 12, resets_at: iso(now + 5.6 * DAY) },
        ],
      },
    ],
    tokens: {
      generated_at: iso(now - 90_000),
      periods: [
        { key: 'today', total_tokens: 8_400_000, cost_usd: 12.3, floor: false, models: [
          { display: 'opus-4.8', total_tokens: 5_100_000, cost_usd: 9.8 },
          { display: 'sonnet-5', total_tokens: 3_300_000, cost_usd: 2.5 },
        ] },
        { key: 'week', total_tokens: 61_000_000, cost_usd: 88.4, floor: false, models: [] },
        { key: 'month', total_tokens: 240_000_000, cost_usd: 310.2, floor: false, models: [] },
        { key: 'lifetime', total_tokens: 3_100_000_000, cost_usd: 4_210, floor: true, models: [] },
      ],
    },
  };

  const agents: AgentsInfo = {
    herdr_agents: [
      { name: 'fleet-hub', kind: 'service', status: 'running', session: 'hub' },
      { name: 'night-audit', kind: 'loop', status: 'idle', session: 'audit' },
    ],
    claude_procs: 1,
    codex_procs: 0,
    tmux_loops: [],
  };

  const auth: AuthInfo = {
    claude: { method: 'setup-token', subscription: 'max', expires_at: iso(now + 340 * DAY), days_to_expiry: 340 },
    codex: [{ label: 'default', method: 'chatgpt' }],
  };

  return {
    v: CONTRACT_VERSION,
    host_id: 'atlas',
    hostname: 'atlas',
    role: 'cockpit · 云雀 · fleet hub',
    taken_at: iso(now - 6_000),
    collector_version: '1.4.2',
    os: { platform: 'linux', release: '6.8.0-40-generic', uptime_sec: 41 * 86_400 + 7_200 },
    cpu: { cores: 4, load1: 0.6, load5: 0.5, load15: 0.4, used_pct: metric('atlas.cpu', now, 18, 9) },
    mem: { total_mb: 16_384, used_mb: 10_150, used_pct: metric('atlas.mem', now, 62, 4) },
    disks: [{ mount: '/', total_gb: 60, used_gb: 38.4, used_pct: 64 }],
    services: probe<ServiceInfo[]>([
      svc('tailscaled', 'systemd', 'infra'),
      svc('docker', 'systemd', 'infra'),
      svc('fail2ban', 'systemd', 'infra'),
      svc('fleet-hub', 'systemd-user', 'cockpit'),
      svc('fleet-collector', 'systemd-user', 'cockpit'),
      svc('herdr', 'systemd-user', 'cockpit'),
      ...pm2Set('~/.pm2', [
        'scheduler', 'web-console', 'c4-dispatcher', 'activity-monitor',
        'provider-usage-updater', 'runtime-failover', 'token-cache-updater',
        'telegram-bridge', 'feishu-bridge',
      ]),
    ], now),
    tailscale: probe(tailscale('atlas', now), now),
    agents: probe(agents, now),
    zylos: probe(zylos, now),
    clauth: probe({ active_profile: 'aria-max', profiles: [
      { name: 'aria-max', auth_status: 'ok', five_hour_pct: 22, seven_day_pct: 61, threshold: 95 },
      { name: 'nimbus-pro', auth_status: 'ok', five_hour_pct: 6, seven_day_pct: 12, threshold: 95 },
    ] }, now),
    tunnels: null,
    singbox: null,
    omni: null,
    openclaw: null,
    clauth_usage: probe(clauthUsage, now),
    codex_usage: null,
    auth: probe(auth, now),
    mosh: probe({ server_present: true, active_sessions: 1 }, now),
  };
}

// ---------------------------------------------------------------------------
// forge — agent runner · persona fleet · factorio
// ---------------------------------------------------------------------------

function forgeSnapshot(now: number): HostSnapshot {
  const personas: ZylosInfo['personas'] = [
    {
      id: 'admin', display_name: 'admin', type: 'dedicated', enabled: true,
      runtime: 'claude', runtime_profile: 'claude-subscription',
      tmux_session: 'claude-admin', tmux_alive: true, status: 'working',
      idle_min: 0, context_pct: Math.round(metric('admin.ctx', now, 51, 6)),
      today_tokens: 4_800_000, week_tokens: 31_000_000, today_cost_usd: 0,
      last_inbound_at: iso(now - 4 * MIN), last_outbound_at: iso(now - 2 * MIN), unanswered: 0,
    },
    {
      id: 'scheduler', display_name: 'scheduler', type: 'dedicated', enabled: true,
      runtime: 'claude', runtime_profile: 'claude-subscription',
      tmux_session: 'claude-scheduler', tmux_alive: true, status: 'idle',
      idle_min: 22, context_pct: 12, today_tokens: 610_000, week_tokens: 4_200_000,
      last_inbound_at: iso(now - 3 * HOUR), last_outbound_at: iso(now - 3 * HOUR), unanswered: 0,
    },
    {
      id: 'group', display_name: 'group', type: 'group', enabled: true,
      runtime: 'codex', runtime_profile: 'codex-subscription',
      runtime_profile_changed_at: iso(now - 9 * HOUR),
      runtime_profile_change_reason: 'usage_exhausted:claude',
      tmux_session: 'claude-group', tmux_alive: true, status: 'idle',
      idle_min: 8, context_pct: 28, today_tokens: 5_600_000, week_tokens: 22_000_000,
      last_inbound_at: iso(now - 41 * MIN), last_outbound_at: iso(now - 39 * MIN), unanswered: 0,
    },
    {
      id: 'user-alice', display_name: 'user-alice', type: 'user', enabled: true,
      runtime: 'claude', runtime_profile: 'claude-subscription',
      tmux_session: 'claude-user-alice', tmux_alive: true, status: 'working',
      idle_min: 1, context_pct: 44, today_tokens: 1_900_000, week_tokens: 9_400_000,
      last_inbound_at: iso(now - 8 * MIN), last_outbound_at: iso(now - 12 * MIN),
      unanswered: 1, oldest_unanswered_min: 8,
    },
    {
      id: 'user-bob', display_name: 'user-bob', type: 'user', enabled: false,
      runtime: 'claude', runtime_profile: 'claude-subscription',
      tmux_session: 'claude-user-bob', tmux_alive: false, status: 'disabled',
      unanswered: 0,
    },
  ];

  const factorio: FactorioInfo = {
    server_name: 'Nimbus Factory',
    game_version: '2.0.28',
    started_at: iso(now - 3 * DAY - 5 * HOUR),
    players: { complete: true, active: 2, max: 10, checked_at: iso(now - 30_000) },
    save: { loaded_file: 'nauvis-mega.zip', map_version: '2.0.28' },
    mods: [
      { name: 'base', version: '2.0.28', builtin: true },
      { name: 'quality', version: '2.0.28', builtin: true },
      { name: 'elevated-rails', version: '2.0.28', builtin: true },
      { name: 'space-age', version: '2.0.28', builtin: true },
      { name: 'afk-queue', version: '1.3.0', builtin: false },
    ],
  };

  const codexUsage: CodexUsageInfo = {
    snapshot_at: iso(now - 6 * MIN),
    plan_type: 'plus',
    rate_limit_reached_type: null,
    windows: [
      { label: '5h', used_pct: Math.round(metric('forge.cx5h', now, 18, 5)), resets_at: iso(now + 2.1 * HOUR) },
      { label: '7d', used_pct: 31, resets_at: iso(now + 3.2 * DAY) },
    ],
  };

  const tunnels: TunnelInfo[] = [
    {
      name: 'forge-ingress',
      state: 'running',
      ingress: [
        { hostname: 'console.example.dev', service: 'http://localhost:7000' },
        { hostname: 'map.example.dev', service: 'http://localhost:8615' },
      ],
    },
  ];

  const auth: AuthInfo = {
    claude: { method: 'setup-token', subscription: 'max', expires_at: iso(now + 296 * DAY), days_to_expiry: 296 },
    codex: [{ label: 'default', method: 'chatgpt' }],
  };

  return {
    v: CONTRACT_VERSION,
    host_id: 'forge',
    hostname: 'forge',
    role: 'agent runner · persona fleet · factorio',
    taken_at: iso(now - 4_000),
    collector_version: '1.4.2',
    os: { platform: 'linux', release: '6.8.0-40-generic', uptime_sec: 12 * 86_400 + 40_000 },
    cpu: { cores: 16, load1: 4.1, load5: 3.6, load15: 3.2, used_pct: metric('forge.cpu', now, 35, 14) },
    mem: { total_mb: 32_768, used_mb: 18_000, used_pct: metric('forge.mem', now, 55, 6) },
    disks: [
      { mount: '/', total_gb: 256, used_gb: 182, used_pct: 71 },
      { mount: '/data', total_gb: 512, used_gb: 215, used_pct: 42 },
    ],
    services: probe<ServiceInfo[]>([
      svc('cloudflared', 'systemd', 'infra'),
      svc('caddy', 'systemd', 'infra'),
      svc('tailscaled', 'systemd', 'infra'),
      svc('docker', 'systemd', 'infra'),
      svc('fail2ban', 'systemd', 'infra'),
      svc('factorio', 'systemd', 'games'),
      svc('map-snapshotter', 'systemd-user', 'games', { state: 'failed', uptime_sec: 0 }),
      svc('herdr', 'systemd-user', 'cockpit'),
      svc('fleet-collector', 'systemd-user', 'cockpit'),
      ...pm2Set('~/.pm2', [
        'scheduler', 'web-console', 'telegram-bridge', 'feishu-bridge',
        'provider-usage-updater', 'runtime-failover', 'token-cache-updater',
        'c4-broker', 'c4-dispatcher',
        'activity-monitor-admin', 'activity-monitor-scheduler', 'activity-monitor-group',
        'activity-monitor-user-alice', 'activity-monitor-user-bob',
      ]),
      svc('rss-mirror', 'docker', 'news', { detail: 'rss-mirror:latest' }),
      svc('trending-api', 'docker', 'news', { state: 'unhealthy', detail: 'trending-api:latest' }),
      svc('newsdeck', 'docker', 'news', { detail: 'newsdeck:latest' }),
    ], now),
    tailscale: probe(tailscale('forge', now), now),
    agents: probe<AgentsInfo>({
      herdr_agents: [],
      claude_procs: 4,
      codex_procs: 1,
      tmux_loops: [],
    }, now),
    zylos: probe<ZylosInfo>({
      root: '/home/demo/zylos',
      personas,
      provider_windows: [
        { provider: 'claude', window: '5h', used_pct: Math.round(metric('forge.cl5h', now, 41, 6)), resets_at: iso(now + 1.6 * HOUR) },
        { provider: 'claude', window: '7d', used_pct: 78, resets_at: iso(now + 1.4 * DAY) },
        { provider: 'codex', window: '7d', used_pct: 24, resets_at: iso(now + 4.8 * DAY) },
      ],
      scheduler_upcoming: 11,
      console_url: 'https://console.example.dev',
    }, now),
    clauth: null,
    tunnels: probe(tunnels, now),
    singbox: null,
    factorio: probe(factorio, now),
    omni: null,
    openclaw: null,
    clauth_usage: null,
    codex_usage: probe(codexUsage, now),
    auth: probe(auth, now),
    mosh: probe({ server_present: true, active_sessions: 0 }, now),
  };
}

// ---------------------------------------------------------------------------
// basalt — knowledge stack · gateways
// ---------------------------------------------------------------------------

function basaltSnapshot(now: number): HostSnapshot {
  const omni: OmniInfo = {
    sources: [
      { name: 'notion', source_type: 'notion', active: true, sync_interval_sec: 3600,
        last_success_at: iso(now - 28 * MIN), last_run_status: 'completed', last_run_at: iso(now - 28 * MIN),
        active_run_activity_at: null, last_error: null, failed_since_success: 0, docs: 12_400 },
      { name: 'slack', source_type: 'slack', active: true, sync_interval_sec: 1800,
        last_success_at: iso(now - 12 * MIN), last_run_status: 'completed', last_run_at: iso(now - 12 * MIN),
        active_run_activity_at: null, last_error: null, failed_since_success: 0, docs: 21_300, docs_capped: true },
      { name: 'github', source_type: 'github', active: true, sync_interval_sec: 3600,
        last_success_at: iso(now - 5 * HOUR), last_run_status: 'running', last_run_at: iso(now - 22 * MIN),
        active_run_activity_at: iso(now - 3 * MIN), last_error: null, failed_since_success: 0, docs: 8_650 },
      { name: 'gdrive', source_type: 'gdrive', active: true, sync_interval_sec: 3600,
        last_success_at: iso(now - 9 * HOUR), last_run_status: 'failed', last_run_at: iso(now - 40 * MIN),
        active_run_activity_at: null, last_error: '429 rate limited by upstream', failed_since_success: 2, docs: 4_020 },
      { name: 'web-crawler', source_type: 'web', active: true, sync_interval_sec: 7200,
        last_success_at: iso(now - 50 * MIN), last_run_status: 'failed', last_run_at: iso(now - 10 * MIN),
        active_run_activity_at: null, last_error: 'timeout fetching sitemap', failed_since_success: 1, docs: 1_780 },
      { name: 'wiki', source_type: 'confluence', active: false, sync_interval_sec: null,
        last_success_at: iso(now - 30 * DAY), last_run_status: 'completed', last_run_at: iso(now - 30 * DAY),
        active_run_activity_at: null, last_error: null, failed_since_success: 0, docs: 950 },
      { name: 'linear', source_type: 'linear', active: true, sync_interval_sec: 3600,
        last_success_at: null, last_run_status: null, last_run_at: null,
        active_run_activity_at: null, last_error: null, failed_since_success: 0, docs: 0 },
    ],
    queue: { pending: 3, processing: 1, failed: 0, failed_recent: 0 },
    stuck_runs: 0,
    docs_total: 48_200,
    docs_total_estimated: true,
  };

  const newapi: NewApiInfo = {
    reachable: true,
    channels: [
      { id: 1, name: 'openai-primary', type: 1, status: 1, response_time_ms: 240 },
      { id: 2, name: 'anthropic-direct', type: 14, status: 1, response_time_ms: 512 },
      { id: 3, name: 'gemini-flash', type: 24, status: 3, response_time_ms: 0 },
      { id: 4, name: 'foundry-east', type: 1, status: 2, response_time_ms: 1_840 },
    ],
  };

  const openclaw: OpenclawInfo = {
    version: '2026.6.11',
    gateway: {
      ok: true,
      event_loop_degraded: false,
      rss_mb: Math.round(metric('basalt.ocrss', now, 812, 40, { min: 700, max: 950 })),
      nrestarts: 1,
      sessions: 3,
      heartbeat_seconds: 12,
    },
    plugins: { loaded: 4, errors: [] },
    agents: [
      {
        id: 'newsbot', name: 'newsbot', model: 'newapi-alice/gpt-5.5-standard', is_default: true,
        bot: { enabled: true, connected: true, running: true, last_error: null, reconnect_attempts: 0,
          token_status: 'available', last_inbound_at: iso(now - 20 * MIN), last_outbound_at: iso(now - 19 * MIN) },
      },
      {
        id: 'digest-bot', name: 'digest-bot', model: 'newapi-bob/gpt-5.5-standard', is_default: false,
        bot: { enabled: true, connected: false, running: false, last_error: 'ETELEGRAM 401', reconnect_attempts: 3,
          token_status: 'available', last_inbound_at: iso(now - 7 * HOUR), last_outbound_at: iso(now - 7 * HOUR) },
      },
      { id: 'lab-bot', name: 'lab-bot', model: null, is_default: false, bot: null },
    ],
    cron: { total: 8, enabled: 6 },
  };

  const codexUsage: CodexUsageInfo = {
    snapshot_at: iso(now - 2 * HOUR),
    plan_type: 'team',
    rate_limit_reached_type: null,
    windows: [
      { label: '5h', used_pct: 42, resets_at: iso(now - 20 * MIN) }, // window reset since snapshot → renders as 0/reset
      { label: '7d', used_pct: 12, resets_at: iso(now + 5.1 * DAY) },
    ],
  };

  const auth: AuthInfo = {
    claude: null,
    codex: [
      { label: 'build-bot', method: 'chatgpt' },
      { label: 'review-bot', method: 'chatgpt' },
      { label: 'qa-bot', method: 'apikey' },
    ],
  };

  const AGENT_HOMES = ['~/agents/build-bot/.pm2', '~/agents/review-bot/.pm2', '~/agents/qa-bot/.pm2'];

  return {
    v: CONTRACT_VERSION,
    host_id: 'basalt',
    hostname: 'basalt',
    role: 'knowledge stack · gateways',
    taken_at: iso(now - 7_000),
    collector_version: '1.4.2',
    os: { platform: 'linux', release: '6.5.0-35-generic', uptime_sec: 87 * 86_400 + 3_000 },
    cpu: { cores: 8, load1: 1.8, load5: 1.7, load15: 1.5, used_pct: metric('basalt.cpu', now, 22, 8) },
    mem: { total_mb: 32_768, used_mb: 22_300, used_pct: metric('basalt.mem', now, 68, 4) },
    disks: [{ mount: '/', total_gb: 512, used_gb: 297, used_pct: 58 }],
    services: probe<ServiceInfo[]>([
      svc('tailscaled', 'systemd', 'infra'),
      svc('docker', 'systemd', 'infra'),
      svc('fail2ban', 'systemd', 'infra'),
      svc('api-gateway', 'systemd', 'agents'),
      svc('openclaw-gateway', 'systemd-user', 'openclaw'),
      svc('herdr', 'systemd-user', 'cockpit'),
      svc('fleet-collector', 'systemd-user', 'cockpit'),
      ...AGENT_HOMES.flatMap((home) =>
        pm2Set(home, ['scheduler', 'c4-dispatcher', 'activity-monitor', 'chat-bridge']),
      ),
      svc('omni-postgres', 'docker', 'omni', { detail: 'paradedb:pg17' }),
      svc('omni-api', 'docker', 'omni'),
      svc('omni-worker', 'docker', 'omni'),
      svc('omni-embedder', 'docker', 'omni'),
      svc('newapi-server', 'docker', 'newapi', { ports: [3006] }),
      svc('newapi-postgres', 'docker', 'newapi'),
    ], now),
    tailscale: probe(tailscale('basalt', now), now),
    agents: probe<AgentsInfo>({
      herdr_agents: [],
      claude_procs: 0,
      codex_procs: 3,
      tmux_loops: [
        { session: 'codex-main', alive: true, since: iso(now - 6 * DAY), agent: 'build-bot' },
        { session: 'codex-main', alive: true, since: iso(now - 6 * DAY), agent: 'review-bot' },
        { session: 'codex-main', alive: true, since: iso(now - 2 * DAY), agent: 'qa-bot' },
      ],
    }, now),
    zylos: null,
    clauth: null,
    tunnels: null,
    singbox: null,
    omni: probe(omni, now),
    newapi: probe(newapi, now),
    openclaw: probe(openclaw, now),
    clauth_usage: null,
    codex_usage: probe(codexUsage, now),
    auth: probe(auth, now),
    mosh: probe({ server_present: true, active_sessions: 2 }, now),
  };
}

// ---------------------------------------------------------------------------
// mica — workstation, asleep by design
// ---------------------------------------------------------------------------

function micaSnapshot(now: number): HostSnapshot {
  const asleepAt = now - 6 * HOUR;
  const clauthUsage: ClauthUsageInfo = {
    schema_ok: true,
    generated_at: iso(asleepAt),
    clauth_version: '0.9.2',
    active_profile: 'aria-max',
    fallback_chain: ['aria-max', 'nimbus-pro'],
    forecast: { action: 'switch', to: 'nimbus-pro' },
    last_error: null,
    stale: true,
    profiles: [
      {
        name: 'aria-max', active: true, tier: 'max20x', email: 'aria@example.com',
        auth_status: 'ok', fetch_status: 'Fresh',
        windows: [
          { label: '5h', used_pct: 71, resets_at: iso(asleepAt + 3 * HOUR) },
          { label: '7d', used_pct: 58, resets_at: iso(now + 2.4 * DAY) },
        ],
      },
    ],
    tokens: null,
  };

  const codexUsage: CodexUsageInfo = {
    snapshot_at: iso(now - 9 * HOUR),
    plan_type: 'plus',
    rate_limit_reached_type: null,
    windows: [
      { label: '5h', used_pct: 64, resets_at: iso(now - 5 * HOUR) },
      { label: '7d', used_pct: 22, resets_at: iso(now + 1.9 * DAY) },
    ],
  };

  return {
    v: CONTRACT_VERSION,
    host_id: 'mica',
    hostname: 'mica.local',
    role: 'workstation · thin client',
    taken_at: iso(asleepAt),
    collector_version: '1.4.2',
    os: { platform: 'darwin', release: '25.5.0', uptime_sec: 9 * 86_400 },
    cpu: { cores: 12, load1: 1.2, load5: 1.4, load15: 1.6, used_pct: 14 },
    mem: { total_mb: 36_864, used_mb: 21_000, used_pct: 57 },
    disks: [{ mount: '/', total_gb: 926, used_gb: 512, used_pct: 55 }],
    services: probe<ServiceInfo[]>([
      svc('com.clauth.daemon', 'launchd', 'cockpit'),
      svc('com.fleet-collector', 'launchd', 'cockpit'),
    ], asleepAt), // checked when the box was last awake
    tailscale: probe(tailscale('mica', asleepAt), asleepAt),
    agents: probe<AgentsInfo>({ herdr_agents: [], claude_procs: 1, codex_procs: 1, tmux_loops: [] }, asleepAt),
    zylos: null,
    clauth: null,
    tunnels: null,
    singbox: null,
    omni: null,
    openclaw: null,
    clauth_usage: probe(clauthUsage, asleepAt),
    codex_usage: probe(codexUsage, asleepAt),
    auth: probe({
      claude: { method: 'oauth', subscription: 'max', expires_at: null, days_to_expiry: null },
      codex: [{ label: 'default', method: 'chatgpt' }],
    }, asleepAt),
    mosh: probe({ server_present: false, active_sessions: 0 }, asleepAt),
  };
}

// ---------------------------------------------------------------------------
// sing-box VPN boxes
// ---------------------------------------------------------------------------

function singboxSnapshot(
  id: 'vpn-kiku' | 'vpn-cedar',
  now: number,
  over: Partial<SingboxInfo>,
  role: string,
): HostSnapshot {
  const up = metric(`${id}.up`, now, 550_000, 420_000, { min: 20_000, max: 4_000_000, period: 300_000 });
  const down = metric(`${id}.down`, now, 2_400_000, 1_900_000, { min: 60_000, max: 16_000_000, period: 300_000 });
  const clients = Math.round(metric(`${id}.clients`, now, 3, 2, { min: 0, max: 8, period: 900_000 }));
  const daily = Array.from({ length: 30 }, (_, i) => {
    const t = now - (29 - i) * DAY;
    return {
      date: iso(t).slice(0, 10),
      // day-spaced samples need a non-day-rational period or the series
      // aliases into a short visible repeat (see fixtures/tokens.ts)
      rx_bytes: Math.round(metric(`${id}.rx`, t, 6, 4, { min: 0.4, max: 14, period: 37 * DAY }) * 2 ** 30),
      tx_bytes: Math.round(metric(`${id}.tx`, t, 2, 1.5, { min: 0.2, max: 6, period: 37 * DAY }) * 2 ** 30),
    };
  });
  const singbox: SingboxInfo = {
    service_state: 'running',
    version: '1.12.4',
    update_available: false,
    latest_version: null,
    throughput: { up_bps: up, down_bps: down },
    traffic: {
      daily_bytes: 8.2 * 2 ** 30,
      weekly_bytes: 61 * 2 ** 30,
      monthly_bytes: 240 * 2 ** 30,
      total_bytes: 3.8 * 2 ** 40,
    },
    connections: { active: clients * 2 + 1 },
    clients_active: clients,
    traffic_daily: daily,
    cert_expiry: iso(now + 68 * DAY),
    interface: 'eth0',
    protocols: ['vless', 'vmess', 'hy2', 'tuic'],
    subscription: {
      domain: `${id}.example.dev`,
      clash_url: `https://${id}.example.dev/demo0token0not0real/clash`,
      singbox_url: `https://${id}.example.dev/demo0token0not0real/singbox`,
    },
    ...over,
  };
  return {
    v: CONTRACT_VERSION,
    host_id: id,
    hostname: id,
    role,
    taken_at: iso(now - 5_000),
    collector_version: '1.4.2',
    os: { platform: 'linux', release: '5.15.0-113-generic', uptime_sec: 156 * 86_400 },
    cpu: { cores: 2, load1: 0.1, load5: 0.1, load15: 0.05, used_pct: metric(`${id}.cpu`, now, 7, 5) },
    mem: { total_mb: 2_048, used_mb: 700, used_pct: metric(`${id}.mem`, now, 34, 5) },
    disks: [{ mount: '/', total_gb: 40, used_gb: 11, used_pct: 28 }],
    services: probe<ServiceInfo[]>([
      svc('sing-box', 'systemd', 'vpn'),
      svc('fleet-collector', 'systemd-user', 'cockpit'),
    ], now),
    tailscale: { available: false, error: 'off-tailnet box (public VPS)', checked_at: iso(now - 8_000) },
    agents: probe<AgentsInfo>({ herdr_agents: [], claude_procs: 0, codex_procs: 0, tmux_loops: [] }, now),
    zylos: null,
    clauth: null,
    tunnels: null,
    singbox: probe(singbox, now),
    omni: null,
    openclaw: null,
    clauth_usage: null,
    codex_usage: null,
    auth: null,
    mosh: probe({ server_present: false, active_sessions: 0 }, now),
  };
}

// ---------------------------------------------------------------------------
// Fleet assembly
// ---------------------------------------------------------------------------

function host(
  id: HostId,
  display: string,
  role: string,
  ip: string,
  snapshot: HostSnapshot | null,
  over: Partial<FleetHost> = {},
): FleetHost {
  return {
    host_id: id,
    display_name: display,
    role,
    reachable: true,
    expected_flaky: false,
    stale_sec: 6,
    snapshot,
    tailnet_ip: ip,
    ...over,
  };
}

export function buildProblems(now: number): FleetProblem[] {
  return [
    {
      id: 'forge/systemd-user/map-snapshotter/failed',
      severity: 'crit',
      host_id: 'forge',
      source: 'systemd',
      msg: 'map-snapshotter failed (systemd-user)',
      since: iso(now - 47 * MIN),
    },
    {
      id: 'forge/docker/trending-api/unhealthy',
      severity: 'warn',
      host_id: 'forge',
      source: 'docker',
      msg: 'trending-api container unhealthy',
      since: iso(now - 3 * HOUR),
    },
    {
      id: 'basalt/omni/gdrive/stale',
      severity: 'warn',
      host_id: 'basalt',
      source: 'omni',
      msg: 'omni source gdrive stale — last success 9h ago (429 rate limited)',
      since: iso(now - 5 * HOUR),
    },
    {
      id: 'basalt/openclaw/digest-bot/disconnected',
      severity: 'warn',
      host_id: 'basalt',
      source: 'openclaw',
      msg: 'openclaw agent digest-bot telegram disconnected (ETELEGRAM 401)',
      since: iso(now - 7 * HOUR),
    },
    // mirrors the status:2 channel in basalt's newapi fixture — auto-disabled
    // is "the signal worth alarming on" per the contract, so it must appear
    // in problems too or the KPI/alerts tab would contradict the gateways tab
    {
      id: 'basalt/newapi/foundry-east/auto-disabled',
      severity: 'warn',
      host_id: 'basalt',
      source: 'newapi',
      msg: 'newapi channel foundry-east auto-disabled (upstream failing, 1840ms)',
      since: iso(now - 80 * MIN),
    },
  ];
}

export function buildTokensSummary(now: number): TokensSummary {
  return {
    as_of: iso(now - 8 * MIN),
    today_cost_usd: TODAY_COST_USD,
    week_cost_usd: 96.4,
    month_cost_usd: 310.2,
    by_host: [
      { instance_id: 'atlas', cost_usd: 4.1, total_tokens: 8_400_000 },
      { instance_id: 'forge', cost_usd: 6.2, total_tokens: 12_900_000 },
      { instance_id: 'basalt', cost_usd: 3.4, total_tokens: 5_200_000 },
      { instance_id: 'mica', cost_usd: 0.92, total_tokens: 1_100_000 },
    ],
    by_agent: [
      { agent: 'build-bot', today_cost_usd: 1.8, today_tokens: 3_200_000, week_cost_usd: 12.4, week_tokens: 21_000_000, total_cost_usd: 412.6, total_tokens: 690_000_000 },
      { agent: 'review-bot', today_cost_usd: 0.7, today_tokens: 1_100_000, week_cost_usd: 5.1, week_tokens: 8_800_000, total_cost_usd: 168.9, total_tokens: 285_000_000 },
      { agent: 'qa-bot', today_cost_usd: 0.4, today_tokens: 890_000, week_cost_usd: 2.9, week_tokens: 5_400_000, total_cost_usd: 96.3, total_tokens: 154_000_000 },
    ],
    stale_instances: [],
  };
}

function buildEvents(now: number): FleetEvent[] {
  return [
    { ts: iso(now - 2 * MIN), kind: 'status', host_id: 'fleet', msg: 'ok: 5/6 up' },
    { ts: iso(now - 22 * MIN), kind: 'status', host_id: 'fleet', msg: 'ok: 5/6 up' },
    { ts: iso(now - 47 * MIN), kind: 'problem', host_id: 'forge', msg: 'map-snapshotter failed (systemd-user)' },
    { ts: iso(now - 2 * HOUR), kind: 'resolved', host_id: 'vpn-cedar', msg: 'sing-box restart flap cleared' },
    { ts: iso(now - 2.1 * HOUR), kind: 'problem', host_id: 'vpn-cedar', msg: 'sing-box restarting' },
    { ts: iso(now - 3 * HOUR), kind: 'problem', host_id: 'forge', msg: 'trending-api container unhealthy' },
    { ts: iso(now - 6 * HOUR), kind: 'host-down', host_id: 'mica', msg: 'unreachable (asleep-expected)' },
    { ts: iso(now - 9 * HOUR), kind: 'host-up', host_id: 'mica', msg: 'reachable again' },
    { ts: iso(now - 26 * HOUR), kind: 'hub', host_id: 'fleet', msg: 'hub restarted (deploy)' },
  ];
}

export function buildFleetState(now: number): FleetState {
  const hosts: FleetHost[] = [
    host('atlas', 'atlas', 'cockpit · 云雀 · fleet hub', '100.64.0.11', atlasSnapshot(now)),
    host('forge', 'forge', 'agent runner · persona fleet · factorio', '100.64.0.12', forgeSnapshot(now)),
    host('basalt', 'basalt', 'knowledge stack · gateways', '100.64.0.13', basaltSnapshot(now)),
    host('mica', 'mica', 'workstation · thin client', '100.64.0.14', micaSnapshot(now), {
      reachable: false,
      expected_flaky: true,
      stale_sec: 6 * 3600,
    }),
    host('vpn-kiku', 'vpn-kiku', 'VPN · tokyo', '203.0.113.10', singboxSnapshot('vpn-kiku', now, {}, 'VPN · tokyo')),
    host('vpn-cedar', 'vpn-cedar', 'VPN · oregon', '203.0.113.20', singboxSnapshot('vpn-cedar', now, {
      version: '1.12.3',
      update_available: true,
      latest_version: '1.12.4',
      cert_expiry: iso(now + 12 * DAY),
      protocols: ['anytls', 'vmess', 'vless', 'hy2', 'tuic'],
    }, 'VPN · oregon')),
  ];

  const problems = buildProblems(now);
  const expected = hosts.flatMap((h) => h.snapshot?.services.data?.filter((s) => s.expected) ?? []);
  const servicesOk = expected.filter((s) => s.state === 'running').length;

  return {
    hosts,
    problems,
    kpis: {
      hosts_up: hosts.filter((h) => h.reachable).length,
      hosts_total: hosts.length,
      services_ok: servicesOk,
      services_expected: expected.length,
      agents_active: 9,
      problems: problems.length,
      today_cost_usd: TODAY_COST_USD,
    },
    tokens: buildTokensSummary(now),
    endpoints: [
      { name: 'fleet', url: 'https://fleet.example.dev', status: 302, ok: true, latency_ms: 89, checked_at: iso(now - 40_000) },
      { name: 'console', url: 'https://console.example.dev', status: 302, ok: true, latency_ms: 121, checked_at: iso(now - 40_000) },
      { name: 'news', url: 'https://news.example.dev', status: 200, ok: true, latency_ms: 210, checked_at: iso(now - 40_000) },
      { name: 'blog', url: 'https://blog.example.dev', status: 200, ok: true, latency_ms: 178, checked_at: iso(now - 40_000) },
    ],
    events: buildEvents(now),
    radar_newsletter: {
      active: 128,
      pending: 9,
      unsubscribed: 4,
      delivered_total: 3_120,
      failed_total: 2,
      last_send_at: iso(now - 22 * HOUR),
      as_of: iso(now - 3 * MIN),
    },
    blog_newsletter: {
      total: 342,
      confirmed: 301,
      pending: 41,
      subs_7d: 12,
      last_subscribe_at: iso(now - 3 * HOUR),
      as_of: iso(now - 3 * MIN),
    },
  };
}
