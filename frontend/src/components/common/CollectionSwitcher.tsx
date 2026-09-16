import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FolderPlus, Layers, Search, Settings2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';
import type { Collection } from '../../types';

export function formatCount(n?: number): string {
  const v = n ?? 0;
  const fmt = (x: number, unit: string) => `${(Math.round(x * 10) / 10).toString().replace('.', ',')}${unit}`;
  if (v >= 1_000_000) return fmt(v / 1_000_000, 'M');
  if (v >= 1_000) return fmt(v / 1_000, 'k');
  return String(v);
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

export const CollectionSwitcher: React.FC<{ onManage: () => void }> = ({ onManage }) => {
  const { t, collections, activeCollection, setActiveCollection, refreshCollections, handleCreateCollection } = useApp();
  const c = t.collections;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => collections.filter((col: Collection) => normalize(col.name).includes(normalize(query.trim()))),
    [collections, query]
  );

  useEffect(() => {
    if (!open) return;
    void refreshCollections();
    setQuery('');
    setNewName('');
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, refreshCollections]);

  useEffect(() => setHighlight(0), [query]);

  const choose = (col: Collection) => {
    setActiveCollection(col);
    setOpen(false);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlight]) { e.preventDefault(); choose(filtered[highlight]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    const created = await handleCreateCollection(name);
    setCreating(false);
    if (created) choose(created);
  };

  return (
    <div ref={rootRef} className="relative" data-tour="collection-selector">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={c.switcherTooltip}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 max-w-[220px] px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
      >
        <Layers className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400 shrink-0" />
        <span className="truncate">{activeCollection?.name || c.empty}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder={c.searchPlaceholder}
                className="w-full pl-8 pr-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-400">{c.noMatch}</li>}
            {filtered.map((col, i) => {
              const active = col.id === activeCollection?.id;
              return (
                <li key={col.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => choose(col)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left ${i === highlight ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                  >
                    <Check className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-primary-600' : 'invisible'}`} />
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate text-xs font-semibold ${active ? 'text-primary-700 dark:text-primary-300' : 'text-slate-800 dark:text-slate-100'}`}>{col.name}</span>
                      <span className="block text-[10px] text-slate-400">
                        {tf(c.counts, { bookings: formatCount(col.booking_count), vessels: formatCount(col.vessel_count), containers: formatCount(col.container_count) })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <form onSubmit={create} className="flex items-center gap-1.5 p-2 border-t border-slate-100 dark:border-slate-800">
            <FolderPlus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              placeholder={c.newPlaceholder}
              className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button type="submit" disabled={!newName.trim() || creating} className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-40">
              {c.create}
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setOpen(false); onManage(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border-t border-slate-100 dark:border-slate-800"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {c.manage}
          </button>
        </div>
      )}
    </div>
  );
};
