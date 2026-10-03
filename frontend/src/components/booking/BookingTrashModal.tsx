import React, { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, Loader2, Trash2, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Pagination } from '../common/Pagination';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import {
  deleteTrashedBookingsApi, getBookingTrash, getBookingTrashIds, restoreBookingsApi, TrashedBooking,
} from '../../services/api';
import { tf } from '../../services/i18nFormat';

/** Mirrors BOOKING_TRASH_KEEP_DAYS in backend/app/core/database.py (the list reports the server value). */
export const BOOKING_TRASH_KEEP_DAYS = 30;
const DEFAULT_PAGE_SIZE = 50;

/** "2026-10-03 14:05:09" -> "14:05 03/10/2026" */
export function formatTrashTime(value?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value || '');
  return m ? `${m[4]}:${m[5]} ${m[3]}/${m[2]}/${m[1]}` : value || '';
}

export interface BookingTrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: number | null;
  /** Called after bookings were restored or deleted for good (reload the table / trash badge here). */
  onChanged?: () => void;
}

export const BookingTrashModal: React.FC<BookingTrashModalProps> = ({ isOpen, onClose, collectionId, onChanged }) => {
  const { t, addToast } = useApp();
  const confirm = useConfirm();
  const tt = t.booking.trash;
  const col = t.booking.columns;
  const [items, setItems] = useState<TrashedBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [keepDays, setKeepDays] = useState(BOOKING_TRASH_KEEP_DAYS);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'restore' | 'delete' | null>(null);
  // Selection survives page changes, like the main booking table
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
      const res = await getBookingTrash(collectionId, size, (targetPage - 1) * size);
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
      setSelected(new Set(await getBookingTrashIds(collectionId)));
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
      const count = await restoreBookingsApi(ids);
      addToast(tf(tt.restoreSuccess, { count }), 'success');
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
      const count = await deleteTrashedBookingsApi(ids);
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
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">{col['Booking No']}</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">{col.Carrier}</th>
                  <th className="px-3 py-2 font-semibold">{col.Vessel}</th>
                  <th className="px-3 py-2 font-semibold">{col['Port of Discharging']}</th>
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
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{b['Booking No'] || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{b.Carrier || ''}</td>
                    <td className="px-3 py-2">{b.Vessel || ''}</td>
                    <td className="px-3 py-2">{b['Port of Discharging'] || ''}</td>
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
};
