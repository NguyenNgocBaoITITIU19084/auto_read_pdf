import { AutoSyncStatus, AutoSyncSchedule } from '../types';
import { tf } from './i18nFormat';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidSyncTime = (value: string): boolean => TIME_RE.test((value || '').trim());

/** Trims, pads ("8:00" -> "08:00"), drops invalid entries, dedupes and sorts ascending. */
export const normalizeSyncTimes = (times: string[] | null | undefined): string[] => {
  if (!Array.isArray(times)) return [];
  const out = new Set<string>();
  times.forEach((raw) => {
    const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return;
    const hh = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const v = `${hh}:${mm}`;
    if (TIME_RE.test(v)) out.add(v);
  });
  return Array.from(out).sort();
};

export const scheduleFromStatus = (status: AutoSyncStatus | null | undefined): AutoSyncSchedule => ({
  mode: status?.mode === 'times' ? 'times' : 'interval',
  interval_minutes: status?.interval_minutes && status.interval_minutes > 0 ? status.interval_minutes : 10,
  times: normalizeSyncTimes(status?.times),
});

export const formatIntervalShort = (minutes: number): string =>
  minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}p`;

/** Human readable schedule, e.g. "mỗi 15 phút" / "lúc 08:00, 14:00". */
export const describeAutoSyncSchedule = (
  schedule: Pick<AutoSyncSchedule, 'mode' | 'interval_minutes' | 'times'> | null | undefined,
  labels: { everyMinutes: string; atTimes: string }
): string => {
  if (!schedule) return '';
  if (schedule.mode === 'times') {
    return tf(labels.atTimes, { times: normalizeSyncTimes(schedule.times).join(', ') || '--:--' });
  }
  return tf(labels.everyMinutes, { n: schedule.interval_minutes });
};
