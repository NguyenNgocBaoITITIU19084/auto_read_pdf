import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';

// Drawn inside the card (border + inset accent bar + tint): an outer ring would be clipped by the scrolling grid
const SELECTED_CLASS =
  'border-primary-400 dark:border-primary-500 bg-primary-50/80 dark:bg-primary-950/40 shadow-[inset_3px_0_0_0_theme(colors.primary.500)]';
const SELECTABLE_CLASS = 'cursor-pointer select-text hover:border-primary-300 dark:hover:border-primary-600';
// "Only: NORFOLK" under a card that copies just part of its value (text comes from data-part)
const PART_CLASS =
  "after:content-[attr(data-part)] after:mt-1 after:self-start after:px-1.5 after:py-0.5 after:rounded-md after:text-[10px] after:font-bold after:bg-amber-100 after:text-amber-800 dark:after:bg-amber-950/60 dark:after:text-amber-300";

/**
 * A single click ticks the card only once it is clear it was not the start of a double / triple click,
 * which selects a word / the whole value to copy part of it (e.g. "NORFOLK" out of "NORFOLK, VA").
 */
export const CLICK_TOGGLE_DELAY_MS = 250;

/** Text highlighted inside one field card: can be picked as that field's value. */
export interface PendingPart {
  key: string;
  text: string;
}

const FIELD_ATTR = 'data-field-key';

/** The highlighted text when it lies inside a single field card, else null. */
function readPendingPart(): PendingPart | null {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  const text = sel?.toString().replace(/\s+/g, ' ').trim();
  if (!sel || !text || !sel.anchorNode || !sel.focusNode) return null;
  const cardOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest(`[${FIELD_ATTR}]`) ?? null;
  const card = cardOf(sel.anchorNode);
  if (!card || card !== cardOf(sel.focusNode)) return null;
  return { key: card.getAttribute(FIELD_ATTR) || '', text };
}

/** Ticked field keys of a detail modal; cleared whenever `resetKey` changes (other record / modal closed). */
export function useFieldSelection(resetKey: unknown) {
  const { t } = useApp();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  /** Ticked fields that copy only the part the user highlighted */
  const [parts, setParts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [pendingPart, setPendingPart] = useState<PendingPart | null>(null);
  const pendingClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingClick = useCallback(() => {
    if (pendingClickRef.current) clearTimeout(pendingClickRef.current);
    pendingClickRef.current = null;
  }, []);
  useEffect(() => cancelPendingClick, [cancelPendingClick]);

  useEffect(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
    setParts((prev) => (prev.size === 0 ? prev : new Map()));
  }, [resetKey]);

  // Follow the text selection: highlighting part of a card offers "pick this part" in the copy bar
  useEffect(() => {
    const onChange = () => {
      const next = readPendingPart();
      setPendingPart((prev) => (prev?.key === next?.key && prev?.text === next?.text ? prev : next));
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);

  const dropPart = (key: string) =>
    setParts((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // A plain click means the whole value again (or nothing)
    dropPart(key);
  }, []);
  const setAll = useCallback((keys: string[]) => setSelected(new Set(keys)), []);
  const clear = useCallback(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
    setParts((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);

  /** Ticks the field of the highlighted text, copying only that part. */
  const pickPart = useCallback((part: PendingPart) => {
    setSelected((prev) => (prev.has(part.key) ? prev : new Set(prev).add(part.key)));
    setParts((prev) => new Map(prev).set(part.key, part.text));
    window.getSelection()?.removeAllRanges();
    setPendingPart(null);
  }, []);

  /**
   * Spread on a field card to make the whole card click-to-select. Clicks on inner buttons / links, drags
   * that select text and double / triple clicks are ignored, so copy buttons and text selection keep working.
   */
  const cardProps = useCallback(
    (key: string, disabled = false) => {
      if (disabled) return {};
      const part = selected.has(key) ? parts.get(key) : undefined;
      return {
        role: 'checkbox' as const,
        'aria-checked': selected.has(key),
        tabIndex: 0,
        [FIELD_ATTR]: key,
        ...(part !== undefined ? { 'data-part': `${t.common.fieldCopy.partOnly} ${part}` } : {}),
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('button, a')) return;
          cancelPendingClick();
          // 2nd / 3rd click of a word / line selection: the first click must not tick the card either
          if (e.detail > 1) return;
          if (window.getSelection()?.toString()) return;
          pendingClickRef.current = setTimeout(() => {
            pendingClickRef.current = null;
            if (!window.getSelection()?.toString()) toggle(key);
          }, CLICK_TOGGLE_DELAY_MS);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggle(key);
          }
        },
      };
    },
    [selected, parts, t, toggle, cancelPendingClick]
  );
  /** Extra classes for a field card: pointer cursor, plus a highlight while selected. */
  const cardClass = useCallback(
    (key: string, disabled = false) =>
      disabled
        ? ''
        : `${SELECTABLE_CLASS} ${selected.has(key) ? SELECTED_CLASS : ''} ${selected.has(key) && parts.has(key) ? PART_CLASS : ''}`,
    [selected, parts]
  );

  /** Props for <FieldCopyBar />, besides `entries`. */
  const barProps = useMemo(
    () => ({ selected, parts, pendingPart, onSelectAll: setAll, onClear: clear, onPickPart: pickPart }),
    [selected, parts, pendingPart, setAll, clear, pickPart]
  );

  return { selected, parts, pendingPart, toggle, setAll, clear, pickPart, cardProps, cardClass, barProps };
}
