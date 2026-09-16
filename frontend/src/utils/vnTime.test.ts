import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseVnDateTime, vnParts } from './vnTime';
import { formatTimeAgo, isRecentUpdate } from './formatters';
import { formatDateTimeShort } from '../services/i18nFormat';

afterEach(() => vi.useRealTimers());

describe('vnTime', () => {
  it('treats naive backend strings as Asia/Ho_Chi_Minh', () => {
    const d = parseVnDateTime('2026-09-15 10:30:00')!;
    expect(d.toISOString()).toBe('2026-09-15T03:30:00.000Z');
  });

  it('parses DD/MM/YYYY HH:mm as VN time', () => {
    expect(parseVnDateTime('15/09/2026 10:30')!.toISOString()).toBe('2026-09-15T03:30:00.000Z');
  });

  it('keeps explicit offsets', () => {
    expect(parseVnDateTime('2026-09-15T03:30:00Z')!.toISOString()).toBe('2026-09-15T03:30:00.000Z');
  });

  it('returns null for garbage', () => {
    expect(parseVnDateTime('null')).toBeNull();
    expect(parseVnDateTime('abc')).toBeNull();
  });

  it('vnParts reports VN wall clock', () => {
    expect(vnParts(new Date('2026-09-15T20:05:00Z'))).toEqual({ year: 2026, month: 9, day: 16, hour: 3, minute: 5 });
  });

  it('formatTimeAgo is correct when the machine is not in VN', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T03:35:00Z')); // 10:35 VN
    expect(formatTimeAgo('2026-09-15 10:30:00')).toBe('5 phút trước');
    expect(isRecentUpdate('2026-09-15 10:30:00', 30)).toBe(true);
    vi.setSystemTime(new Date('2026-09-15T08:00:00Z')); // 15:00 VN
    expect(formatTimeAgo('2026-09-15 10:30:00')).toBe('Hôm nay 10:30');
    expect(formatDateTimeShort('2026-09-15 10:30:00')).toBe('10:30 15/09/2026');
  });
});
