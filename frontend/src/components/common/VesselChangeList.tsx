import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { AppNotification } from '../../types';
import { CHANGE_TONE, CHANGE_TONE_FALLBACK, notificationChanges, shortDateTime, timeShift } from '../../utils/notifications';

/** "+1 ngày": amber when the time moved later, rose when it moved earlier (less time to prepare). */
const ShiftBadge: React.FC<{ oldValue: string; newValue: string; compact?: boolean }> = ({ oldValue, newValue, compact }) => {
  const { t } = useApp();
  const shift = timeShift(oldValue, newValue, t, compact);
  if (!shift) return null;
  const later = shift.minutes > 0;
  return (
    <span
      title={later ? t.notifications.shift.later : t.notifications.shift.earlier}
      className={`inline-block px-1.5 py-px rounded-full text-[10px] font-bold whitespace-nowrap ${
        later
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
          : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
      }`}
    >
      {shift.text}
    </span>
  );
};

const Pill: React.FC<{ kind: string; label: string }> = ({ kind, label }) => (
  <span className={`inline-block px-1.5 py-px rounded-md text-[10px] font-bold whitespace-nowrap ${CHANGE_TONE[kind] || CHANGE_TONE_FALLBACK}`}>
    {label}
  </span>
);

/** Every changed time of a grouped vessel notification: compact rows for the bell, a before / after table for the detail. */
export const VesselChangeList: React.FC<{ item: AppNotification; variant: 'compact' | 'full' }> = ({ item, variant }) => {
  const { t } = useApp();
  const changes = notificationChanges(item, t);
  if (changes.length === 0) return null;

  if (variant === 'compact') {
    return (
      <span className="mt-1.5 grid grid-cols-[auto,auto,1fr] items-center gap-x-3 gap-y-1.5 text-[11px] tabular-nums">
        {changes.map((c) => (
          <React.Fragment key={c.kind}>
            <Pill kind={c.kind} label={c.label} />
            <span className="flex items-center gap-1 whitespace-nowrap min-w-0">
              <span className="text-slate-400 dark:text-slate-500 line-through decoration-slate-300 dark:decoration-slate-600">{shortDateTime(c.old)}</span>
              <ArrowRight className="w-3 h-3 shrink-0 text-slate-400" />
              <span className="font-semibold text-slate-900 dark:text-slate-100">{shortDateTime(c.new)}</span>
            </span>
            <span className="text-right"><ShiftBadge oldValue={c.old} newValue={c.new} compact /></span>
          </React.Fragment>
        ))}
      </span>
    );
  }

  const d = t.notifications.detail;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-slate-50 dark:bg-slate-800/80 text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-2.5 py-1.5 text-left font-semibold" />
            <th className="px-2.5 py-1.5 text-left font-semibold">{d.before}</th>
            <th className="px-2.5 py-1.5 text-left font-semibold text-primary-600 dark:text-primary-400">{d.after}</th>
            <th className="px-2.5 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {changes.map((c) => (
            <tr key={c.kind}>
              <td className="px-2.5 py-2"><Pill kind={c.kind} label={c.label} /></td>
              <td className="px-2.5 py-2 text-slate-400 dark:text-slate-500 line-through decoration-slate-300 dark:decoration-slate-600 whitespace-nowrap">{c.old}</td>
              <td className="px-2.5 py-2 font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">{c.new}</td>
              <td className="px-2.5 py-2 text-right whitespace-nowrap"><ShiftBadge oldValue={c.old} newValue={c.new} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
