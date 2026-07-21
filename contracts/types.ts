/**
 * axfleet shared contracts — the single source of truth for every boundary.
 * In the full system these types are shared by per-host collectors, the hub,
 * the web UI, and a `fleet` CLI; this public demo drives the same TUI from
 * fixture data that satisfies the identical contract.
 */

export const CONTRACT_VERSION = 1 as const;

/** Every hub API response is wrapped in this envelope. */
export interface FleetEnvelope<T> {
  v: typeof CONTRACT_VERSION;
  generated_at: string; // ISO 8601
  data: T;
}

/**
 * Failure-as-value probe result: one dead probe never kills a snapshot.
 * `available:false` + error string; consumers render "unavailable", not crash.
 */
export interface Probe<T> {
  available: boolean;
  data?: T;
  error?: string;
  checked_at: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Host snapshot (collector → hub)
// ---------------------------------------------------------------------------

export type HostId =
  | 'atlas'
  | 'forge'
  | 'basalt'
  | 'mica'
  | 'vpn-kiku'
  | 'vpn-cedar';

export interface HostSnapshot {
  v: typeof CONTRACT_VERSION;
  host_id: HostId;
  hostname: string;
  role: string; // human label, e.g. "cockpit · 云雀 · fleet hub"
  taken_at: string;
  collector_version: string;
  os: { platform: 'linux' | 'darwin'; release: string; uptime_sec: number };
  cpu: { cores: number; load1: number; load5: number; load15: number; used_pct: number };
  mem: { total_mb: number; used_mb: number; used_pct: number };
  disks: Array<{ mount: string; total_gb: number; used_gb: number; used_pct: number }>;
  services: Probe<ServiceInfo[]>;
  tailscale: Probe<TailscaleInfo>;
  agents: Probe<AgentsInfo>;
  /** null on non-zylos hosts */
  zylos: Probe<ZylosInfo> | null;
  /** hub host only; null elsewhere */
  clauth: Probe<ClauthInfo> | null;
  /** hosts running cloudflared; null elsewhere */
  tunnels: Probe<TunnelInfo[]> | null;
  /** sing-box VPN hosts only; null elsewhere */
  singbox: Probe<SingboxInfo> | null;
  /** Factorio game telemetry (game-server hosts only); old collectors omit this key. */
  factorio?: Probe<FactorioInfo> | null;
  /** omni knowledge-stack hosts only; null elsewhere */
  omni: Probe<OmniInfo> | null;
  /** New API gateway hosts only; null elsewhere.
   *  Deploy boundary: pre-upgrade collectors omit the key — read defensively. */
  newapi?: Probe<NewApiInfo> | null;
  /** openclaw gateway hosts only; null elsewhere */
  openclaw: Probe<OpenclawInfo> | null;
  /** hosts whose clauth daemon publishes ~/.clauth/{status,tokens}.json; null elsewhere */
  clauth_usage: Probe<ClauthUsageInfo> | null;
  /** hosts running the codex CLI (~/.codex/sessions); null elsewhere.
   *  Deploy boundary: pre-upgrade collectors omit the key — read defensively. */
  codex_usage?: Probe<CodexUsageInfo> | null;
  /** per-host auth-posture inventory (claude oauth vs setup-token, codex per home).
   *  Deploy boundary: pre-upgrade collectors omit the key — read defensively. */
  auth?: Probe<AuthInfo> | null;
  mosh: Probe<{ server_present: boolean; active_sessions: number }>;
}

export type Supervisor = 'systemd' | 'systemd-user' | 'pm2' | 'docker' | 'launchd' | 'tmux' | 'cron';
export type ServiceState = 'running' | 'stopped' | 'failed' | 'unhealthy' | 'unknown';

export interface ServiceInfo {
  name: string;
  /** Stable identity for duplicate supervisor entries (for PM2: includes PM2_HOME + name).
   *  Optional for deploy compatibility with pre-upgrade collectors. */
  instance_id?: string;
  supervisor: Supervisor;
  state: ServiceState;
  /** true when listed in the host's expected-services config (drives ok/total KPI) */
  expected: boolean;
  uptime_sec?: number;
  restarts?: number;
  memory_mb?: number;
  cpu_pct?: number;
  ports?: number[];
  /** free-form, e.g. docker image, pm2 home, unit description */
  detail?: string;
  /** logical group for UI: zylos | openclaw | omni | newapi | cockpit | infra | news | other */
  group?: string;
}

/** Stable PM2 identity shared by collector output and per-host expectations. */
export function pm2InstanceId(pm2Home: string, name: string): string {
  return `pm2:${pm2Home}:${name}`;
}

/** Identity key for alert/KPI state; legacy snapshots fall back to service name. */
export function serviceInstanceKey(service: Pick<ServiceInfo, 'name' | 'instance_id'>): string {
  return service.instance_id ?? service.name;
}

export interface TailscaleInfo {
  self_ip: string;
  self_online: boolean;
  peers: Array<{
    host_name: string;
    ip: string;
    os: string;
    online: boolean;
    last_seen?: string; // ISO; absent when online
  }>;
}

export interface AgentsInfo {
  /** from `herdr agent list` */
  herdr_agents: Array<{ name: string; kind: string; status: string; session: string }>;
  /** count of live claude/codex CLI processes (excludes herdr-managed dupes is best-effort) */
  claude_procs: number;
  codex_procs: number;
  /** long-running tmux agent loops, e.g. standalone codex sessions.
   *  `agent` is the usage-tracker agent tag (e.g. 'qa-bot') when the
   *  loop maps to a tracked agent — the join key for per-agent token usage.
   *  Absent on untagged loops / pre-upgrade collectors — read defensively. */
  tmux_loops: Array<{ session: string; alive: boolean; since?: string; agent?: string }>;
}

/**
 * Alert floor (minutes) for delivered-but-unanswered user messages: at or above
 * this, problems.ts emits a `zylos-unanswered` warn and the zylos-tab badge goes
 * warn. Single source of truth — both the hub rule and the UI import this so they
 * can't drift. (The probe's 6h collection window is a separate scoping bound.)
 */
export const UNANSWERED_STUCK_MIN = 20;

export interface ZylosInfo {
  root: string;
  personas: Array<{
    id: string;
    display_name: string;
    type: string; // dedicated | user | group
    enabled: boolean;
    runtime: 'claude' | 'codex' | string;
    /** Active named runtime tier from instances.json (additive; absent on old collectors). */
    runtime_profile?: string;
    /** Last automatic/manual tier transition metadata, when recorded by Zylos. */
    runtime_profile_changed_at?: string;
    runtime_profile_change_reason?: string;
    /** Stable pane identity; it intentionally does not change across runtime tiers. */
    tmux_session?: string;
    tmux_alive: boolean;
    status?: string; // from per-persona activity-monitor/<id>/agent-status.json when present
    idle_min?: number;
    context_pct?: number;
    today_cost_usd?: number;
    week_cost_usd?: number;
    /**
     * today/week TOTAL tokens (cache-inclusive) from token-cache.json daily
     * buckets. This is the meaningful activity signal for subscription-plan
     * agents whose cost_usd is $0 (no per-token billing) — the `today` column
     * renders tokens, appending cost only when > 0. UTC-day keyed to match the
     * writer (update-token-cache.js). Absent ⇒ cache has no entry for today.
     */
    today_tokens?: number;
    week_tokens?: number;
    /** Azure API profile-only usage; cost is a LiteLLM-price equivalent estimate, not invoice spend. */
    api_today_tokens?: number;
    api_week_tokens?: number;
    api_today_equiv_cost_usd?: number;
    api_week_equiv_cost_usd?: number;
    /**
     * Last real (non system/scheduler) message timestamps from c4.db comm-bridge,
     * ISO-8601 UTC. `last_inbound_at` = newest message routed TO this persona
     * (inbound rows carry target_instance). `last_outbound_at` = newest reply on
     * any of the persona's chat_ids — outbound rows carry a BLANK target_instance,
     * so they are mapped to the persona by chat id (instances.json chat_ids is the
     * authoritative owner, since one chat can appear under several historical
     * target_instances). Absent ⇒ no comm-bridge db / query unavailable / no such
     * message.
     */
    last_inbound_at?: string | null;
    last_outbound_at?: string | null;
    /**
     * Delivered-but-unanswered user messages (c4.db comm-bridge): distinct
     * endpoints whose most-recent delivered user inbound (last 6h) has no
     * outbound reply since — the "agent went silent under traffic" signal
     * this field surfaces. Absent ⇒ no comm-bridge db / query unavailable.
     */
    unanswered?: number;
    /** age (minutes) of the oldest such waiting endpoint; drives the alert. */
    oldest_unanswered_min?: number;
  }>;
  /** provider quota windows from provider-usage.json, when present */
  provider_windows?: Array<{
    provider: string;
    window: string; // e.g. "5h" | "7d"
    used_pct: number;
    resets_at?: string;
  }>;
  scheduler_upcoming: number;
  console_url?: string; // per-box web-console deep link
}

export interface ClauthInfo {
  active_profile: string;
  profiles: Array<{
    name: string;
    auth_status: string; // ok | auth_broken | ...
    five_hour_pct?: number;
    seven_day_pct?: number;
    threshold?: number;
  }>;
}

export interface TunnelInfo {
  name: string;
  state: ServiceState;
  ingress: Array<{ hostname: string; service: string }>;
}

export interface SingboxInfo {
  service_state: ServiceState;
  version: string | null;
  update_available: boolean;
  latest_version: string | null;
  throughput: { up_bps: number; down_bps: number };
  traffic: { daily_bytes: number; weekly_bytes: number; monthly_bytes: number; total_bytes: number };
  /** active raw socket count (inbound + outbound) — ≈2× connected clients; see countSingboxSockets */
  connections: { active: number };
  /**
   * distinct client IPs currently connected. Source: sing-box clash_api
   * /connections (exact, covers QUIC/UDP) with an ss TCP-peer fallback
   * (undercounts hy2/tuic). null = neither source available.
   */
  clients_active: number | null;
  /** last-30d per-day rx/tx from vnstat (same --json call as the totals) */
  traffic_daily: Array<{ date: string; rx_bytes: number; tx_bytes: number }>;
  cert_expiry: string | null; // ISO 8601, null if no cert
  interface: string | null;
  /** enabled inbound protocols — configured per host, not probed */
  protocols: string[];
  /** shareable subscription links (from the box's nginx sub site + .sub_token); null when unreadable */
  subscription: { domain: string; clash_url: string; singbox_url: string } | null;
}

export type FactorioPlayers =
  | { complete: true; active: number; max: number; checked_at: string }
  | { complete: false; active: null; max: number; checked_at: string };

export interface FactorioInfo {
  server_name: string;
  game_version: string;
  started_at: string;
  players: FactorioPlayers;
  save: { loaded_file: string; map_version: string | null };
  mods: Array<{ name: string; version: string; builtin: boolean }>;
}

/**
 * omni sync-staleness thresholds — shared by the hub problem rule AND the
 * web/tui state badges so they can't drift (same pattern as
 * UNANSWERED_STUCK_MIN). An active source is stale after MULT× its own
 * interval (floored at FLOOR_MS); older than CRIT_MS is the notion-class
 * outage and pages as crit.
 */
export const OMNI_SYNC_STALE = {
  MULT: 3,
  FLOOR_MS: 2 * 60 * 60 * 1000,
  /** crit floor — the effective crit threshold is max(CRIT_MS, 2× the warn
   *  threshold) so a daily-cadence source can't page during normal operation
   *  and crit can never fire before warn (2026-07-12 review catch) */
  CRIT_MS: 24 * 60 * 60 * 1000,
  /** never-succeeded sources escalate warn → crit at this failure streak */
  CRIT_FAILS: 10,
  /** a status=running sync whose last_activity_at is within this window is
   *  ACTIVELY progressing (→ `syncing`, no page); older than it is `stuck`.
   *  ONE threshold, shared by the classifier's liveness gate and the probe's
   *  stuck_runs count. (The classifier measures it against the collector clock on a
   *  frozen snapshot, the probe against Postgres now(); near the boundary they can
   *  disagree by the snapshot age, but only ever escalating syncing→dead, never the
   *  reverse — so the skew can't hide a source.) */
  STUCK_MIN: 30,
  /** upper bound on how long `syncing` may suppress a dead/stale alert. last_activity_at
   *  is an UNVERIFIED liveness signal owned by omni (it may tick on retries, not only on
   *  real indexing) — so a heartbeating-but-wedged run can't hide forever: past this age
   *  a would-be-dead source degrades to `stale` (warn — surfaced, never a page, never
   *  silently green). A legit first-ever backfill finishes well inside this window. */
  SYNCING_MAX_MS: 7 * 24 * 60 * 60 * 1000,
} as const;

export type OmniSourceHealth =
  | 'ok'
  | 'flaky'
  | 'syncing'
  | 'stale'
  | 'dead'
  | 'never-synced'
  | 'pending'
  | 'off';

/**
 * THE omni source-state classifier — hub alert rule, web badge, and tui glyph
 * all call this one function, so severity and render can't drift (they did,
 * three ways, when each surface hand-rolled the thresholds).
 *
 *   off          is_active=false — deliberately disabled, never alerts
 *   pending      never ran / never failed yet — new connector warming up
 *   never-synced no success ever + latest run failed (warn; crit ≥ CRIT_FAILS streak)
 *   ok           fresh success
 *   flaky        fresh success but the latest run failed (render-only, no alert)
 *   syncing      a run is in progress and actively advancing (fresh last_activity_at)
 *                — render-only, no alert, EVEN past the stale/crit windows. This is
 *                what a legitimate long first-ever backfill looks like; without it a
 *                >24h crawl trips `dead` and pages while nothing is wrong. Bounded by
 *                SYNCING_MAX_MS: a run that heartbeats past it degrades to `stale`
 *                (warn) so a wedged-but-heartbeating run can't be masked forever.
 *   stale        no success for max(MULT×interval, FLOOR) — warn
 *   dead         no success for max(CRIT_MS, 2×warn-threshold) — crit, pages
 */
export function omniSourceHealth(s: OmniInfo['sources'][number], now: number): OmniSourceHealth {
  if (!s.active) return 'off';
  // A run is "actively progressing" only when it is running AND its last_activity_at
  // is within the stuck window — the same threshold the probe's stuck_runs uses, so
  // there is ONE definition of a live run. Gating on FRESH activity (not merely
  // status=running) is what keeps a genuinely stuck run falling through to dead.
  const activelyProgressing =
    s.last_run_status === 'running' &&
    s.active_run_activity_at !== null &&
    now - Date.parse(s.active_run_activity_at) < OMNI_SYNC_STALE.STUCK_MIN * 60_000;
  if (s.last_success_at === null) {
    // A first-ever backfill that is advancing reads `syncing` (no page). KNOWN LIMIT:
    // with no last_success there is no age to bound against, so this path is capped
    // only by the run failing or its heartbeat going stale — a first sync that
    // heartbeats without progress stays `syncing`. Lower-stakes than a previously
    // healthy source (this only hides a source that never had data); a duration cap
    // here needs the run's start time as a new field. Tracked, not fixed here.
    if (activelyProgressing) return 'syncing';
    return s.last_run_status === 'failed' ? 'never-synced' : 'pending';
  }
  const age = now - Date.parse(s.last_success_at);
  if (!Number.isFinite(age)) return 'ok'; // unparseable timestamp — benign, parser nulls these anyway
  const warnAfter = Math.max((s.sync_interval_sec ?? 3600) * 1000 * OMNI_SYNC_STALE.MULT, OMNI_SYNC_STALE.FLOOR_MS);
  const critAfter = Math.max(OMNI_SYNC_STALE.CRIT_MS, 2 * warnAfter);
  // An in-flight, advancing sync means the source is doing work right now — "no recent
  // success" must not read as dead/stale WHILE it progresses. But cap the masking: past
  // SYNCING_MAX_MS the heartbeat is no longer trusted and the source degrades to `stale`
  // (warn — surfaced, never a page), so a wedged-but-heartbeating run still surfaces.
  if (age > warnAfter && activelyProgressing) return age > OMNI_SYNC_STALE.SYNCING_MAX_MS ? 'stale' : 'syncing';
  if (age > critAfter) return 'dead';
  if (age > warnAfter) return 'stale';
  if (s.last_run_status === 'failed') return 'flaky';
  return 'ok';
}

/**
 * omni indexing health (knowledge-stack docker hosts) — the "service is up but
 * broken" detector. Container up/down lives in the services probe; THIS is
 * per-source sync freshness (the class of failure where a connector sits
 * circuit-broken for a month unnoticed), embedding-queue backlog, and stuck
 * sync runs. Sourced from two bounded psql queries against the stack's
 * postgres: small-table source/run health, then capped/indexable document and
 * embedding-queue statistics.
 */
/** New API gateway status codes for a channel (calciumion/new-api `channels.status`). */
export const NEWAPI_CHANNEL_STATUS: Record<number, string> = {
  1: 'enabled',
  2: 'auto-disabled', // upstream failed → New API auto-disabled it (the alarmable state)
  3: 'disabled', // manually disabled (deliberate)
};

/**
 * New API gateway health. `reachable` = the HTTP layer answered
 * GET :port/api/status (the container being up ≠ the app serving). `channels`
 * are the upstream provider routes; `status===2` (auto-disabled) means New API
 * tripped a provider offline — that is the signal worth alarming on.
 */
export interface NewApiInfo {
  reachable: boolean;
  channels: Array<{
    id: number;
    name: string;
    type: number; // New API provider type (1=OpenAI-wire, 14=Anthropic, 24=Gemini, …)
    status: number; // see NEWAPI_CHANNEL_STATUS
    response_time_ms: number; // last test latency; 0 = never tested
  }>;
}

export interface OmniInfo {
  sources: Array<{
    name: string;
    source_type: string;
    /** is_active — false = deliberately disabled connector: shown dim, never alerts */
    active: boolean;
    sync_interval_sec: number | null;
    /** completion time of the newest completed full/incremental document sync; null = never succeeded */
    last_success_at: string | null;
    /** status of the newest full/incremental document sync; null = never ran */
    last_run_status: string | null;
    last_run_at: string | null;
    /** last_activity_at of the newest running full/incremental document sync;
     *  null = no scheduled-slot run in flight. Fresh (< STUCK_MIN) ⇒ the
     *  source is actively backfilling → `syncing`, not dead. Long-lived
     *  realtime watchers use a separate Omni slot and are excluded here. */
    active_run_activity_at: string | null;
    /** error_message of the newest failed full/incremental run since last success (truncated) */
    last_error: string | null;
    /** failed full/incremental runs since the last success — a growing streak ≈ breaker heading open */
    failed_since_success: number;
    /** true when failed_since_success is a lower bound capped for cheap health polling */
    failed_since_success_capped?: boolean;
    /** indexed documents attributed to this source */
    docs: number;
    /** true when docs is a lower bound capped for cheap health polling */
    docs_capped?: boolean;
  }>;
  /** embedding_queue rows by status; failed_recent = failed rows updated in the last hour */
  queue: { pending: number; processing: number; failed: number; failed_recent: number };
  /** true per field when the corresponding queue count is a lower bound */
  queue_capped?: { pending: boolean; processing: boolean; failed: boolean; failed_recent: boolean };
  /** sync_runs stuck in status=running with last_activity_at older than OMNI_SYNC_STALE.STUCK_MIN */
  stuck_runs: number;
  docs_total: number;
  /** docs_total comes from PostgreSQL planner statistics, not a full-table count */
  docs_total_estimated?: boolean;
}

/**
 * openclaw gateway + per-agent health. Sourced from `openclaw health
 * --json` + `agents list --json` + systemd MemoryCurrent — catches the incident
 * classes that "unit is active" misses: telegram bot silently disconnected,
 * plugin configured-but-not-installed, gateway memory creep, event-loop stall.
 */
export interface OpenclawInfo {
  /** from the systemd unit Description, e.g. "2026.6.11"; null if unparsable */
  version: string | null;
  gateway: {
    /** `openclaw health` returned ok:true */
    ok: boolean;
    event_loop_degraded: boolean;
    /** systemd MemoryCurrent; 1536 MB is the memory-creep alarm threshold */
    rss_mb: number | null;
    nrestarts: number | null;
    sessions: number | null;
    heartbeat_seconds: number | null;
  };
  /** null = health call failed (gateway down/unreachable) — unknown, not zero */
  plugins: { loaded: number; errors: string[] } | null;
  agents: Array<{
    id: string; // agent id == telegram accountId (default account ⇒ the isDefault agent)
    name: string; // identityName
    model: string | null;
    is_default: boolean;
    /** telegram bot channel state; null = no bot account bound / health unavailable */
    bot: null | {
      enabled: boolean;
      connected: boolean;
      running: boolean;
      last_error: string | null;
      reconnect_attempts: number;
      token_status: string | null;
      last_inbound_at: string | null;
      last_outbound_at: string | null;
    };
  }>;
  /** null = cron list unavailable — unknown, not zero */
  cron: { total: number; enabled: number } | null;
}

/**
 * AI-account usage from the clauth daemon's published feeds
 * (~/.clauth/status.json + tokens.json, both schema 1) — read as files, zero
 * coupling to the clauth daemon itself (same contract ccu renders). tokens is
 * null when the daemon predates the tokens feed.
 */
export interface ClauthUsageInfo {
  /** status.json schema === 1; false ⇒ UI renders "update fleet parser", not a misparse */
  schema_ok: boolean;
  generated_at: string | null;
  clauth_version: string | null;
  active_profile: string | null;
  fallback_chain: string[];
  forecast: { action: string; to: string | null } | null;
  last_error: string | null;
  /** feed age > 3× the daemon's refresh interval (min 5min) at probe time */
  stale: boolean;
  profiles: Array<{
    name: string;
    active: boolean;
    tier: string | null;
    email: string | null;
    auth_status: string; // ok | expiring | auth_broken | ...
    fetch_status: string | null; // Fresh | RateLimited | ...
    windows: Array<{ label: string; used_pct: number; resets_at: string | null }>;
  }>;
  tokens: null | {
    generated_at: string | null;
    /** daemon-published order: today / week / month / lifetime (absent keys skipped) */
    periods: Array<{
      key: string;
      total_tokens: number; // cache-inclusive total (ccu headline convention)
      cost_usd: number;
      /** cost_is_floor || !complete ⇒ render with a trailing '+' */
      floor: boolean;
      models: Array<{ display: string; total_tokens: number; cost_usd: number }>;
    }>;
  };
}

/**
 * Codex (OpenAI) account usage, read passively from codex's own session logs
 * (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`): every `token_count`
 * event embeds a full rate-limit snapshot — 5h/7d `used_percent`, reset
 * instants, plan tier. No daemon, no auth.json, no network (same source ccu
 * renders; mechanics in clauth `docs/codex-support/feasibility.md` §2.5–2.6).
 * The snapshot only refreshes while codex runs on that host, so consumers
 * MUST surface `snapshot_at` age instead of treating old data as live; a
 * window whose `resets_at` has passed reads as ~0% now, not its stored pct.
 * Unlike clauth profiles, codex feeds are NOT merged across hosts — each
 * host may hold a different ChatGPT login (work vs personal), and the
 * snapshot carries no account identity to dedupe on.
 */
export interface CodexUsageInfo {
  /** the newest token_count line's own timestamp; null = sessions exist but no snapshot found */
  snapshot_at: string | null;
  plan_type: string | null;
  /** which window tripped the limit ('primary' | 'secondary'), null when none.
   *  Kept as the raw kind — display decides whether the claim still applies
   *  (a limit whose own window has since reset is dead information; see
   *  codexStillLimited in lib/codex-view). */
  rate_limit_reached_type: string | null;
  /** '5h' (primary) / '7d' (secondary); resets_at normalized to ISO 8601 */
  windows: Array<{ label: string; used_pct: number; resets_at: string | null }>;
}

/**
 * Auth-posture inventory per host (bookkeeping): how each AI runtime on the box
 * authenticates — read-only from local credential files, no network.
 *  - claude: `oauth` = an interactive Claude login (rotating, has a refresh
 *    token, short expiry) vs `setup-token` = a long-lived `claude setup-token`
 *    (no refresh token, ~1yr expiry, minimal scopes — the pinned non-rotating
 *    posture used on unattended remote hosts). Typical model: workstation =
 *    oauth, all remotes = setup-token.
 *  - codex: one entry per codex HOME on the box — the default `~/.codex` plus
 *    each isolated agent home. `chatgpt` = a ChatGPT-subscription login;
 *    `apikey` = an API key. `label` is 'default' or the agent dir name.
 */
export interface AuthInfo {
  claude: {
    method: 'oauth' | 'setup-token';
    subscription: string | null; // 'max' / 'pro' / null (from creds subscriptionType)
    expires_at: string | null;   // ISO — for a setup-token, the ~1yr expiry worth watching
    days_to_expiry: number | null;
  } | null;
  codex: Array<{
    label: string; // 'default' or the isolated agent dir name (e.g. 'qa-bot')
    method: 'chatgpt' | 'apikey';
  }>;
}

// ---------------------------------------------------------------------------
// Fleet state (hub → web/CLI/agents)
// ---------------------------------------------------------------------------

export interface FleetState {
  hosts: FleetHost[];
  problems: FleetProblem[];
  kpis: FleetKpis;
  tokens: TokensSummary;
  /** hub-side HTTP checks of the public ingress endpoints (status-wall SERVICE HEALTH) */
  endpoints: EndpointHealth[];
  /** recent state transitions, newest first (status-wall ROLLING LOG) */
  events: FleetEvent[];
  /**
   * News-site newsletter rollup. Absent on pre-upgrade hubs and when the
   * newsroom DB client is unset — cross the hub/web deploy boundary by
   * reading it defensively (`state.radar_newsletter` may be undefined).
   */
  radar_newsletter?: RadarNewsletter;
  /**
   * Blog newsletter rollup. Absent on pre-upgrade hubs and when the
   * blog DB client is unset — read defensively across the deploy boundary.
   */
  blog_newsletter?: BlogNewsletter;
}

export interface EndpointHealth {
  name: string; // e.g. "fleet", "console"
  url: string;
  /** HTTP status (302 = Access-gated OK); 0 = network failure */
  status: number;
  ok: boolean; // any response < 500
  latency_ms: number | null;
  checked_at: string;
}

export interface FleetEvent {
  ts: string;
  /** 'status' = periodic hub heartbeat line ("ok: <up>/<total> up") */
  kind: 'host-up' | 'host-down' | 'problem' | 'resolved' | 'hub' | 'status';
  host_id: HostId | 'fleet';
  msg: string;
}

export interface FleetHost {
  host_id: HostId;
  display_name: string;
  role: string;
  reachable: boolean;
  /** the workstation sleeps by design: unreachable ⇒ 'asleep-expected', not a problem */
  expected_flaky: boolean;
  stale_sec: number | null; // age of last good snapshot; null = never seen
  snapshot: HostSnapshot | null;
  tailnet_ip: string;
}

export type ProblemSeverity = 'crit' | 'warn' | 'info';

export interface FleetProblem {
  id: string; // stable dedupe key, e.g. "forge/systemd-user/api-gateway/failed"
  severity: ProblemSeverity;
  host_id: HostId | 'fleet';
  source: string; // systemd | pm2 | docker | disk | mem | collector | tailscale | clauth | tokens | ...
  msg: string;
  since: string; // ISO — first time hub observed it
}

export interface FleetKpis {
  hosts_up: number;
  hosts_total: number;
  services_ok: number;
  services_expected: number;
  agents_active: number;
  problems: number;
  today_cost_usd: number | null;
}

// ---------------------------------------------------------------------------
// Sent notifications (hub → lark-cli out-of-band DM; persisted, /api/notifications)
// ---------------------------------------------------------------------------

/**
 * One alert the hub pushed to the operator out-of-band via lark-cli (the bot DM
 * channel, independent of the fleet's own feishu bot — which may itself be the
 * thing that's down). Persisted append-only so the web "alerts" tab and `fleet
 * events` can show what was sent, whether it landed, and the lark message id.
 */
export interface SentNotification {
  /** stable per-incident key: `${problem_id}@${problem.since}` (also the lark idempotency key) */
  id: string;
  ts: string; // ISO — when the hub sent it
  severity: ProblemSeverity;
  host_id: HostId | 'fleet';
  problem_id: string;
  source: string;
  msg: string;
  channel: 'lark';
  /** true when lark-cli reported ok; false ⇒ send failed (see error) */
  delivered: boolean;
  lark_message_id: string | null;
  error?: string;
  /**
   * Set by /api/notifications at serve time (NOT persisted): true once this
   * page's problem_id is no longer among the hub's current active problems —
   * i.e. the paged condition has cleared. Absent on the stored row and on
   * pre-upgrade hubs; render an undefined value as "active" (never resolved).
   */
  resolved?: boolean;
}

/**
 * Annotate sent notifications with live resolution: a page is `resolved` once
 * its problem_id is no longer among the hub's currently-active problems. Pure —
 * the hub calls it once at /api/notifications serve time so web, TUI, and the
 * `fleet events` CLI all render one server-computed flag, with no client-side
 * reclassification that could drift on a stale bundle.
 */
export function markResolved(
  rows: readonly SentNotification[],
  activeProblemIds: ReadonlySet<string>,
): SentNotification[] {
  return rows.map((n) => ({ ...n, resolved: !activeProblemIds.has(n.problem_id) }));
}

// ---------------------------------------------------------------------------
// Tokens (hub ← the token tracker's usage DB)
// ---------------------------------------------------------------------------

export type TokenRange = 'today' | '7d' | '30d' | '90d' | 'all';

export interface TokensSummary {
  /** max(collected_at) across instances — honesty badge for ≤6h collection lag */
  as_of: string | null;
  today_cost_usd: number | null;
  week_cost_usd: number | null;
  month_cost_usd: number | null;
  by_host: Array<{ instance_id: string; cost_usd: number; total_tokens: number }>;
  /**
   * Per-agent usage from the token tracker's daily rollups (today +
   * trailing-7d cost/tokens), joined into the Agents view by loop tag. Empty
   * until the tracker writes agent-tagged rows (e.g. agent='qa-bot');
   * an empty array is the correct steady state, not an error.
   */
  by_agent: Array<{
    agent: string;
    today_cost_usd: number;
    today_tokens: number;
    week_cost_usd: number;
    week_tokens: number;
    /** all-time sums (no date filter); cost_usd is LiteLLM-priced = API-equivalent spend */
    total_cost_usd: number;
    total_tokens: number;
  }>;
  stale_instances: string[]; // instances_v2.status != healthy or last_collect_at > 30h
}

export interface TokensDetail {
  range: TokenRange;
  as_of: string | null;
  totals: { cost_usd: number; total_tokens: number; messages: number };
  /** whole-history totals (no date filter), independent of `range`; null without a usage DB */
  all_time: { cost_usd: number; total_tokens: number } | null;
  by_host: Array<{ instance_id: string; cost_usd: number; total_tokens: number }>;
  by_client: Array<{ client: string; cost_usd: number; total_tokens: number }>;
  by_model: Array<{
    model: string;
    /** Compatibility display string; multiple contributing harnesses are joined. */
    client: string;
    harnesses?: string[];
    cost_usd: number;
    total_tokens: number;
  }>;
  /** top workspaces by total tokens in range (merged across per-client key
   *  formats hub-side); attributed rows only, capped at 20 */
  by_workspace: Array<{ workspace: string; cost_usd: number; total_tokens: number }>;
  daily: Array<{ date: string; cost_usd: number; total_tokens: number }>;
  /** last-48h intraday burn from usage_events_v2 hour buckets (first UI on this data) */
  hourly: Array<{ ts: string; cost_usd: number; total_tokens: number; instance_id: string }>;
  /** hours where cost > 3× the 30d same-hour average */
  spikes: Array<{ ts: string; cost_usd: number; baseline_usd: number }>;
}

// ---------------------------------------------------------------------------
// News newsletter (hub ← the news site's own DB)
// ---------------------------------------------------------------------------

/**
 * Newsletter subscriber + delivery rollup for the news site. The hub polls
 * the newsroom's OWN DB directly — a second client, distinct from the token
 * tracker's — aggregating `newsletter_subscribers` by status and
 * `newsletter_email_sends` by outcome (mirrors the TokensProvider pattern).
 *
 * Every field is nullable: a null newsroom client (creds unset) OR a failed query
 * yields all-null with `as_of` null — never an error, never a frozen poll cycle
 * (failure-as-value, exactly like TokensSummary).
 */
export interface RadarNewsletter {
  /** newsletter_subscribers with status='active' (confirmed, opted in) */
  active: number | null;
  /** status='pending' (double-opt-in confirmation not yet clicked) */
  pending: number | null;
  /** status='unsubscribed' */
  unsubscribed: number | null;
  /** newsletter_email_sends rows with status='sent' */
  delivered_total: number | null;
  /** newsletter_email_sends rows with status='failed' */
  failed_total: number | null;
  /** ISO of max(sent_at) across all sends (sent_at is a ms-epoch INTEGER); null when none */
  last_send_at: string | null;
  /** hub poll time (ISO); null when the newsroom client is unset */
  as_of: string | null;
}

// ---------------------------------------------------------------------------
// Blog newsletter (hub ← the blog's own DB)
// ---------------------------------------------------------------------------

/**
 * Newsletter subscriber rollup for the blog. Third independent DB client —
 * aggregating the blog's `subscribers` table by status (pending|confirmed,
 * double opt-in) and `subscribe_events` for recent momentum. Same
 * failure-as-value + all-nullable contract as RadarNewsletter.
 */
export interface BlogNewsletter {
  /** all subscribers rows */
  total: number | null;
  /** status='confirmed' (clicked the double-opt-in link, in Resend audience) */
  confirmed: number | null;
  /** status='pending' (confirmation not yet clicked) */
  pending: number | null;
  /** subscribe_events with event='subscribe' in the last 7 days */
  subs_7d: number | null;
  /** ISO of max(at) across subscribe events; null when none */
  last_subscribe_at: string | null;
  /** hub poll time (ISO); null when the blog client is unset */
  as_of: string | null;
}

// ---------------------------------------------------------------------------
// Agents view (hub /api/agents — flattened cross-host)
// ---------------------------------------------------------------------------

export interface AgentsView {
  zylos: Array<ZylosInfo['personas'][number] & { host_id: HostId; console_url: string | null }>;
  herdr: Array<AgentsInfo['herdr_agents'][number] & { host_id: HostId }>;
  /** tmux loops flattened per host; per-agent token fields are attached from
   *  TokensSummary.by_agent when the loop's `agent` tag matches (absent otherwise). */
  loops: Array<
    AgentsInfo['tmux_loops'][number] & {
      host_id: HostId;
      today_tokens?: number;
      today_cost_usd?: number;
      week_tokens?: number;
      week_cost_usd?: number;
    }
  >;
  openclaw: Array<{ host_id: HostId; name: string; state: ServiceState }>;
  /** per-agent openclaw status (bot connectivity etc.) from the openclaw probe;
   *  [] until the host's collector ships it (deploy-boundary: read defensively) */
  openclaw_agents: Array<OpenclawInfo['agents'][number] & { host_id: HostId }>;
  /** openclaw gateway rollup per host running one */
  openclaw_gateway: Array<{
    host_id: HostId;
    version: string | null;
    ok: boolean;
    event_loop_degraded: boolean;
    rss_mb: number | null;
    plugin_errors: string[];
    cron_enabled: number;
    cron_total: number;
    sessions: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// Singbox view (hub /api/singbox — flattened per sing-box VPN host)
// ---------------------------------------------------------------------------

export type SingboxView = Array<
  SingboxInfo & { host_id: HostId; display_name: string; reachable: boolean }
>;

// ---------------------------------------------------------------------------
// Accounts view (hub /api/accounts — clauth usage feeds flattened per host)
// ---------------------------------------------------------------------------

export type AccountsView = Array<
  ClauthUsageInfo & { host_id: HostId; display_name: string; reachable: boolean; checked_at: string }
>;

// ---------------------------------------------------------------------------
// Codex view (hub /api/codex — codex usage flattened per host, NOT deduped:
// hosts may hold different ChatGPT logins and the feed carries no identity)
// ---------------------------------------------------------------------------

export type CodexView = Array<
  CodexUsageInfo & { host_id: HostId; display_name: string; reachable: boolean; checked_at: string }
>;

// ---------------------------------------------------------------------------
// Auth view (hub /api/auth — auth-posture probe flattened per host)
// ---------------------------------------------------------------------------
export type AuthView = Array<
  AuthInfo & { host_id: HostId; display_name: string; reachable: boolean; checked_at: string }
>;

// ---------------------------------------------------------------------------
// Omni view (hub /api/omni — omni probe flattened per host)
// ---------------------------------------------------------------------------

export type OmniView = Array<
  OmniInfo & {
    host_id: HostId;
    display_name: string;
    reachable: boolean;
    checked_at: string;
    /** Additive v1 probe status. Absent means an older hub; false means the
     * flattened OmniInfo is retained last-good (or an explicit empty shell). */
    probe_available?: boolean;
    probe_error?: string | null;
    data_stale?: boolean;
  }
>;

// ---------------------------------------------------------------------------
// New API view (hub /api/newapi — newapi probe flattened per host)
// ---------------------------------------------------------------------------
export type NewApiView = Array<
  NewApiInfo & { host_id: HostId; display_name: string; checked_at: string }
>;

// ---------------------------------------------------------------------------
// History (hub sqlite → sparklines)
// ---------------------------------------------------------------------------

export interface HostHistory {
  host_id: HostId;
  /** 5-min buckets, 48h retention. up_bps/down_bps/clients are always emitted
   *  by every producer but are null for non-sing-box hosts (not recorded). */
  points: Array<{
    ts: string;
    cpu_pct: number;
    mem_pct: number;
    reachable: boolean;
    up_bps: number | null;
    down_bps: number | null;
    /** distinct connected VPN client IPs (sing-box hosts only) */
    clients: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

/** event: "fleet" — full FleetState refresh; event: "problems" — problems[] only */
export type SseEventName = 'fleet' | 'problems';
