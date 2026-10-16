import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2, Undo2 } from 'lucide-react';
import { Booking, TableQuery } from '../../types';
import { getBookingsCalendar } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { ValueBadge } from '../common/ValueBadge';
import { BookingStatusCell, BookingStatusLabels, OVERDUE_KEY, STATUS_KEY } from './BookingStatus';
import { BookingStatus } from '../../types';

export const DEADLINE_KEY = 'Hạn cut-off';
export const ALL_DAY_KEY = 'Cut-off cả ngày';

export interface BookingCalendarLabels {
  prevWeek: string;
  nextWeek: string;
  /** 'Tuần {n}' */
  weekNumber: string;
  pickDate: string;
  thisWeek: string;
  lastWeek: string;
  followingWeek: string;
  weeksAgo: string;
  weeksAhead: string;
  backToThisWeek: string;
  /** Monday first */
  weekdays: string[];
  summary: string;
  lateSummary: string;
  undated: string;
  empty: string;
  allDay: string;
  error: string;
}

// --- dates (local calendar days) -------------------------------------------------------------------------
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const startOfWeek = (d: Date): Date => {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); // back to Monday
  return r;
};

export const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

/** ISO-8601 week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export const isoWeek = (d: Date): number => {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); // Thursday of this week
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
};

/** Whole weeks from this week's Monday to another Monday (DST-safe). */
export const weeksFromNow = (monday: Date, now = new Date()): number =>
  Math.round((Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate())
    - Date.UTC(startOfWeek(now).getFullYear(), startOfWeek(now).getMonth(), startOfWeek(now).getDate())) / (7 * 86400000));

export const relativeWeekLabel = (offset: number, labels: BookingCalendarLabels): string => {
  if (offset === 0) return labels.thisWeek;
  if (offset === -1) return labels.lastWeek;
  if (offset === 1) return labels.followingWeek;
  return tf(offset < 0 ? labels.weeksAgo : labels.weeksAhead, { n: Math.abs(offset) });
};

const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Bookings grouped by the day of their cut-off ('YYYY-MM-DD HH:MM'). */
export const groupByDay = (items: Booking[]): Map<string, Booking[]> => {
  const map = new Map<string, Booking[]>();
  items.forEach((b) => {
    const key = String(b[DEADLINE_KEY] || '').slice(0, 10);
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(b);
    else map.set(key, [b]);
  });
  return map;
};

interface BookingCalendarProps {
  collectionId: number;
  query: TableQuery;
  /** Bumped by the tab whenever its data changed (status change, edit, upload...) */
  reloadKey: number;
  labels: BookingCalendarLabels;
  statusLabels: BookingStatusLabels;
  onOpen: (booking: Booking) => void;
  onContextMenu: (booking: Booking, e: React.MouseEvent) => void;
  onChangeStatus: (booking: Booking, status: BookingStatus) => void;
  onError: (message: string) => void;
}

