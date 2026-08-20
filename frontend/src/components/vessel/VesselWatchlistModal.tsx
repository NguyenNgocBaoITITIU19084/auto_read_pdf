import React, { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { VesselWatchlist } from '../../types';
import { useApp } from '../../context/AppContext';
import { AutoSyncSettingsCard } from '../common/AutoSyncSettingsCard';
import { getVesselWatchlist, addVesselWatchlist, deleteVesselWatchlist, syncVesselWatchlist } from '../../services/api';

interface VesselWatchlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataUpdated?: () => void;
}

export const VesselWatchlistModal: React.FC<VesselWatchlistModalProps> = ({
  isOpen,
  onClose,
  onDataUpdated,
}) => {
  const { t, activeCollection, addToast } = useApp();
  const [watchlist, setWatchlist] = useState<VesselWatchlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [siteId, setSiteId] = useState('CTL');
  const [vesselName, setVesselName] = useState('');
  const [voyage, setVoyage] = useState('');

  const loadWatchlist = async () => {
    if (!activeCollection) return;
    try {
      setLoading(true);
      const data = await getVesselWatchlist(activeCollection.id);
      setWatchlist(data);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadWatchlist();
    }
  }, [isOpen, activeCollection]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCollection || !vesselName.trim()) return;
    try {
      await addVesselWatchlist(activeCollection.id, siteId, vesselName.trim(), voyage.trim());
      addToast(t.common.success, 'success');
      setVesselName('');
      setVoyage('');
      await loadWatchlist();
      onDataUpdated?.();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteVesselWatchlist(id);
      addToast(t.common.success, 'success');
      setWatchlist((prev) => prev.filter((w) => w.id !== id));
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleSyncNow = async () => {
    if (!activeCollection) return;
    try {
      setSyncing(true);
      const res = await syncVesselWatchlist(activeCollection.id);
      addToast(`Đã đồng bộ ${res.updated_count} bản ghi!`, 'success');
      onDataUpdated?.();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.vessel.watchlistTitle} maxWidth="max-w-xl">
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
                onChange={(e) => setSiteId(e.target.value)}
                className="w-full text-xs font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-primary-500"
              >
                <option value="CTL">CTL (Cát Lái)</option>
                <option value="GNL">GNL (Giang Nam)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                {t.common.vesselName}
              </label>
              <input
                type="text"
                required
                value={vesselName}
                onChange={(e) => setVesselName(e.target.value)}
                placeholder="VD: KOTA NEKAD"
                className="w-full text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                {t.common.voyage} (Tùy chọn)
              </label>
              <input
                type="text"
                value={voyage}
                onChange={(e) => setVoyage(e.target.value)}
                placeholder="VD: 0272S (hoặc để trống)"
                className="w-full text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>{t.vessel.addToWatchlist}</span>
          </button>
        </form>

        {/* Watchlist table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Danh sách theo dõi ({watchlist.length})</span>
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
                {t.vessel.emptyWatchlist}
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
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {item.vessel_name}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      / {item.voyage}
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
