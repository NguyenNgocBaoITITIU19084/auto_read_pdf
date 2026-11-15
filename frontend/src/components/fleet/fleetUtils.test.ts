import { describe, expect, it } from 'vitest';
import { daysUntil, fold, formatIsoDate, liveDaysLeft, matches, todayVnIso } from './fleetUtils';

describe('fleetUtils', () => {
  it('counts days in Vietnam time', () => {
    // 23:30 UTC on 14/11 is already 15/11 in Vietnam
    expect(todayVnIso(new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-15');
    expect(daysUntil('2026-11-20', '2026-11-15')).toBe(5);
    expect(daysUntil('2026-11-10', '2026-11-15')).toBe(-5);
    expect(daysUntil('2027-03-01', '2026-11-15')).toBe(106);
    expect(daysUntil('', '2026-11-15')).toBeNull();
  });

  it('counts the days of a notified document from today', () => {
    expect(liveDaysLeft({ expiry: '25/11/2026', days_left: 10 }, '2026-11-20')).toBe(5);
    expect(liveDaysLeft({ expiry: 'bad', days_left: 3 }, '2026-11-20')).toBe(3);
  });

  it('formats dates and matches Vietnamese text without accents', () => {
    expect(formatIsoDate('2026-01-09')).toBe('09/01/2026');
    expect(fold('Đặng Văn Ân')).toBe('dang van an');
    expect(matches('dang an', 'Đặng Văn Ân')).toBe(false);
    expect(matches('van an', 'Đặng Văn Ân')).toBe(true);
    expect(matches('51c12345', '51C-123.45')).toBe(true);
    expect(matches('51c 123', '51C-123.45')).toBe(true);
    expect(matches('51c9', '51C-123.45')).toBe(false);
    expect(matches('51c-123', '51C-123.45')).toBe(true);
  });
});
