import React, { useEffect, useRef } from 'react';
import { ArrowDownToLine, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';

export interface UpdateOffer {
  /** 'install': downloaded, restart to install (Windows). 'download': open the release page (macOS, Windows portable). */
  kind: 'install' | 'download';
  version: string;
  currentVersion: string;
  notes: string;
}

interface UpdateDialogProps {
  offer: UpdateOffer;
  busy?: boolean;
  onAccept: () => void;
  onLater: () => void;
}

/** Announces a new version as soon as it is ready: what changed, and install (or download) now or later. */
export const UpdateDialog: React.FC<UpdateDialogProps> = ({ offer, busy = false, onAccept, onLater }) => {
  const { t } = useApp();
  const u = t.appUpdate;
  const acceptRef = useRef<HTMLButtonElement>(null);
  const onLaterRef = useRef(onLater);
  onLaterRef.current = onLater;

  useEffect(() => {
    const focusTimer = window.setTimeout(() => acceptRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onLaterRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const install = offer.kind === 'install';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onLater()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 pt-5">
          <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 id="update-dialog-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">{u.dialogTitle}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {offer.currentVersion ? `v${offer.currentVersion} → ` : ''}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">v{offer.version}</span>
            </p>
          </div>
        </div>

        <div className="px-5 pt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">{u.dialogNotes}</p>
          <div className="max-h-56 overflow-y-auto rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 whitespace-pre-line break-words">
            {offer.notes || u.dialogNoNotes}
          </div>
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            {install ? tf(u.installMessage, { version: offer.version }) : u.dialogDownloadHint}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 mt-1">
          <button
            type="button"
            onClick={onLater}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {u.later}
          </button>
          <button
            ref={acceptRef}
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            {install ? u.installNow : u.downloadNew}
          </button>
        </div>
      </div>
    </div>
  );
};
