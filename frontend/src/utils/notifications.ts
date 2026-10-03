import type { AppNotification, VesselTimeChange } from '../types';
import type { AppContextType } from '../context/AppContext';
import { tf } from '../services/i18nFormat';

type Translations = AppContextType['t'];

/** Vessel + voyage or container number, as the notification's subject. */
export function notificationSubject(n: AppNotification): string {
  const d = n.detail || {};
  if (n.kind.startsWith('container_')) return d.container || n.nav_query || '';
  return [d.vessel, d.voyage].filter(Boolean).join(' ') || n.nav_query || '';
}

/** Localized headline; falls back to the backend's Vietnamese text for an unknown kind. */
export function notificationTitle(n: AppNotification, t: Translations): string {
  if (n.kind === 'test') return t.notifications.testTitle;
  const template = (t.notifications.titles as Record<string, string>)[n.kind];
  const subject = notificationSubject(n);
  return template && subject ? tf(template, { name: subject }) : n.title;
}

/** The changed times of a grouped vessel notification, with localized labels ([] for any other kind). */
export function notificationChanges(n: AppNotification, t: Translations): (VesselTimeChange & { text: string })[] {
  const labels = t.notifications.changeLabels as Record<string, string>;
  return (n.detail?.changes || []).map((c) => {
    const label = labels[c.kind] || c.label;
    return { ...c, label, text: `${label} ${c.old} → ${c.new}` };
  });
}

/** Tailwind classes of the label pill of each changed time. */
export const CHANGE_TONE: Record<string, string> = {
  vessel_etd: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
  vessel_eta: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  vessel_closing: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  vessel_closing_icd: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  vessel_open_gate: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};
export const CHANGE_TONE_FALLBACK = 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

const DMY_HM = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/;

function parseDmyHm(value: string): number | null {
  const m = DMY_HM.exec((value || '').trim());
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : null;
}

/** "07/10/2026 23:00" -> "07/10 23:00" (the year rarely matters in the compact list). */
export function shortDateTime(value: string): string {
  const m = DMY_HM.exec((value || '').trim());
  return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')} ${m[4].padStart(2, '0')}:${m[5]}` : value;
}

/** How far a time moved: {minutes, text: "+1 ngày 2 giờ"} ("+1 ngày" when compact: the largest unit, rounded);
 *  null when either side can't be read or nothing moved. */
export function timeShift(
  oldValue: string, newValue: string, t: Translations, compact = false,
): { minutes: number; text: string } | null {
  const before = parseDmyHm(oldValue);
  const after = parseDmyHm(newValue);
  if (before === null || after === null || before === after) return null;
  const minutes = Math.round((after - before) / 60000);
  const s = t.notifications.shift;
  const sign = minutes > 0 ? '+' : '−';
  const unit = (n: number, word: string) => (word.length <= 1 ? `${n}${word}` : `${n} ${word}`);
  const abs = Math.abs(minutes);
  if (compact) {
    const text = abs >= 1440 ? unit(Math.round(abs / 1440), s.day)
      : abs >= 60 ? unit(Math.round(abs / 60), s.hour) : unit(abs, s.minute);
    return { minutes, text: `${sign}${text}` };
  }
  let rest = abs;
  const days = Math.floor(rest / 1440);
  rest -= days * 1440;
  const hours = Math.floor(rest / 60);
  const mins = rest - hours * 60;
  const parts = [
    days ? unit(days, s.day) : '',
    hours ? unit(hours, s.hour) : '',
    !days && mins ? unit(mins, s.minute) : '',
  ].filter(Boolean);
  return { minutes, text: `${sign}${parts.join(' ')}` };
}

/** "old → new" for a changed time (one line per time for a grouped vessel notification), just the new value for an event. */
export function notificationChange(n: AppNotification, t?: Translations): string {
  if (t && n.detail?.changes?.length) return notificationChanges(n, t).map((c) => c.text).join('\n');
  return n.old_value ? `${n.old_value} → ${n.new_value}` : n.new_value;
}
