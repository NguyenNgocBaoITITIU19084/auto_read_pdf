import { AppMetrics, SystemResources } from '../../types';

/** One poll result, normalized: CPU as % of the whole machine (0-100), RAM in bytes. */
export interface ResourceSample {
  t: number;
  sysCpu: number;
  sysRamPct: number;
  appCpu: number;
  appRamBytes: number;
  appRamPct: number;
}

export type ResourceLevel = 'ok' | 'warn' | 'crit';

export const POLL_MS = 3000;
export const HISTORY_SIZE = 100; // 100 × 3s = 5 minutes
export const WARN_PCT = 80;
export const CRIT_PCT = 90;
export const CONSECUTIVE = 3; // ~9s above a threshold before warning (ignores short OCR spikes)

const clampPct = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

/** Backend reports itself + children; Electron (when present) adds main/renderer/GPU processes. */
export function mergeSample(backend: SystemResources, electron?: AppMetrics | null, t = Date.now()): ResourceSample {
  const appRamBytes = backend.backend.rss + (electron?.totalWorkingSetBytes ?? 0);
  const total = backend.system.ram_total || 1;
  return {
    t,
    sysCpu: clampPct(backend.system.cpu_percent),
    sysRamPct: clampPct(backend.system.ram_percent),
    appCpu: clampPct(backend.backend.cpu_percent + (electron?.totalCpuPercent ?? 0)),
    appRamBytes,
    appRamPct: clampPct((appRamBytes / total) * 100),
  };
}

export function pushSample<T>(buf: T[], s: T, max = HISTORY_SIZE): T[] {
  const next = buf.length >= max ? buf.slice(buf.length - max + 1) : buf.slice();
  next.push(s);
  return next;
}

/** Level of the most recent `consecutive` values: every one of them must be above the threshold. */
export function evaluateLevel(
  values: number[],
  warn = WARN_PCT,
  crit = CRIT_PCT,
  consecutive = CONSECUTIVE,
): ResourceLevel {
  if (values.length < consecutive) return 'ok';
  const tail = values.slice(-consecutive);
  if (tail.every((v) => v >= crit)) return 'crit';
  if (tail.every((v) => v >= warn)) return 'warn';
  return 'ok';
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}
