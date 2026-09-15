import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';
import { formatTimeAgo } from '../../utils/formatters';
import { useMinuteTick } from './tableHelpers';

export interface WatchlistSyncLabels {
  syncStatusOk: string;
  syncStatusNotFound: string;
  syncStatusError: string;
  syncNever: string;
  lastSyncAt: string;
}

interface WatchlistSyncBadgeProps {
  status?: string | null;
  at?: string | null;
  message?: string | null;
  labels: WatchlistSyncLabels;
}

/** Per-item auto-sync result: status badge + relative last sync time; message as tooltip. */
export const WatchlistSyncBadge: React.FC<WatchlistSyncBadgeProps> = React.memo(({ status, at, message, labels }) => {
  useMinuteTick();
  const normalized = (status || '').toLowerCase();

  if (!at && !normalized) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium italic text-slate-400 dark:text-slate-500">
        <Clock className="w-3 h-3" />
        {labels.syncNever}
      </span>
    );
  }

  let cls = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  let Icon = Clock;
  let text = status || '';
  if (normalized === 'ok') {
    cls = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800';
    Icon = CheckCircle2;
    text = labels.syncStatusOk;
  } else if (normalized === 'not_found') {
    cls = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800';
    Icon = AlertTriangle;
    text = labels.syncStatusNotFound;
  } else if (normalized === 'error') {
    cls = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800';
    Icon = XCircle;
    text = labels.syncStatusError;
  }

  const tooltip = [at ? `${labels.lastSyncAt}: ${at}` : '', message || ''].filter(Boolean).join('\n');

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={tooltip || undefined}>
      {normalized && (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 ${cls}`}>
          <Icon className="w-3 h-3" />
          {text}
        </span>
      )}
      {at && <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">{formatTimeAgo(at)}</span>}
      {message && normalized !== 'ok' && (
        <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[160px]">{message}</span>
      )}
    </span>
  );
});
WatchlistSyncBadge.displayName = 'WatchlistSyncBadge';
