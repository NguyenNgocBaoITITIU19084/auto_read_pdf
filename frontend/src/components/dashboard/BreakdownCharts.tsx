import React from 'react';
import { Anchor, BarChart3, Box, Layers, Ship } from 'lucide-react';
import { DashboardDistributions, DistributionItem } from '../../types';
import { useApp } from '../../context/AppContext';
import { ValueBadge } from '../common/ValueBadge';
import { tf } from '../../services/i18nFormat';

interface BreakdownChartsProps {
  distributions: DashboardDistributions;
  loading?: boolean;
}

type BadgeTable = 'booking' | 'container' | 'vessel' | 'all';

const ProgressBarItem: React.FC<{ item: DistributionItem; barClass: string; badgeTable: BadgeTable; badgeColumn: string }> = ({
  item, barClass, badgeTable, badgeColumn,
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="min-w-0 truncate">
        <ValueBadge value={item.name} columnKey={badgeColumn} table={badgeTable} />
      </div>
      <div className="flex items-center gap-2 shrink-0 tabular-nums">
        <span className="font-semibold text-slate-900 dark:text-slate-100">{item.count}</span>
        <span className="text-slate-400 text-[11px] w-11 text-right">{item.percentage}%</span>
      </div>
    </div>
    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
      <div className={`h-1.5 rounded-full ${barClass}`} style={{ width: `${Math.max(item.percentage, 2)}%` }} />
    </div>
  </div>
);

export const BreakdownCharts: React.FC<BreakdownChartsProps> = React.memo(({ distributions, loading = false }) => {
  const { t } = useApp();
  const d = t.dashboard.distributions;

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-52 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        ))}
      </div>
    );
  }

  const cards: {
    key: string; title: string; icon: React.ReactNode; items: DistributionItem[]; count: string;
    barClass: string; badgeTable: BadgeTable; badgeColumn: string;
  }[] = [
    {
      key: 'carriers', title: d.carriers, icon: <Ship className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
      items: distributions.carriers || [], count: d.countCarriers,
      barClass: 'bg-blue-500 dark:bg-blue-400', badgeTable: 'booking', badgeColumn: 'Carrier',
    },
    {
      key: 'sites', title: d.sites, icon: <Anchor className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />,
      items: distributions.sites || [], count: d.countSites,
      barClass: 'bg-emerald-500 dark:bg-emerald-400', badgeTable: 'all', badgeColumn: 'site_id',
    },
    {
      key: 'equipment', title: d.equipment, icon: <Box className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />,
      items: distributions.equipment_types || [], count: d.countTypes,
      barClass: 'bg-indigo-500 dark:bg-indigo-400', badgeTable: 'booking', badgeColumn: 'Equipment Type',
    },
    {
      key: 'events', title: d.events, icon: <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />,
      items: distributions.container_events || [], count: d.countEvents,
      barClass: 'bg-purple-500 dark:bg-purple-400', badgeTable: 'container', badgeColumn: 'event_type',
    },
  ];

  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
        <BarChart3 className="w-4 h-4 text-primary-600 dark:text-primary-400" />
        {d.title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.key} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 min-w-0">
                {c.icon}
                <span className="truncate">{c.title}</span>
              </span>
              <span className="text-[11px] text-slate-400 shrink-0">{tf(c.count, { n: c.items.length })}</span>
            </div>
            {c.items.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">{d.noData}</p>
            ) : (
              <div className="space-y-2.5 max-h-44 overflow-y-auto pr-1">
                {c.items.map((item) => (
                  <ProgressBarItem key={item.name} item={item} barClass={c.barClass} badgeTable={c.badgeTable} badgeColumn={c.badgeColumn} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
});
BreakdownCharts.displayName = 'BreakdownCharts';
