import React from 'react';
import { ArrowDownToLine, Check, Loader2, RefreshCw, RotateCw, AlertTriangle, ExternalLink } from 'lucide-react';
import { useUpdateStatus } from '../../hooks/useUpdateStatus';

/** Update panel in Settings. On macOS / browser it degrades to a link to the releases page. */
export const UpdateSettingsCard: React.FC = () => {
  const { status, checking, check, install } = useUpdateStatus();
  const { state, version, percent = 0, error, currentVersion, releasesUrl } = status;

  const busy = checking || state === 'checking' || state === 'downloading';

  const openReleases = () => {
    const url = releasesUrl || 'https://github.com/NguyenNgocBaoITITIU19084/auto_read_pdf/releases/latest';
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url).catch(() => {});
    else window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-1.5 rounded-lg shrink-0 transition-colors ${
            state === 'downloaded'
              ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400'
              : state === 'error'
                ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400'
                : 'bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400'
          }`}>
            <ArrowDownToLine className={`w-4 h-4 ${state === 'downloading' ? 'animate-pulse' : ''}`} />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Cập nhật ứng dụng</span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Phiên bản hiện tại: <span className="font-semibold">{currentVersion || '—'}</span>
            </p>
          </div>
        </div>

        {state === 'downloaded' ? (
          <button
            type="button"
            onClick={() => install()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors shrink-0"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Khởi động lại & cài
          </button>
        ) : state === 'unsupported' ? (
          <button
            type="button"
            onClick={openReleases}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Trang tải về
          </button>
        ) : (
          <button
            type="button"
            onClick={() => check()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white shadow-xs transition-colors shrink-0"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Kiểm tra
          </button>
        )}
      </div>

      <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 text-[11px]">
        {state === 'checking' && (
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <Loader2 className="w-3 h-3 animate-spin" /> Đang kiểm tra bản mới...
          </span>
        )}
        {state === 'up-to-date' && (
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <Check className="w-3 h-3" /> Bạn đang dùng phiên bản mới nhất.
          </span>
        )}
        {state === 'downloading' && (
          <div className="space-y-1.5">
            <span className="text-slate-600 dark:text-slate-300 font-semibold">
              Đang tải bản {version || 'mới'}... {percent}%
            </span>
            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className="h-full bg-primary-600 transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
        {state === 'downloaded' && (
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
            Đã tải xong bản {version}. Bấm "Khởi động lại & cài" để cập nhật.
          </span>
        )}
        {state === 'error' && (
          <span className="flex items-start gap-1.5 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">Không kiểm tra được bản mới: {error}</span>
          </span>
        )}
        {state === 'unsupported' && (
          <span className="text-slate-500 dark:text-slate-400">
            Tự động cập nhật chỉ hỗ trợ bản Windows. Trên macOS vui lòng tải bản mới thủ công.
          </span>
        )}
        {state === 'idle' && (
          <span className="text-slate-500 dark:text-slate-400">
            App tự kiểm tra bản mới khi khởi động và mỗi 6 giờ.
          </span>
        )}
      </div>
    </div>
  );
};
