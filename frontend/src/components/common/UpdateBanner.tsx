import React, { useState } from 'react';
import { ArrowDownToLine, RotateCw, X } from 'lucide-react';
import { useUpdateStatus } from '../../hooks/useUpdateStatus';

/**
 * Thin strip shown once a new version has finished downloading in the background.
 * Dismissing it only hides the strip — the update still installs on the next quit.
 */
export const UpdateBanner: React.FC = () => {
  const { status, install } = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (status.state !== 'downloaded' || dismissed) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-emerald-600 text-white text-xs font-semibold shrink-0">
      <ArrowDownToLine className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-0 truncate">
        Đã có phiên bản {status.version} và tải xong. Khởi động lại để cài đặt.
      </span>
      <button
        type="button"
        disabled={installing}
        onClick={() => {
          setInstalling(true);
          install().finally(() => setInstalling(false));
        }}
        className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-60 transition-colors shrink-0"
      >
        <RotateCw className={`w-3.5 h-3.5 ${installing ? 'animate-spin' : ''}`} />
        Khởi động lại & cài
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Đóng"
        className="p-1 rounded-md hover:bg-white/20 transition-colors shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
