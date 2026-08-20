import React, { useState } from 'react';
import { 
  AlertTriangle, Clock, ShieldAlert, Ship, ArrowRight, 
  CheckCircle2, Box, Calendar, MapPin
} from 'lucide-react';
import { DashboardAlerts, TabId } from '../../types';
import { useApp } from '../../context/AppContext';
import { ValueBadge } from '../common/ValueBadge';

interface AlertsSectionProps {
  alerts: DashboardAlerts;
  onNavigateTab: (tabId: TabId, searchKeyword?: string) => void;
  loading?: boolean;
}

type AlertFilter = 'all' | 'cutoffs' | 'containers' | 'vessels';

export const AlertsSection: React.FC<AlertsSectionProps> = ({
  alerts,
  onNavigateTab,
  loading = false,
}) => {
  const { t } = useApp();
  const [filter, setFilter] = useState<AlertFilter>('all');

  const totalCutoffs = alerts.critical_cutoffs?.length || 0;
  const totalUnclearedConts = alerts.uncleared_containers?.length || 0;
  const totalUpcomingVessels = alerts.upcoming_vessels?.length || 0;
  const totalAlertsCount = totalCutoffs + totalUnclearedConts + totalUpcomingVessels;

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm animate-pulse h-64" />
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t.dashboard.alerts.title}
              </h3>
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                totalAlertsCount > 0 
                  ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800' 
                  : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              }`}>
                {totalAlertsCount} {totalAlertsCount > 0 ? 'mục cần lưu ý' : 'hoàn tất'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.dashboard.alerts.subtitle}
            </p>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 bg-slate-200/60 dark:bg-slate-800 p-1 rounded-lg text-xs font-medium">
          <button
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              filter === 'all'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            {t.common.all} ({totalAlertsCount})
          </button>
          <button
            onClick={() => setFilter('cutoffs')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              filter === 'cutoffs'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Cut-off ({totalCutoffs})
          </button>
          <button
            onClick={() => setFilter('containers')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              filter === 'containers'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Cont chưa duyệt ({totalUnclearedConts})
          </button>
          <button
            onClick={() => setFilter('vessels')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              filter === 'vessels'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Lịch tàu ({totalUpcomingVessels})
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="p-4 space-y-4 max-h-[420px] overflow-y-auto">
        {totalAlertsCount === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t.dashboard.alerts.noAlerts}
            </p>
          </div>
        ) : (
          <>
            {/* 1. Uncleared Containers */}
            {(filter === 'all' || filter === 'containers') && totalUnclearedConts > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    {t.dashboard.alerts.unclearedConts} ({totalUnclearedConts})
                  </span>
                  <button
                    onClick={() => onNavigateTab('container')}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 cursor-pointer font-medium"
                  >
                    {t.dashboard.alerts.jumpToContainer}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {alerts.uncleared_containers.map((cont) => (
                    <div
                      key={`cont-alert-${cont.id}`}
                      onClick={() => onNavigateTab('container', cont.containerno)}
                      className="p-3 rounded-lg border border-rose-200/80 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 hover:border-rose-300 dark:hover:border-rose-800 transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                            {cont.containerno}
                          </span>
                          {cont.site_id && (
                            <ValueBadge value={cont.site_id} columnKey="site_id" table="container" />
                          )}
                          {cont.iso && (
                            <span className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">
                              {cont.iso}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {cont.custom_clearance_status && (
                            <ValueBadge value={cont.custom_clearance_status} columnKey="custom_clearance_status" table="container" />
                          )}
                          {cont.infras_fee_status && (
                            <ValueBadge value={cont.infras_fee_status} columnKey="infras_fee_status" table="container" />
                          )}
                          {cont.location && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-0.5">
                              <MapPin className="w-2.5 h-2.5" />
                              {cont.location}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1">
                        <span className="text-[10px] text-slate-400">
                          {cont.event_time ? cont.event_time.substring(0, 16) : ''}
                        </span>
                        <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                          {t.dashboard.alerts.action} &rarr;
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Critical Cargo Cut-offs */}
            {(filter === 'all' || filter === 'cutoffs') && totalCutoffs > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {t.dashboard.alerts.criticalCutoffs} ({totalCutoffs})
                  </span>
                  <button
                    onClick={() => onNavigateTab('booking')}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 cursor-pointer font-medium"
                  >
                    {t.dashboard.alerts.jumpToBooking}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {alerts.critical_cutoffs.map((bkg) => (
                    <div
                      key={`bkg-alert-${bkg.id}`}
                      onClick={() => onNavigateTab('booking', bkg.booking_no)}
                      className="p-3 rounded-lg border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 hover:border-amber-300 dark:hover:border-amber-800 transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                            {bkg.booking_no || 'N/A'}
                          </span>
                          {bkg.carrier && (
                            <ValueBadge value={bkg.carrier} columnKey="Carrier" table="booking" />
                          )}
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
                          {bkg.vessel && <span>Tàu: <strong>{bkg.vessel}</strong></span>}
                          {bkg.port_of_discharging && <span>POD: <strong>{bkg.port_of_discharging}</strong></span>}
                        </div>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1">
                        <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded">
                          <Clock className="w-3 h-3" />
                          <span>{bkg.cutoff_time}</span>
                        </div>
                        <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                          {t.dashboard.alerts.action} &rarr;
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Upcoming Vessels */}
            {(filter === 'all' || filter === 'vessels') && totalUpcomingVessels > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Ship className="w-3.5 h-3.5" />
                    {t.dashboard.alerts.upcomingVessels} ({totalUpcomingVessels})
                  </span>
                  <button
                    onClick={() => onNavigateTab('vessel')}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 cursor-pointer font-medium"
                  >
                    {t.dashboard.alerts.jumpToVessel}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {alerts.upcoming_vessels.map((v) => (
                    <div
                      key={`vessel-alert-${v.id}`}
                      onClick={() => onNavigateTab('vessel', v.vessel_name)}
                      className="p-3 rounded-lg border border-sky-200/80 dark:border-sky-900/50 bg-sky-50/40 dark:bg-sky-950/20 hover:border-sky-300 dark:hover:border-sky-800 transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                            {v.vessel_name}
                          </span>
                          {v.in_out_voyage && (
                            <span className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 font-mono">
                              Chuyến: {v.in_out_voyage}
                            </span>
                          )}
                          {v.site_id && (
                            <ValueBadge value={v.site_id} columnKey="site_id" table="vessel" />
                          )}
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">
                          {v.actual_berth_time && (
                            <span>Cập bến: <strong>{v.actual_berth_time}</strong></span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1">
                        {v.closing_time && (
                          <span className="text-[10px] text-slate-500">
                            Closing: {v.closing_time}
                          </span>
                        )}
                        <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                          {t.dashboard.alerts.action} &rarr;
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
