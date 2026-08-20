import React from 'react';
import { CheckSquare, Square, ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { Tooltip } from './Tooltip';

export interface ColumnDef {
  key: string;
  label: string;
  defaultLabel?: string;
  customLabel?: string;
  visible: boolean;
}

interface ColumnConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnDef[];
  onChange: (columns: ColumnDef[]) => void;
  onReset?: () => void;
}

export const ColumnConfigModal: React.FC<ColumnConfigModalProps> = ({
  isOpen,
  onClose,
  columns,
  onChange,
  onReset,
}) => {
  const { t } = useApp();

  const toggleVisibility = (index: number) => {
    const updated = [...columns];
    updated[index].visible = !updated[index].visible;
    onChange(updated);
  };

  const handleRename = (index: number, newLabel: string) => {
    const updated = [...columns];
    const defaultLbl = updated[index].defaultLabel || updated[index].label;
    const isCustom = newLabel !== defaultLbl && newLabel.trim() !== '';
    updated[index] = {
      ...updated[index],
      label: newLabel,
      customLabel: isCustom ? newLabel : undefined,
    };
    onChange(updated);
  };

  const handleResetColumnName = (index: number) => {
    const updated = [...columns];
    const defaultLbl = updated[index].defaultLabel || updated[index].key;
    updated[index] = {
      ...updated[index],
      label: defaultLbl,
      customLabel: undefined,
    };
    onChange(updated);
  };

  const selectAll = () => {
    onChange(columns.map((c) => ({ ...c, visible: true })));
  };

  const deselectAll = () => {
    onChange(columns.map((c) => ({ ...c, visible: false })));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...columns];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    onChange(updated);
  };

  const moveDown = (index: number) => {
    if (index === columns.length - 1) return;
    const updated = [...columns];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    onChange(updated);
  };

  const visibleCount = columns.filter((c) => c.visible).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.common.columnsConfig} maxWidth="max-w-xl">
      <div className="space-y-3">
        {/* Toolbar & Options */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span>
            {t.common.selected}: <strong className="text-slate-800 dark:text-slate-200">{visibleCount}</strong>/{columns.length} cột
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="px-2 py-1 rounded-md text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
            >
              Chọn tất cả
            </button>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <button
              type="button"
              onClick={deselectAll}
              className="px-2 py-1 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Bỏ chọn tất cả
            </button>
            {onReset && (
              <>
                <span className="text-slate-300 dark:text-slate-700">•</span>
                <button
                  type="button"
                  onClick={onReset}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                  title={t.common.resetAllColumns}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{t.common.resetAllColumns}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Columns List */}
        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
          {columns.map((col, idx) => (
            <div
              key={col.key}
              className={`flex items-center justify-between gap-2.5 p-2 rounded-xl border transition-all ${
                col.visible
                  ? 'bg-slate-50/80 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 shadow-2xs'
                  : 'bg-slate-100/40 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/80 opacity-60'
              }`}
            >
              {/* Checkbox visibility button */}
              <button
                type="button"
                onClick={() => toggleVisibility(idx)}
                className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 text-left shrink-0 p-1 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
                title={col.visible ? 'Bỏ chọn hiển thị cột này' : 'Hiển thị cột này'}
              >
                {col.visible ? (
                  <CheckSquare className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400 shrink-0" />
                )}
              </button>

              {/* Editable column label input */}
              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                <input
                  type="text"
                  value={col.label}
                  onChange={(e) => handleRename(idx, e.target.value)}
                  placeholder={col.defaultLabel || col.key}
                  className="w-full text-xs font-medium px-2.5 py-1.5 rounded-lg border bg-white dark:bg-slate-900/90 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />

                {col.customLabel && (
                  <Tooltip content={`${t.common.resetColumnName}: "${col.defaultLabel || col.key}"`}>
                    <button
                      type="button"
                      onClick={() => handleResetColumnName(idx)}
                      className="p-1.5 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/60 border border-amber-200 dark:border-amber-800/80 transition-colors shrink-0 shadow-2xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                )}
              </div>

              {/* Reorder buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <Tooltip content="Di chuyển lên">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveUp(idx)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip content="Di chuyển xuống">
                  <button
                    type="button"
                    disabled={idx === columns.length - 1}
                    onClick={() => moveDown(idx)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md shadow-primary-500/20 transition-all"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </Modal>
  );
};
