import React from 'react';
import { AlarmClock, AlertTriangle, CalendarClock, CalendarDays, Ship } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { AppNotification } from '../../types';
import { tf } from '../../services/i18nFormat';

type Translations = ReturnType<typeof useApp>['t'];

const DMY_HM = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/;

/** '16/10/2026 14:00' -> local Date (null when unreadable). */
export const parseDmyHm = (value?: string): Date | null => {
  const m = DMY_HM.exec(String(value || '').trim());
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : null;
};

/** 'còn 3 giờ 19 phút' / 'còn 40 phút' / 'đã qua' from now until a cut-off. */
export const remainingText = (cutoff: string | undefined, t: Translations, now = new Date()): string => {
  const at = parseDmyHm(cutoff);
  if (!at) return '';
  const r = t.notifications.reminder;
  const minutes = Math.floor((at.getTime() - now.getTime()) / 60000);
  if (minutes < 0) return r.passed;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return tf(r.leftMinutes, { m });
  if (m === 0 || h >= 6) return tf(r.leftHours, { h });
  return tf(r.leftHoursMinutes, { h, m });
};

/** 'A, A, B' -> 'A ×2, B' */
export const groupBookingNumbers = (list: string[] = []): string => {
  const counts = new Map<string, number>();
  list.forEach((no) => counts.set(no, (counts.get(no) || 0) + 1));
  return Array.from(counts, ([no, n]) => (n > 1 ? `${no} ×${n}` : no)).join(', ');
};

/** '2026-10-16 10:40:46' -> '10:40 · 16/10/2026' */
export const formatStamp = (value: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value || '');
  return m ? `${m[4]}:${m[5]} · ${m[3]}/${m[2]}/${m[1]}` : value;
};

const shortCutoff = (cutoff?: string) => {
  const m = DMY_HM.exec(String(cutoff || '').trim());
  return m ? `${m[4].padStart(2, '0')}:${m[5]} ${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}` : cutoff || '';
};

const Chip: React.FC<{ tone: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ tone, icon, children }) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}>
    {icon}
    {children}
  </span>
);

const TONE = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  primary: 'bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
};

/** Body of a reminder in the bell list: chips instead of the stored sentence. */
export const ReminderSummary: React.FC<{ item: AppNotification }> = ({ item }) => {
  const { t } = useApp();
  const r = t.notifications.reminder;
  const d = item.detail || {};
  if (item.kind === 'morning_brief') {
    return (
      <span className="mt-1 flex flex-wrap gap-1">
        <Chip tone={TONE.primary}>{tf(r.chipToday, { count: d.today || 0 })}</Chip>
        {(d.late || 0) > 0 && <Chip tone={TONE.rose}>{tf(r.chipLate, { count: d.late || 0 })}</Chip>}
        <Chip tone={TONE.neutral}>{tf(r.chipTomorrow, { count: d.tomorrow || 0 })}</Chip>
        {(d.vessels_today || 0) > 0 && <Chip tone={TONE.sky}>{tf(r.chipVessels, { count: d.vessels_today || 0 })}</Chip>}
      </span>
    );
  }
  const left = remainingText(d.cutoff, t);
  const several = (d.count || 0) > 1;
  return (
    <span className="mt-1 block space-y-1">
      <span className="flex flex-wrap gap-1">
        <Chip tone={TONE.neutral} icon={<CalendarClock className="w-3 h-3" />}>{shortCutoff(d.cutoff)}</Chip>
        {left && <Chip tone={left === r.passed ? TONE.rose : TONE.amber}>{left}</Chip>}
      </span>
      {(several || d.vessel_name) && (
        <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
          {several ? groupBookingNumbers(d.bookings) : d.vessel_name}
        </span>
      )}
    </span>
  );
};

