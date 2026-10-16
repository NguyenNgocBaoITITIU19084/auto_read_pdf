import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter, Search } from 'lucide-react';
import type { ColumnValueCount } from '../../services/api';
import { tf } from '../../services/i18nFormat';

export interface ColumnFilterLabels {
  /** 'Lọc theo {col}' */
  button: string;
  active: string;
  search: string;
  all: string;
  clear: string;
  empty: string;
  none: string;
  loading: string;
}

interface ColumnValueFilterProps {
  /** Column label, for the button title */
  column: string;
  /** Distinct values of the column with their row counts; reloaded on every open */
  loadOptions: () => Promise<ColumnValueCount[]>;
  /** Selected values ('' = blank cells); empty = no filter */
  value: string[];
  onChange: (values: string[]) => void;
  labels: ColumnFilterLabels;
}

const WIDTH = 224;
const MARGIN = 8;

/** Filter button for a table column (e.g. the carrier): a checkbox list of its values, in a portal. */
export const ColumnValueFilter: React.FC<ColumnValueFilterProps> = ({ column, loadOptions, value, onChange, labels }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [options, setOptions] = useState<ColumnValueCount[] | null>(null);
  const loadRef = useRef(loadOptions);
  loadRef.current = loadOptions;
  const [query, setQuery] = useState('');

  // Fresh list on every open: rows may have been added since
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setOptions(null);
    loadRef.current()
      .then((list) => alive && setOptions(list))
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [open]);

  // Under the button, kept inside the window
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setPos({ left: Math.max(MARGIN, Math.min(r.left, window.innerWidth - WIDTH - MARGIN)), top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = (e: Event) => !panelRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const selected = new Set(value);
  const toggle = (c: string) => onChange(selected.has(c) ? value.filter((v) => v !== c) : [...value, c]);
  const q = query.trim().toUpperCase();
  const shown = (options || []).filter((o) => !q || (o.carrier || labels.empty).toUpperCase().includes(q));
  const active = value.length > 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={active ? tf(labels.active, { n: value.length }) : tf(labels.button, { col: column })}
        aria-label={tf(labels.button, { col: column })}
        aria-expanded={open}
        className={`shrink-0 flex items-center gap-0.5 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${
          active ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400 dark:text-slate-500 opacity-60 group-hover/th:opacity-100'
        }`}
      >
        <Filter className="w-3 h-3" fill={active ? 'currentColor' : 'none'} />
        {active && <span className="text-[10px] font-bold leading-none">{value.length}</span>}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: WIDTH }}
            className="fixed z-50 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl text-xs font-normal text-slate-700 dark:text-slate-200"
          >
            <div className="p-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800">
                <Search className="w-3 h-3 text-slate-400 shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={labels.search}
                  className="w-full bg-transparent outline-none text-xs placeholder:text-slate-400"
                />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {options === null ? (
                <div className="px-3 py-2 text-slate-400">{labels.loading}</div>
              ) : shown.length === 0 ? (
                <div className="px-3 py-2 text-slate-400">{labels.none}</div>
              ) : (
                shown.map((o) => (
                  <label
                    key={o.carrier}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(o.carrier)}
                      onChange={() => toggle(o.carrier)}
                      className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                    />
                    <span className={`flex-1 truncate ${o.carrier ? '' : 'italic text-slate-400'}`}>{o.carrier || labels.empty}</span>
                    <span className="text-[10px] text-slate-400 tabular-nums">{o.count}</span>
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center justify-between gap-2 p-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onChange(Array.from(new Set([...value, ...shown.map((o) => o.carrier)])))}
                disabled={!shown.length}
                className="px-2 py-1 rounded-md text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-slate-800 disabled:opacity-40"
              >
                {labels.all}
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={!active}
                className="px-2 py-1 rounded-md text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
              >
                {labels.clear}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
