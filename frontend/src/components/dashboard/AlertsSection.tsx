import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, MapPin, ShieldAlert, Ship } from 'lucide-react';
import { DashboardAlerts, TabId } from '../../types';
import { useApp } from '../../context/AppContext';
import { ValueBadge } from '../common/ValueBadge';
import { CustomsStatusBadge } from '../container/customs';
import { tf } from '../../services/i18nFormat';
import { parseVnDateTime } from '../../utils/vnTime';

interface AlertsSectionProps {
  alerts: DashboardAlerts;
  onNavigateTab: (tabId: TabId, searchKeyword?: string) => void;
  loading?: boolean;
}

type AlertTab = 'cutoffs' | 'containers' | 'vessels';

const DEFAULT_WINDOW_DAYS = 7;

/** "còn 5 giờ" / "còn 2 ngày" from a VN wall-clock "YYYY-MM-DDTHH:mm"; null when unknown. */
export function timeLeft(alertAt: string | undefined, now: number = Date.now()): { hours: number } | null {
  const d = parseVnDateTime(alertAt);
  if (!d) return null;
  return { hours: (d.getTime() - now) / 3_600_000 };
}

const rowClass =
  'w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer group';

export const AlertsSection: React.FC<AlertsSectionProps> = React.memo(({ alerts, onNavigateTab, loading = false }) => {
  const { t } = useApp();
  const a = t.dashboard.alerts;
  const days = alerts.window_days ?? DEFAULT_WINDOW_DAYS;

  const lists = {
    cutoffs: alerts.critical_cutoffs || [],
    containers: alerts.uncleared_containers || [],
    vessels: alerts.upcoming_vessels || [],
  };
  const totals = {
    cutoffs: alerts.totals?.critical_cutoffs ?? lists.cutoffs.length,
    containers: alerts.totals?.uncleared_containers ?? lists.containers.length,
    vessels: alerts.totals?.upcoming_vessels ?? lists.vessels.length,
  };
  const grandTotal = totals.cutoffs + totals.containers + totals.vessels;

  // Open the most urgent non-empty list; keep the user's choice afterwards.
  const firstNonEmpty: AlertTab = totals.cutoffs ? 'cutoffs' : totals.containers ? 'containers' : totals.vessels ? 'vessels' : 'cutoffs';
  const [tab, setTab] = useState<AlertTab | null>(null);
  const active = tab ?? firstNonEmpty;
  useEffect(() => {
    if (tab && totals[tab] === 0 && grandTotal > 0) setTab(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grandTotal]);

  if (loading) {
    return <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm animate-pulse h-[360px]" />;
  }

  const tabs: { id: AlertTab; label: string; icon: React.ReactNode; tone: string }[] = [
    { id: 'cutoffs', label: a.tabCutoffs, icon: <Clock className="w-3.5 h-3.5" />, tone: 'text-amber-600 dark:text-amber-400' },
    { id: 'containers', label: a.tabContainers, icon: <ShieldAlert className="w-3.5 h-3.5" />, tone: 'text-rose-600 dark:text-rose-400' },
    { id: 'vessels', label: a.tabVessels, icon: <Ship className="w-3.5 h-3.5" />, tone: 'text-sky-600 dark:text-sky-400' },
  ];
  const jump: Record<AlertTab, { tab: TabId; label: string }> = {
    cutoffs: { tab: 'booking', label: a.jumpToBooking },
    containers: { tab: 'container', label: a.jumpToContainer },
    vessels: { tab: 'vessel', label: a.jumpToVessel },
  };

  const renderTimeLeft = (alertAt?: string) => {
    const left = timeLeft(alertAt);
    if (!left) return null;
    const text = left.hours < 1 ? a.timeLeftSoon
      : left.hours < 48 ? tf(a.timeLeftHours, { n: Math.floor(left.hours) })
      : tf(a.timeLeftDays, { n: Math.floor(left.hours / 24) });
    const urgent = left.hours < 24;
    return (
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${urgent ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'}`}>
        {text}
      </span>
    );
  };

  const empty = (text: string) => (
    <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center gap-2 px-6">
      <CheckCircle2 className="w-8 h-8 text-emerald-500" />
      <p className="text-xs text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  );

  const list = () => {
    if (active === 'cutoffs') {
      if (!lists.cutoffs.length) return empty(tf(a.emptyCutoffs, { days }));
      return lists.cutoffs.map((b) => (
        <button key={`c-${b.id}`} type="button" className={rowClass} onClick={() => onNavigateTab('booking', b.booking_no)}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 truncate">
                {b.booking_no || 'N/A'}
              </span>
              {b.carrier && <ValueBadge value={b.carrier} columnKey="Carrier" table="booking" />}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {b.vessel && <span>{a.vessel}: <strong className="text-slate-700 dark:text-slate-300">{b.vessel}</strong></span>}
              {b.vessel && b.port_of_discharging && <span className="mx-1.5">·</span>}
              {b.port_of_discharging && <span>{a.pod}: <strong className="text-slate-700 dark:text-slate-300">{b.port_of_discharging}</strong></span>}
            </div>
          </div>
          <div className="text-right shrink-0 space-y-0.5">
            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{b.cutoff_time}</div>
            {renderTimeLeft(b.alert_at)}
          </div>
        </button>
      ));
    }
    if (active === 'containers') {
      if (!lists.containers.length) return empty(a.emptyContainers);
      return lists.containers.map((c) => (
        <button key={`k-${c.id}`} type="button" className={rowClass} onClick={() => onNavigateTab('container', c.containerno)}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                {c.containerno}
              </span>
              {c.site_id && <ValueBadge value={c.site_id} columnKey="site_id" table="container" />}
              {c.iso && <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">{c.iso}</span>}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              <CustomsStatusBadge row={c} showDate={false} rawFallback fallbackText="" />
              {c.infras_fee_status && <ValueBadge value={c.infras_fee_status} columnKey="infras_fee_status" table="container" />}
              {c.location && (
                <span className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-0.5">
                  <MapPin className="w-2.5 h-2.5" />
                  {c.location}
                </span>
              )}
            </div>
          </div>
          <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{c.event_time ? c.event_time.substring(0, 16) : ''}</span>
        </button>
      ));
    }
    if (!lists.vessels.length) return empty(tf(a.emptyVessels, { days }));
    return lists.vessels.map((v) => (
      <button key={`v-${v.id}`} type="button" className={rowClass} onClick={() => onNavigateTab('vessel', v.vessel_name)}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 truncate">
              {v.vessel_name}
            </span>
            {v.site_id && <ValueBadge value={v.site_id} columnKey="site_id" table="vessel" />}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {v.in_out_voyage && <span>{a.voyage}: <span className="font-mono">{v.in_out_voyage}</span></span>}
            {v.closing_time && <span className="ml-2">{a.closing}: {v.closing_time}</span>}
          </div>
        </div>
        <div className="text-right shrink-0 space-y-0.5">
          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{v.actual_berth_time}</div>
          {renderTimeLeft(v.alert_at)}
        </div>
      </button>
    ));
  };

  const shown = lists[active].length;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm flex flex-col h-full min-h-[360px]">
      <div className="px-4 pt-3.5 pb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-4 h-4 ${grandTotal ? 'text-rose-500' : 'text-emerald-500'}`} />
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{a.title}</h3>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${grandTotal ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400' : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'}`}>
            {grandTotal ? tf(a.needAttention, { count: grandTotal }) : a.allDone}
          </span>
        </div>
        <span className="text-[11px] text-slate-400">{tf(a.windowHint, { days })}</span>
      </div>

      <div role="tablist" className="px-4 flex items-center gap-1 border-b border-slate-100 dark:border-slate-800">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            type="button"
            aria-selected={active === tb.id}
            onClick={() => setTab(tb.id)}
            className={`flex items-center gap-1.5 px-2.5 py-2 -mb-px border-b-2 text-xs font-semibold transition-colors cursor-pointer ${
              active === tb.id
                ? `border-primary-500 text-slate-900 dark:text-slate-100`
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span className={tb.tone}>{tb.icon}</span>
            {tb.label}
            <span className={`text-[10px] px-1.5 rounded-full tabular-nums ${totals[tb.id] ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
              {totals[tb.id]}
            </span>
          </button>
        ))}
      </div>

      <div role="tabpanel" className="flex-1 overflow-y-auto p-1.5 max-h-[340px] divide-y divide-slate-100 dark:divide-slate-800/60">
        {list()}
      </div>

      <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">{shown ? tf(a.showing, { shown, total: totals[active] }) : ''}</span>
        <button
          type="button"
          onClick={() => onNavigateTab(jump[active].tab)}
          className="text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
        >
          {jump[active].label}
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
});
AlertsSection.displayName = 'AlertsSection';
