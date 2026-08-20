import React, { useState } from 'react';
import { 
  FolderPlus, Trash2, Moon, Sun, Database, 
  RefreshCw, Layers, ShieldCheck, Settings2
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from './Modal';
import { BackupModal } from './BackupModal';
import { CollectionManagerModal } from './CollectionManagerModal';
import { Tooltip } from './Tooltip';

export const Header: React.FC = () => {
  const { 
    t, language, setLanguage, isDark, setIsDark, 
    collections, activeCollection, setActiveCollection, 
    handleCreateCollection, handleDeleteCollection,
    autoSyncEnabled, syncInterval, toggleAutoSync
  } = useApp();

  const [isNewColOpen, setIsNewColOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isCollectionManagerOpen, setIsCollectionManagerOpen] = useState(false);

  const submitCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName.trim()) return;
    await handleCreateCollection(newColName.trim());
    setNewColName('');
    setIsNewColOpen(false);
  };

  const confirmDelete = async () => {
    if (!activeCollection) return;
    if (window.confirm(t.common.deleteConfirm)) {
      await handleDeleteCollection(activeCollection.id);
    }
  };

  const intervalLabel = syncInterval >= 60 && syncInterval % 60 === 0 
    ? `${syncInterval / 60}h` 
    : `${syncInterval}p`;

  return (
    <header className="h-13 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between shrink-0 shadow-sm gap-3 overflow-x-auto select-none">
      {/* Left: Brand & Collection Selector */}
      <div className="flex items-center gap-4 shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary-600 to-sky-400 flex items-center justify-center text-white shadow-md shadow-primary-500/20 shrink-0">
            <ShieldCheck className="w-4.5 h-4.5" />
          </div>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-50 tracking-tight">
              Auto Read PDF
            </span>
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-primary-50 dark:bg-primary-950 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800/80">
              v2.0
            </span>
          </div>
        </div>

        {/* Collection Dropdown */}
        <div className="flex items-center gap-2 pl-4 border-l border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
            <Layers className="w-3.5 h-3.5" />
            <span>{t.common.collection}:</span>
          </div>

          <Tooltip content="Chọn bộ sưu tập để làm việc" position="bottom">
            <select
              value={activeCollection?.id || ''}
              onChange={(e) => {
                const selected = collections.find((c) => c.id === Number(e.target.value));
                if (selected) setActiveCollection(selected);
              }}
              className="w-44 text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer truncate"
            >
              {collections.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.name}
                </option>
              ))}
            </select>
          </Tooltip>

          <Tooltip content="Tạo bộ sưu tập mới" position="bottom">
            <button
              onClick={() => setIsNewColOpen(true)}
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 bg-slate-100 dark:bg-slate-800 hover:bg-primary-50 dark:hover:bg-primary-950/50 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </Tooltip>

          <Tooltip content="Quản lý bộ sưu tập (xóa, tạo mới...)" position="bottom">
            <button
              onClick={() => setIsCollectionManagerOpen(true)}
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Auto Sync Toggle */}
        <Tooltip content={autoSyncEnabled ? `Tự động đồng bộ đang BẬT (mỗi ${syncInterval} phút). Nhấp để tắt hoặc vào tab Watchlist để đổi thời gian` : `Tự động đồng bộ đang TẮT (chu kỳ ${syncInterval} phút). Nhấp để bật hoặc vào tab Watchlist để đổi thời gian`} position="bottom">
          <button
            onClick={() => toggleAutoSync()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap shrink-0 ${
              autoSyncEnabled
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-xs shadow-emerald-500/10'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-750'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${autoSyncEnabled ? 'animate-spin text-emerald-600' : ''}`} />
            <span>{t.common.autoSync}: {autoSyncEnabled ? `ON (${intervalLabel})` : 'OFF'}</span>
          </button>
        </Tooltip>

        {/* Backup & Restore Modal */}
        <Tooltip content="Cài đặt & Sao lưu/Khôi phục dữ liệu JSON" position="bottom">
          <button
            onClick={() => setIsBackupOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Database className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span>{t.common.settings}</span>
          </button>
        </Tooltip>

        {/* Language Switcher */}
        <Tooltip content="Chuyển đổi ngôn ngữ Tiếng Việt / English" position="bottom">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold shrink-0">
            <button
              onClick={() => setLanguage('vi')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                language === 'vi'
                  ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-300 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              VI
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                language === 'en'
                  ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-300 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              EN
            </button>
          </div>
        </Tooltip>

        {/* Dark / Light Toggle */}
        <Tooltip content={isDark ? "Chuyển sang giao diện Sáng" : "Chuyển sang giao diện Tối"} position="bottom">
          <button
            onClick={() => setIsDark(!isDark)}
            className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </Tooltip>
      </div>

      {/* New Collection Modal */}
      <Modal
        isOpen={isNewColOpen}
        onClose={() => setIsNewColOpen(false)}
        title={t.common.newCollection}
        maxWidth="max-w-md"
      >
        <form onSubmit={submitCreateCollection} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
              {t.common.collection}
            </label>
            <input
              type="text"
              required
              autoFocus
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder={t.common.enterCollectionName}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsNewColOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md shadow-primary-500/20 transition-colors"
            >
              {t.common.save}
            </button>
          </div>
        </form>
      </Modal>

      {/* Backup & Restore Modal */}
      <BackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
      />

      {/* Collection Manager Modal */}
      <CollectionManagerModal
        isOpen={isCollectionManagerOpen}
        onClose={() => setIsCollectionManagerOpen(false)}
      />
    </header>
  );
};
