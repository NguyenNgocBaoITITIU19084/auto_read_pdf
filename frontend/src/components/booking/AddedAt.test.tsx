import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './AddedAt';

const labels = { justNow: 'Vừa xong', minutes: '{n} phút trước', hours: '{n} giờ trước', days: '{n} ngày trước' };
const now = new Date('2026-09-26T03:35:00Z').getTime(); // 10:35 VN

describe('formatRelativeTime', () => {
  it('uses VN wall-clock timestamps from the backend', () => {
    expect(formatRelativeTime('2026-09-26 10:34:30', labels, now)).toBe('Vừa xong');
    expect(formatRelativeTime('2026-09-26 10:34:00', labels, now)).toBe('1 phút trước');
    expect(formatRelativeTime('2026-09-26 10:30:00', labels, now)).toBe('5 phút trước');
    expect(formatRelativeTime('2026-09-26 07:35:00', labels, now)).toBe('3 giờ trước');
    expect(formatRelativeTime('2026-09-24 10:00:00', labels, now)).toBe('2 ngày trước');
  });

  it('shows the full date after a week and nothing for missing values', () => {
    expect(formatRelativeTime('2026-09-01 08:05:00', labels, now)).toBe('08:05 01/09/2026');
    expect(formatRelativeTime('', labels, now)).toBe('');
    expect(formatRelativeTime(null, labels, now)).toBe('');
  });

  it('treats a slightly-ahead clock as just now', () => {
    expect(formatRelativeTime('2026-09-26 10:35:20', labels, now)).toBe('Vừa xong');
  });
});
