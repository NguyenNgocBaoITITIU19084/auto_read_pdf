import React, { useCallback, useEffect, useState } from 'react';

// Drawn inside the card (border + inset accent bar + tint): an outer ring would be clipped by the scrolling grid
const SELECTED_CLASS =
  'border-primary-400 dark:border-primary-500 bg-primary-50/80 dark:bg-primary-950/40 shadow-[inset_3px_0_0_0_theme(colors.primary.500)]';
const SELECTABLE_CLASS = 'cursor-pointer select-text hover:border-primary-300 dark:hover:border-primary-600';

/** Ticked field keys of a detail modal; cleared whenever `resetKey` changes (other record / modal closed). */
export function useFieldSelection(resetKey: unknown) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
  }, [resetKey]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const setAll = useCallback((keys: string[]) => setSelected(new Set(keys)), []);
  const clear = useCallback(() => setSelected((prev) => (prev.size === 0 ? prev : new Set())), []);

  /**
   * Spread on a field card to make the whole card click-to-select. Clicks on inner buttons / links and
   * drags that select text are ignored, so per-field copy buttons and text selection keep working.
   */
  const cardProps = useCallback(
    (key: string, disabled = false) => {
      if (disabled) return {};
      return {
        role: 'checkbox' as const,
        'aria-checked': selected.has(key),
        tabIndex: 0,
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('button, a')) return;
          if (window.getSelection()?.toString()) return;
          toggle(key);
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
    [selected, toggle]
  );
  /** Extra classes for a field card: pointer cursor, plus a highlight while selected. */
  const cardClass = useCallback(
    (key: string, disabled = false) => (disabled ? '' : `${SELECTABLE_CLASS} ${selected.has(key) ? SELECTED_CLASS : ''}`),
    [selected]
  );

  return { selected, toggle, setAll, clear, cardProps, cardClass };
}
