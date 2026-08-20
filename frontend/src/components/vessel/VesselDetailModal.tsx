import React from 'react';
import { Copy, Check, Ship, Clock, CheckCircle2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { VesselSchedule } from '../../types';
import { useApp } from '../../context/AppContext';
import { formatTimeAgo, isRecentUpdate } from '../../utils/formatters';
import { getPortDisplayName } from '../../utils/ports';

interface VesselDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  schedule: VesselSchedule | null;
}

export const VesselDetailModal: React.FC<VesselDetailModalProps> = ({
  isOpen,
  onClose,
  schedule,
}) => {
  const { t, language, addToast } = useApp();
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  if (!schedule) return null;

  const copyField = (val: string, keyName: string) => {
    if (!val || val === 'null') return;
    navigator.clipboard.writeText(val);
    setCopiedKey(keyName);
    addToast(t.common.copySuccess, 'success');
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const isRecent = isRecentUpdate(schedule.queried_at, 45);

  const fields: { key: string; label: string }[] = [
    { key: "site_id", label: t.vessel.columns["site_id"] },
    { key: "agent", label: t.vessel.columns["agent"] },
    { key: "vessel_name", label: t.vessel.columns["vessel_name"] },
    { key: "in_out_voyage", label: t.vessel.columns["in_out_voyage"] },
    { key: "actual_berth_time", label: t.vessel.columns["actual_berth_time"] },
    { key: "actual_departure_time", label: t.vessel.columns["actual_departure_time"] },
    { key: "closing_time", label: t.vessel.columns["closing_time"] },
    { key: "closing_time_icd", label: t.vessel.columns["closing_time_icd"] },
    { key: "in_gate", label: t.vessel.columns["in_gate"] },
    { key: "open_ts", label: t.vessel.columns["open_ts"] },
    { key: "reefer_open_ts", label: t.vessel.columns["reefer_open_ts"] },
    { key: "oog_open_ts", label: t.vessel.columns["oog_open_ts"] },
    { key: "haz_open_ts", label: t.vessel.columns["haz_open_ts"] },
    { key: "remarks", label: t.vessel.columns["remarks"] },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Chi tiết Lịch tàu: ${schedule.vessel_name || ''}`}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Status & Update Banner */}
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800/80 dark:to-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-950/70 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0">
              <Ship className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {schedule.vessel_name}
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                  Chuyến: {schedule.in_out_voyage || 'null'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Khu vực cảng: <strong>{getPortDisplayName(schedule.site_id, language)}</strong> • Đại lý: <strong>{schedule.agent || 'null'}</strong>
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border shadow-xs ${
                isRecent
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {isRecent ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>Đồng bộ: {formatTimeAgo(schedule.queried_at)}</span>
            </span>
            {schedule.queried_at && (
              <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                {schedule.queried_at}
              </span>
            )}
          </div>
        </div>

        {/* Detailed Fields Grid */}
        <div className="grid grid-cols-2 gap-2.5 max-h-[55vh] overflow-y-auto pr-1">
          {fields.map((f) => {
            const val = schedule[f.key] || 'null';
            const isNull = val === 'null' || !val;
            return (
              <div
                key={f.key}
                className={`p-2.5 rounded-xl border flex flex-col justify-between transition-all ${
                  isNull
                    ? 'bg-slate-50/40 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50'
                    : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 shadow-xs'
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
                <div className={`text-xs font-semibold break-words ${isNull ? 'text-slate-400 dark:text-slate-500 italic font-normal' : 'text-slate-900 dark:text-slate-100'}`}>
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
