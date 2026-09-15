### Task 7: Form thêm/sửa booking (`BookingFormModal`)

**Files:**
- Create: `frontend/src/components/booking/bookingForm.ts`, `frontend/src/components/booking/bookingForm.test.ts`
- Create: `frontend/src/components/booking/BookingFormModal.tsx`, `frontend/src/components/booking/BookingFormModal.test.tsx`
- Modify: `frontend/src/services/api.ts:96-102` (thêm `updateBookingApi`, `saveManualBookingApi` trả `warnings`)
- Modify: `frontend/src/i18n/translations.ts` (`booking.form` trong `vi` và `en`)

**Interfaces:**
- Consumes: `POST /bookings/manual-save`, `PUT /bookings/{id}` (Task 6); `CARRIERS` từ `booking/carriers.ts`; `useConfirm`
- Produces (TS):
  ```ts
  // bookingForm.ts
  export type BookingFormValues = Record<BookingFieldKey, string>;
  export type BookingFieldKey = 'Booking No' | 'Carrier' | 'Vessel' | 'ETD' | 'Port of Discharging' | 'Place of Delivery'
    | 'T/S Port' | 'Block' | 'Equipment Type' | "Q'ty" | 'Empty Pick Up CY' | 'Full return CY' | 'Port Cargo Cut-off' | 'Tên file PDF';
  export const BOOKING_FORM_SECTIONS: { titleKey: 'main' | 'ports' | 'equipment' | 'yards' | 'source'; fields: { key: BookingFieldKey; kind: 'text' | 'date' | 'datetime' | 'number' | 'carrier'; required?: boolean }[] }[]
  export function emptyBookingForm(): BookingFormValues
  export function bookingToForm(b: Partial<Booking> | null): BookingFormValues
  export function isValidBookingDate(value: string, allowTime: boolean): boolean
  export function validateBookingForm(v: BookingFormValues): Partial<Record<BookingFieldKey | '_identity', string>>  // giá trị là key dịch trong booking.form
  export function diffBookingForm(initial: BookingFormValues, current: BookingFormValues): Partial<BookingFormValues>
  // api.ts
  export const saveManualBookingApi: (collectionId: number, booking: Partial<Booking>) => Promise<{ item: Booking; warnings: string[] }>
  export const updateBookingApi: (id: number, booking: Partial<Booking>) => Promise<{ item: Booking; warnings: string[] }>
  // BookingFormModal.tsx
  export interface BookingFormModalProps { isOpen: boolean; mode: 'create' | 'edit'; booking?: Booking | null; onClose: () => void; onSaved: (item: Booking, mode: 'create' | 'edit') => void }
  ```
- Hành vi form:
  - Ô ngày nhận `DD/MM/YYYY` (Cut-off thêm tuỳ chọn ` HH:mm`); lỗi hiện dưới ô khi rời ô hoặc khi bấm Lưu.
  - Nút Lưu bị khoá khi còn lỗi hoặc không có thay đổi (chế độ sửa).
  - `Ctrl/Cmd+Enter` = Lưu.
  - Đóng khi có thay đổi chưa lưu → hỏi xác nhận.
  - Chế độ sửa chỉ gửi các trường đã đổi (`diffBookingForm`).
  - Lỗi 400 từ server hiện trong khung đỏ đầu form; `warnings` hiện bằng toast `info`.

- [ ] **Step 1: Viết test thất bại cho logic thuần**

`frontend/src/components/booking/bookingForm.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Chạy, xác nhận thất bại**

Run: `cd frontend && npm test -- bookingForm`
Expected: FAIL — không resolve `./bookingForm`

- [ ] **Step 3: Cài đặt `bookingForm.ts`**

```ts
import type { Booking } from '../../types';

export type BookingFieldKey = 'Booking No' | 'Carrier' | 'Vessel' | 'ETD' | 'Port of Discharging' | 'Place of Delivery'
  | 'T/S Port' | 'Block' | 'Equipment Type' | "Q'ty" | 'Empty Pick Up CY' | 'Full return CY' | 'Port Cargo Cut-off' | 'Tên file PDF';

export type BookingFormValues = Record<BookingFieldKey, string>;
type FieldKind = 'text' | 'date' | 'datetime' | 'number' | 'carrier';

