import React, { useEffect, useMemo, useState } from 'react';
import { Anchor, Clock, FileText, Hourglass } from 'lucide-react';
import { TableQuery, VesselSchedule } from '../../types';
import { getVesselsCalendar } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { WeekCalendar, WeekNavLabels, addDays, dayKey, groupByDay, startOfWeek } from '../common/WeekCalendar';

export interface VesselCalendarLabels extends WeekNavLabels {
  summary: string;
  soonSummary: string;
  undated: string;
  estimated: string;
  estimatedTooltip: string;
  closed: string;
  soon: string;
  etd: string;
  /** 'còn {h} giờ' / 'còn {m} phút' */
  hoursLeft: string;
  minutesLeft: string;
  bookings: string;
  bookingsOpen: string;
  bookingsTooltip: string;
  error: string;
}

type ClosingState = 'closed' | 'soon' | 'open';

/** 'EST (dự kiến): 05:00 17/10/2026' -> '05:00 17/10' */
export const shortTime = (text: unknown): string => {
  const s = String(text || '');
  const time = /(\d{1,2}:\d{2})/.exec(s)?.[1];
  const date = /(\d{1,2}\/\d{1,2})\/\d{4}/.exec(s)?.[1];
  return [time, date].filter(Boolean).join(' ');
};

/** ePort's 'IN-OUT' voyage: '0579-061N-0579-061N' -> '0579-061N', '062B-063A' -> '062B / 063A'. */
export const formatVoyage = (text: unknown): string => {
  const s = String(text || '').trim();
  const parts = s.split('-');
  if (parts.length < 2 || parts.length % 2) return s;
  const half = parts.length / 2;
  const inbound = parts.slice(0, half).join('-');
  const outbound = parts.slice(half).join('-');
  return inbound === outbound ? inbound : `${inbound} / ${outbound}`;
};

/** 'còn 5 giờ' / 'còn 40 phút' until a 'YYYY-MM-DD HH:MM' deadline ('' once it has passed). */
export const timeLeft = (deadline: unknown, labels: Pick<VesselCalendarLabels, 'hoursLeft' | 'minutesLeft'>, now = new Date()): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(String(deadline || ''));
  if (!m) return '';
  const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const minutes = Math.floor((at.getTime() - now.getTime()) / 60000);
  if (minutes < 0) return '';
  return minutes < 60 ? tf(labels.minutesLeft, { m: minutes }) : tf(labels.hoursLeft, { h: Math.floor(minutes / 60) });
};

interface VesselCalendarProps {
  collectionId: number;
  query: TableQuery;
  reloadKey: number;
  labels: VesselCalendarLabels;
  onOpen: (schedule: VesselSchedule) => void;
  onContextMenu: (schedule: VesselSchedule, e: React.MouseEvent) => void;
  /** Show this vessel's bookings in the booking tab */
  onOpenBookings?: (schedule: VesselSchedule) => void;
  onError: (message: string) => void;
}

/** Week view of the vessel schedules by closing time (cắt máng). */
export const VesselCalendar: React.FC<VesselCalendarProps> = ({
  collectionId, query, reloadKey, labels, onOpen, onContextMenu, onOpenBookings, onError,
}) => {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [items, setItems] = useState<VesselSchedule[]>([]);
  const [undated, setUndated] = useState(0);
  const [loading, setLoading] = useState(true);
  const from = dayKey(weekStart);
  const to = dayKey(addDays(weekStart, 6));
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getVesselsCalendar(collectionId, from, to, query)
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setUndated(res.undated);
      })
      .catch((e: any) => {
        if (!alive) return;
        const detail = e?.response?.data?.detail;
        onError((typeof detail === 'string' && detail) || e?.message || labels.error);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, from, to, queryKey, reloadKey]);

  const itemsByDay = useMemo(() => {
    const cards = new Map<string, React.ReactNode[]>();
    groupByDay(items, (v) => String(v.calendar_deadline || '')).forEach((list, key) => cards.set(key, list.map((v) => (
      <VesselCard key={v.id} schedule={v} labels={labels} onOpen={onOpen} onContextMenu={onContextMenu} onOpenBookings={onOpenBookings} />
    ))));
    return cards;
  }, [items, labels, onOpen, onContextMenu, onOpenBookings]);
  const soon = items.filter((v) => v.closing_state === 'soon').length;

  return (
    <WeekCalendar
      weekStart={weekStart}
      onWeekStartChange={setWeekStart}
      labels={labels}
      loading={loading}
      itemsByDay={itemsByDay}
      summary={(
        <>
          <span className="font-semibold text-slate-700 dark:text-slate-200">{tf(labels.summary, { count: items.length })}</span>
          {soon > 0 && (
            <span className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400">
              <Clock className="w-3 h-3" />
              {tf(labels.soonSummary, { count: soon })}
            </span>
          )}
          {undated > 0 && <span>· {tf(labels.undated, { count: undated })}</span>}
        </>
      )}
    />
  );
};

