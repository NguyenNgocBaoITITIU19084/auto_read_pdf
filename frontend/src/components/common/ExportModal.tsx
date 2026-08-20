import React, { useState } from 'react';
import { FileSpreadsheet, CheckSquare, Square, Download } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { exportExcelApi } from '../../services/api';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: any[];
  allColumns: { key: string; label: string }[];
  defaultSelected?: string[];
  filenamePrefix?: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  data,
  allColumns,
  defaultSelected,
  filenamePrefix = 'export_data',
}) => {
  const { t, addToast } = useApp();
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => {
    return defaultSelected || allColumns.map((c) => c.key);
  });
  const [loading, setLoading] = useState(false);

  const toggleColumn = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const selectAll = () => {
    setSelectedKeys(allColumns.map((c) => c.key));
  };

  const deselectAll = () => {
    setSelectedKeys([]);
  };

  const handleExport = async () => {
    if (selectedKeys.length === 0) {
      addToast('Vui lòng chọn ít nhất một cột để xuất!', 'error');
      return;
    }

    try {
      setLoading(true);
      // Map keys to labels
      const columnLabels = selectedKeys.map((key) => {
        const found = allColumns.find((c) => c.key === key);
        return found ? found.label : key;
      });

      // Prepare mapped data objects
      const mappedData = data.map((item, index) => {
        const row: any = {};
        selectedKeys.forEach((key) => {
          const colDef = allColumns.find((c) => c.key === key);
          const colLabel = colDef ? colDef.label : key;
          if (key === 'STT') {
            row[colLabel] = index + 1;
          } else {
            row[colLabel] = item[key] !== undefined && item[key] !== null ? item[key] : 'null';
          }
        });
        return row;
      });

      const blob = await exportExcelApi(mappedData, columnLabels);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${filenamePrefix}_${dateStr}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      addToast(t.common.success, 'success');
      onClose();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.common.exportExcel} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span>
            {t.common.selected}: {selectedKeys.length}/{allColumns.length} cột
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="text-primary-600 dark:text-primary-400 hover:underline"
            >
              Chọn tất cả
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={deselectAll}
              className="text-slate-500 hover:underline"
            >
              Bỏ chọn
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
          {allColumns.map((col) => {
            const isChecked = selectedKeys.includes(col.key);
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => toggleColumn(col.key)}
                className={`flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-xl border text-left transition-all ${
                  isChecked
                    ? 'bg-primary-50 dark:bg-primary-950/40 border-primary-300 dark:border-primary-800 text-primary-900 dark:text-primary-200'
                    : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {isChecked ? (
                  <CheckSquare className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400 shrink-0" />
                )}
                <span className="truncate">{col.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={loading || selectedKeys.length === 0}
            onClick={handleExport}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md shadow-emerald-500/20 transition-all"
          >
            <Download className="w-4 h-4" />
            <span>{loading ? t.common.loading : t.common.exportExcel}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
