/**
 * Out-of-band alert DM log (alerts tab) — a mix of delivered/failed and
 * active/resolved rows so every rendering branch shows. `resolved` mirrors
 * what the hub computes at serve time: true once the problem id is no longer
 * active (see buildProblems in fixtures/fleet.ts).
 */
import type { SentNotification } from '../contracts/types';

const MIN = 60_000;
const HOUR = 3_600_000;
const iso = (t: number): string => new Date(t).toISOString();

export function buildNotifications(now: number): SentNotification[] {
  return [
    {
      id: `forge/systemd-user/map-snapshotter/failed@${iso(now - 47 * MIN)}`,
      ts: iso(now - 46 * MIN),
      severity: 'crit',
      host_id: 'forge',
      problem_id: 'forge/systemd-user/map-snapshotter/failed',
      source: 'systemd',
      msg: 'map-snapshotter failed (systemd-user)',
      channel: 'lark',
      delivered: true,
      lark_message_id: 'om_demo_0001',
      resolved: false,
    },
    {
      id: `basalt/openclaw/digest-bot/disconnected@${iso(now - 7 * HOUR)}`,
      ts: iso(now - 7 * HOUR + 2 * MIN),
      severity: 'warn',
      host_id: 'basalt',
      problem_id: 'basalt/openclaw/digest-bot/disconnected',
      source: 'openclaw',
      msg: 'openclaw agent digest-bot telegram disconnected (ETELEGRAM 401)',
      channel: 'lark',
      delivered: true,
      lark_message_id: 'om_demo_0002',
      resolved: false,
    },
    {
      id: `vpn-cedar/singbox/restart-flap@${iso(now - 2.1 * HOUR)}`,
      ts: iso(now - 2.1 * HOUR),
      severity: 'warn',
      host_id: 'vpn-cedar',
      problem_id: 'vpn-cedar/singbox/restart-flap',
      source: 'singbox',
      msg: 'sing-box restarting (flap)',
      channel: 'lark',
      delivered: false,
      lark_message_id: null,
      error: 'lark send timeout after 10s',
      resolved: true,
    },
    {
      id: `forge/systemd/factorio/failed@${iso(now - 30 * HOUR)}`,
      ts: iso(now - 30 * HOUR),
      severity: 'crit',
      host_id: 'forge',
      problem_id: 'forge/systemd/factorio/failed',
      source: 'systemd',
      msg: 'factorio failed (exit-code)',
      channel: 'lark',
      delivered: true,
      lark_message_id: 'om_demo_0003',
      resolved: true,
    },
    {
      id: `fleet/tokens/collector-stale@${iso(now - 2 * 24 * HOUR)}`,
      ts: iso(now - 2 * 24 * HOUR),
      severity: 'info',
      host_id: 'fleet',
      problem_id: 'fleet/tokens/collector-stale',
      source: 'tokens',
      msg: 'token collector mica stale >30h',
      channel: 'lark',
      delivered: true,
      lark_message_id: 'om_demo_0004',
      resolved: true,
    },
  ];
}