export const BOOKING_FORM_SECTIONS: { titleKey: 'main' | 'ports' | 'equipment' | 'yards' | 'source'; fields: { key: BookingFieldKey; kind: FieldKind; required?: boolean }[] }[] = [
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
```

- [ ] **Step 4: Chạy test**

Run: `cd frontend && npm test -- bookingForm`
Expected: PASS

- [ ] **Step 5: API + chuỗi dịch**

`api.ts` — thay `saveManualBookingApi` và thêm `updateBookingApi`:
```ts
export const saveManualBookingApi = async (collectionId: number, booking: Partial<Booking>): Promise<{ item: Booking; warnings: string[] }> => {
  const res = await apiClient.post<{ status: string; id: number; item: Booking; warnings?: string[] }>('/bookings/manual-save', {
    collection_id: collectionId,
    booking,
  });
  return { item: res.data.item, warnings: res.data.warnings || [] };
};

export const updateBookingApi = async (id: number, booking: Partial<Booking>): Promise<{ item: Booking; warnings: string[] }> => {
  const res = await apiClient.put<{ status: string; item: Booking; warnings?: string[] }>(`/bookings/${id}`, { booking });
  return { item: res.data.item, warnings: res.data.warnings || [] };
};
```
`ImageBookingModal.tsx:247` đổi thành:
```ts
      const { item: saved, warnings } = await saveManualBookingApi(activeCollection.id, bookingDataToSave);
      warnings.forEach((w) => addToast(w, 'info'));
```

`translations.ts` — `vi.booking` thêm:
```ts
      form: {
        addButton: "Thêm booking",
        addTooltip: "Nhập tay một booking mới",
        createTitle: "Thêm booking thủ công",
        editTitle: "Sửa booking {no}",
        editButton: "Sửa",
        editTooltip: "Sửa dữ liệu dòng này",
        sections: { main: "Thông tin chính", ports: "Cảng", equipment: "Container", yards: "Bãi & cut-off", source: "Nguồn" },
        datePlaceholder: "DD/MM/YYYY",
        dateTimePlaceholder: "DD/MM/YYYY HH:mm",
        carrierPlaceholder: "Chọn hoặc nhập hãng tàu",
        requiredHint: "Cần Booking No hoặc Tàu",
        identityRequired: "Cần nhập ít nhất Booking No hoặc Tàu",
        dateInvalid: "Ngày không hợp lệ (DD/MM/YYYY)",
        dateTimeInvalid: "Ngày giờ không hợp lệ (DD/MM/YYYY hoặc DD/MM/YYYY HH:mm)",
        qtyInvalid: "Số lượng phải là số nguyên từ 1 đến 999",
        save: "Lưu",
        saving: "Đang lưu...",
        cancel: "Huỷ",
        shortcut: "Ctrl/⌘ + Enter để lưu",
        createSuccess: "Đã thêm booking",
        updateSuccess: "Đã cập nhật booking",
        discardTitle: "Bỏ thay đổi?",
        discardMessage: "Các thay đổi chưa lưu sẽ bị mất.",
        discardConfirm: "Bỏ thay đổi",
        noChanges: "Chưa có thay đổi"
      },
```
`en.booking`:
```ts
      form: {
        addButton: "Add booking",
        addTooltip: "Enter a new booking manually",
        createTitle: "Add booking manually",
        editTitle: "Edit booking {no}",
        editButton: "Edit",
        editTooltip: "Edit this row",
        sections: { main: "Main info", ports: "Ports", equipment: "Container", yards: "Yards & cut-off", source: "Source" },
        datePlaceholder: "DD/MM/YYYY",
        dateTimePlaceholder: "DD/MM/YYYY HH:mm",
        carrierPlaceholder: "Pick or type a carrier",
        requiredHint: "Booking No or Vessel required",
        identityRequired: "Enter at least a Booking No or a Vessel",
        dateInvalid: "Invalid date (DD/MM/YYYY)",
        dateTimeInvalid: "Invalid date/time (DD/MM/YYYY or DD/MM/YYYY HH:mm)",
        qtyInvalid: "Quantity must be a whole number from 1 to 999",
        save: "Save",
        saving: "Saving...",
        cancel: "Cancel",
        shortcut: "Ctrl/⌘ + Enter to save",
        createSuccess: "Booking added",
        updateSuccess: "Booking updated",
        discardTitle: "Discard changes?",
        discardMessage: "Unsaved changes will be lost.",
        discardConfirm: "Discard",
        noChanges: "No changes yet"
      },
```

- [ ] **Step 6: Viết test thất bại cho modal**

`frontend/src/components/booking/BookingFormModal.test.tsx`:
```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const api = vi.hoisted(() => ({ saveManualBookingApi: vi.fn(), updateBookingApi: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => api);
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ t: translations.vi, activeCollection: { id: 7, name: 'A', created_at: '' }, addToast: toast }),
}));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => async () => true }));

