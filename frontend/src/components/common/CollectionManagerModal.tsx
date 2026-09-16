import React, { useEffect, useRef, useState } from 'react';
import { Check, Layers, Pencil, Trash2, X } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { tf } from '../../services/i18nFormat';
import type { Collection } from '../../types';
import { formatCount } from './CollectionSwitcher';

interface CollectionManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const formatDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};

export const CollectionManagerModal: React.FC<CollectionManagerModalProps> = ({ isOpen, onClose }) => {
  const { t, collections, activeCollection, setActiveCollection, refreshCollections, handleDeleteCollection, handleRenameCollection } = useApp();
  const c = t.collections;
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      void refreshCollections();
      setEditingId(null);
    }
  }, [isOpen, refreshCollections]);

  useEffect(() => {
    if (editingId !== null) inputRef.current?.select();
  }, [editingId]);

  const startRename = (col: Collection) => {
    setEditingId(col.id);
    setDraft(col.name);
  };

  const saveRename = async (col: Collection) => {
    const name = draft.trim();
    if (!name || name === col.name) {
      setEditingId(null);
      return;
    }
    setBusyId(col.id);
    const ok = await handleRenameCollection(col.id, name);
    setBusyId(null);
    if (ok) setEditingId(null);
  };

  const remove = async (col: Collection) => {
    const ok = await confirm({
      title: tf(c.deleteTitle, { name: col.name }),
      message: tf(c.deleteMessage, {
        bookings: col.booking_count ?? 0, vessels: col.vessel_count ?? 0,
        containers: col.container_count ?? 0, watchlists: col.watchlist_count ?? 0,
      }),
      confirmText: c.deleteConfirm,
      danger: true,
    });
    if (!ok) return;
    setBusyId(col.id);
    await handleDeleteCollection(col.id);
    setBusyId(null);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={c.managerTitle} maxWidth="max-w-xl">
      {collections.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-400">{c.empty}</div>
      ) : (
        <ul className="-mx-2 divide-y divide-slate-100 dark:divide-slate-800">
          {collections.map((col) => {
            const active = col.id === activeCollection?.id;
            const editing = editingId === col.id;
            return (
              <li key={col.id} className="group h-11 flex items-center gap-2.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Layers className={`w-4 h-4 shrink-0 ${active ? 'text-primary-600' : 'text-slate-400'}`} />
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <form onSubmit={(e) => { e.preventDefault(); void saveRename(col); }} className="flex items-center gap-1">
                      <input
                        ref={inputRef}
                        value={draft}
                        maxLength={100}
                        aria-label={c.rename}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditingId(null); } }}
                        className="flex-1 min-w-0 px-2 py-1 text-xs font-semibold border border-primary-400 rounded-md bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      <button type="submit" disabled={busyId === col.id} aria-label={c.renameSave} className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} aria-label={t.common.cancel} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className={`truncate text-xs font-semibold ${active ? 'text-primary-700 dark:text-primary-300' : 'text-slate-800 dark:text-slate-100'}`}>{col.name}</span>
                      {active && <span className="shrink-0 text-[10px] font-bold px-1.5 rounded bg-primary-100 dark:bg-primary-900/60 text-primary-700 dark:text-primary-300">{c.active}</span>}
                      <span className="truncate text-[10px] text-slate-400">
                        {tf(c.counts, { bookings: formatCount(col.booking_count), vessels: formatCount(col.vessel_count), containers: formatCount(col.container_count) })}
                        {' · '}{tf(c.createdAt, { date: formatDate(col.created_at) })}
                      </span>
                    </div>
                  )}
                </div>
                {!editing && (
                  <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100">
                    {!active && (
                      <button type="button" onClick={() => { setActiveCollection(col); onClose(); }} className="px-2 py-1 text-[11px] font-semibold rounded-md text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40">
                        {c.use}
                      </button>
                    )}
                    <button type="button" onClick={() => startRename(col)} title={c.rename} aria-label={c.rename} className="p-1.5 rounded-md text-slate-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(col)}
                      disabled={busyId === col.id || collections.length <= 1}
                      title={collections.length <= 1 ? c.lastOneHint : c.delete}
                      aria-label={c.delete}
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};
