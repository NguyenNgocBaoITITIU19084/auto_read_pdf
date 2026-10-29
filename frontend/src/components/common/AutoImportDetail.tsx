import React from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { AppNotification, AutoImportNoticeItem } from '../../types';
import { tf } from '../../services/i18nFormat';

/** Body of an auto-import notification: the bookings added, then the files that need a hand and why. */
export const AutoImportDetail: React.FC<{ item: AppNotification }> = ({ item }) => {
  const { t } = useApp();
  const a = t.notifications.autoImport;
  const d = item.detail || {};
  const statusLabel = a.status as Record<string, string>;

  const list = (title: string, icon: React.ReactNode, rows: AutoImportNoticeItem[], total: number, tone: string) => (
    <div>
      <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider mb-1.5 ${tone}`}>
        {icon} {title} · {total}
      </div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={`${r.file}-${i}`} className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {r.booking_no && <span className="font-mono font-bold text-slate-900 dark:text-slate-100 shrink-0">{r.booking_no}</span>}
              <span className="truncate text-slate-600 dark:text-slate-300" title={r.file}>{r.file}</span>
            </div>
            {r.status && r.status !== 'imported' && (
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                <span className="font-semibold text-amber-600 dark:text-amber-400">{statusLabel[r.status] || r.status}</span>
                {r.message ? ` · ${r.message}` : ''}
              </div>
            )}
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <p className="text-[11px] text-slate-400 mt-1">{tf(a.more, { count: total - rows.length })}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="auto-import-detail">
      {(d.imported || []).length > 0 &&
        list(a.imported, <CheckCircle2 className="w-3.5 h-3.5" />, d.imported || [], d.count || 0, 'text-emerald-600 dark:text-emerald-400')}
      {(d.skipped || []).length > 0 &&
        list(a.skipped, <AlertTriangle className="w-3.5 h-3.5" />, d.skipped || [], d.skipped_count || 0, 'text-amber-600 dark:text-amber-400')}
    </div>
  );
};
