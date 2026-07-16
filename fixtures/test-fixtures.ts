/**
 * Test-only builders for FleetHost / HostSnapshot / ServiceInfo fixtures.
 * Not a *.test.ts file, so `bun test` ignores it; imported by the suites.
 * Standalone (no collector host-config): a tiny per-host table supplies the
 * display metadata the suites assert on.
 */
import type {
  FactorioInfo,
  FleetHost,
  HostId,
  HostSnapshot,
  Probe,
  ServiceInfo,
} from '../contracts/types';

const ISO = '2026-07-10T12:00:00.000Z';

const HOSTS: Record<HostId, { display_name: string; role: string; tailnet_ip: string; expected_flaky: boolean }> = {
  atlas: { display_name: 'atlas', role: 'cockpit · 云雀 · fleet hub', tailnet_ip: '100.64.0.11', expected_flaky: false },
  forge: { display_name: 'forge', role: 'agent runner · persona fleet · factorio', tailnet_ip: '100.64.0.12', expected_flaky: false },
  basalt: { display_name: 'basalt', role: 'knowledge stack · gateways', tailnet_ip: '100.64.0.13', expected_flaky: false },
  mica: { display_name: 'mica', role: 'workstation · thin client', tailnet_ip: '100.64.0.14', expected_flaky: true },
  'vpn-kiku': { display_name: 'vpn-kiku', role: 'VPN · tokyo', tailnet_ip: '203.0.113.10', expected_flaky: false },
  'vpn-cedar': { display_name: 'vpn-cedar', role: 'VPN · oregon', tailnet_ip: '203.0.113.20', expected_flaky: false },
};

export function probe<T>(data: T): Probe<T> {
  return { available: true, data, checked_at: ISO };
}

export function factorioInfo(active = 0): FactorioInfo {
  const builtins = ['base', 'quality', 'elevated-rails', 'space-age'].map((name) => ({
    name, version: '2.0.77', builtin: true,
  }));
  const external = Array.from({ length: 19 }, (_, i) => ({
    name: `example-mod-${String(i + 1).padStart(2, '0')}`,
    version: '1.0.0',
    builtin: false,
  }));
  return {
    server_name: 'Nimbus Factory',
    game_version: '2.0.77',
    started_at: '2026-07-14T04:24:01.000Z',
    players: {
      complete: true,
      active,
      max: 10,
      checked_at: '2026-07-14T05:00:00.000Z',
    },
    save: { loaded_file: 'main.zip', map_version: '2.0.77-0' },
    mods: [...builtins, ...external],
  };
}

export function svc(over: Partial<ServiceInfo> = {}): ServiceInfo {
  return { name: 'svc', supervisor: 'systemd', state: 'running', expected: true, ...over };
}

/** A small healthy service set (the demo suites don't assert problem rules). */
export function expectedRunning(id: HostId): ServiceInfo[] {
  return [
    svc({ name: 'tailscaled', group: 'infra' }),
    svc({ name: 'fleet-collector', supervisor: 'systemd-user', group: 'cockpit' }),
    svc({ name: `${id}-app`, supervisor: 'systemd-user', group: 'apps' }),
  ];
}

export function snapshot(id: HostId, over: Partial<HostSnapshot> = {}): HostSnapshot {
  return {
    v: 1,
    host_id: id,
    hostname: id,
    role: 'test',
    taken_at: ISO,
    collector_version: 'test',
    os: { platform: 'linux', release: '6.8', uptime_sec: 100000 },
    cpu: { cores: 8, load1: 1.0, load5: 1.0, load15: 1.0, used_pct: 12 },
    mem: { total_mb: 24000, used_mb: 6000, used_pct: 25 },
    disks: [{ mount: '/', total_gb: 200, used_gb: 40, used_pct: 20 }],
    services: probe(expectedRunning(id)),
    tailscale: probe({ self_ip: HOSTS[id].tailnet_ip, self_online: true, peers: [] }),
    agents: probe({ herdr_agents: [], claude_procs: 0, codex_procs: 0, tmux_loops: [] }),
    zylos: null,
    clauth: null,
    tunnels: null,
    singbox: null,
    omni: null,
    openclaw: null,
    clauth_usage: null,
    codex_usage: null,
    mosh: probe({ server_present: true, active_sessions: 0 }),
    ...over,
  };
}

export function healthyHost(id: HostId, over: Partial<FleetHost> = {}): FleetHost {
  const cfg = HOSTS[id];
  return {
    host_id: id,
    display_name: cfg.display_name,
    role: cfg.role,
    reachable: true,
    expected_flaky: cfg.expected_flaky,
    stale_sec: 5,
    snapshot: snapshot(id),
    tailnet_ip: cfg.tailnet_ip,
    ...over,
  };
}
