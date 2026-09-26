import React from 'react';
import { parseVnDateTime } from '../../utils/vnTime';
import { formatDateTimeShort, tf } from '../../services/i18nFormat';
import { useMinuteTick } from '../vessel/tableHelpers';

export const CREATED_KEY = 'Thời gian thêm';

export interface RelativeTimeLabels {
  justNow: string;
  minutes: string;
  hours: string;
  days: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Rows added within this window get the "new" highlight. */
const FRESH_MS = 10 * MIN;

/** "Vừa xong" / "5 phút trước" / "3 giờ trước" / "2 ngày trước", then the full date after a week. */
export function formatRelativeTime(value: string | null | undefined, labels: RelativeTimeLabels, now = Date.now()): string {
  const d = parseVnDateTime(value);
  if (!d) return '';
  const diff = now - d.getTime();
  if (diff < MIN) return labels.justNow;
  if (diff < HOUR) return tf(labels.minutes, { n: Math.floor(diff / MIN) });
  if (diff < DAY) return tf(labels.hours, { n: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return tf(labels.days, { n: Math.floor(diff / DAY) });
  return formatDateTimeShort(value);
}

interface AddedAtProps {
  value: unknown;
  labels: RelativeTimeLabels;
}

/** Relative "added" time for a booking row; refreshes itself once per minute. */
export const AddedAt: React.FC<AddedAtProps> = React.memo(({ value, labels }) => {
  useMinuteTick();
  const str = value === undefined || value === null ? '' : String(value);
  const d = parseVnDateTime(str);
  if (!d) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  const fresh = Date.now() - d.getTime() < FRESH_MS;
  return (
    <span
      title={formatDateTimeShort(str)}
      className={`inline-flex items-center gap-1.5 ${fresh ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}
    >
      {fresh && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
      {formatRelativeTime(str, labels)}
    </span>
  );
});
AddedAt.displayName = 'AddedAt';
