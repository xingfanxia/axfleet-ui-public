/**
 * Pure view-model builders — flatten per-host snapshots into the shapes each
 * tab renders. In the full system these live beside the hub's HTTP routes so
 * the web UI and the TUI share one flattening; here they run in-process over
 * fixture data. Every builder is pure: (hosts[, tokens]) → view.
 */
import type {
  AccountsView,
  AgentsView,
  AuthView,
  CodexView,
  FleetHost,
  NewApiView,
  OmniView,
  SingboxView,
  TokensSummary,
} from '../contracts/types';

/** Flatten personas + herdr agents + tmux loops + openclaw services/agents across hosts.
 *  `tokens` (optional) joins per-agent usage onto tmux loops by their `agent` tag —
 *  absent ⇒ loops carry no token fields (the pre-token-tracker steady state). */
export function buildAgentsView(hosts: FleetHost[], tokens?: TokensSummary): AgentsView {
  const view: AgentsView = {
    zylos: [], herdr: [], loops: [], openclaw: [], openclaw_agents: [], openclaw_gateway: [],
  };
  const byAgent = new Map<string, TokensSummary['by_agent'][number]>();
  for (const a of tokens?.by_agent ?? []) byAgent.set(a.agent, a);
  for (const host of hosts) {
    const snap = host.snapshot;
    if (!snap) continue;
    if (snap.zylos && snap.zylos.available && snap.zylos.data) {
      const console_url = snap.zylos.data.console_url ?? null; // per-box console deep link
      for (const p of snap.zylos.data.personas) view.zylos.push({ ...p, host_id: host.host_id, console_url });
    }
    if (snap.agents.available && snap.agents.data) {
      for (const a of snap.agents.data.herdr_agents) view.herdr.push({ ...a, host_id: host.host_id });
      for (const l of snap.agents.data.tmux_loops) {
        const t = l.agent ? byAgent.get(l.agent) : undefined;
        view.loops.push({
          ...l,
          host_id: host.host_id,
          ...(t
            ? {
                today_tokens: t.today_tokens,
                today_cost_usd: t.today_cost_usd,
                week_tokens: t.week_tokens,
                week_cost_usd: t.week_cost_usd,
              }
            : {}),
        });
      }
    }
    if (snap.services.available && snap.services.data) {
      for (const s of snap.services.data) {
        if (s.group === 'openclaw') view.openclaw.push({ host_id: host.host_id, name: s.name, state: s.state });
      }
    }
    // deploy boundary: pre-openclaw collectors ship snapshots without the key
    const oc = snap.openclaw;
    if (oc?.available && oc.data) {
      for (const a of oc.data.agents) view.openclaw_agents.push({ ...a, host_id: host.host_id });
      view.openclaw_gateway.push({
        host_id: host.host_id,
        version: oc.data.version,
        ok: oc.data.gateway.ok,
        event_loop_degraded: oc.data.gateway.event_loop_degraded,
        rss_mb: oc.data.gateway.rss_mb,
        plugin_errors: oc.data.plugins?.errors ?? [],
        cron_enabled: oc.data.cron?.enabled ?? 0,
        cron_total: oc.data.cron?.total ?? 0,
        sessions: oc.data.gateway.sessions,
      });
    }
  }
  return view;
}

/** Flatten each clauth-usage feed into a per-host accounts row. */
export function buildAccountsView(hosts: FleetHost[]): AccountsView {
  const view: AccountsView = [];
  for (const host of hosts) {
    const cu = host.snapshot?.clauth_usage; // deploy boundary: may be absent entirely
    if (!cu?.available || !cu.data) continue;
    view.push({
      ...cu.data,
      host_id: host.host_id,
      display_name: host.display_name,
      reachable: host.reachable,
      checked_at: cu.checked_at,
    });
  }
  return view;
}

/** Flatten each codex-usage feed into a per-host row — NOT deduped across
 *  hosts (each may hold a different ChatGPT login; the feed has no identity). */
export function buildCodexView(hosts: FleetHost[]): CodexView {
  const view: CodexView = [];
  for (const host of hosts) {
    const cx = host.snapshot?.codex_usage; // deploy boundary: may be absent entirely
    if (!cx?.available || !cx.data) continue;
    view.push({
      ...cx.data,
      host_id: host.host_id,
      display_name: host.display_name,
      reachable: host.reachable,
      checked_at: cx.checked_at,
    });
  }
  return view;
}

/** Flatten each auth-posture probe into a per-host row (skip hosts with nothing
 *  to report — no claude creds AND no codex homes). */
export function buildAuthView(hosts: FleetHost[]): AuthView {
  const view: AuthView = [];
  for (const host of hosts) {
    const au = host.snapshot?.auth; // deploy boundary: may be absent entirely
    if (!au?.available || !au.data) continue;
    if (!au.data.claude && au.data.codex.length === 0) continue; // nothing to show
    view.push({
      ...au.data,
      host_id: host.host_id,
      display_name: host.display_name,
      reachable: host.reachable,
      checked_at: au.checked_at,
    });
  }
  return view;
}

/** Flatten each omni probe into a per-host omni view row. */
export function buildOmniView(hosts: FleetHost[]): OmniView {
  const view: OmniView = [];
  for (const host of hosts) {
    const om = host.snapshot?.omni; // deploy boundary: may be absent entirely
    if (!om) continue;
    // Keep the original flattened OmniInfo shape for v1 clients. A failed
    // probe retains last-good data when present; before the first success the
    // explicit empty shell plus additive status fields prevents a false
    // "no Omni hosts" result without breaking existing field readers.
    const data = om.data ?? {
      sources: [],
      queue: { pending: 0, processing: 0, failed: 0, failed_recent: 0 },
      stuck_runs: 0,
      docs_total: 0,
    };
    view.push({
      ...data,
      host_id: host.host_id,
      display_name: host.display_name,
      reachable: host.reachable,
      checked_at: om.checked_at,
      probe_available: om.available,
      probe_error: om.error ?? null,
      data_stale: !om.available,
    });
  }
  return view;
}

/** Flatten each New API gateway probe into a per-host view row. */
export function buildNewApiView(hosts: FleetHost[]): NewApiView {
  const view: NewApiView = [];
  for (const host of hosts) {
    const na = host.snapshot?.newapi; // deploy boundary: may be absent entirely
    if (!na?.available || !na.data) continue;
    view.push({
      ...na.data,
      host_id: host.host_id,
      display_name: host.display_name,
      checked_at: na.checked_at,
    });
  }
  return view;
}

/** Flatten each sing-box VPN host's singbox probe into a per-host view row. */
export function buildSingboxView(hosts: FleetHost[]): SingboxView {
  const view: SingboxView = [];
  for (const host of hosts) {
    const sb = host.snapshot?.singbox;
    if (!sb || !sb.available || !sb.data) continue;
    view.push({ ...sb.data, host_id: host.host_id, display_name: host.display_name, reachable: host.reachable });
  }
  return view;
}