/** Week view of the bookings by cut-off: one column per day, Monday to Sunday. */
export const BookingCalendar: React.FC<BookingCalendarProps> = ({
  collectionId, query, reloadKey, labels, statusLabels, onOpen, onContextMenu, onChangeStatus, onError,
}) => {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [items, setItems] = useState<Booking[]>([]);
  const [undated, setUndated] = useState(0);
  const [loading, setLoading] = useState(true);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = dayKey(days[0]);
  const to = dayKey(days[6]);
  const queryKey = JSON.stringify(query);
  const weekOffset = weeksFromNow(weekStart);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getBookingsCalendar(collectionId, from, to, query)
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

  const byDay = useMemo(() => groupByDay(items), [items]);
  const late = items.filter((b) => b[OVERDUE_KEY]).length;
  const todayKey = dayKey(new Date());

  return (
    <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm min-h-0">
      {/* Week navigation: ‹ [Tuần 42 · 12/10 – 18/10/2026 ▾] ›, where it sits relative to today, a way back */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="inline-flex items-stretch rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          <button
            type="button"
            aria-label={labels.prevWeek}
            title={labels.prevWeek}
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="px-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            title={labels.pickDate}
            onClick={openDatePicker}
            className="relative flex items-center gap-2 px-3 py-1.5 border-x border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <CalendarDays className="w-4 h-4 text-primary-600 dark:text-primary-400" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">
              {tf(labels.weekNumber, { n: isoWeek(weekStart) })}
            </span>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">
              {ddmm(days[0])} – {ddmm(days[6])}/{days[6].getFullYear()}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            <input
              ref={dateInputRef}
              type="date"
              tabIndex={-1}
              aria-hidden="true"
              value={from}
              onChange={(e) => {
                const [y, m, d] = e.target.value.split('-').map(Number);
                if (y && m && d) setWeekStart(startOfWeek(new Date(y, m - 1, d)));
              }}
              className="absolute inset-0 opacity-0 pointer-events-none"
            />
          </button>
          <button
            type="button"
            aria-label={labels.nextWeek}
            title={labels.nextWeek}
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="px-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            weekOffset === 0
              ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {relativeWeekLabel(weekOffset, labels)}
        </span>
        {weekOffset !== 0 && (
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
            {labels.backToThisWeek}
          </button>
        )}
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{tf(labels.summary, { count: items.length })}</span>
          {late > 0 && (
            <span className="inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-3 h-3" />
              {tf(labels.lateSummary, { count: late })}
            </span>
          )}
          {undated > 0 && <span>· {tf(labels.undated, { count: undated })}</span>}
        </span>
      </div>

      {/* One column per day */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="grid grid-cols-7 min-w-[1050px] h-full divide-x divide-slate-200 dark:divide-slate-800">
          {days.map((d, i) => {
            const key = dayKey(d);
            const list = byDay.get(key) || [];
            const isToday = key === todayKey;
            const isPast = key < todayKey;
            return (
              <section key={key} aria-label={`${labels.weekdays[i]} ${ddmm(d)}`} className={`flex flex-col min-h-0 ${isPast ? 'bg-slate-50/70 dark:bg-slate-950/40' : ''}`}>
                <header
                  className={`sticky top-0 z-10 flex items-center justify-between gap-1 px-2.5 py-1.5 border-b text-[11px] ${
                    isToday
                      ? 'bg-primary-50 dark:bg-primary-950/50 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span className="font-bold">
                    {labels.weekdays[i]} <span className="font-semibold opacity-80">{ddmm(d)}</span>
                  </span>
                  {list.length > 0 && (
                    <span className={`min-w-[20px] text-center rounded-full px-1.5 text-[10px] font-bold ${
                      isToday ? 'bg-primary-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}>
                      {list.length}
                    </span>
                  )}
                </header>
                <div className="flex-1 p-1.5 space-y-1.5">
                  {list.length === 0 && !loading && (
                    <p className="pt-3 text-center text-[11px] text-slate-300 dark:text-slate-600">{labels.empty}</p>
                  )}
                  {list.map((b) => (
                    <CalendarCard
                      key={b.id}
                      booking={b}
                      allDayLabel={labels.allDay}
                      statusLabels={statusLabels}
                      onOpen={onOpen}
                      onContextMenu={onContextMenu}
                      onChangeStatus={onChangeStatus}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const CalendarCard: React.FC<{
  booking: Booking;
  allDayLabel: string;
  statusLabels: BookingStatusLabels;
  onOpen: (booking: Booking) => void;
  onContextMenu: (booking: Booking, e: React.MouseEvent) => void;
  onChangeStatus: (booking: Booking, status: BookingStatus) => void;
}> = ({ booking, allDayLabel, statusLabels, onOpen, onContextMenu, onChangeStatus }) => {
  const late = !!booking[OVERDUE_KEY];
  const time = booking[ALL_DAY_KEY] ? allDayLabel : String(booking[DEADLINE_KEY] || '').slice(11, 16);
  const qty = [booking["Q'ty"], booking['Equipment Type']].filter((v) => v && v !== 'null').join(' × ');
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(booking)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(booking);
      }}
      onContextMenu={(e) => onContextMenu(booking, e)}
      className={`group cursor-pointer rounded-lg border bg-white dark:bg-slate-900 p-2 shadow-xs hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
        late ? 'border-l-4 border-l-rose-500 border-rose-200 dark:border-rose-900' : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[11px] font-bold tabular-nums ${late ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {late && <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-px" />}
          {time}
        </span>
        <ValueBadge table="booking" columnKey="Carrier" value={booking.Carrier} fallbackText="" />
      </div>
      <div className="mt-0.5 text-xs font-bold text-slate-800 dark:text-slate-100 truncate" title={String(booking['Booking No'] || '')}>
        {booking['Booking No'] || '—'}
      </div>
      {booking.Vessel && booking.Vessel !== 'null' && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={String(booking.Vessel)}>{booking.Vessel}</div>
      )}
      {qty && <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{qty}</div>}
      <div className="mt-1.5">
        <BookingStatusCell
          status={booking[STATUS_KEY]}
          labels={statusLabels}
          onChange={(s) => onChangeStatus(booking, s)}
        />
      </div>
    </div>
  );
};
