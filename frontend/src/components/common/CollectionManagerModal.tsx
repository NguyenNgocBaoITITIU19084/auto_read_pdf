import React, { useState } from 'react';
import { Trash2, Layers, AlertTriangle, FolderPlus } from 'lucide-react';
import { Modal } from './Modal';
import { Collection } from '../../types';
import { useApp } from '../../context/AppContext';

interface CollectionManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CollectionManagerModal: React.FC<CollectionManagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    t,
    collections,
    activeCollection,
    setActiveCollection,
    handleCreateCollection,
    handleDeleteCollection,
    refreshCollections,
    addToast,
  } = useApp();

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newColName, setNewColName] = useState('');

  const handleDelete = async (col: Collection) => {
    if (confirmDeleteId !== col.id) {
      setConfirmDeleteId(col.id);
      return;
    }

    // Actually delete
    try {
      setDeleting(true);
      await handleDeleteCollection(col.id);
      setConfirmDeleteId(null);
      // If we deleted the active collection, the context will auto-select another
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName.trim()) return;
    await handleCreateCollection(newColName.trim());
    setNewColName('');
  };

  const handleSelectAndClose = (col: Collection) => {
    setActiveCollection(col);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setConfirmDeleteId(null);
        onClose();
      }}
      title="Quản lý Bộ sưu tập"
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        {/* Create new collection */}
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
            placeholder={t.common.enterCollectionName}
            className="flex-1 px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={!newColName.trim()}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-xs font-semibold rounded-xl shadow-sm transition-all shrink-0"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Tạo mới</span>
          </button>
        </form>

        {/* Collections list */}
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
          {collections.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Chưa có bộ sưu tập nào
            </div>
          ) : (
            collections.map((col) => {
              const isActive = activeCollection?.id === col.id;
              const isConfirming = confirmDeleteId === col.id;

              return (
                <div
                  key={col.id}
                  className={`flex items-center justify-between px-4 py-3 transition-colors ${
                    isActive
                      ? 'bg-primary-50/50 dark:bg-primary-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div
                    className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
                    onClick={() => handleSelectAndClose(col)}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'bg-primary-100 dark:bg-primary-900/60 text-primary-600 dark:text-primary-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <Layers className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-semibold truncate ${
                            isActive
                              ? 'text-primary-700 dark:text-primary-300'
                              : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {col.name}
                        </span>
                        {isActive && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/70 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 shrink-0">
                            Đang dùng
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        Tạo lúc: {col.created_at}
                      </span>
                    </div>
                  </div>

                  {/* Delete action */}
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {isConfirming ? (
                      <>
                        <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 whitespace-nowrap">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Xác nhận xóa?
                        </span>
                        <button
                          onClick={() => handleDelete(col)}
                          disabled={deleting}
                          className="px-2.5 py-1 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                        >
                          {deleting ? '...' : 'Xóa'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          Hủy
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleDelete(col)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
                        title="Xóa bộ sưu tập"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
          Xóa bộ sưu tập sẽ xóa toàn bộ dữ liệu Booking, Lịch tàu, Container và Watchlist bên trong.
        </p>

        <div className="flex justify-end pt-1 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => {
              setConfirmDeleteId(null);
              onClose();
            }}
            className="px-5 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md transition-all"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </Modal>
  );
};
