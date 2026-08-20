import React, { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ContainerWatchlist } from '../../types';
import { useApp } from '../../context/AppContext';
import { AutoSyncSettingsCard } from '../common/AutoSyncSettingsCard';
import { getContainerWatchlist, addContainerWatchlist, deleteContainerWatchlist, syncContainerWatchlist } from '../../services/api';

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
  const { t, activeCollection, addToast } = useApp();
  const [watchlist, setWatchlist] = useState<ContainerWatchlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [siteId, setSiteId] = useState<string>(() => localStorage.getItem('last_container_site_id') || 'CTL');
  const [containerNo, setContainerNo] = useState('');

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
      loadWatchlist();
    }
  }, [isOpen, activeCollection]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCollection || !containerNo.trim()) return;
    try {
      localStorage.setItem('last_container_site_id', siteId);
      await addContainerWatchlist(activeCollection.id, siteId, containerNo.trim().toUpperCase());
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
        <form onSubmit={handleAdd} className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
          <div className="grid grid-cols-3 gap-2">
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
            <div className="col-span-2">
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
          </div>
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm vào theo dõi</span>
          </button>
        </form>

        {/* Watchlist table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Danh sách Container ({watchlist.length})</span>
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncing || watchlist.length === 0}
              className="flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-40"
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
                  className="flex items-center justify-between px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {item.site_id}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100">
                      {item.container_no}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="text-slate-400 hover:text-rose-600 p-1 rounded-md transition-colors"
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
