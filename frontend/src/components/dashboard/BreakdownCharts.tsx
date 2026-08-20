import React from 'react';
import { BarChart3, Ship, Box, Layers, Anchor } from 'lucide-react';
import { DashboardDistributions, DistributionItem } from '../../types';
import { useApp } from '../../context/AppContext';
import { ValueBadge } from '../common/ValueBadge';

interface BreakdownChartsProps {
  distributions: DashboardDistributions;
  loading?: boolean;
}

const ProgressBarItem: React.FC<{
  item: DistributionItem;
  colorClass: string;
  badgeTable?: 'booking' | 'container' | 'vessel' | 'all';
  badgeColumn?: string;
}> = ({ item, colorClass, badgeTable, badgeColumn }) => {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 truncate max-w-[70%]">
          {badgeTable && badgeColumn ? (
            <ValueBadge value={item.name} columnKey={badgeColumn} table={badgeTable} />
          ) : (
            <span className="font-medium text-slate-700 dark:text-slate-300 truncate">
              {item.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{item.count}</span>
          <span className="text-slate-400 font-mono text-[11px] w-10 text-right">{item.percentage}%</span>
        </div>
      </div>
      <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${Math.max(item.percentage, 2)}%` }}
        />
      </div>
    </div>
  );
};

export const BreakdownCharts: React.FC<BreakdownChartsProps> = ({
  distributions,
  loading = false,
}) => {
  const { t } = useApp();

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-60 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse border border-slate-300/40 dark:border-slate-700/50" />
        ))}
      </div>
    );
  }

  const carriers = distributions.carriers || [];
  const sites = distributions.sites || [];
  const equipment = distributions.equipment_types || [];
  const events = distributions.container_events || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-primary-600 dark:text-primary-400" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          {t.dashboard.distributions.title}
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Top Carriers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Ship className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                {t.dashboard.distributions.carriers}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {carriers.length} hãng
              </span>
            </div>
            {carriers.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">{t.dashboard.distributions.noData}</p>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {carriers.map((item, idx) => (
                  <ProgressBarItem
                    key={`carrier-${idx}`}
                    item={item}
                    colorClass="bg-blue-500 dark:bg-blue-400"
                    badgeTable="booking"
                    badgeColumn="Carrier"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 2. Sites Distribution */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Anchor className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                {t.dashboard.distributions.sites}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {sites.length} cảng
              </span>
            </div>
            {sites.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">{t.dashboard.distributions.noData}</p>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {sites.map((item, idx) => (
                  <ProgressBarItem
                    key={`site-${idx}`}
                    item={item}
                    colorClass="bg-emerald-500 dark:bg-emerald-400"
                    badgeTable="all"
                    badgeColumn="site_id"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 3. Equipment Types */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Box className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                {t.dashboard.distributions.equipment}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {equipment.length} loại
              </span>
            </div>
            {equipment.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">{t.dashboard.distributions.noData}</p>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {equipment.map((item, idx) => (
                  <ProgressBarItem
                    key={`equip-${idx}`}
                    item={item}
                    colorClass="bg-indigo-500 dark:bg-indigo-400"
                    badgeTable="booking"
                    badgeColumn="Equipment Type"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 4. Container Events */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                {t.dashboard.distributions.events}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {events.length} sự kiện
              </span>
            </div>
            {events.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">{t.dashboard.distributions.noData}</p>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {events.map((item, idx) => (
                  <ProgressBarItem
                    key={`event-${idx}`}
                    item={item}
                    colorClass="bg-purple-500 dark:bg-purple-400"
                    badgeTable="container"
                    badgeColumn="event_type"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