import { BookingFormModal } from './BookingFormModal';
const f = translations.vi.booking.form;
const cols = translations.vi.booking.columns;

beforeEach(() => {
  api.saveManualBookingApi.mockReset();
  api.updateBookingApi.mockReset();
  toast.mockReset();
});

describe('BookingFormModal', () => {
  it('creates a booking and reports duplicate warnings', async () => {
    api.saveManualBookingApi.mockResolvedValue({ item: { id: 5, 'Booking No': 'SGN1' }, warnings: ['dup!'] });
    const onSaved = vi.fn();
    render(<BookingFormModal isOpen mode="create" onClose={() => {}} onSaved={onSaved} />);
    const save = screen.getByRole('button', { name: f.save });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(cols['Booking No']), { target: { value: 'SGN1' } });
    fireEvent.change(screen.getByLabelText(cols.ETD), { target: { value: '31/04/2026' } });
    fireEvent.blur(screen.getByLabelText(cols.ETD));
    expect(screen.getByText(f.dateInvalid)).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(cols.ETD), { target: { value: '30/04/2026' } });
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 5, 'Booking No': 'SGN1' }, 'create'));
    expect(api.saveManualBookingApi.mock.calls[0][0]).toBe(7);
    expect(api.saveManualBookingApi.mock.calls[0][1]).toMatchObject({ 'Booking No': 'SGN1', ETD: '30/04/2026' });
    expect(toast).toHaveBeenCalledWith('dup!', 'info');
  });

  it('edits only changed fields', async () => {
    api.updateBookingApi.mockResolvedValue({ item: { id: 9, 'Booking No': 'A1', Vessel: 'NEW' }, warnings: [] });
    const onSaved = vi.fn();
    render(<BookingFormModal isOpen mode="edit" booking={{ id: 9, 'Booking No': 'A1', Vessel: 'OLD' } as any} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(cols.Vessel), { target: { value: 'NEW' } });
    fireEvent.keyDown(screen.getByLabelText(cols.Vessel), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(api.updateBookingApi).toHaveBeenCalledWith(9, { Vessel: 'NEW' }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ Vessel: 'NEW' }), 'edit');
  });

  it('shows the server error message', async () => {
    api.saveManualBookingApi.mockRejectedValue({ response: { status: 400, data: { detail: 'ETD: ngày không hợp lệ' } } });
    render(<BookingFormModal isOpen mode="create" onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(cols['Booking No']), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: f.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ETD: ngày không hợp lệ');
  });
});
```

Run: `cd frontend && npm test -- BookingFormModal`
Expected: FAIL — không resolve `./BookingFormModal`

- [ ] **Step 7: Cài đặt `BookingFormModal.tsx`**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Save } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { saveManualBookingApi, updateBookingApi } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import type { Booking } from '../../types';
import { CARRIERS } from './carriers';
import {
  BOOKING_FORM_SECTIONS, BookingFieldKey, BookingFormValues, bookingToForm, diffBookingForm, validateBookingForm,
} from './bookingForm';

export interface BookingFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  booking?: Booking | null;
  onClose: () => void;
  onSaved: (item: Booking, mode: 'create' | 'edit') => void;
}

const inputClass = (invalid: boolean) =>
  `w-full px-2.5 py-1.5 text-xs font-medium rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 ${
    invalid ? 'border-rose-400 focus:ring-rose-400' : 'border-slate-200 dark:border-slate-700 focus:ring-primary-500'
  }`;

export const BookingFormModal: React.FC<BookingFormModalProps> = ({ isOpen, mode, booking, onClose, onSaved }) => {
  const { t, activeCollection, addToast } = useApp();
  const confirm = useConfirm();
  const f = t.booking.form;
  const initial = useMemo(() => bookingToForm(mode === 'edit' ? booking ?? null : null), [mode, booking]);
  const [values, setValues] = useState<BookingFormValues>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setValues(initial);
    setTouched(new Set());
    setSubmitted(false);
    setServerError('');
  }, [isOpen, initial]);

  const errors = validateBookingForm(values);
  const changes = diffBookingForm(initial, values);
  const dirty = Object.keys(changes).length > 0;
  const hasErrors = Object.keys(errors).length > 0;
  const canSave = !saving && !hasErrors && dirty;

  const fieldError = (key: BookingFieldKey) => {
    const code = errors[key];
    return code && (touched.has(key) || submitted) ? (f as Record<string, any>)[code] as string : '';
  };

  const requestClose = async () => {
    if (saving) return;
    if (dirty && !(await confirm({ title: f.discardTitle, message: f.discardMessage, confirmText: f.discardConfirm, danger: true }))) return;
    onClose();
  };

  const submit = async () => {
    setSubmitted(true);
    if (hasErrors || !dirty || saving) return;
    setSaving(true);
    setServerError('');
    try {
      const res = mode === 'edit' && booking
        ? await updateBookingApi(booking.id, changes as Partial<Booking>)
        : await saveManualBookingApi(activeCollection!.id, diffBookingForm(bookingToForm(null), values) as Partial<Booking>);
      res.warnings.forEach((w) => addToast(w, 'info'));
      addToast(mode === 'edit' ? f.updateSuccess : f.createSuccess, 'success');
      onSaved(res.item, mode);
      onClose();
    } catch (e: any) {
      setServerError(e?.response?.data?.detail || e?.message || t.common.error);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const title = mode === 'edit' ? tf(f.editTitle, { no: booking?.['Booking No'] || `#${booking?.id ?? ''}` }) : f.createTitle;

  return (
    <Modal isOpen={isOpen} onClose={requestClose} title={title} maxWidth="max-w-3xl">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} onKeyDown={onKeyDown} className="space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{serverError}</span>
          </div>
        )}
        {BOOKING_FORM_SECTIONS.map((section) => (
          <fieldset key={section.titleKey} className="space-y-2">
            <legend className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">{f.sections[section.titleKey]}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
              {section.fields.map((field) => {
                const id = `booking-form-${field.key.replace(/[^a-z0-9]/gi, '-')}`;
                const label = t.booking.columns[field.key] || field.key;
                const err = fieldError(field.key);
                const identityErr = field.required && errors._identity && (submitted || touched.has(field.key));
                return (
                  <div key={field.key}>
                    <div className="flex items-center gap-1 mb-1">
                      <label htmlFor={id} className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</label>
                      {field.required && <span id={`${id}-hint`} className="text-[11px] text-slate-400">({f.requiredHint})</span>}
                    </div>
                    <input
                      id={id}
                      value={values[field.key]}
                      list={field.kind === 'carrier' ? 'booking-form-carriers' : undefined}
                      inputMode={field.kind === 'number' ? 'numeric' : undefined}
                      placeholder={field.kind === 'date' ? f.datePlaceholder : field.kind === 'datetime' ? f.dateTimePlaceholder : field.kind === 'carrier' ? f.carrierPlaceholder : undefined}
                      aria-invalid={!!err || !!identityErr}
                      aria-describedby={field.required ? `${id}-hint` : undefined}
                      onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      onBlur={() => setTouched((prev) => new Set(prev).add(field.key))}
                      className={inputClass(!!err || !!identityErr)}
                      autoFocus={field.key === 'Booking No'}
                    />
                    {err && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{err}</p>}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
        <datalist id="booking-form-carriers">
          {CARRIERS.map((c) => <option key={c.key} value={c.key} />)}
        </datalist>
        {errors._identity && submitted && <p className="text-[11px] text-rose-600 dark:text-rose-400">{f.identityRequired}</p>}

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <span className="text-[11px] text-slate-400">{dirty ? f.shortcut : f.noChanges}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={requestClose} className="px-3.5 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              {f.cancel}
            </button>
            <button type="submit" disabled={!canSave} className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? f.saving : f.save}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
```
Lưu ý:
- Nút Lưu có nội dung là icon + chữ; test tìm theo `name: f.save` vẫn khớp vì icon SVG không có tên.
- Kiểm tra `t.booking.columns` có đủ 14 key trong `BOOKING_FORM_SECTIONS` (dùng đúng các key của `defaultColumns` ở `BookingTab`).

- [ ] **Step 8: Chạy test + build**

Run: `cd frontend && npm test -- booking && npm run build`
Expected: PASS; build thành công

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/booking/bookingForm.ts frontend/src/components/booking/bookingForm.test.ts frontend/src/components/booking/BookingFormModal.tsx frontend/src/components/booking/BookingFormModal.test.tsx frontend/src/components/booking/ImageBookingModal.tsx frontend/src/services/api.ts frontend/src/i18n/translations.ts
git commit -m "feat(booking-ui): shared create/edit booking form with validation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

