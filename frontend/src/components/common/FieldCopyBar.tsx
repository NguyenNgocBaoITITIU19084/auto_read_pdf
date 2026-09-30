import React from 'react';
import { ClipboardCopy, ListChecks, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { copyTextToClipboard } from '../../utils/formatters';
import { tf } from '../../services/i18nFormat';
import { CopyEntry, FieldCopyMode, copyableEntries, formatEntriesForCopy } from '../../utils/fieldCopy';

interface FieldCheckProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
}

/** Small tick box shown in a field card header. */
export const FieldCheck: React.FC<FieldCheckProps> = ({ checked, onToggle, label }) => (
  <input
    type="checkbox"
    checked={checked}
    onChange={onToggle}
    aria-label={label}
    title={label}
    className="rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer shrink-0"
  />
);

interface FieldCopyBarProps {
  entries: CopyEntry[];
  selected: ReadonlySet<string>;
  onSelectAll: (keys: string[]) => void;
  onClear: () => void;
}

/** Toolbar above a detail grid: pick several fields, then copy them together. */
export const FieldCopyBar: React.FC<FieldCopyBarProps> = ({ entries, selected, onSelectAll, onClear }) => {
  const { t, addToast } = useApp();
  const f = t.common.fieldCopy;
  const available = copyableEntries(entries);
  const count = available.filter((e) => selected.has(e.key)).length;

  const copy = async (mode: FieldCopyMode) => {
    const text = formatEntriesForCopy(entries, selected, mode);
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    addToast(ok ? tf(f.copied, { count }) : t.common.error, ok ? 'success' : 'error');
  };

  const btn =
    'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors whitespace-nowrap';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 px-2.5 py-1.5">
      <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
        <ListChecks className="w-3.5 h-3.5" />
        {count > 0 ? <strong className="text-slate-700 dark:text-slate-200">{tf(f.selected, { count })}</strong> : f.hint}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {count < available.length && (
          <button
            type="button"
            onClick={() => onSelectAll(available.map((e) => e.key))}
            className={`${btn} border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700`}
          >
            {f.selectAll}
          </button>
        )}
        {count > 0 && (
          <>
            <button
              type="button"
              onClick={() => copy('labeled')}
              className={`${btn} bg-primary-600 hover:bg-primary-700 text-white border-primary-600`}
            >
              <ClipboardCopy className="w-3.5 h-3.5" />
              {f.copyLabeled}
            </button>
            <button
              type="button"
              onClick={() => copy('values')}
              className={`${btn} border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/40`}
            >
              {f.copyValues}
            </button>
            <button
              type="button"
              onClick={onClear}
              aria-label={f.clear}
              title={f.clear}
              className={`${btn} border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 px-1.5`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
