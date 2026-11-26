import { describe, expect, it } from 'vitest';
import { daysUntil, fold, formatIsoDate, liveDaysLeft, matches, todayVnIso, licenseAllows, licenseNeeded, payloadKg } from './fleetUtils';

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

describe('licence classes for a truck follow its weight', () => {
  const truck = (gross_weight: number, payload: string) => ({ category: 'truck' as const, gross_weight, payload });
  it.each([
    [3400, '1.9 tấn', ['B', 'B2', 'C1', 'C', 'FC'], ['D']],
    [4990, '2,4 tấn', ['B2', 'C1', 'C'], ['B']],
    [7500, '3.5 tấn', ['C1', 'C'], ['B', 'B2']],
    [9500, '5.5 tấn', ['C', 'FC', 'CE', 'E'], ['C1', 'B2', 'B']],
    [0, '2 tấn', ['B2', 'C'], ['C1', 'B']],
  ])('%i kg, %s', (gross, payload, allowed, refused) => {
    for (const c of allowed) expect(licenseAllows(c, truck(gross, payload))).toBe(true);
    for (const c of refused) expect(licenseAllows(c, truck(gross, payload))).toBe(false);
  });
  it('a tractor needs FC / CE whatever it weighs', () => {
    expect(licenseAllows('C', { category: 'tractor', gross_weight: 3000 })).toBe(false);
    expect(licenseAllows('b2, fc', { category: 'tractor' })).toBe(true);
    expect(licenseNeeded({ category: 'tractor' })).toBe('FC/CE');
  });
  it('names the classes to ask for', () => {
    expect(licenseNeeded(truck(4990, '2,4 tấn'))).toBe('B2/C1/C/FC');
    expect(licenseNeeded(truck(9500, '5.5 tấn'))).toBe('C/FC');
  });
  it.each([['8 tấn', 8000], ['2,4 tấn', 2400], ['7500 kg', 7500], ['3.5', 3500], ['', null], ['không rõ', null]])(
    'reads tải trọng %s', (text, kg) => expect(payloadKg(text as string)).toBe(kg));
});
