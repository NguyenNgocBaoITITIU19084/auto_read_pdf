import React, { useMemo, useRef } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2, Undo2, X } from 'lucide-react';
import { tf } from '../../services/i18nFormat';

export interface WeekNavLabels {
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
  empty: string;
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

export const relativeWeekLabel = (offset: number, labels: WeekNavLabels): string => {
  if (offset === 0) return labels.thisWeek;
  if (offset === -1) return labels.lastWeek;
  if (offset === 1) return labels.followingWeek;
  return tf(offset < 0 ? labels.weeksAgo : labels.weeksAhead, { n: Math.abs(offset) });
};

export const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Items grouped by the calendar day their 'YYYY-MM-DD HH:MM' value starts with. */
export function groupByDay<T>(items: T[], dateOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  items.forEach((item) => {
    const key = String(dateOf(item) || '').slice(0, 10);
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  });
  return map;
}

interface WeekCalendarProps {
  weekStart: Date;
  onWeekStartChange: (monday: Date) => void;
  labels: WeekNavLabels;
  loading: boolean;
  /** Right side of the week bar (counts, warnings) */
  summary?: React.ReactNode;
  /** Filter bar under the week bar */
  filters?: React.ReactNode;
  /** Rendered cards per day ('YYYY-MM-DD') */
  itemsByDay: Map<string, React.ReactNode[]>;
}

/** Week bar (‹ week ›, where it sits from today, a way back) over one column per day, Monday to Sunday. */
export const WeekCalendar: React.FC<WeekCalendarProps> = ({
  weekStart, onWeekStartChange, labels, loading, summary, filters, itemsByDay,
}) => {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = dayKey(days[0]);
  const weekOffset = weeksFromNow(weekStart);
  const todayKey = dayKey(new Date());
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

  return (
    <div data-tour="calendar" className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm min-h-0">
      {/* Week navigation: ‹ [Tuần 42 · 12/10 – 18/10/2026 ▾] ›, where it sits relative to today, a way back */}
      <div data-tour="calendar-week" className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="inline-flex items-stretch rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          <button
            type="button"
            aria-label={labels.prevWeek}
            title={labels.prevWeek}
            onClick={() => onWeekStartChange(addDays(weekStart, -7))}
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
                if (y && m && d) onWeekStartChange(startOfWeek(new Date(y, m - 1, d)));
              }}
              className="absolute inset-0 opacity-0 pointer-events-none"
            />
          </button>
          <button
            type="button"
            aria-label={labels.nextWeek}
            title={labels.nextWeek}
            onClick={() => onWeekStartChange(addDays(weekStart, 7))}
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
            onClick={() => onWeekStartChange(startOfWeek(new Date()))}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
            {labels.backToThisWeek}
          </button>
        )}
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        <span data-tour="calendar-summary" className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          {summary}
        </span>
      </div>

      {filters && (
        <div data-tour="calendar-filters" className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 shrink-0">
          {filters}
        </div>
      )}

      {/* One column per day */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="grid grid-cols-7 min-w-[900px] min-h-full divide-x divide-slate-200 dark:divide-slate-800">
          {days.map((d, i) => {
            const key = dayKey(d);
            const list = itemsByDay.get(key) || [];
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
                  {list}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** "Only late" style switch of a calendar's filter bar. */
export const FilterToggle: React.FC<{ active: boolean; onChange: (active: boolean) => void; icon?: React.ReactNode; children: React.ReactNode }> = ({
  active, onChange, icon, children,
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={() => onChange(!active)}
    className={`shrink-0 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
      active
        ? 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
    }`}
  >
    {icon}
    {children}
  </button>
);

/** How many filters are on, and a way to clear them all (nothing when none is on). */
export const ActiveFilters: React.FC<{ count: number; label: string; clearLabel: string; onClear: () => void }> = ({
  count, label, clearLabel, onClear,
}) =>
  count > 0 ? (
    <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
      <span className="whitespace-nowrap">{tf(label, { count })}</span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/40 whitespace-nowrap"
      >
        <X className="w-3 h-3" />
        {clearLabel}
      </button>
    </span>
  ) : null;
