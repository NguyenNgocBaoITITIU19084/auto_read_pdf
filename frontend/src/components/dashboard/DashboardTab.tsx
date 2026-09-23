import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Layers, Radio, RefreshCw, Sparkles } from 'lucide-react';
import { DashboardSummary, TabId } from '../../types';
import { getDashboardSummaryApi } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { KPICards } from './KPICards';
import { AlertsSection } from './AlertsSection';
import { BreakdownCharts } from './BreakdownCharts';
import { ResourceMonitor } from './ResourceMonitor';

interface DashboardTabProps {
  onNavigateTab: (tabId: TabId, searchKeyword?: string) => void;
}

type ScopeMode = 'all' | 'current';

/**
 * Last summary per scope, kept across tab switches (the tab unmounts when hidden): coming back
 * renders it instantly and revalidates in the background instead of flashing skeletons.
 */
const summaryCache = new Map<string, DashboardSummary>();
let lastScopeMode: ScopeMode = 'all';

export function __clearDashboardCacheForTests() {
  summaryCache.clear();
  lastScopeMode = 'all';
}

const EMPTY_KPIS = {
  total_bookings: 0, total_estimated_teus: 0, customs_uncleared: 0, customs_cleared: 0,
  infras_unpaid: 0, infras_paid: 0, containers_in_yard: 0, containers_out_yard: 0,
  total_vessels: 0, watchlist_vessels: 0, total_containers: 0, watchlist_containers: 0,
};
const EMPTY_ALERTS = { critical_cutoffs: [], uncleared_containers: [], upcoming_vessels: [] };
const EMPTY_DISTRIBUTIONS = { carriers: [], sites: [], equipment_types: [], container_events: [] };

export const DashboardTab: React.FC<DashboardTabProps> = ({ onNavigateTab }) => {
  const { activeCollection, t, autoSyncEnabled, addToast } = useApp();

  const [scopeMode, setScopeModeState] = useState<ScopeMode>(lastScopeMode);
  const setScopeMode = (mode: ScopeMode) => {
    lastScopeMode = mode;
    setScopeModeState(mode);
  };
  // Only the id matters, and only in 'current' scope: avoids refetching on unrelated context updates.
  const scopedCollectionId = scopeMode === 'current' ? activeCollection?.id : undefined;
  const cacheKey = scopedCollectionId !== undefined ? `col:${scopedCollectionId}` : 'all';

  const [summary, setSummary] = useState<DashboardSummary | null>(() => summaryCache.get(cacheKey) ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const requestSeq = useRef(0);

  const fetchSummary = useCallback(async () => {
    const seq = ++requestSeq.current;
    setRefreshing(true);
    try {
      const data = await getDashboardSummaryApi(scopedCollectionId);
      summaryCache.set(cacheKey, data);
      if (seq === requestSeq.current) setSummary(data);
    } catch (err: any) {
      console.error('Failed to fetch dashboard summary', err);
      if (seq === requestSeq.current) addToast(err?.response?.data?.detail || t.common.error, 'error');
    } finally {
      if (seq === requestSeq.current) setRefreshing(false);
    }
  }, [scopedCollectionId, cacheKey, addToast, t.common.error]);

  useEffect(() => {
    // Show what we already have for this scope (if anything), then revalidate.
    setSummary(summaryCache.get(cacheKey) ?? null);
    fetchSummary();
  }, [cacheKey, fetchSummary]);

  const firstLoad = !summary;
  const scopeName = scopeMode === 'all' ? t.dashboard.scopeAll : (activeCollection?.name || t.dashboard.scopeCurrent);

  const scopeBtn = (active: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
      active
        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs'
        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
    }`;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50/50 dark:bg-slate-950">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />
            <span className="truncate">{t.dashboard.title}</span>
            {autoSyncEnabled && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 shrink-0">
                <Radio className="w-3 h-3 animate-pulse" />
                Auto-Sync
              </span>
            )}
          </h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {t.dashboard.lastUpdated}: <strong>{summary?.updated_at || '---'}</strong>
            <span className="mx-1.5">·</span>
            {t.dashboard.scopeLabel}: <strong>{scopeName}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div data-tour="dashboard-scope" className="flex items-center bg-slate-200/60 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-semibold">
            <button type="button" onClick={() => setScopeMode('all')} className={scopeBtn(scopeMode === 'all')}>
              <Globe className="w-3.5 h-3.5" />
              <span>{t.dashboard.scopeAll}</span>
            </button>
            <button type="button" onClick={() => setScopeMode('current')} disabled={!activeCollection} className={scopeBtn(scopeMode === 'current')}>
              <Layers className="w-3.5 h-3.5" />
              <span className="max-w-[140px] truncate">{activeCollection ? activeCollection.name : t.dashboard.scopeCurrent}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={fetchSummary}
            disabled={refreshing}
            aria-label={t.dashboard.refreshSummary}
            title={refreshing ? t.dashboard.refreshing : t.dashboard.refreshSummary}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-all cursor-pointer disabled:cursor-wait"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-primary-600' : ''}`} />
            <span className="hidden sm:inline">{t.dashboard.refreshSummary}</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div data-tour="dashboard-kpis">
        <KPICards kpis={summary?.kpis || EMPTY_KPIS} loading={firstLoad} />
      </div>

      {/* Alerts (main) + system resources (side) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <div data-tour="dashboard-alerts" className="lg:col-span-2 min-w-0">
          <AlertsSection alerts={summary?.alerts || EMPTY_ALERTS} onNavigateTab={onNavigateTab} loading={firstLoad} />
        </div>
        {/* Polls on its own, independent of the scope above */}
        <div data-tour="dashboard-resources" className="min-w-0">
          <ResourceMonitor onBackendRestarted={fetchSummary} />
        </div>
      </div>

      {/* Distributions */}
      <div data-tour="dashboard-charts">
        <BreakdownCharts distributions={summary?.distributions || EMPTY_DISTRIBUTIONS} loading={firstLoad} />
      </div>
    </div>
  );
};
