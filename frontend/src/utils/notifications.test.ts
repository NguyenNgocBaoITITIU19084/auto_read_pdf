import { describe, expect, it } from 'vitest';
import { translations } from '../i18n/translations';
import type { AppNotification } from '../types';
import { notificationChange, notificationSubject, notificationTitle, shortDateTime, timeShift } from './notifications';

const base: AppNotification = {
  id: 1, collection_id: 1, kind: 'vessel_closing', title: 'Tàu HMM HOPE 062E-062E: đổi hạn đóng máng',
  old_value: '23/09/2026 11:00', new_value: '24/09/2026 09:30', detail: { vessel: 'HMM HOPE', voyage: '062E-062E' },
  nav_tab: 'vessel', nav_query: 'HMM HOPE', source: 'auto_sync', created_at: '2026-09-30 10:00:00', read: false,
};

describe('notification text', () => {
  it('names a vessel with its voyage and a container by its number', () => {
    expect(notificationSubject(base)).toBe('HMM HOPE 062E-062E');
    expect(notificationSubject({ ...base, kind: 'container_outgate', detail: { container: 'EMCU1234567' } })).toBe('EMCU1234567');
  });

  it('builds the headline in the chosen language', () => {
    expect(notificationTitle(base, translations.vi)).toBe('Tàu HMM HOPE 062E-062E: đổi hạn đóng máng');
    expect(notificationTitle(base, translations.en)).toBe('Vessel HMM HOPE 062E-062E: closing time changed');
    const cont: AppNotification = { ...base, kind: 'container_customs', detail: { container: 'EMCU1234567' }, old_value: 'Chưa thông quan', new_value: 'Đã thông quan' };
    expect(notificationTitle(cont, translations.en)).toBe('Container EMCU1234567 cleared by customs');
  });

  it("falls back to the backend's text when the kind or subject is unknown", () => {
    expect(notificationTitle({ ...base, kind: 'something_new' as any }, translations.vi)).toBe(base.title);
    expect(notificationTitle({ ...base, detail: {}, nav_query: null }, translations.vi)).toBe(base.title);
  });

  it('shows old → new for a changed time and just the value for an event', () => {
    expect(notificationChange(base)).toBe('23/09/2026 11:00 → 24/09/2026 09:30');
    expect(notificationChange({ ...base, old_value: '', new_value: '26/09/2026 09:46' })).toBe('26/09/2026 09:46');
  });

  it('groups every changed time of a vessel under one headline', () => {
    const grouped: AppNotification = {
      ...base, kind: 'vessel_schedule', title: 'DONGJIN CONFIDENT 0152S-0152S đã đổi', old_value: '',
      new_value: 'ETD 06/10/2026 23:00 → 07/10/2026 23:00\nCut-off 05/10/2026 15:00 → 06/10/2026 15:00',
      detail: {
        vessel: 'DONGJIN CONFIDENT', voyage: '0152S-0152S', changes: [
          { kind: 'vessel_etd', label: 'ETD', old: '06/10/2026 23:00', new: '07/10/2026 23:00' },
          { kind: 'vessel_open_gate', label: 'Mở cổng hạ', old: '03/10/2026 00:00', new: '04/10/2026 00:00' },
        ],
      },
    };
    expect(notificationTitle(grouped, translations.vi)).toBe('DONGJIN CONFIDENT 0152S-0152S đã đổi');
    expect(notificationChange(grouped, translations.vi)).toBe(
      'ETD 06/10/2026 23:00 → 07/10/2026 23:00\nMở cổng hạ 03/10/2026 00:00 → 04/10/2026 00:00');
    expect(notificationChange(grouped, translations.en).split('\n')[1]).toBe('Gate open 03/10/2026 00:00 → 04/10/2026 00:00');
    expect(notificationChange(grouped)).toBe(grouped.new_value);  // no translations: the backend's text
  });

  it('tells how far a time moved, in full or as one rounded unit', () => {
    const vi = translations.vi;
    expect(timeShift('05/10/2026 20:00', '05/10/2026 08:30', vi)).toEqual({ minutes: -690, text: '−11 giờ 30 phút' });
    expect(timeShift('05/10/2026 20:00', '05/10/2026 08:30', vi, true)?.text).toBe('−12 giờ');
    expect(timeShift('06/10/2026 23:00', '08/10/2026 01:00', vi)?.text).toBe('+1 ngày 2 giờ');
    expect(timeShift('06/10/2026 23:00', '08/10/2026 01:00', translations.en, true)?.text).toBe('+1d');
    expect(timeShift('06/10/2026 23:00', '06/10/2026 23:00', vi)).toBeNull();
    expect(timeShift('', '06/10/2026 23:00', vi)).toBeNull();
    expect(shortDateTime('07/10/2026 23:00')).toBe('07/10 23:00');
  });

  it('names the test sample in the chosen language', () => {
    const sample: AppNotification = { ...base, kind: 'test', title: 'Thông báo thử', old_value: '', new_value: '17:58:02', detail: {}, nav_tab: null, nav_query: null };
    expect(notificationTitle(sample, translations.vi)).toBe('Thông báo thử');
    expect(notificationTitle(sample, translations.en)).toBe('Test notification');
  });
});