const STATE_CARD: Record<ClosingState, string> = {
  closed: 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60',
  soon: 'border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 ring-1 ring-amber-200/60 dark:ring-amber-900/40',
  open: 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900',
};

const STATE_TIME: Record<ClosingState, string> = {
  closed: 'text-slate-400 dark:text-slate-500',
  soon: 'text-amber-600 dark:text-amber-400',
  open: 'text-slate-700 dark:text-slate-200',
};

const VesselCard: React.FC<{
  schedule: VesselSchedule;
  labels: VesselCalendarLabels;
  onOpen: (schedule: VesselSchedule) => void;
  onContextMenu: (schedule: VesselSchedule, e: React.MouseEvent) => void;
  onOpenBookings?: (schedule: VesselSchedule) => void;
}> = ({ schedule: v, labels, onOpen, onContextMenu, onOpenBookings }) => {
  const state: ClosingState = v.closing_state === 'closed' || v.closing_state === 'soon' ? v.closing_state : 'open';
  const count = Number(v.booking_count) || 0;
  const open = Number(v.booking_open_count) || 0;
  const etd = shortTime(v.actual_departure_time);
  const voyage = formatVoyage(v.in_out_voyage);
  const left = state === 'soon' ? timeLeft(v.calendar_deadline, labels) : '';
  const muted = state === 'closed';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(v);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(v, e);
      }}
      className={`cursor-pointer overflow-hidden rounded-lg border shadow-xs hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${STATE_CARD[state]}`}
    >
      <div className="p-2">
        {/* closing time · site */}
        <div className="flex items-center justify-between gap-1.5">
          <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-bold tabular-nums ${STATE_TIME[state]}`}>
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {String(v.calendar_deadline || '').slice(11, 16)}
            {v.closing_estimated && (
              <span title={labels.estimatedTooltip} className="rounded px-1 text-[9px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                {labels.estimated}
              </span>
            )}
          </span>
          <span className="shrink-0 rounded px-1.5 text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800">
            {v.site_id}
          </span>
        </div>
        <div
          className={`mt-1 text-xs font-bold truncate ${muted ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}
          title={v.vessel_name}
        >
          {v.vessel_name}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={`${v.in_out_voyage}${v.agent ? ` · ${v.agent}` : ''}`}>
          <span className="font-medium tabular-nums">{voyage}</span>
          {v.agent ? <span className="text-slate-400 dark:text-slate-500"> · {v.agent}</span> : null}
        </div>
        {etd && (
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
            <Anchor className="w-3 h-3 shrink-0" />
            <span className="truncate">{labels.etd} {etd}</span>
          </div>
        )}
        {count > 0 && (
          <button
            type="button"
            title={labels.bookingsTooltip}
            onClick={(e) => {
              e.stopPropagation();
              onOpenBookings?.(v);
            }}
            className="mt-1.5 flex flex-wrap items-center gap-1 text-left"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-950/50 dark:text-primary-300">
              <FileText className="w-3 h-3" />
              {tf(labels.bookings, { count })}
            </span>
            {open > 0 && (
              <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                state === 'open'
                  ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
              }`}>
                {tf(labels.bookingsOpen, { count: open })}
              </span>
            )}
          </button>
        )}
      </div>
      {/* closing state strip */}
      {state !== 'open' && (
        <div className={`px-2 py-0.5 text-[10px] font-bold whitespace-nowrap truncate ${
          state === 'soon'
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
            : 'bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
        }`}>
          {state === 'soon' ? (
            <span title={labels.soon} className="inline-flex items-center gap-1">
              <Hourglass className="w-3 h-3 shrink-0" />
              {left ? left.charAt(0).toUpperCase() + left.slice(1) : labels.soon}
            </span>
          ) : labels.closed}
        </div>
      )}
    </div>
  );
};
