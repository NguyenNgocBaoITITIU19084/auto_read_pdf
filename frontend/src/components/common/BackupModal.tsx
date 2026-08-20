import React, { useState } from 'react';
import { Download, Upload, Database } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { AutoSyncSettingsCard } from './AutoSyncSettingsCard';
import { AISettingsCard } from './AISettingsCard';
import { getBackupDb, restoreBackupDb } from '../../services/api';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({ 
  isOpen, 
  onClose,
}) => {
  const { t, addToast, refreshCollections } = useApp();
  const [loading, setLoading] = useState(false);

  const handleExportBackup = async () => {
    try {
      setLoading(true);
      const data = await getBackupDb();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `booking_data_backup_${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast(t.common.success, 'success');
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      const text = await file.text();
      const jsonData = JSON.parse(text);
      await restoreBackupDb(jsonData);
      addToast(t.common.success, 'success');
      await refreshCollections();
      onClose();
    } catch (e: any) {
      addToast(e.message || 'Invalid JSON backup file', 'error');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.common.settings} maxWidth="max-w-xl">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* Gemini Vision AI & OCR Configuration */}
        <AISettingsCard />

        {/* Auto Sync & Interval Configuration */}
        <AutoSyncSettingsCard />

        {/* Export Backup JSON */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t.common.backup}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Xuất toàn bộ cơ sở dữ liệu (Collections, Bookings, Vessels, Containers) ra file JSON.
              </p>
            </div>
          </div>
          <button
            onClick={handleExportBackup}
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md shadow-primary-500/20 transition-all"
          >
            <Download className="w-4 h-4" />
            <span>{t.common.backup}</span>
          </button>
        </div>

        {/* Restore Backup JSON */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 rounded-lg">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t.common.restore}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Nhập file JSON sao lưu để phục hồi dữ liệu vào hệ thống.
              </p>
            </div>
          </div>

          <label className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl cursor-pointer shadow-sm transition-all">
            <Upload className="w-4 h-4" />
            <span>{t.common.restore}</span>
            <input
              type="file"
              accept=".json"
              disabled={loading}
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        </div>
      </div>
    </Modal>
  );
};
