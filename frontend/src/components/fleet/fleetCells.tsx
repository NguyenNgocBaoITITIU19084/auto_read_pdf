import React from 'react';
import { CheckCircle2, StickyNote } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';
import type { DriverStatus, FleetDocumentKind, VehicleStatus } from '../../types';
import { daysLeftText } from '../common/ReminderViews';
import { NoteHover } from '../booking/NoteHover';
import { EXPIRY_WARN_DAYS, daysUntil, formatIsoDate } from './fleetUtils';

/** Table pieces shared by the fleet tabs (tractors, drivers, trailers): status badges, document and date cells. */

export const VEHICLE_TONE: Record<VehicleStatus, { badge: string; dot: string }> = {
  ready: { badge: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300', dot: 'bg-sky-500' },
  not_ready: { badge: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300', dot: 'bg-orange-500' },
  active: { badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  broken: { badge: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300', dot: 'bg-rose-500' },
  maintenance: { badge: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300', dot: 'bg-amber-500' },
  inactive: { badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' },
};
export const DRIVER_TONE: Record<DriverStatus, { badge: string; dot: string }> = {
  not_ready: { badge: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300', dot: 'bg-orange-500' },
  active: { badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  leave: { badge: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300', dot: 'bg-amber-500' },
  left: { badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' },
};
export const TEMP_CHIP = 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300';
/** marks a truck (xe tải) where tractors and trucks are listed together */
export const TRUCK_CHIP = 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300';

export const StatusBadge: React.FC<{ tone: { badge: string; dot: string }; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full pl-2 pr-2.5 py-1 text-xs font-semibold ${tone.badge}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
    {children}
  </span>
);

export const Chip: React.FC<{ tone: string; children: React.ReactNode; title?: string }> = ({ tone, children, title }) => (
  <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
    {children}
  </span>
);

export const TH = 'px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap';
export const TD = 'px-4 py-3 align-middle';

/** The row number (STT) column, right after the checkbox: counted across pages, as the booking table does. */
export const SttTh: React.FC<{ label: string }> = ({ label }) => (
  <th className="w-12 px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
    {label}
  </th>
);
export const SttTd: React.FC<{ n: number }> = ({ n }) => (
  <td data-testid="stt" className="w-12 px-2 py-3 align-middle text-center tabular-nums text-xs font-semibold text-slate-400 dark:text-slate-500">{n}</td>
);
/** The STT of the `i`-th row of page `page` (1-based) of `pageSize` rows. */
export const sttOf = (page: number, pageSize: number, i: number) => (page - 1) * pageSize + i + 1;
export const MUTED = 'text-xs text-slate-500 dark:text-slate-400';
export const ROW = 'cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500';

/** A double-click on a button / link inside a row is that control's, not the row's. */
export const fromControl = (e: React.SyntheticEvent) => !!(e.target as HTMLElement).closest('button, a, input, select, textarea');

export interface DocWarning { kind: FleetDocumentKind; days: number; date: string }

/** Documents of a truck / driver that are expired or expire within the reminder window, soonest first. */
export function docWarnings(entries: [FleetDocumentKind, string][], today: string): DocWarning[] {
  return entries
    .map(([kind, iso]) => ({ kind, days: daysUntil(iso, today), date: iso }))
    .filter((d): d is DocWarning => d.days !== null && d.days <= EXPIRY_WARN_DAYS)
    .sort((a, b) => a.days - b.days);
}

export type DocState = 'expired' | 'soon' | 'ok' | 'none';
export const DOC_STATES: DocState[] = ['expired', 'soon', 'ok', 'none'];

/** How a row's documents stand overall: the worst of them. */
export function docState(entries: [FleetDocumentKind, string][], today: string): DocState {
  const days = entries.map(([, iso]) => daysUntil(iso, today)).filter((d): d is number => d !== null);
  if (days.length === 0) return 'none';
  const soonest = Math.min(...days);
  return soonest < 0 ? 'expired' : soonest <= EXPIRY_WARN_DAYS ? 'soon' : 'ok';
}

/** Days until the soonest of a row's documents expires (null: no dates), for sorting. */
export function soonestDays(entries: [FleetDocumentKind, string][], today: string): number | null {
  const days = entries.map(([, iso]) => daysUntil(iso, today)).filter((d): d is number => d !== null);
  return days.length ? Math.min(...days) : null;
}

/** One cell for all of a row's documents: a green "Còn hạn", or the ones needing attention. Dates in the tooltip. */
export const DocsCell: React.FC<{ entries: [FleetDocumentKind, string][]; today: string; muted?: boolean }> = ({ entries, today, muted }) => {
  const { t } = useApp();
  const names = t.notifications.reminder.fleetDocs;
  const title = entries.map(([kind, iso]) => `${names[kind]}: ${iso ? formatIsoDate(iso) : t.fleet.none}`).join('\n');
  if (!entries.some(([, iso]) => iso)) return <span className={MUTED} title={title}>{t.fleet.list.noDates}</span>;
  // a truck out of service / a driver who left: the real state, but quiet (nobody needs to act on it)
  if (muted) return <span className={MUTED} title={title}>{t.fleet.table.docState[docState(entries, today)]}</span>;
  const warnings = docWarnings(entries, today);
  if (warnings.length === 0) {
    return (
      <span title={title} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />{t.fleet.list.docsOk}
      </span>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1" title={title}>
      {warnings.map((w) => (
        <Chip key={w.kind} tone={w.days < 0 ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
          : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}>
          {names[w.kind]} · {daysLeftText(w.days, t).toLowerCase()}
        </Chip>
      ))}
    </div>
  );
};

/** A single date column: the date, and the days left once inside the reminder window. */
export const DateCell: React.FC<{ iso: string; today: string; muted?: boolean }> = ({ iso, today, muted }) => {
  const { t } = useApp();
  const days = daysUntil(iso, today);
  if (days === null) return <span className="text-slate-300 dark:text-slate-600">{t.fleet.none}</span>;
  const warn = !muted && days <= EXPIRY_WARN_DAYS;
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className={warn ? (days < 0 ? 'font-semibold text-rose-600 dark:text-rose-400' : 'font-semibold text-amber-700 dark:text-amber-300')
        : 'text-slate-700 dark:text-slate-200'}>{formatIsoDate(iso)}</span>
      {warn && <span className={`block text-[11px] ${days < 0 ? 'text-rose-500' : 'text-amber-600 dark:text-amber-400'}`}>{daysLeftText(days, t)}</span>}
    </span>
  );
};

/** Longest note the fleet keeps (the server cuts the rest) */
export const FLEET_NOTE_MAX = 1000;

/** The note mark next to a row's name, like the booking table's: hovering it shows the note in a card; with no note
 *  and `onSave` given, a faint mark whose card is a quick form to add one (Ctrl/⌘ + Enter saves, Esc closes). With
 *  `onSave`, an existing note can be edited from its card too ("Sửa"; saved empty, it is cleared). */
export const NoteIcon: React.FC<{ note: string; name?: string; onSave?: (note: string) => Promise<void> }> = ({ note, name = '', onSave }) => {
  const { t } = useApp();
  const text = note.trim();
  if (!text && !onSave) return null;
  const L = t.fleet.list;
  return (
    <NoteHover note={text} title={text ? t.fleet.cols.note : L.noteAdd} delay={120} className="inline-flex align-middle ml-1.5"
      onSave={onSave} maxLength={FLEET_NOTE_MAX} allowEdit addLabels={{
        title: L.noteAdd, placeholder: tf(L.notePh, { name }), hint: t.booking.noteQuick.hint,
        save: t.booking.form.save, saving: t.booking.form.saving, edit: L.noteEdit, editTitle: L.noteEditTitle,
      }}>
      {text ? (
        <StickyNote data-testid="note-icon" aria-label={tf(L.noteTitle, { note: text })}
          className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 cursor-help" />
      ) : (
        <StickyNote data-testid="note-add" aria-label={L.noteAdd}
          className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 hover:text-amber-400 dark:hover:text-amber-500 transition-colors cursor-pointer" />
      )}
    </NoteHover>
  );
};

