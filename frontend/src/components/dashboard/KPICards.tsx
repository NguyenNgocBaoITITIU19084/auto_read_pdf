import React from 'react';
import { 
  FileText, ShieldCheck, ShieldAlert, Coins, 
  Warehouse, Eye, Box, Ship, ArrowUpRight
} from 'lucide-react';
import { DashboardKPIs } from '../../types';
import { useApp } from '../../context/AppContext';

interface KPICardsProps {
  kpis: DashboardKPIs;
  loading?: boolean;
}

export const KPICards: React.FC<KPICardsProps> = ({ kpis, loading = false }) => {
  const { t } = useApp();

  const totalConts = kpis.total_containers || 1;
  const clearanceRate = Math.round((kpis.customs_cleared / (kpis.customs_cleared + kpis.customs_uncleared || 1)) * 100);
  const infrasRate = Math.round((kpis.infras_paid / (kpis.infras_paid + kpis.infras_unpaid || 1)) * 100);
  const yardRate = Math.round((kpis.containers_in_yard / totalConts) * 100);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse border border-slate-300/40 dark:border-slate-700/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {/* 1. Bookings & TEUs */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow transition-shadow flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-bl-full pointer-events-none -mr-4 -mt-4 transition-transform group-hover:scale-110" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t.dashboard.kpis.bookingsTitle}
          </span>
          <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <FileText className="w-4 h-4" />
          </div>
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
              {kpis.total_bookings}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              booking
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-950/40 px-2 py-1 rounded-md w-fit">
            <Box className="w-3.5 h-3.5" />
            <span>~{kpis.total_estimated_teus} TEUs {t.dashboard.kpis.estimatedTeus}</span>
          </div>
        </div>
      </div>

      {/* 2. Customs Clearance */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow transition-shadow flex flex-col justify-between relative overflow-hidden group">
        <div className={`absolute top-0 right-0 w-24 h-24 ${kpis.customs_uncleared > 0 ? 'bg-rose-500/10' : 'bg-emerald-500/10'} rounded-bl-full pointer-events-none -mr-4 -mt-4 transition-transform group-hover:scale-110`} />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t.dashboard.kpis.customsTitle}
          </span>
          <div className={`w-8 h-8 rounded-lg ${kpis.customs_uncleared > 0 ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400' : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'} flex items-center justify-center`}>
            {kpis.customs_uncleared > 0 ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          </div>
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-black ${kpis.customs_uncleared > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'} tracking-tight`}>
              {kpis.customs_uncleared}
            </span>
            <span className="text-xs text-rose-600 dark:text-rose-400 font-semibold">
              {t.dashboard.kpis.customsUncleared}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{t.dashboard.kpis.customsCleared}: <strong className="text-emerald-600 dark:text-emerald-400">{kpis.customs_cleared}</strong></span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">{clearanceRate}%</span>
          </div>
        </div>
      </div>

      {/* 3. Port Infrastructure Fee */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow transition-shadow flex flex-col justify-between relative overflow-hidden group">
        <div className={`absolute top-0 right-0 w-24 h-24 ${kpis.infras_unpaid > 0 ? 'bg-amber-500/10' : 'bg-emerald-500/10'} rounded-bl-full pointer-events-none -mr-4 -mt-4 transition-transform group-hover:scale-110`} />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t.dashboard.kpis.infrasTitle}
          </span>
          <div className={`w-8 h-8 rounded-lg ${kpis.infras_unpaid > 0 ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400' : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'} flex items-center justify-center`}>
            <Coins className="w-4 h-4" />
          </div>
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-black ${kpis.infras_unpaid > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'} tracking-tight`}>
              {kpis.infras_unpaid}
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
              {t.dashboard.kpis.infrasUnpaid}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{t.dashboard.kpis.infrasPaid}: <strong className="text-emerald-600 dark:text-emerald-400">{kpis.infras_paid}</strong></span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">{infrasRate}%</span>
          </div>
        </div>
      </div>

      {/* 4. Yard Occupancy */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow transition-shadow flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/10 rounded-bl-full pointer-events-none -mr-4 -mt-4 transition-transform group-hover:scale-110" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t.dashboard.kpis.yardTitle}
          </span>
          <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center">
            <Warehouse className="w-4 h-4" />
          </div>
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-teal-600 dark:text-teal-400 tracking-tight">
              {kpis.containers_in_yard}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.dashboard.kpis.inYard}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{t.dashboard.kpis.outYard}: <strong className="text-slate-700 dark:text-slate-300">{kpis.containers_out_yard}</strong></span>
            <span className="font-semibold text-teal-600 dark:text-teal-400">{yardRate}%</span>
          </div>
        </div>
      </div>

      {/* 5. Watchlists */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow transition-shadow flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-bl-full pointer-events-none -mr-4 -mt-4 transition-transform group-hover:scale-110" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t.dashboard.kpis.watchlistTitle}
          </span>
          <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <Eye className="w-4 h-4" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Ship className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span className="text-xl font-bold text-slate-900 dark:text-slate-100">{kpis.watchlist_vessels}</span>
              <span className="text-[11px] text-slate-500">{t.dashboard.kpis.vesselsCount}</span>
            </div>
            <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700" />
            <div className="flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span className="text-xl font-bold text-slate-900 dark:text-slate-100">{kpis.watchlist_containers}</span>
              <span className="text-[11px] text-slate-500">{t.dashboard.kpis.containersCount}</span>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-purple-600 dark:text-purple-400 font-medium">
            Theo dõi tự động định kỳ
          </div>
        </div>
      </div>
    </div>
  );
};
