import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, Cpu, Eraser, MemoryStick, RotateCcw } from 'lucide-react';
import { AppMetrics, SystemResources } from '../../types';
import { freeBackendMemoryApi, getSystemResourcesApi } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { Sparkline } from './Sparkline';
import {
  HISTORY_SIZE, POLL_MS, ResourceLevel, ResourceSample,
  evaluateLevel, formatBytes, mergeSample, pushSample,
} from './resourceMath';

const LEVEL_STYLES: Record<ResourceLevel, { border: string; icon: string; value: string }> = {
  ok: {
    border: 'border-slate-200 dark:border-slate-800',
    icon: 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400',
    value: 'text-slate-900 dark:text-slate-100',
  },
  warn: {
    border: 'border-amber-300 dark:border-amber-700',
    icon: 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
    value: 'text-amber-600 dark:text-amber-400',
  },
  crit: {
    border: 'border-rose-300 dark:border-rose-700',
    icon: 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400',
    value: 'text-rose-600 dark:text-rose-400',
  },
};

const worst = (a: ResourceLevel, b: ResourceLevel): ResourceLevel =>
  a === 'crit' || b === 'crit' ? 'crit' : a === 'warn' || b === 'warn' ? 'warn' : 'ok';

const fmt = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

interface MetricRowProps {
  title: string;
  icon: React.ReactNode;
  level: ResourceLevel;
  appValue: string;
  appSub?: string;
  machinePct: number;
  machineLabel: string;
  appLabel: string;
  appSeries: number[];
  machineSeries: number[];
}

const MetricRow: React.FC<MetricRowProps> = ({
  title, icon, level, appValue, appSub, machinePct, machineLabel, appLabel, appSeries, machineSeries,
}) => {
  const st = LEVEL_STYLES[level];
  return (
    <div className={`rounded-lg border ${st.border} p-3 space-y-2 transition-colors`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-7 h-7 rounded-md ${st.icon} flex items-center justify-center shrink-0`}>{icon}</div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{title} · {appLabel}</div>
            <div className="flex items-baseline gap-1">
              <span className={`text-lg font-black tracking-tight tabular-nums leading-tight ${st.value}`}>{appValue}</span>
              {appSub && <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{appSub}</span>}
            </div>
          </div>
        </div>
        <div className="text-right w-24 shrink-0">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {machineLabel}: <strong className="text-slate-700 dark:text-slate-200 tabular-nums">{Math.round(machinePct)}%</strong>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${machinePct >= 90 ? 'bg-rose-500' : machinePct >= 80 ? 'bg-amber-500' : 'bg-slate-400 dark:bg-slate-500'}`}
              style={{ width: `${Math.max(0, Math.min(100, machinePct))}%` }}
            />
          </div>
        </div>
      </div>
      <Sparkline
        capacity={HISTORY_SIZE}
        height={28}
        series={[
          { values: machineSeries, className: 'stroke-slate-400 dark:stroke-slate-500', dashed: true },
          { values: appSeries, className: 'stroke-sky-500 dark:stroke-sky-400' },
        ]}
      />
    </div>
  );
};

