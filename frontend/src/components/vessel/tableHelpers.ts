import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Shared minute ticker: one interval for every "x phút trước" badge on screen.
// Only the subscribed badges re-render (not whole table rows).
// ---------------------------------------------------------------------------
let minuteTick = 0;
const tickListeners = new Set<() => void>();
let tickTimer: number | null = null;

const subscribeMinuteTick = (listener: () => void) => {
  tickListeners.add(listener);
  if (tickTimer === null) {
    tickTimer = window.setInterval(() => {
      if (document.hidden) return;
      minuteTick += 1;
      tickListeners.forEach((l) => l());
    }, 60000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer !== null) {
      window.clearInterval(tickTimer);
      tickTimer = null;
    }
  };
};

const getMinuteTick = () => minuteTick;

/** Re-renders the caller about once per minute (while the window is visible). */
export const useMinuteTick = (): number => useSyncExternalStore(subscribeMinuteTick, getMinuteTick, getMinuteTick);

/**
 * Returns a function with a stable identity that always calls the latest `fn`.
 * Lets memoized rows receive callbacks without re-rendering when parent state changes.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/** Cheap change signature for table data: row count + max queried_at + ids hash. */
export function rowsSignature(rows: { id?: number | null; queried_at?: string | null }[]): string {
  let maxQueried = '';
  let hash = 0;
  for (const r of rows) {
    const q = r.queried_at || '';
    if (q > maxQueried) maxQueried = q;
    hash = (Math.imul(hash, 31) + (Number(r.id) || 0)) | 0;
  }
  return `${rows.length}|${maxQueried}|${hash}`;
}

/** Change signature for watchlist rows (ids + last sync info). */
export function watchlistSignature(
  rows: { id: number; last_sync_at?: string | null; last_sync_status?: string | null; last_sync_message?: string | null }[]
): string {
  return rows
    .map((w) => `${w.id}:${w.last_sync_at || ''}:${w.last_sync_status || ''}:${w.last_sync_message || ''}`)
    .join(',');
}

interface AutoRefreshOptions {
  /** Auto-sync enabled — activates the safety poll and refresh on window focus */
  enabled: boolean;
  /** autoSyncStatus.last_run_at */
  lastRunAt: string | null | undefined;
  /** autoSyncStatus.running */
  running: boolean | undefined;
  /** Silent refresh. Must guard against concurrent requests itself. */
  refresh: () => void;
  /** Safety poll interval (default 60s) */
  safetyMs?: number;
}

/**
 * Replaces blind 10s polling:
 * - refetches when the scheduler finishes a run (last_run_at / running changes),
 * - keeps a slow safety poll while auto-sync is on,
 * - never polls while the window is hidden (catches up when it becomes visible).
 */
export function useAutoRefresh({ enabled, lastRunAt, running, refresh, safetyMs = 60000 }: AutoRefreshOptions) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const pendingRef = useRef(false);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      if (pendingRef.current || enabledRef.current) {
        pendingRef.current = false;
        refreshRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      refreshRef.current();
    }, safetyMs);
    return () => window.clearInterval(timer);
  }, [enabled, safetyMs]);

  const prevKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${lastRunAt ?? ''}|${running ? 1 : 0}`;
    if (prevKeyRef.current === null) {
      prevKeyRef.current = key;
      return;
    }
    if (prevKeyRef.current === key) return;
    prevKeyRef.current = key;
    if (running) return; // wait for the run to finish
    if (document.hidden) {
      pendingRef.current = true;
      return;
    }
    refreshRef.current();
  }, [lastRunAt, running]);
}

const cleanTsvCell = (value: unknown): string => {
  if (value === undefined || value === null || value === 'null') return '';
  return String(value).replace(/[\t\r\n]+/g, ' ').trim();
};

/** Rows -> TSV (header + one line per row) that pastes cleanly into Excel. */
export function rowsToTSV<T extends Record<string, any>>(
  rows: T[],
  columns: { key: string; label: string }[],
  getValue: (row: T, key: string) => unknown = (row, key) => row[key]
): string {
  const header = columns.map((c) => cleanTsvCell(c.label)).join('\t');
  const lines = rows.map((row) => columns.map((c) => cleanTsvCell(getValue(row, c.key))).join('\t'));
  return [header, ...lines].join('\n');
}

export const errorMessage = (e: any, fallback: string): string => {
  const data = e?.response?.data;
  const detail = typeof data?.detail === 'string' ? data.detail : '';
  const rid = data?.request_id || e?.response?.headers?.['x-request-id'];
  const base = detail || e?.message || fallback;
  return rid && e?.response?.status >= 500 && !base.includes(rid) ? `${base} (mã: ${rid})` : base;
};
