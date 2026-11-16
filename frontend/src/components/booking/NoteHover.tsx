import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Pencil, StickyNote } from 'lucide-react';
import { NOTE_MAX_LENGTH as NOTE_MAX_LEN } from './bookingForm';

export const NOTE_KEY = 'Ghi chú';

/** The booking's note, or '' when empty / "null". */
export const getBookingNote = (booking: Record<string, unknown>): string => {
  const v = booking[NOTE_KEY];
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s.toLowerCase() === 'null' ? '' : s;
};

export interface NoteQuickAddLabels {
  title: string;
  placeholder: string;
  save: string;
  saving: string;
  hint: string;
  /** with `allowEdit`: the button opening an existing note for editing, and the form's title then */
  edit?: string;
  editTitle?: string;
}

interface NoteHoverProps {
  note: string;
  title: string;
  children: React.ReactNode;
  className?: string;
  delay?: number;
  /** When set and there is no note, hovering opens a small form to add one. Rejects with an error message on failure. */
  onSave?: (note: string) => Promise<void>;
  addLabels?: NoteQuickAddLabels;
  /** longest note the quick-add form takes (the booking's by default) */
  maxLength?: number;
  /** An existing note can be edited from its card too (a "Sửa" button turns it into the form, filled in; saving it
   *  empty clears the note). Off for bookings. */
  allowEdit?: boolean;
}

const CARD_W = 300;
const GAP = 6;
const HIDE_DELAY = 200;

/**
 * Shows the booking note in a floating card while the pointer is over `children`;
 * for a booking without a note (and `onSave` given) the card is a quick-add form instead.
 * Rendered in a portal with fixed positioning so the table's overflow never clips it.
 */
export const NoteHover: React.FC<NoteHoverProps> = ({
  note, title, children, className = '', delay = 250, onSave, addLabels, maxLength = NOTE_MAX_LEN, allowEdit = false,
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  // the existing note can be opened for editing from its card (the card then takes the pointer)
  const canEdit = !!note && allowEdit && !!onSave && !!addLabels;
  // the card is the form: adding a note, or editing one
  const editable = (!note || editing) && !!onSave && !!addLabels;
  const interactive = editable || canEdit;
  // Once the user starts typing (or opened a note to edit), the form stays open until saved, Esc or a click outside.
  const pinned = editable && (editing || draft.trim() !== '' || saving);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = useCallback(() => {
    clear();
    setOpen(false);
    setPos(null);
    setDraft('');
    setError('');
    setEditing(false);
  }, []);
  const show = useCallback(() => {
    if (!note && !editable) return;
    clear();
    if (!open) timer.current = setTimeout(() => setOpen(true), delay);
  }, [note, editable, open, delay]);
  const hide = useCallback(() => {
    if (pinned) return;
    clear();
    if (!interactive) return close();
    // give the pointer time to travel from the anchor into the card
    timer.current = setTimeout(close, HIDE_DELAY);
  }, [pinned, interactive, close]);
  const startEdit = () => {
    clear();
    setDraft(note);
    setError('');
    setEditing(true);
  };
  // the textarea of a note opened for editing takes the focus, the caret at the end of the note
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  useEffect(() => clear, []);

  // Place below the anchor; flip above when there is no room; keep inside the viewport horizontally.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !cardRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const h = cardRef.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = a.bottom + GAP + h > vh && a.top - GAP - h > 0 ? a.top - GAP - h : a.bottom + GAP;
    const left = Math.max(8, Math.min(a.left, vw - CARD_W - 8));
    setPos({ top, left });
  }, [open, note, editable, editing]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (pinned || cardRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (cardRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      if (!saving) close();
    };
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, pinned, saving, close]);

  const submit = async () => {
    const text = draft.trim();
    // adding needs some text; editing may clear the note (saved empty)
    if ((!text && !editing) || saving || !onSave) return;
    if (text.length > maxLength) return;
    if (editing && text === note.trim()) return close();
    setSaving(true);
    setError('');
    try {
      await onSave(text);
      close();
    } catch (e: any) {
      setError(typeof e === 'string' ? e : e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const onFormKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  // Events inside the portal still bubble through the React tree to the row: keep them there.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const len = draft.trim().length;

  return (
    <span
      ref={anchorRef}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={interactive ? undefined : show}
      onBlur={interactive ? undefined : hide}
    >
      {children}
      {open && (note || editable) && createPortal(
        <div
          ref={cardRef}
          role={editable ? 'dialog' : 'tooltip'}
          aria-label={editable ? (editing ? addLabels?.editTitle || title : title) : undefined}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: CARD_W, zIndex: 9999 }}
          className={`${interactive ? '' : 'pointer-events-none '}rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-slate-800 shadow-lg p-3 text-xs cursor-auto`}
          onMouseEnter={interactive ? () => {
            clear();
            // focus only once the pointer is in the card, so hovering rows never steals focus from e.g. the search box
            if (editable) inputRef.current?.focus({ preventScroll: true });
          } : undefined}
          onMouseLeave={interactive ? hide : undefined}
          onClick={stop}
          onDoubleClick={stop}
          onMouseDown={stop}
        >
          <div className="flex items-center gap-1.5 mb-1.5 font-semibold text-amber-700 dark:text-amber-400">
            <StickyNote className="w-3.5 h-3.5" />
            <span className="flex-1">{editing ? addLabels?.editTitle || title : title}</span>
            {canEdit && !editing && (
              // mouse-down keeps the focus where it is: the button goes away on click, the textarea takes it
              <button type="button" onClick={startEdit} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
                <Pencil className="w-3 h-3" />{addLabels?.edit}
              </button>
            )}
          </div>
          {editable && addLabels ? (
            <div onKeyDown={onFormKeyDown}>
              <textarea
                ref={inputRef}
                rows={3}
                value={draft}
                disabled={saving}
                placeholder={addLabels.placeholder}
                onChange={(e) => { setDraft(e.target.value); setError(''); }}
                className="w-full resize-y min-h-[60px] rounded-lg border border-amber-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs leading-relaxed text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
              />
              {error && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400">
                  {addLabels.hint}
                  <span className={`ml-1.5 tabular-nums ${len > maxLength ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                    {len}/{maxLength}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={submit}
                  disabled={saving || (!len && !editing) || len > maxLength}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-2.5 py-1 text-[11px] transition-colors"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  {saving ? addLabels.saving : addLabels.save}
                </button>
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200 max-h-60 overflow-hidden leading-relaxed">
              {note}
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
};
