export function humanDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86_400)}d`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? humanDuration(ms / 1000) : '—';
}

/** Future countdown for reset timestamps: "2h41m" style; '—' for past/invalid. */
export function until(iso: string | null | undefined): string {
  if (!iso) return '—';
  const sec = (Date.parse(iso) - Date.now()) / 1000;
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m`;
  if (sec < 86_400) {
    // round to whole minutes FIRST so "2h59.5m" carries to 3h, not "2h60m"
    const totalMin = Math.round(sec / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  const totalH = Math.round(sec / 3600);
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  return h > 0 ? `${d}d${h}h` : `${d}d`;
}

export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
}

/** Bytes → binary human size (KiB/MiB/GiB/TiB). */
export function bytesHuman(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

/**
 * Bytes-per-second (as produced by procNetDevRates) → networking bit-rate.
 * Multiplies by 8 and scales in base-1000 units, e.g. 5.29 MB/s → "42.3 Mbps".
 */
export function bpsHuman(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '—';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  let bits = bytesPerSec * 8;
  let i = 0;
  while (bits >= 1000 && i < units.length - 1) {
    bits /= 1000;
    i += 1;
  }
  const digits = i === 0 || bits >= 100 ? 0 : bits >= 10 ? 1 : 2;
  return `${bits.toFixed(digits)} ${units[i]}`;
}

export function compactTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

/** Render a count that may be a query cap rather than an exact value. */
export function lowerBoundCount(n: number, capped = false, compact = false): string {
  return `${capped ? '≥' : ''}${compact ? compactTokens(n) : n}`;
}

/** Render a planner-derived estimate without implying exactness. */
export function estimatedCount(n: number, estimated = false, compact = false): string {
  return `${estimated ? '~' : ''}${compact ? compactTokens(n) : n}`;
}

export function primaryDisk(disks: Array<{ mount: string; total_gb: number; used_gb: number; used_pct: number }>) {
  const internal = disks.filter((d) => !d.mount.startsWith('/Volumes/'));
  const pool = internal.length > 0 ? internal : disks;
  return pool.reduce((a, b) => (b.used_pct > a.used_pct ? b : a), pool[0]!) ?? null;
}
