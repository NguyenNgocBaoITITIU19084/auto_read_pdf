import React from 'react';
import { formatTimeAgo, isRecentUpdate } from '../../utils/formatters';
import { useMinuteTick } from './tableHelpers';

interface QueriedAtBadgeProps {
  value: unknown;
  emptyText?: string;
}

/** "Cập nhật lúc" badge — refreshes its relative time itself once per minute. */
export const QueriedAtBadge: React.FC<QueriedAtBadgeProps> = React.memo(({ value, emptyText = 'Chưa cập nhật' }) => {
  useMinuteTick();
  const str = value === undefined || value === null ? '' : String(value);
  if (!str || str === 'null') {
    return <span className="text-slate-400 dark:text-slate-500 italic text-[11px]">{emptyText}</span>;
  }
  const isRecent = isRecentUpdate(str, 45);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-tight border ${
        isRecent
          ? 'bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-2xs'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRecent ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
      <span>{formatTimeAgo(str)}</span>
    </span>
  );
});
QueriedAtBadge.displayName = 'QueriedAtBadge';
