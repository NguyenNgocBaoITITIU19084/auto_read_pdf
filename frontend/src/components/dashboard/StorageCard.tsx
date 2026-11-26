import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eraser, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import { StorageItem, StorageUsage } from '../../types';
import { cleanStorageApi, getStorageUsageApi } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { tf } from '../../services/i18nFormat';

/** "0 B" / "820 KB" / "1.9 MB" / "12 GB" */
export function sizeText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i < 2 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Disk is "low" under 10% free or under 5 GB free */
export function diskLow(disk: { total: number; free: number }): boolean {
  return disk.total > 0 && (disk.free / disk.total < 0.1 || disk.free < 5 * 1024 ** 3);
}

type CleanTarget = 'zalo_media_cache' | 'backups' | 'database' | 'ui_cache';

/** What the app's data takes on disk, with one-click clean-ups for what is made again by itself. */
export const StorageCard: React.FC = () => {
  const { t, addToast } = useApp();
  const s = t.dashboard.storage;
  const confirm = useConfirm();
  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [uiCache, setUiCache] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState<CleanTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, ui] = await Promise.all([
        getStorageUsageApi(),
        electronAPI?.getRendererCacheSize ? electronAPI.getRendererCacheSize().catch(() => null) : Promise.resolve(null),
      ]);
      setUsage(data);
      setUiCache(ui ? ui.total : null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [electronAPI]);

  useEffect(() => {
    load();
  }, [load]);

  const item = (id: StorageItem['id']) => usage?.items.find((i) => i.id === id);

  const runClean = async (target: CleanTarget) => {
    if (target === 'backups') {
      const backups = item('backups');
      if (!backups || !usage) return;
      const ok = await confirm({
        title: s.backupsConfirmTitle,
        message: tf(s.backupsConfirm, {
          n: Math.max(0, (backups.files ?? 0) - usage.backups_kept),
          size: sizeText(backups.cleanable),
          kept: usage.backups_kept,
        }),
        confirmText: s.backupsConfirmButton,
        danger: true,
      });
      if (!ok) return;
    }
    setCleaning(target);
    try {
      let freed = 0;
      if (target === 'ui_cache') {
        const before = uiCache ?? 0;
        await electronAPI?.clearRendererCache?.();
        const after = await electronAPI?.getRendererCacheSize?.().catch(() => null);
        freed = Math.max(0, before - (after?.total ?? 0));
      } else {
        freed = (await cleanStorageApi(target)).freed_bytes;
      }
      if (freed > 0) addToast(tf(s.freed, { size: sizeText(freed) }), 'success');
      else addToast(s.freedNothing, 'info');
      await load();
    } catch (err: any) {
      addToast(err?.response?.data?.detail || t.common.error, 'error');
    } finally {
      setCleaning(null);
    }
  };

  const cleanButton = (target: CleanTarget, label: string, cleanable: number) => (
    <button
      type="button"
      onClick={() => runClean(target)}
      disabled={cleanable <= 0 || cleaning !== null}
      title={cleanable > 0 ? tf(s.cleanable, { size: sizeText(cleanable) }) : s.freedNothing}
      className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
    >
      {cleaning === target ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eraser className="w-3 h-3" />}
      {label}
    </button>
  );

  const row = (label: string, bytes: number, sub: React.ReactNode, action?: React.ReactNode) => (
    <div className="flex items-center gap-2 px-2 py-1">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-700 dark:text-slate-200 truncate">{label}</div>
        {sub && <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{sub}</div>}
      </div>
      <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200 shrink-0">{sizeText(bytes)}</span>
      {action}
    </div>
  );

  const body = () => {
    if (failed && !usage) return <p className="px-2 py-1.5 text-[11px] text-slate-400">{s.loadError}</p>;
    if (!usage) return <div className="h-40 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />;
    const low = diskLow(usage.disk);
    const usedPct = usage.disk.total ? Math.round((usage.disk.used / usage.disk.total) * 100) : 0;
    const db = item('database');
    const files = (n: number | null | undefined) => (n ? tf(s.files, { n }) : '');
    const backups = item('backups');
    const appTotal = usage.total_bytes + (uiCache ?? 0);
    return (
      <>
        <div className="px-2 space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{s.appData}</span>
            <span className="text-lg font-black tabular-nums text-slate-900 dark:text-slate-100">{sizeText(appTotal)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" title={usage.data_dir}>
            <div className={`h-full ${low ? 'bg-rose-500' : 'bg-primary-500'}`} style={{ width: `${usedPct}%` }} />
          </div>
          <div className={`flex items-center gap-1 text-[10px] ${low ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-400 dark:text-slate-500'}`}>
            {low && <AlertTriangle className="w-3 h-3" />}
            {low && <span>{s.diskLow} ·</span>}
            <span>{tf(s.diskFree, { free: sizeText(usage.disk.free), total: sizeText(usage.disk.total) })}</span>
          </div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {db && row(
            s.database,
            db.bytes,
            db.groups && Object.keys(db.groups).length
              ? tf(s.databaseGroups, { zalo: sizeText(db.groups.zalo ?? 0), gmail: sizeText(db.groups.gmail ?? 0) })
              : null,
            cleanButton('database', s.cleanDatabase, db.cleanable),
          )}
          {item('zalo_files') && row(s.zalo_files, item('zalo_files')!.bytes, files(item('zalo_files')!.files))}
          {item('zalo_media_cache') && row(
            s.zalo_media_cache, item('zalo_media_cache')!.bytes, files(item('zalo_media_cache')!.files),
            cleanButton('zalo_media_cache', s.clean, item('zalo_media_cache')!.cleanable),
          )}
          {uiCache !== null && row(s.uiCache, uiCache, null, cleanButton('ui_cache', s.clean, uiCache))}
          {item('fleet_photos') && row(s.fleet_photos, item('fleet_photos')!.bytes, files(item('fleet_photos')!.files))}
          {backups && row(
            s.backups,
            backups.bytes,
            [files(backups.files), tf(s.keepsNewest, { n: usage.backups_kept })].filter(Boolean).join(' · '),
            cleanButton('backups', s.clean, backups.cleanable),
          )}
        </div>
      </>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <HardDrive className="w-4 h-4 text-primary-600 dark:text-primary-400" />
          {s.title}
        </h3>
        <button
          type="button"
          onClick={load}
          disabled={loading || cleaning !== null}
          aria-label={s.refresh}
          title={s.refresh}
          className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:cursor-wait"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>
      {body()}
    </div>
  );
};
