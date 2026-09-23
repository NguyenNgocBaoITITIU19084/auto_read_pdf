import type { Booking } from '../../types';

export type BookingFieldKey = 'Booking No' | 'Carrier' | 'Vessel' | 'ETD' | 'Port of Discharging' | 'Place of Delivery'
  | 'T/S Port' | 'Block' | 'Equipment Type' | "Q'ty" | 'Empty Pick Up CY' | 'Full return CY' | 'Port Cargo Cut-off' | 'Tên file PDF'
  | 'Ghi chú';

export type BookingFormValues = Record<BookingFieldKey, string>;
type FieldKind = 'text' | 'date' | 'datetime' | 'number' | 'carrier' | 'textarea';

export const NOTE_MAX_LENGTH = 2000;

export const BOOKING_FORM_SECTIONS: { titleKey: 'main' | 'ports' | 'equipment' | 'yards' | 'source' | 'note'; fields: { key: BookingFieldKey; kind: FieldKind; required?: boolean }[] }[] = [
  { titleKey: 'main', fields: [
    { key: 'Booking No', kind: 'text', required: true }, { key: 'Carrier', kind: 'carrier' },
    { key: 'Vessel', kind: 'text', required: true }, { key: 'ETD', kind: 'date' },
  ] },
  { titleKey: 'ports', fields: [
    { key: 'Port of Discharging', kind: 'text' }, { key: 'Place of Delivery', kind: 'text' },
    { key: 'T/S Port', kind: 'text' }, { key: 'Block', kind: 'text' },
  ] },
  { titleKey: 'equipment', fields: [{ key: 'Equipment Type', kind: 'text' }, { key: "Q'ty", kind: 'number' }] },
  { titleKey: 'yards', fields: [
    { key: 'Empty Pick Up CY', kind: 'text' }, { key: 'Full return CY', kind: 'text' }, { key: 'Port Cargo Cut-off', kind: 'datetime' },
  ] },
  { titleKey: 'source', fields: [{ key: 'Tên file PDF', kind: 'text' }] },
  { titleKey: 'note', fields: [{ key: 'Ghi chú', kind: 'textarea' }] },
];

const ALL_KEYS = BOOKING_FORM_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
const clean = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s.toLowerCase() === 'null' ? '' : s;
};

export function emptyBookingForm(): BookingFormValues {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, ''])) as BookingFormValues;
}

export function bookingToForm(b: Partial<Booking> | null): BookingFormValues {
  const form = emptyBookingForm();
  if (b) ALL_KEYS.forEach((k) => { form[k] = clean((b as Record<string, unknown>)[k]); });
  return form;
}

export function isValidBookingDate(value: string, allowTime: boolean): boolean {
  const v = value.trim();
  if (!v) return true;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/);
  if (!m || (m[4] !== undefined && !allowTime)) return false;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return false;
  return m[4] === undefined || (Number(m[4]) <= 23 && Number(m[5]) <= 59);
}

export function validateBookingForm(v: BookingFormValues): Partial<Record<BookingFieldKey | '_identity', string>> {
  const errors: Partial<Record<BookingFieldKey | '_identity', string>> = {};
  if (!v['Booking No'].trim() && !v.Vessel.trim()) errors._identity = 'identityRequired';
  if (!isValidBookingDate(v.ETD, false)) errors.ETD = 'dateInvalid';
  if (!isValidBookingDate(v['Port Cargo Cut-off'], true)) errors['Port Cargo Cut-off'] = 'dateTimeInvalid';
  const qty = v["Q'ty"].trim();
  if (qty && !(/^\d+$/.test(qty) && Number(qty) >= 1 && Number(qty) <= 999)) errors["Q'ty"] = 'qtyInvalid';
  if (v['Ghi chú'].trim().length > NOTE_MAX_LENGTH) errors['Ghi chú'] = 'noteTooLong';
  return errors;
}

export function diffBookingForm(initial: BookingFormValues, current: BookingFormValues): Partial<BookingFormValues> {
  const diff: Partial<BookingFormValues> = {};
  ALL_KEYS.forEach((k) => {
    const next = current[k].trim();
    if (next !== initial[k].trim()) diff[k] = next;
  });
  return diff;
}
