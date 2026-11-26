import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import type { useFieldSelection } from '../../hooks/useFieldSelection';
import { copyTextToClipboard } from '../../utils/formatters';

/** Boxes of the fleet popups (details and edit forms) that are picked and copied together exactly like the booking
 *  details' cards: a click on the box picks it (the next one unpicks it), its copy button copies it alone. */

export type Selection = ReturnType<typeof useFieldSelection>;

/** A box's look, the booking details' card: picked = the booking's own highlight (tint + left accent bar, from
 *  useFieldSelection's cardClass); else edited (amber), empty (faded) or plain. */
export const boxTone = (selected: boolean, dirty = false, empty = false) =>
  selected ? ''
    : dirty ? 'border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20'
      : empty ? 'bg-slate-50/40 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50'
        : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 shadow-xs';

/** A box's name, as the booking details write it (no tick: the whole box is what is picked). */
export const PickLabel: React.FC<{ label: string }> = ({ label }) => (
  <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
);

/** Copies one value at once (a tick for a moment after), the booking details' copy button. */
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

/** The props that make a box pick-on-click exactly like a booking detail card (useFieldSelection's cardProps and
 *  cardClass): a click picks / unpicks it, Space / Enter too; its inputs, buttons and links keep their clicks, and
 *  a drag or double click that selects text offers "copy this part" instead. Empty boxes are not picked. */
export const pickCard = (picked: Selection, id: string, disabled: boolean) => ({
  ...picked.cardProps(id, disabled),
  'data-selected': picked.selected.has(id) || undefined,
});

/** A box: its name and copy button, then its content (an input to edit, or a value to read). */
export const PickBox: React.FC<{
  id: string; label: string; copyValue: string; picked: Selection; dirty?: boolean; className?: string; testId?: string;
  children: React.ReactNode;
}> = ({ id, label, copyValue, picked, dirty = false, className = '', testId, children }) => {
  const { t } = useApp();
  const empty = !copyValue.trim();
  return (
    <div data-testid={testId ?? `field-${id}`} {...pickCard(picked, id, empty)}
      className={`flex flex-col p-2.5 rounded-xl border transition-all focus-within:ring-2 focus-within:ring-primary-500/30 ${
        picked.cardClass(id, empty)} ${boxTone(picked.selected.has(id), dirty, empty)} ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <PickLabel label={label} />
        {!empty && <CopyButton value={copyValue} label={label} />}
      </div>
      {empty && typeof children === 'string' ? <div className="text-sm italic text-slate-400 dark:text-slate-500">{t.fleet.none}</div> : children}
    </div>
  );
};

const INPUT_IN_BOX = 'min-w-0 flex-1 bg-transparent p-0 border-0 text-sm font-semibold text-slate-800 dark:text-slate-100 '
  + 'placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:opacity-70';
/** A field inside a pickable box takes only the room of its text (field-sizing), so the rest of the box, beside and
 *  around it, picks the box like a booking card; the field itself is still where a click edits. */
export const PICK_INPUT = 'block max-w-full min-w-[3ch] [field-sizing:content] bg-transparent p-0 border-0 text-sm font-semibold '
  + 'text-slate-800 dark:text-slate-100 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:ring-0 '
  + 'disabled:opacity-70 cursor-text';
/** A note (textarea) is the exception: it spans the box and keeps at least two lines, growing with its text. An
 *  empty one sized to its content would shrink to a sliver with only its resize handle showing. */
export const PICK_TEXTAREA = 'block w-full min-h-[3.25rem] [field-sizing:content] resize-y bg-transparent p-0 border-0 '
  + 'text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:font-normal placeholder:text-slate-400 '
  + 'focus:outline-none focus:ring-0 disabled:opacity-70 cursor-text';
/** The class of a field inside a pickable box. */
export const pickInputClass = (child: React.ReactElement) => (child.type === 'textarea' ? PICK_TEXTAREA : PICK_INPUT);

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
      {React.cloneElement(children, { 'aria-label': label, className: pickInputClass(children) })}
    </PickBox>
  );
};
