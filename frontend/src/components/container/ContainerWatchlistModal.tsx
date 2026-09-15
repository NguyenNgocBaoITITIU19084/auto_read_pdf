import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, RefreshCw, BookmarkMinus } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ContainerWatchlist } from '../../types';
import { useApp } from '../../context/AppContext';
import { AutoSyncSettingsCard } from '../common/AutoSyncSettingsCard';
import { getContainerWatchlist, addContainerWatchlist, deleteContainerWatchlist, syncContainerWatchlist, removeContainerWatchlistBatch } from '../../services/api';
import { useConfirm } from '../../hooks/useConfirm';
import { tf } from '../../services/i18nFormat';
import { WatchlistSyncBadge } from '../vessel/WatchlistSyncBadge';

interface ContainerWatchlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataUpdated?: () => void;
}

export const ContainerWatchlistModal: React.FC<ContainerWatchlistModalProps> = ({
  isOpen,
  onClose,
  onDataUpdated,
}) => {
  const { t, activeCollection, addToast, autoSyncStatus } = useApp();
  const confirm = useConfirm();
  const [watchlist, setWatchlist] = useState<ContainerWatchlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set());
  const [removing, setRemoving] = useState(false);

  const [siteId, setSiteId] = useState<string>(() => localStorage.getItem('last_container_site_id') || 'CTL');
  const [containerNo, setContainerNo] = useState('');
  const [eventType, setEventType] = useState<string>('UNLOAD');

  const loadWatchlist = async () => {
    if (!activeCollection) return;
    try {
      setLoading(true);
      const data = await getContainerWatchlist(activeCollection.id);
      setWatchlist(data);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSiteId(localStorage.getItem('last_container_site_id') || 'CTL');
      setCheckedIds(new Set());
      loadWatchlist();
    }
  }, [isOpen, activeCollection]);

  // Refresh per-item sync status when a scheduler run finishes while the modal is open
  useEffect(() => {
    if (isOpen && autoSyncStatus?.last_run_at && !autoSyncStatus.running) loadWatchlist();
  }, [autoSyncStatus?.last_run_at, autoSyncStatus?.running]);

  // Drop checked ids that no longer exist
  const validCheckedIds = useMemo(() => {
    const ids = new Set(watchlist.map((w) => w.id));
    return Array.from(checkedIds).filter((id) => ids.has(id));
  }, [watchlist, checkedIds]);
  const allChecked = watchlist.length > 0 && validCheckedIds.length === watchlist.length;

  const toggleChecked = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRemoveChecked = async () => {
    const ids = validCheckedIds;
    if (ids.length === 0 || removing) return;
    const ok = await confirm({
      message: tf(t.container.removeWatchlistConfirm, { count: ids.length }),
      confirmText: tf(t.container.removeSelectedWatchlist, { count: ids.length }),
      danger: true,
    });
    if (!ok) return;
    try {
      setRemoving(true);
      const res = await removeContainerWatchlistBatch(ids);
      const idSet = new Set(ids);
      setWatchlist((prev) => prev.filter((w) => !idSet.has(w.id)));
      setCheckedIds(new Set());
      addToast(tf(t.container.watchlistBatchRemoved, { count: res?.removed ?? ids.length }), 'success');
      onDataUpdated?.();
    } catch (e: any) {
      addToast(e?.response?.data?.detail || e.message || t.common.error, 'error');
    } finally {
      setRemoving(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCollection || !containerNo.trim()) return;
    try {
      localStorage.setItem('last_container_site_id', siteId);
      await addContainerWatchlist(
        activeCollection.id,
        siteId.trim().toUpperCase(),
        containerNo.trim().toUpperCase(),
        eventType.trim().toUpperCase()
      );
      addToast(t.common.success, 'success');
      setContainerNo('');
      await loadWatchlist();
      onDataUpdated?.();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteContainerWatchlist(id);
      addToast(t.common.success, 'success');
      setWatchlist((prev) => prev.filter((w) => w.id !== id));
      onDataUpdated?.();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleSyncNow = async () => {
    if (!activeCollection) return;
    try {
      setSyncing(true);
      const res = await syncContainerWatchlist(activeCollection.id);
      addToast(`Đã cập nhật ${res.updated_count} trạng thái container!`, 'success');
      await loadWatchlist();
      onDataUpdated?.();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.container.watchlistTitle} maxWidth="max-w-xl">
      <div className="space-y-4">
        {/* Auto Sync & Interval Configuration */}
        <AutoSyncSettingsCard />

        {/* Form Add */}
        <form data-tour="container-watchlist-form" onSubmit={handleAdd} className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                {t.common.site}
              </label>
              <select
                value={siteId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSiteId(val);
                  localStorage.setItem('last_container_site_id', val);
                }}
                className="w-full text-xs font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-primary-500"
              >
                <option value="CTL">{t.vessel.siteCTL}</option>
                <option value="GNL">{t.vessel.siteGNL}</option>
                <option value="THP">{t.vessel.siteTHP}</option>
                <option value="CMS">{t.vessel.siteCMS}</option>
                <option value="IST">{t.vessel.siteIST}</option>
                <option value="TNT">{t.vessel.siteTNT}</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                Số Container
              </label>
              <input
                type="text"
                required
                value={containerNo}
                onChange={(e) => setContainerNo(e.target.value.toUpperCase())}
                placeholder="VD: TEMU1234567"
                className="w-full text-xs uppercase font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                Tác nghiệp
              </label>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                className="w-full text-xs font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-primary-500"
              >
                <option value="UNLOAD">UNLOAD</option>
                <option value="INGATE">INGATE</option>
                <option value="OUTGATE">OUTGATE</option>
                <option value="STACKING">STACKING</option>
                <option value="LOAD">LOAD</option>
                <option value="ALL">Tất cả</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm vào theo dõi</span>
          </button>
        </form>

        {/* Watchlist table & sync */}
        <div data-tour="container-watchlist-list" className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allChecked}
                disabled={watchlist.length === 0}
                onChange={() => setCheckedIds(allChecked ? new Set() : new Set(watchlist.map((w) => w.id)))}
                className="rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500 cursor-pointer"
                title={t.container.selectAllWatchlist}
              />
              <span>Danh sách Container ({watchlist.length})</span>
            </label>
            {validCheckedIds.length > 0 && (
              <button
                type="button"
                onClick={handleRemoveChecked}
                disabled={removing}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                <BookmarkMinus className="w-3.5 h-3.5" />
                <span>{tf(t.container.removeSelectedWatchlist, { count: validCheckedIds.length })}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncing || watchlist.length === 0}
              className="ml-auto flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{t.common.syncWatchlist}</span>
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
            {watchlist.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                {t.container.emptyWatchlist}
              </div>
            ) : (
              watchlist.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-2 px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                    checkedIds.has(item.id) ? 'bg-sky-50/70 dark:bg-sky-950/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={checkedIds.has(item.id)}
                      onChange={() => toggleChecked(item.id)}
                      className="rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500 cursor-pointer shrink-0"
                    />
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                          {item.site_id}
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100">
                          {item.container_no}
                        </span>
                        {item.event_type && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800">
                            {item.event_type}
                          </span>
                        )}
                      </div>
                      <WatchlistSyncBadge
                        status={item.last_sync_status}
                        at={item.last_sync_at}
                        message={item.last_sync_message}
                        labels={t.container}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="text-slate-400 hover:text-rose-600 p-1 rounded-md transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md transition-all"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </Modal>
  );
};
