import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Booking, TableQuery } from '../../types';
import { getBookingsCalendar } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { ValueBadge } from '../common/ValueBadge';
import {
  WeekCalendar, WeekNavLabels, addDays, dayKey, groupByDay as groupItemsByDay, startOfWeek,
} from '../common/WeekCalendar';
import { BookingStatusCell, BookingStatusLabels, OVERDUE_KEY, STATUS_KEY } from './BookingStatus';
import { BookingStatus } from '../../types';

export {
  addDays, dayKey, isoWeek, relativeWeekLabel, startOfWeek, weeksFromNow,
} from '../common/WeekCalendar';

export const DEADLINE_KEY = 'Hạn cut-off';
export const ALL_DAY_KEY = 'Cut-off cả ngày';

export interface BookingCalendarLabels extends WeekNavLabels {
  summary: string;
  lateSummary: string;
  undated: string;
  allDay: string;
  error: string;
}

/** Bookings grouped by the day of their cut-off ('YYYY-MM-DD HH:MM'). */
export const groupByDay = (items: Booking[]): Map<string, Booking[]> =>
  groupItemsByDay(items, (b) => String(b[DEADLINE_KEY] || ''));

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

  const from = dayKey(weekStart);
  const to = dayKey(addDays(weekStart, 6));
  const queryKey = JSON.stringify(query);

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

  const itemsByDay = useMemo(() => {
    const cards = new Map<string, React.ReactNode[]>();
    groupByDay(items).forEach((list, key) => cards.set(key, list.map((b) => (
      <CalendarCard
        key={b.id}
        booking={b}
        allDayLabel={labels.allDay}
        statusLabels={statusLabels}
        onOpen={onOpen}
        onContextMenu={onContextMenu}
        onChangeStatus={onChangeStatus}
      />
    ))));
    return cards;
  }, [items, labels.allDay, statusLabels, onOpen, onContextMenu, onChangeStatus]);
  const late = items.filter((b) => b[OVERDUE_KEY]).length;

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
          {late > 0 && (
            <span className="inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-3 h-3" />
              {tf(labels.lateSummary, { count: late })}
            </span>
          )}
          {undated > 0 && <span>· {tf(labels.undated, { count: undated })}</span>}
        </>
      )}
    />
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
        <span className={`shrink-0 inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-bold tabular-nums ${late ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {late && <AlertTriangle className="w-3 h-3" />}
          {time}
        </span>
        {/* long line names stay on one line, clipped (full name on hover) */}
        <span className="min-w-0 overflow-hidden rounded">
          <ValueBadge table="booking" columnKey="Carrier" value={booking.Carrier} fallbackText="" badgeClassName="whitespace-nowrap" />
        </span>
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
