import React, { useEffect, useState, useCallback } from 'react';
import { 
  RefreshCw, Layers, Sparkles, Clock, Globe,
  ShieldCheck, ArrowRight, Radio
} from 'lucide-react';
import { DashboardSummary, TabId } from '../../types';
import { getDashboardSummaryApi } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { KPICards } from './KPICards';
import { AlertsSection } from './AlertsSection';
import { BreakdownCharts } from './BreakdownCharts';

interface DashboardTabProps {
  onNavigateTab: (tabId: TabId, searchKeyword?: string) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({ onNavigateTab }) => {
  const { activeCollection, collections, t, autoSyncEnabled, addToast } = useApp();

  // Scope: 'all' or 'current'
  const [scopeMode, setScopeMode] = useState<'all' | 'current'>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const targetColId = scopeMode === 'current' && activeCollection ? activeCollection.id : undefined;
      const data = await getDashboardSummaryApi(targetColId);
      setSummary(data);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err: any) {
      console.error('Failed to fetch dashboard summary', err);
      addToast(err?.response?.data?.detail || t.common.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [scopeMode, activeCollection, addToast, t.common.error]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-slate-50/50 dark:bg-slate-950">
      {/* Top Banner / Dashboard Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-primary-100 dark:bg-primary-950 text-primary-600 dark:text-primary-400">
                <Sparkles className="w-5 h-5" />
              </span>
              {t.dashboard.title}
            </h1>
            {autoSyncEnabled && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                <Radio className="w-3 h-3 animate-pulse" />
                Auto-Sync ON
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span>{t.dashboard.lastUpdated}: <strong>{summary?.updated_at || lastRefreshed || '---'}</strong></span>
            <span>•</span>
            <span>Phạm vi: <strong>{scopeMode === 'all' ? t.dashboard.scopeAll : (activeCollection?.name || t.dashboard.scopeCurrent)}</strong></span>
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Scope Selector */}
          <div data-tour="dashboard-scope" className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setScopeMode('all')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                scopeMode === 'all'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{t.dashboard.scopeAll}</span>
            </button>
            <button
              onClick={() => setScopeMode('current')}
              disabled={!activeCollection}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                scopeMode === 'current'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{activeCollection ? activeCollection.name : t.dashboard.scopeCurrent}</span>
            </button>
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchSummary}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-all shadow-2xs cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-primary-600' : ''}`} />
            <span>{t.dashboard.refreshSummary}</span>
          </button>
        </div>
      </div>

      {/* 1. KPI Cards */}
      <div data-tour="dashboard-kpis">
        <KPICards
          kpis={summary?.kpis || {
            total_bookings: 0,
            total_estimated_teus: 0,
            customs_uncleared: 0,
            customs_cleared: 0,
            infras_unpaid: 0,
            infras_paid: 0,
            containers_in_yard: 0,
            containers_out_yard: 0,
            total_vessels: 0,
            watchlist_vessels: 0,
            total_containers: 0,
            watchlist_containers: 0,
          }}
          loading={loading}
        />
      </div>

      {/* 2. Urgent Alerts Section */}
      <div data-tour="dashboard-alerts">
        <AlertsSection
          alerts={summary?.alerts || {
            critical_cutoffs: [],
            uncleared_containers: [],
            upcoming_vessels: [],
          }}
          onNavigateTab={onNavigateTab}
          loading={loading}
        />
      </div>

      {/* 3. Breakdown Charts */}
      <div data-tour="dashboard-charts">
        <BreakdownCharts
          distributions={summary?.distributions || {
            carriers: [],
            sites: [],
            equipment_types: [],
            container_events: [],
          }}
          loading={loading}
        />
      </div>
    </div>
  );
};
