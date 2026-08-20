import React, { useState, useEffect } from 'react';
import { RefreshCw, Clock, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const PRESETS = [
  { label: '5 phút', value: 5 },
  { label: '15 phút', value: 15 },
  { label: '30 phút', value: 30 },
  { label: '1 giờ', value: 60 },
  { label: '2 giờ', value: 120 },
  { label: '4 giờ', value: 240 },
];

export const AutoSyncSettingsCard: React.FC = () => {
  const { autoSyncEnabled, syncInterval, toggleAutoSync, updateSyncInterval } = useApp();
  const [customInput, setCustomInput] = useState<string>(String(syncInterval || 10));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCustomInput(String(syncInterval));
  }, [syncInterval]);

  const handleToggle = async () => {
    setLoading(true);
    const validInterval = Math.max(1, Number(customInput) || syncInterval || 10);
    await toggleAutoSync(!autoSyncEnabled, validInterval);
    setLoading(false);
  };

  const handleApplyInterval = async (val?: number) => {
    const target = val !== undefined ? val : Number(customInput);
    setLoading(true);
    await updateSyncInterval(target);
    setLoading(false);
  };

  return (
    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
      {/* Header with Switch */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg transition-colors ${
            autoSyncEnabled 
              ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400' 
              : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
          }`}>
            <RefreshCw className={`w-4 h-4 ${autoSyncEnabled ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Tự động đồng bộ (Auto Sync)
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                autoSyncEnabled 
                  ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300' 
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
              }`}>
                {autoSyncEnabled ? 'ON' : 'OFF'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Tự động truy vấn ePort làm mới toàn bộ danh sách theo dõi định kỳ.
            </p>
          </div>
        </div>

        {/* Toggle Button */}
        <button
          type="button"
          disabled={loading}
          onClick={handleToggle}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 ${
            autoSyncEnabled
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200'
          }`}
        >
          {autoSyncEnabled ? 'ĐANG BẬT' : 'BẬT NGAY'}
        </button>
      </div>

      {/* Manual Input & Presets */}
      <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Thời gian làm mới (phút):</span>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max="10080"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleApplyInterval())}
              placeholder="VD: 10"
              className="w-20 px-2.5 py-1 text-xs font-bold text-center bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500 font-medium">phút</span>
            <button
              type="button"
              disabled={loading}
              onClick={() => handleApplyInterval()}
              className="px-2.5 py-1 text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-1 shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Lưu</span>
            </button>
          </div>
        </div>

        {/* Quick presets chips */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mr-1">
            Chọn nhanh:
          </span>
          {PRESETS.map((p) => {
            const isSelected = Number(customInput) === p.value;
            return (
              <button
                key={p.value}
                type="button"
                disabled={loading}
                onClick={() => {
                  setCustomInput(String(p.value));
                  handleApplyInterval(p.value);
                }}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all ${
                  isSelected
                    ? 'bg-primary-50 dark:bg-primary-950/80 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700 font-bold'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
