/**
 * 48h host history — 5-minute buckets, generated from the same noise
 * functions the live snapshot uses, so a sparkline's right edge agrees with
 * the gauge next to it. Sing-box hosts also carry up/down bps + client
 * counts; mica has a gap where the workstation slept.
 */
import type { HostHistory, HostId } from '../contracts/types';
import { metric } from './noise';

const BUCKET = 5 * 60_000;
const POINTS = (48 * 60) / 5; // 576

const BASE: Record<HostId, { cpu: [number, number]; mem: [number, number]; vpn: boolean }> = {
  atlas: { cpu: [18, 9], mem: [62, 4], vpn: false },
  forge: { cpu: [35, 14], mem: [55, 6], vpn: false },
  basalt: { cpu: [22, 8], mem: [68, 4], vpn: false },
  mica: { cpu: [14, 8], mem: [57, 5], vpn: false },
  'vpn-kiku': { cpu: [7, 5], mem: [34, 5], vpn: true },
  'vpn-cedar': { cpu: [6, 4], mem: [31, 5], vpn: true },
};

export function buildHistory(hostId: HostId, now: number): HostHistory {
  const base = BASE[hostId];
  const asleepSince = now - 6 * 3_600_000; // mica's nap window
  const points = Array.from({ length: POINTS }, (_, i) => {
    const ts = now - (POINTS - 1 - i) * BUCKET;
    const asleep = hostId === 'mica' && ts > asleepSince;
    return {
      ts: new Date(ts).toISOString(),
      cpu_pct: asleep ? 0 : metric(`${hostId}.cpu`, ts, base.cpu[0], base.cpu[1]),
      mem_pct: asleep ? 0 : metric(`${hostId}.mem`, ts, base.mem[0], base.mem[1]),
      reachable: !asleep,
      up_bps: base.vpn ? metric(`${hostId}.up`, ts, 550_000, 420_000, { min: 20_000, max: 4_000_000, period: 300_000 }) : null,
      down_bps: base.vpn ? metric(`${hostId}.down`, ts, 2_400_000, 1_900_000, { min: 60_000, max: 16_000_000, period: 300_000 }) : null,
      clients: base.vpn ? Math.round(metric(`${hostId}.clients`, ts, 3, 2, { min: 0, max: 8, period: 900_000 })) : null,
    };
  });
  return { host_id: hostId, points };
}