/** Detail of a cut-off reminder: the cut-off, time left, vessel and bookings. */
export const CutoffReminderDetail: React.FC<{ item: AppNotification }> = ({ item }) => {
  const { t } = useApp();
  const r = t.notifications.reminder;
  const d = item.detail || {};
  const left = remainingText(d.cutoff, t);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 p-3">
        <span className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
          <AlarmClock className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{r.cutoff}</div>
          <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100 leading-tight">{d.cutoff}</div>
        </div>
        {left && (
          <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${
            left === r.passed ? TONE.rose : 'bg-amber-500 text-white'
          }`}>
            {left}
          </span>
        )}
      </div>
      {d.vessel_name && (
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <Ship className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="font-semibold">{d.vessel_name}</span>
        </div>
      )}
      {(d.bookings || []).length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            {tf(r.bookingCount, { count: (d.bookings || []).length })}
          </div>
          <div className="flex flex-wrap gap-1">
            {groupBookingNumbers(d.bookings).split(', ').map((no) => (
              <Chip key={no} tone={TONE.neutral}>{no}</Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/** The morning brief: today's counts, the bookings due today and, with several collections, a split per collection. */
export const MorningBriefDetail: React.FC<{ item: AppNotification }> = ({ item }) => {
  const { t } = useApp();
  const r = t.notifications.reminder;
  const info = item.detail || {};
  const items = info.items || [];
  const more = (info.today || 0) - items.length;
  const tiles: { label: string; value: number; icon: React.ReactNode; tone: string; strong?: boolean }[] = [
    { label: r.tileToday, value: info.today || 0, icon: <CalendarClock className="w-3.5 h-3.5" />, tone: 'text-primary-600 dark:text-primary-400' },
    { label: r.tileLate, value: info.late || 0, icon: <AlertTriangle className="w-3.5 h-3.5" />, tone: 'text-rose-600 dark:text-rose-400', strong: (info.late || 0) > 0 },
    { label: r.tileTomorrow, value: info.tomorrow || 0, icon: <CalendarDays className="w-3.5 h-3.5" />, tone: 'text-slate-500 dark:text-slate-400' },
    { label: r.tileVessels, value: info.vessels_today || 0, icon: <Ship className="w-3.5 h-3.5" />, tone: 'text-sky-600 dark:text-sky-400' },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={`rounded-xl border px-3 py-2.5 ${
              tile.strong ? 'border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30' : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className={`text-2xl font-bold tabular-nums leading-none ${tile.strong ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                {tile.value}
              </span>
              <span className={tile.tone}>{tile.icon}</span>
            </div>
            <div className="mt-1.5 text-[11px] font-medium leading-tight text-slate-500 dark:text-slate-400">{tile.label}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{r.dueToday}</div>
        {items.length > 0 ? (
          <ul className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {items.map((b, i) => (
              <li key={`${b.booking_no}-${i}`} className="flex items-center gap-3 px-3 py-2">
                <span className="rounded-md bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-700 dark:text-amber-300 shrink-0">
                  {b.time}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800 dark:text-slate-100 truncate">{b.booking_no || '—'}</span>
                  {b.vessel && <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{b.vessel}</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 px-3 py-3 text-center text-xs text-slate-500 dark:text-slate-400">
            {r.nothingToday}
          </p>
        )}
        {more > 0 && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{tf(r.more, { count: more })}</p>}
      </div>

      {(info.collections || []).length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{r.perCollection}</div>
          <table className="w-full text-xs">
            <thead className="text-[10px] text-slate-400">
              <tr>
                <th className="text-left font-semibold" />
                <th className="font-semibold">{r.today}</th>
                <th className="font-semibold">{r.late}</th>
                <th className="font-semibold">{r.tomorrow}</th>
              </tr>
            </thead>
            <tbody>
              {(info.collections || []).map((c) => (
                <tr key={c.name}>
                  <td className="py-0.5 font-medium text-slate-700 dark:text-slate-200">{c.name}</td>
                  <td className="text-center tabular-nums">{c.today}</td>
                  <td className={`text-center tabular-nums ${c.late ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}`}>{c.late}</td>
                  <td className="text-center tabular-nums">{c.tomorrow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
