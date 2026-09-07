import type { FleetHost, StorageHealthInfo } from './types';

export function storageView(host: FleetHost, now: number): { status: 'healthy' | 'degraded' | 'unknown'; data?: StorageHealthInfo } | null {
  const probe = host.snapshot?.storage_health;
  if (!probe) return null;
  const fresh = (iso: string) => Number.isFinite(Date.parse(iso)) && now - Date.parse(iso) >= -30_000 && now - Date.parse(iso) <= 180_000;
  if (!host.reachable || !probe.available || !probe.data || !fresh(probe.checked_at) || !fresh(probe.data.checked_at)) return { status: 'unknown' };
  return { status: probe.data.healthy ? 'healthy' : 'degraded', data: probe.data };
}
