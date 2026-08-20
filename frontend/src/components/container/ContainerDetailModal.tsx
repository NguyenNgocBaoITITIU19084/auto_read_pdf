import React from 'react';
import { Copy, Check } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ContainerInfo } from '../../types';
import { useApp } from '../../context/AppContext';

interface ContainerDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  container: ContainerInfo | null;
}

export const ContainerDetailModal: React.FC<ContainerDetailModalProps> = ({
  isOpen,
  onClose,
  container,
}) => {
  const { t, addToast } = useApp();
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  if (!container) return null;

  const copyField = (val: string, keyName: string) => {
    if (!val || val === 'null') return;
    navigator.clipboard.writeText(val);
    setCopiedKey(keyName);
    addToast(t.common.copySuccess, 'success');
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const fields: { key: string; label: string }[] = [
    { key: "containerno", label: t.container.columns["containerno"] },
    { key: "site_id", label: t.container.columns["site_id"] },
    { key: "location", label: t.container.columns["location"] },
    { key: "item_seal_no", label: t.container.columns["item_seal_no"] },
    { key: "custom_clearance_status", label: t.container.columns["custom_clearance_status"] },
    { key: "infras_fee_status", label: t.container.columns["infras_fee_status"] },
    { key: "event_time", label: t.container.columns["event_time"] },
    { key: "event_type", label: t.container.columns["event_type"] },
    { key: "fel", label: t.container.columns["fel"] },
    { key: "iso", label: t.container.columns["iso"] },
    { key: "gross", label: t.container.columns["gross"] },
    { key: "vgm", label: t.container.columns["vgm"] },
    { key: "category", label: t.container.columns["category"] },
    { key: "cust", label: t.container.columns["cust"] },
    { key: "truck_vessel", label: t.container.columns["truck_vessel"] },
    { key: "line_oper", label: t.container.columns["line_oper"] },
    { key: "im_exp", label: t.container.columns["im_exp"] },
    { key: "bill_book", label: t.container.columns["bill_book"] },
    { key: "cust_approval_date", label: t.container.columns["cust_approval_date"] },
    { key: "note", label: t.container.columns["note"] },
    { key: "queried_at", label: t.container.columns["queried_at"] },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Container: ${container.containerno || 'Chi tiết'}`}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
          {fields.map((f) => {
            const val = container[f.key] !== undefined && container[f.key] !== null ? container[f.key] : 'null';
            const isNull = val === 'null' || val === '' || val === 0;
            return (
              <div
                key={f.key}
                className={`p-3 rounded-xl border flex flex-col justify-between transition-all ${
                  isNull
                    ? 'bg-slate-50/50 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50'
                    : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 shadow-sm'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {f.label}
                  </span>
                  {!isNull && (
                    <button
                      type="button"
                      onClick={() => copyField(String(val), f.key)}
                      className="text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 p-0.5 rounded transition-colors"
                      title={t.common.copy}
                    >
                      {copiedKey === f.key ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
                <div className={`text-sm font-semibold break-words ${isNull ? 'text-slate-400 dark:text-slate-500 italic' : 'text-slate-900 dark:text-slate-100'}`}>
                  {String(val)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
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
