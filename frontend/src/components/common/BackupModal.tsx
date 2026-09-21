import React, { useState } from 'react';
import { Download, Upload, Database, ScrollText, FileArchive, FolderOpen } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { AutoSyncSettingsCard } from './AutoSyncSettingsCard';
import { AISettingsCard } from './AISettingsCard';
import { UpdateSettingsCard } from './UpdateSettingsCard';
import { getBackupDb, restoreBackupDb, RestoreMode, downloadLogsZipApi } from '../../services/api';
import { errorMessage } from '../vessel/tableHelpers';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Navigate to the standalone Logs tab (closes this modal too). Falls back to no-op button behavior if omitted. */
  onNavigateToLogs?: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  onNavigateToLogs,
}) => {
  const { t, addToast, refreshCollections } = useApp();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('merge');

  const handleExportLogs = async () => {
    try {
      setLoading(true);
      const { blob, filename } = await downloadLogsZipApi();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      addToast(t.logs.exportSuccess, 'success');
    } catch (e: any) {
      addToast(errorMessage(e, t.common.error), 'error');
    } finally {
      setLoading(false);
    }
  };

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
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);
      if (restoreMode === 'replace') {
        const ok = await confirm({
          title: t.common.restoreReplaceConfirmTitle,
          message: t.common.restoreReplaceConfirmMessage,
          confirmText: t.common.restoreReplaceConfirm,
          danger: true,
        });
        if (!ok) return;
      }
      setLoading(true);
      await restoreBackupDb(jsonData, restoreMode);
      addToast(t.common.success, 'success');
      await refreshCollections();
      onClose();
    } catch (err: any) {
      addToast(err?.response?.data?.detail || err.message || 'Invalid JSON backup file', 'error');
    } finally {
      setLoading(false);
      input.value = '';
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.common.settings} maxWidth="max-w-xl">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* Gemini Vision AI & OCR Configuration */}
        <AISettingsCard />

        {/* Auto Sync & Interval Configuration */}
        <AutoSyncSettingsCard />

        {/* App auto-update (Windows) */}
        <UpdateSettingsCard />

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
                {t.common.restoreDesc}
              </p>
            </div>
          </div>

          <div role="radiogroup" className="grid grid-cols-2 gap-2 mt-3 mb-2">
            {(['merge', 'replace'] as RestoreMode[]).map((mode) => {
              const active = restoreMode === mode;
              const danger = mode === 'replace';
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={loading}
                  onClick={() => setRestoreMode(mode)}
                  className={`text-left p-2.5 rounded-xl border text-xs transition-all ${
                    active
                      ? danger
                        ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-700'
                        : 'border-primary-400 bg-primary-50 dark:bg-primary-950/40 dark:border-primary-700'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <div className={`font-semibold ${danger && active ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-slate-100'}`}>
                    {mode === 'merge' ? t.common.restoreMerge : t.common.restoreReplace}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {mode === 'merge' ? t.common.restoreMergeDesc : t.common.restoreReplaceDesc}
                  </div>
                </button>
              );
            })}
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

        {/* System logs */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg">
              <ScrollText className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.logs.cardTitle}</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.logs.cardDesc}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onNavigateToLogs} disabled={!onNavigateToLogs} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50">
              <ScrollText className="w-4 h-4" />{t.logs.view}
            </button>
            <button type="button" disabled={loading} onClick={handleExportLogs} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50">
              <FileArchive className="w-4 h-4" />{t.logs.export}
            </button>
            {window.electronAPI?.openLogFolder && (
              <button type="button" onClick={() => window.electronAPI?.openLogFolder?.()} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">
                <FolderOpen className="w-4 h-4" />{t.logs.openFolder}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
