import { describe, expect, it } from 'vitest';
import { bookingToForm, diffBookingForm, emptyBookingForm, isValidBookingDate, validateBookingForm } from './bookingForm';

describe('bookingForm', () => {
  it('validates dates', () => {
    expect(isValidBookingDate('', false)).toBe(true);
    expect(isValidBookingDate('20/09/2026', false)).toBe(true);
    expect(isValidBookingDate('29/02/2028', false)).toBe(true);
    expect(isValidBookingDate('30/02/2026', false)).toBe(false);
    expect(isValidBookingDate('20/09/2026 17:30', false)).toBe(false);
    expect(isValidBookingDate('20/09/2026 17:30', true)).toBe(true);
    expect(isValidBookingDate('20/09/2026 24:00', true)).toBe(false);
    expect(isValidBookingDate('2026-09-20', false)).toBe(false);
  });

  it('requires booking no or vessel and checks qty', () => {
    const v = emptyBookingForm();
    expect(validateBookingForm(v)._identity).toBe('identityRequired');
    expect(validateBookingForm({ ...v, Vessel: 'KOTA' })._identity).toBeUndefined();
    expect(validateBookingForm({ ...v, 'Booking No': 'A', "Q'ty": '0' })["Q'ty"]).toBe('qtyInvalid');
    expect(validateBookingForm({ ...v, 'Booking No': 'A', ETD: '31/04/2026' }).ETD).toBe('dateInvalid');
  });

  it('maps null-ish booking values to empty strings and diffs only changed fields', () => {
    const initial = bookingToForm({ id: 1, 'Booking No': 'A1', Vessel: 'null', Carrier: undefined } as any);
    expect(initial.Vessel).toBe('');
    expect(diffBookingForm(initial, { ...initial, Vessel: ' NEW ' })).toEqual({ Vessel: 'NEW' });
    expect(diffBookingForm(initial, initial)).toEqual({});
  });

  it('limits the note length and keeps line breaks when diffing', () => {
    const v = { ...emptyBookingForm(), 'Booking No': 'A' };
    expect(validateBookingForm({ ...v, 'Ghi chú': 'x'.repeat(2000) })['Ghi chú']).toBeUndefined();
    expect(validateBookingForm({ ...v, 'Ghi chú': 'x'.repeat(2001) })['Ghi chú']).toBe('noteTooLong');
    const initial = bookingToForm({ id: 1, 'Booking No': 'A', 'Ghi chú': '' } as any);
    expect(diffBookingForm(initial, { ...initial, 'Ghi chú': ' dòng 1\ndòng 2 ' })).toEqual({ 'Ghi chú': 'dòng 1\ndòng 2' });
  });
});
