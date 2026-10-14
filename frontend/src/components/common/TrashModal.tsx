import React, { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, Loader2, Trash2, X } from 'lucide-react';
import { Modal } from './Modal';
import { Pagination } from './Pagination';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { PageResult } from '../../types';
import { tf } from '../../services/i18nFormat';

/** Mirrors TRASH_KEEP_DAYS in backend/app/core/database.py (the list reports the server value). */
export const TRASH_KEEP_DAYS = 30;
const DEFAULT_PAGE_SIZE = 50;

export interface TrashFields { id: number; deleted_at: string; purge_at: string; days_left: number }

export interface TrashApi<T extends TrashFields> {
  list: (collectionId: number, limit: number, offset: number) => Promise<PageResult<T> & { keep_days?: number }>;
  ids: (collectionId: number) => Promise<number[]>;
  /** `superseded`: trashed copies dropped because the row was looked up again meanwhile (the newer row stays). */
  restore: (ids: number[]) => Promise<{ restored: number; superseded?: number }>;
  deleteNow: (ids: number[]) => Promise<number>;
}

export interface TrashColumn<T> {
  key: string;
  label: string;
  render: (item: T) => React.ReactNode;
  className?: string;
}

/** The texts of one trash dialog (t.booking.trash, t.vessel.trash, t.container.trash). */
export interface TrashTexts {
  title: string; hint: string; empty: string; loading: string; deletedAt: string; expires: string;
  daysLeft: string; lastDay: string; selectAll: string; restore: string; restoreSelected: string;
  restoreSuccess: string; restoreSuperseded?: string; deleteNow: string; deleteNowSelected: string;
  deleteNowConfirm: string; deleteNowSuccess: string; selectedCount: string; selectAllResults: string;
  clearSelection: string;
}

/** "2026-10-03 14:05:09" -> "14:05 03/10/2026" */
export function formatTrashTime(value?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value || '');
  return m ? `${m[4]}:${m[5]} ${m[3]}/${m[2]}/${m[1]}` : value || '';
}

export interface TrashModalProps<T extends TrashFields> {
  isOpen: boolean;
  onClose: () => void;
  collectionId: number | null;
  /** Called after rows were restored or deleted for good (reload the table / trash badge here). */
  onChanged?: () => void;
  api: TrashApi<T>;
  texts: TrashTexts;
  columns: TrashColumn<T>[];
}

