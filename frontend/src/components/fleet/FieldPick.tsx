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

/** A click anywhere on a box picks it (or unpicks it), like the booking details: its inputs, buttons and links keep
 *  their own clicks, and a drag or double click that selects text does not pick (it offers "copy this part"). The
 *  tick stays the box's keyboard control, so the box itself takes only the click. */
export const pickOnClick = (picked: Selection, id: string, disabled: boolean) => {
  if (disabled) return {};
  const { onClick, 'data-field-key': key, 'data-part': part } = picked.cardProps(id) as {
    onClick: (e: React.MouseEvent) => void; 'data-field-key': string; 'data-part'?: string;
  };
  return { onClick, 'data-field-key': key, 'data-part': part };
};
const CLICKABLE = 'cursor-pointer select-text hover:border-primary-300 dark:hover:border-primary-600';

/** A box: its pick tick and name, its copy button, then its content (an input to edit, or a value to read). */
export const PickBox: React.FC<{
  id: string; label: string; copyValue: string; picked: Selection; dirty?: boolean; className?: string; testId?: string;
  children: React.ReactNode;
}> = ({ id, label, copyValue, picked, dirty = false, className = '', testId, children }) => {
  const { t } = useApp();
  const empty = !copyValue.trim();
  const selected = picked.selected.has(id);
  return (
    <div data-testid={testId ?? `field-${id}`} data-selected={selected || undefined} {...pickOnClick(picked, id, empty)}
      className={`flex flex-col px-2.5 py-1.5 rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-primary-500/30 ${
        boxTone(selected, dirty)} ${empty ? '' : CLICKABLE} ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <PickToggle id={id} label={label} picked={picked} disabled={empty} />
        {!empty && <CopyButton value={copyValue} label={label} />}
      </div>
      {empty && typeof children === 'string' ? <div className="text-sm text-slate-400">{t.fleet.none}</div> : children}
    </div>
  );
};

const INPUT_IN_BOX = 'min-w-0 flex-1 bg-transparent p-0 border-0 text-sm font-semibold text-slate-800 dark:text-slate-100 '
  + 'placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:opacity-70';

/** A form box (an input, select or textarea): in an edit popup it can also be picked and copied like the booking
 *  details (`picked` given); in an add popup it is a plain labelled box. */
export const FormBox: React.FC<{
  id: string; label: string; copyValue: string; picked: Selection | null; required?: boolean; className?: string;
  children: React.ReactElement;
}> = ({ id, label, copyValue, picked, required, className = '', children }) => {
  if (!picked) {
    return (
      <label className={`block px-2.5 py-1.5 rounded-xl border bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/30 ${className}`}>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}{required && <span className="text-rose-500"> *</span>}
        </span>
        {React.cloneElement(children, { className: `block w-full ${INPUT_IN_BOX}` })}
      </label>
    );
  }
  return (
    <PickBox id={id} label={required ? `${label} *` : label} copyValue={copyValue} picked={picked} className={className}>
      {React.cloneElement(children, { 'aria-label': label, className: `block w-full ${INPUT_IN_BOX}` })}
    </PickBox>
  );
};
