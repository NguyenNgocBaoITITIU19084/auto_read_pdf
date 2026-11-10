import { describe, expect, it } from 'vitest';
import { translations } from '../i18n/translations';
import type { AppNotification, Booking } from '../types';
import { MESSAGE_MAX_BOOKINGS, bookingMessageLine, isVesselChangeNotification, vesselChangeMessage } from './vesselChangeMessage';

const vi = translations.vi;

const grouped: AppNotification = {
  id: 7, collection_id: 1, kind: 'vessel_schedule', title: 'ZHONG GU BEI JING TVI000W19 đã đổi', old_value: '',
  new_value: '', nav_tab: 'vessel', nav_query: 'ZHONG GU BEI JING', source: 'auto_sync',
  created_at: '2026-11-09 08:15:00', read: false,
  detail: {
    site_id: 'CTL', vessel: 'ZHONG GU BEI JING', voyage: 'TVI000W19', bookings: ['SGN3527323', 'SGN3527400'],
    changes: [
      { kind: 'vessel_closing', label: 'Cut-off', old: '10/11/2026 09:00', new: '09/11/2026 21:00' },
      { kind: 'vessel_etd', label: 'ETD', old: '11/11/2026 23:00', new: '12/11/2026 05:00' },
    ],
  },
};

const cma: Partial<Booking> = {
  'Booking No': 'SGN3527323', Carrier: 'CMA CGM', 'Equipment Type': "40'HC", "Q'ty": '1', 'Full return CY': 'GEMALINK PORT',
  'Port Cargo Cut-off': '10/11/2026 09:00',
};

describe('vesselChangeMessage', () => {
  it('writes the changes with their shift and the bookings on the voyage', () => {
    expect(vesselChangeMessage(grouped, [cma, { 'Booking No': 'SGN3527400', Carrier: 'null' }], vi)).toBe([
      '‼ TÀU ĐỔI LỊCH: ZHONG GU BEI JING TVI000W19',
      'Cảng: Cát Lái (CTL)',
      '• Cut-off: 10/11 09:00 → 09/11 21:00 (SỚM HƠN 12 giờ)',
      '• ETD: 11/11 23:00 → 12/11 05:00 (trễ hơn 6 giờ)',
      '',
      'Booking trên chuyến này (2):',
      "• SGN3527323 – CMA CGM – 1x40'HC – hạ GEMALINK PORT",
      '• SGN3527400',
      '(Theo ePort lúc 08:15 09/11)',
    ].join('\n'));
  });

  it("never repeats a booking's PDF cut-off, which the new time replaces", () => {
    expect(bookingMessageLine(cma, vi)).not.toContain('10/11');
  });

  it('only warns (⚠) when every time moved later', () => {
    const later = { ...grouped, detail: { ...grouped.detail, changes: [grouped.detail.changes![1]] } };
    expect(vesselChangeMessage(later, [], vi).split('\n')[0]).toBe('⚠ TÀU ĐỔI LỊCH: ZHONG GU BEI JING TVI000W19');
  });

  it('leaves the booking list out when no open booking uses the voyage', () => {
    expect(vesselChangeMessage(grouped, [], vi)).not.toContain('Booking');
  });

  it('falls back to the booking numbers kept in the notification when the bookings could not be loaded', () => {
    const text = vesselChangeMessage(grouped, null, vi);
    expect(text).toContain('Booking trên chuyến này (2):\n• SGN3527323\n• SGN3527400');
  });

  it('counts the bookings past the limit instead of listing them', () => {
    const many = Array.from({ length: MESSAGE_MAX_BOOKINGS + 3 }, (_, i) => ({ 'Booking No': `BK${i}` }));
    const text = vesselChangeMessage(grouped, many, vi);
    expect(text).toContain(`Booking trên chuyến này (${MESSAGE_MAX_BOOKINGS + 3}):`);
    expect(text).toContain('… và 3 booking khác');
    expect(text).not.toContain(`BK${MESSAGE_MAX_BOOKINGS}\n`);
  });

  it('handles a one-row-per-change notification from before and an unknown terminal code', () => {
    const legacy: AppNotification = {
      ...grouped, kind: 'vessel_closing', old_value: '23/09/2026 11:00', new_value: '24/09/2026 09:30',
      detail: { site_id: 'XYZ', vessel: 'HMM HOPE', voyage: '062E-062E' },
    };
    const text = vesselChangeMessage(legacy, [], vi);
    expect(text).toContain('Cảng: XYZ');
    expect(text).toContain('• Cut-off: 23/09 11:00 → 24/09 09:30 (trễ hơn 22 giờ 30 phút)');
  });

  it('is written in the chosen language', () => {
    expect(vesselChangeMessage(grouped, [cma], translations.en)).toContain('(12h EARLIER)');
  });

  it('applies to vessel schedule notifications only', () => {
    expect(isVesselChangeNotification(grouped)).toBe(true);
    expect(isVesselChangeNotification({ ...grouped, kind: 'vessel_closing' })).toBe(true);
    expect(isVesselChangeNotification({ ...grouped, kind: 'container_ingate' })).toBe(false);
    expect(isVesselChangeNotification({ ...grouped, kind: 'booking_cutoff' })).toBe(false);
  });
});