export const ResourceMonitor: React.FC<{ onBackendRestarted?: () => void }> = ({ onBackendRestarted }) => {
  const { t, addToast } = useApp();
  const confirm = useConfirm();
  const r = t.dashboard.resources;
  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const hasElectron = !!electronAPI?.getAppMetrics;

  const [history, setHistory] = useState<ResourceSample[]>([]);
  const [latest, setLatest] = useState<{ backend: SystemResources; electron: AppMetrics | null } | null>(null);
  const [failing, setFailing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [freeing, setFreeing] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [backend, electron] = await Promise.all([
        getSystemResourcesApi(),
        electronAPI?.getAppMetrics ? electronAPI.getAppMetrics().catch(() => null) : Promise.resolve(null),
      ]);
      setLatest({ backend, electron });
      setHistory((h) => pushSample(h, mergeSample(backend, electron)));
      setFailing(false);
    } catch {
      // The axios interceptor already reports (deduplicated) network errors; show one inline notice only.
      setFailing(true);
    } finally {
      inFlight.current = false;
    }
  }, [electronAPI]);

  // Poll only while this tab is mounted AND the window is visible (hidden to tray → no polling).
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer || document.visibilityState !== 'visible') return;
      poll();
      timer = setInterval(poll, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll]);

  const cpuLevel = evaluateLevel(history.map((s) => Math.max(s.appCpu, s.sysCpu)));
  const ramLevel = evaluateLevel(history.map((s) => s.sysRamPct));
  const overall = worst(cpuLevel, ramLevel);
  const last = history[history.length - 1];

  const handleFreeMemory = async () => {
    setFreeing(true);
    try {
      const appBefore = last?.appRamBytes ?? 0;
      const [backendRes, uiRes] = await Promise.all([
        freeBackendMemoryApi(),
        electronAPI?.clearRendererCache ? electronAPI.clearRendererCache().catch(() => null) : Promise.resolve(null),
      ]);
      const freedBytes =
        Math.max(0, backendRes.rss_before - backendRes.rss_after) + (uiRes ? Math.max(0, uiRes.before - uiRes.after) : 0);
      const appAfter = Math.max(0, appBefore - freedBytes);
      const vars = { mb: Math.round(freedBytes / 1024 ** 2), before: formatBytes(appBefore), after: formatBytes(appAfter) };
      if (freedBytes < 1024 ** 2) addToast(fmt(r.freedNothing, vars), 'info');
      else addToast(fmt(r.freed, vars), 'success');
      poll();
    } catch (err: any) {
      addToast(err?.response?.data?.detail || t.common.error, 'error');
    } finally {
      setFreeing(false);
    }
  };

  const handleRestart = async () => {
    if (!electronAPI?.restartBackend) return;
    const ok = await confirm({
      title: r.restartTitle,
      message: r.restartMessage,
      confirmText: r.restartConfirm,
      danger: true,
    });
    if (!ok) return;
    setRestarting(true);
    try {
      const res = await electronAPI.restartBackend();
      if (res.ok) {
        addToast(r.restartDone, 'success');
        setHistory([]);
        onBackendRestarted?.();
      } else if (res.reason === 'not_owned') {
        addToast(r.reasonNotOwned, 'info');
      } else if (res.reason === 'busy') {
        addToast(r.reasonBusy, 'info');
      } else {
        addToast(r.restartFailed, 'error');
      }
    } catch {
      addToast(r.restartFailed, 'error');
    } finally {
      setRestarting(false);
    }
  };

  const electronProcs = latest?.electron?.processes ?? [];
  const sumType = (match: (type: string) => boolean) =>
    electronProcs.filter((p) => match(p.type)).reduce(
      (a, p) => ({ cpu: a.cpu + p.cpuPercent, ram: a.ram + p.workingSetBytes, n: a.n + 1 }),
      { cpu: 0, ram: 0, n: 0 },
    );
  const detailRows: { label: string; cpu: number; ram: number; count?: number }[] = [];
  if (hasElectron) {
    const renderer = sumType((ty) => ty === 'Tab');
    const browser = sumType((ty) => ty === 'Browser');
    const gpu = sumType((ty) => ty === 'GPU');
    const other = sumType((ty) => !['Tab', 'Browser', 'GPU'].includes(ty));
    detailRows.push({ label: r.procRenderer, ...renderer }, { label: r.procBrowser, ...browser }, { label: r.procGpu, ...gpu });
    if (other.n) detailRows.push({ label: r.procOther, ...other, count: other.n });
  }
  if (latest) {
    detailRows.push({ label: r.procBackend, cpu: latest.backend.backend.cpu_percent, ram: latest.backend.backend.rss });
  }

  const restartDisabledReason = !electronAPI?.restartBackend ? r.reasonNotElectron : '';

  const iconBtn =
    'w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
          <span className="truncate">{r.title}</span>
          {overall !== 'ok' && (
            <span
              title={r.warnHigh}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${overall === 'crit' ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400' : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'}`}
            >
              <AlertTriangle className="w-3 h-3" />
              {r.warnHigh}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleFreeMemory}
            disabled={freeing || restarting || failing}
            aria-label={r.freeMemory}
            title={r.freeMemory}
            className={iconBtn}
          >
            <Eraser className={`w-3.5 h-3.5 ${freeing ? 'animate-pulse text-sky-600' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handleRestart}
            disabled={!!restartDisabledReason || restarting || freeing}
            aria-label={r.restartBackend}
            title={restartDisabledReason || r.restartBackend}
            className={`${iconBtn} hover:text-rose-600 dark:hover:text-rose-400`}
          >
            <RotateCcw className={`w-3.5 h-3.5 ${restarting ? 'animate-spin text-rose-600' : ''}`} />
          </button>
        </div>
      </div>

      {failing && (
        <div className="text-[11px] rounded-lg px-2.5 py-2 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          {r.unavailable}
        </div>
      )}
      {overall === 'crit' && !failing && (
        <div className="text-[11px] rounded-lg px-2.5 py-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {r.critHint}
        </div>
      )}

      <MetricRow
        title={r.cpu}
        icon={<Cpu className="w-3.5 h-3.5" />}
        level={cpuLevel}
        appLabel={r.app}
        machineLabel={r.machine}
        appValue={last ? `${last.appCpu.toFixed(1)}%` : '--'}
        machinePct={last?.sysCpu ?? 0}
        appSeries={history.map((s) => s.appCpu)}
        machineSeries={history.map((s) => s.sysCpu)}
      />
      <MetricRow
        title={r.ram}
        icon={<MemoryStick className="w-3.5 h-3.5" />}
        level={ramLevel}
        appLabel={r.app}
        machineLabel={r.machine}
        appValue={last ? formatBytes(last.appRamBytes) : '--'}
        appSub={latest ? `/ ${formatBytes(latest.backend.system.ram_total)}` : undefined}
        machinePct={last?.sysRamPct ?? 0}
        appSeries={history.map((s) => s.appRamPct)}
        machineSeries={history.map((s) => s.sysRamPct)}
      />

      <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span>{r.last5min}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-sky-500 inline-block" />{r.app}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 border-t border-dashed border-slate-400 inline-block" />{r.machine}</span>
        </span>
      </div>

      <div className="mt-auto">
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
          {r.details}
        </button>
        {showDetails && (
          <table className="mt-1.5 w-full text-[11px]">
            <tbody className="text-slate-700 dark:text-slate-200 tabular-nums">
              {detailRows.map((row) => (
                <tr key={row.label} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-1 pr-2">{row.label}{row.count ? ` (${row.count})` : ''}</td>
                  <td className="py-1 pr-2 text-right">{row.cpu.toFixed(1)}%</td>
                  <td className="py-1 text-right">{formatBytes(row.ram)}</td>
                </tr>
              ))}
              {latest && (
                <tr>
                  <td className="py-1 pr-2 text-slate-500 dark:text-slate-400">{r.procOcr}</td>
                  <td className="py-1 text-right" colSpan={2}>{latest.backend.backend.child_count}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
