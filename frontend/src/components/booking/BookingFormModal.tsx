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
  BOOKING_FORM_SECTIONS, BookingFieldKey, BookingFormValues, NOTE_MAX_LENGTH, bookingToForm, diffBookingForm, validateBookingForm,
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
                if (field.kind === 'textarea') {
                  const len = values[field.key].trim().length;
                  return (
                    <div key={field.key} className="sm:col-span-2">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <label htmlFor={id} className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</label>
                        <span className={`text-[10px] tabular-nums ${len > NOTE_MAX_LENGTH ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>
                          {len}/{NOTE_MAX_LENGTH}
                        </span>
                      </div>
                      <textarea
                        id={id}
                        rows={3}
                        value={values[field.key]}
                        placeholder={f.notePlaceholder}
                        aria-invalid={!!err}
                        onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        onBlur={() => setTouched((prev) => new Set(prev).add(field.key))}
                        className={`${inputClass(!!err)} resize-y min-h-[64px] leading-relaxed`}
                      />
                      {err && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{err}</p>}
                    </div>
                  );
                }
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