export function TrashModal<T extends TrashFields>({
  isOpen, onClose, collectionId, onChanged, api, texts: tt, columns,
}: TrashModalProps<T>) {
  const { t, addToast } = useApp();
  const confirm = useConfirm();
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [keepDays, setKeepDays] = useState(TRASH_KEEP_DAYS);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'restore' | 'delete' | null>(null);
  // Selection survives page changes, like the main tables
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const requestSeq = useRef(0);

  const showError = (e: any) => {
    const detail = e?.response?.data?.detail;
    addToast((typeof detail === 'string' && detail) || e?.message || t.common.error, 'error');
  };

  const load = async (targetPage = page, size = pageSize) => {
    if (collectionId === null) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const res = await api.list(collectionId, size, (targetPage - 1) * size);
      if (seq !== requestSeq.current) return;
      const lastPage = Math.max(1, Math.ceil((res.total || 0) / size));
      if (targetPage > lastPage && res.total > 0) {
        // the page emptied out (restored / deleted / purged): show the last one that still has rows
        setPage(lastPage);
        return;
      }
      setItems(res.items || []);
      setTotal(res.total || 0);
      if (res.keep_days) setKeepDays(res.keep_days);
    } catch (e: any) {
      if (seq === requestSeq.current) showError(e);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set());
    setItems([]);
    setTotal(0);
    if (page === 1) void load(1); else setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, collectionId]);

  useEffect(() => {
    if (isOpen) void load(page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const pageIds = items.map((i) => i.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSomeSelected = pageIds.some((id) => selected.has(id));
  const headerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = pageSomeSelected && !pageAllSelected;
  }, [pageSomeSelected, pageAllSelected]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (pageAllSelected ? next.delete(id) : next.add(id)));
      return next;
    });

  const selectAllResults = async () => {
    if (collectionId === null) return;
    try {
      setSelected(new Set(await api.ids(collectionId)));
    } catch (e: any) {
      showError(e);
    }
  };

  const afterChange = async (ids: number[]) => {
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
    await load();
    onChanged?.();
  };

  const restore = async (ids: number[]) => {
    if (ids.length === 0 || busy) return;
    setBusy('restore');
    try {
      const { restored, superseded = 0 } = await api.restore(ids);
      const msg = tf(tt.restoreSuccess, { count: restored });
      addToast(superseded > 0 && tt.restoreSuperseded ? `${msg}. ${tf(tt.restoreSuperseded, { count: superseded })}` : msg, 'success');
      await afterChange(ids);
    } catch (e: any) {
      showError(e);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const deleteNow = async (ids: number[]) => {
    if (ids.length === 0 || busy) return;
    const ok = await confirm({ message: tf(tt.deleteNowConfirm, { count: ids.length }), confirmText: tt.deleteNow, danger: true });
    if (!ok) return;
    setBusy('delete');
    try {
      const count = await api.deleteNow(ids);
      addToast(tf(tt.deleteNowSuccess, { count }), 'success');
      await afterChange(ids);
    } catch (e: any) {
      showError(e);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const selectedIds = [...selected];
  const iconBtn = 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold disabled:opacity-40 transition-colors';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={tt.title} maxWidth="max-w-5xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">{tf(tt.hint, { days: keepDays })}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => restore(selectedIds)}
              disabled={selectedIds.length === 0 || busy !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white shadow-sm transition-colors"
            >
              {busy === 'restore' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
              {tf(tt.restoreSelected, { count: selectedIds.length })}
            </button>
            <button
              type="button"
              onClick={() => deleteNow(selectedIds)}
              disabled={selectedIds.length === 0 || busy !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white shadow-sm transition-colors"
            >
              {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {tf(tt.deleteNowSelected, { count: selectedIds.length })}
            </button>
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-xs text-primary-800 dark:text-primary-200">
            <span className="font-semibold">{tf(tt.selectedCount, { count: selectedIds.length })}</span>
            {selectedIds.length < total && (
              <button type="button" onClick={selectAllResults} className="underline hover:no-underline">
                {tf(tt.selectAllResults, { count: total })}
              </button>
            )}
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto inline-flex items-center gap-1 hover:underline">
              <X className="w-3 h-3" /> {tt.clearSelection}
            </button>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> {tt.loading}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
            <Trash2 className="w-6 h-6" />
            {tt.empty}
          </div>
        ) : (
          <div className={`max-h-[55vh] overflow-auto border border-slate-200 dark:border-slate-800 rounded-xl ${loading ? 'opacity-60' : ''}`}>
            <table className="min-w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input ref={headerRef} type="checkbox" aria-label={tt.selectAll} checked={pageAllSelected} onChange={togglePage} />
                  </th>
                  {columns.map((c) => (
                    <th key={c.key} className="px-3 py-2 font-semibold whitespace-nowrap">{c.label}</th>
                  ))}
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">{tt.deletedAt}</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">{tt.expires}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-200">
                {items.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => toggle(b.id)}
                    className={`cursor-pointer ${selected.has(b.id) ? 'bg-primary-50/70 dark:bg-primary-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                  >
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 ${c.className ?? ''}`}>{c.render(b)}</td>
                    ))}
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">{formatTrashTime(b.deleted_at)}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${b.days_left <= 3 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                      {b.days_left <= 0 ? tt.lastDay : tf(tt.daysLeft, { days: b.days_left })}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void restore([b.id]); }}
                        disabled={busy !== null}
                        className={`${iconBtn} text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/50`}
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                        {tt.restore}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void deleteNow([b.id]); }}
                        disabled={busy !== null}
                        className={`${iconBtn} text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {tt.deleteNow}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <Pagination
            currentPage={page}
            totalItems={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        )}
      </div>
    </Modal>
  );
}
