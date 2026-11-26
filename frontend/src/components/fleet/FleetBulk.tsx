import React, { useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { apiError } from './fleetUtils';

/** Multi-select for the fleet tables (Đầu kéo, Tài xế, Rơ moóc), like the booking table: a checkbox column (shift-click
 *  for a range), a page checkbox in the header, and the shared BulkActionBar at the bottom. */

const CHECKBOX = 'w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer align-middle';

/** Header cell: every row of this page (indeterminate when only some are picked). */
export const SelectHeader: React.FC<{ checked: boolean; partial: boolean; disabled?: boolean; onChange: () => void }> = ({
  checked, partial, disabled, onChange,
}) => {
  const { t } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <th className="pl-4 pr-1 py-2.5 w-8">
      <input ref={ref} type="checkbox" aria-label={t.bulk.selectPage} title={t.bulk.selectPage} checked={checked}
        disabled={disabled} onChange={onChange} className={CHECKBOX} />
    </th>
  );
};

/** Row cell: its own clicks (and double-clicks) never reach the row (no details, no row menu). */
export const SelectCell: React.FC<{ checked: boolean; label: string; onToggle: (shiftKey: boolean) => void }> = ({ checked, label, onToggle }) => (
  <td className="pl-4 pr-1 py-3 w-8 align-middle" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
    <input type="checkbox" checked={checked} aria-label={label} onChange={() => undefined}
      onClick={(e) => onToggle(e.shiftKey)} className={CHECKBOX} />
  </td>
);

/** Row background: picked rows stay tinted (the row whose menu is open too). */
export const rowTone = (selected: boolean, menuOpen: boolean) =>
  selected ? 'bg-primary-50/70 dark:bg-primary-950/30'
    : menuOpen ? 'bg-primary-50/60 dark:bg-primary-950/30' : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40';

/** Runs `work` on each item one after another (the fleet is small; each change keeps its own rules, e.g. a truck that
 *  stops running drops its driver). Returns how many worked and the distinct errors of the others. */
export async function runEach<T>(items: T[], work: (item: T) => Promise<unknown>, fallback: string): Promise<{ ok: number; errors: string[] }> {
  let ok = 0;
  const errors = new Set<string>();
  for (const item of items) {
    try {
      await work(item);
      ok += 1;
    } catch (err) {
      errors.add(apiError(err, fallback));
    }
  }
  return { ok, errors: [...errors] };
}

export interface StatusOption {
  value: string;
  label: string;
  /** a Tailwind bg-* class for the dot */
  dot: string;
}

/** Pick the new status of the selected rows. */
export const StatusPickerModal: React.FC<{
  open: boolean; title: string; hint?: string; options: StatusOption[]; onPick: (value: string) => void; onClose: () => void;
}> = ({ open, title, hint, options, onPick, onClose }) => (
  <Modal isOpen={open} onClose={onClose} title={title} maxWidth="max-w-sm">
    <div className="space-y-3" data-testid="fleet-status-picker">
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      <div className="grid gap-1.5">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onPick(o.value)}
            className="flex items-center gap-2.5 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-primary-400 hover:bg-primary-50/60 dark:hover:bg-primary-950/30 text-left">
            <span className={`w-2 h-2 rounded-full ${o.dot}`} />{o.label}
          </button>
        ))}
      </div>
    </div>
  </Modal>
);
