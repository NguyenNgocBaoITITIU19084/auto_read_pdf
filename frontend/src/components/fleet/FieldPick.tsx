import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import type { useFieldSelection } from '../../hooks/useFieldSelection';
import { copyTextToClipboard } from '../../utils/formatters';

/** Boxes of the fleet details (driver, truck) that can be picked and copied together, like the booking details: a tick
 *  by the box's name picks it (one click, the next one unpicks it), a copy button copies it alone. */

export type Selection = ReturnType<typeof useFieldSelection>;

/** A box's look: picked wins (blue), then edited (amber), else plain. One class set each, so they never fight. */
export const boxTone = (selected: boolean, dirty = false) =>
  selected ? 'border-primary-400 dark:border-primary-500 bg-primary-50/80 dark:bg-primary-950/40'
    : dirty ? 'border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20'
      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80';

/** The box's name with a tick in front. */
export const PickToggle: React.FC<{ id: string; label: string; picked: Selection; disabled?: boolean }> = ({ id, label, picked, disabled }) => {
  const selected = picked.selected.has(id);
  return (
    <button type="button" role="checkbox" aria-checked={selected} disabled={disabled} onClick={() => picked.toggle(id)}
      data-testid={`pick-${id}`}
      className="group/pick -ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-primary-50 dark:hover:bg-primary-950/40 disabled:cursor-default disabled:hover:bg-transparent">
      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${selected
        ? 'border-primary-500 bg-primary-600 text-white'
        : 'border-slate-300 dark:border-slate-600 group-hover/pick:border-primary-400 group-disabled/pick:opacity-40'}`}>
        {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
      <span className={`truncate text-[10px] font-semibold uppercase tracking-wider ${selected
        ? 'text-primary-700 dark:text-primary-300' : 'text-slate-500 dark:text-slate-400'}`}>{label}</span>
    </button>
  );
};

/** Copies one value at once (a tick for a moment after). */
export const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyTextToClipboard(value);
    addToast(ok ? t.common.copySuccess : t.fleet.toast.error, ok ? 'success' : 'error');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button type="button" onClick={() => void copy()} title={t.common.copy} aria-label={`${t.common.copy} ${label}`}
      className="p-0.5 rounded text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};

/** A box: its pick tick and name, its copy button, then its content (an input to edit, or a value to read). */
export const PickBox: React.FC<{
  id: string; label: string; copyValue: string; picked: Selection; dirty?: boolean; className?: string; testId?: string;
  children: React.ReactNode;
}> = ({ id, label, copyValue, picked, dirty = false, className = '', testId, children }) => {
  const { t } = useApp();
  const empty = !copyValue.trim();
  const selected = picked.selected.has(id);
  return (
    <div data-testid={testId ?? `field-${id}`} data-selected={selected || undefined}
      className={`flex flex-col px-2.5 py-1.5 rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-primary-500/30 ${
        boxTone(selected, dirty)} ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <PickToggle id={id} label={label} picked={picked} disabled={empty} />
        {!empty && <CopyButton value={copyValue} label={label} />}
      </div>
      {empty && typeof children === 'string' ? <div className="text-sm text-slate-400">{t.fleet.none}</div> : children}
    </div>
  );
};
