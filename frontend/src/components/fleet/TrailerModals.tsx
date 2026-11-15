import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { Modal } from '../common/Modal';
import { tf } from '../../services/i18nFormat';
import {
  createFleetTrailerApi, deleteFleetTrailerPhotoApi, hitchFleetTrailerApi, updateFleetTrailerApi, uploadFleetTrailerPhotoApi,
} from '../../services/api';
import { PhotoPicker, type PhotoChoice } from './FleetPhoto';
import { Field, Footer, INPUT, NO_PHOTO_CHANGE, savePhoto } from './FleetModals';
import { VEHICLE_STATUSES, type FleetTrailer, type FleetVehicle, type TrailerStatus } from '../../types';
import { apiError } from './fleetUtils';

/** Tractors a trailer can go on: not out of service, with the trailer each one pulls now. */
const tractorLabel = (v: FleetVehicle, pulling: string, status: string) => {
  const extra = [v.trailer_plate ? tf(pulling, { plate: v.trailer_plate }) : '', v.status !== 'active' ? status : '']
    .filter(Boolean).join(' · ');
  return extra ? `${v.plate} (${extra})` : v.plate;
};

// ---------------------------------------------------------------------------
// Trailer: add / edit
// ---------------------------------------------------------------------------
interface TrailerFormProps {
  isOpen: boolean;
  trailer: FleetTrailer | null;
  vehicles: FleetVehicle[];
  onClose: () => void;
  onSaved: () => void;
}

export const TrailerFormModal: React.FC<TrailerFormProps> = ({ isOpen, trailer, vehicles, onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const f = t.fleet.trailer.form;
  const empty = {
    plate: '', trailer_type: '', chassis_no: '', payload: '', year: '', registration_expiry: '', insurance_expiry: '',
    status: 'active' as TrailerStatus, note: '',
  };
  const [form, setForm] = useState(empty);
  const [vehicleId, setVehicleId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<PhotoChoice>(NO_PHOTO_CHANGE);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setPhoto(NO_PHOTO_CHANGE);
    setVehicleId('');
    setForm(trailer ? {
      plate: trailer.plate, trailer_type: trailer.trailer_type, chassis_no: trailer.chassis_no, payload: trailer.payload,
      year: trailer.year, registration_expiry: trailer.registration_expiry, insurance_expiry: trailer.insurance_expiry,
      status: trailer.status, note: trailer.note,
    } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, trailer]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.plate.trim()) {
      setError(f.plateRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const id = trailer ? (await updateFleetTrailerApi(trailer.id, form)).id
        : (await createFleetTrailerApi({ ...form, vehicle_id: vehicleId ? Number(vehicleId) : null })).id;
      const photoError = await savePhoto(photo, id, uploadFleetTrailerPhotoApi, deleteFleetTrailerPhotoApi, t.fleet.toast.error,
        t.fleet.photo.outdatedBackend);
      if (photoError !== null) addToast(tf(t.fleet.photo.uploadFailed, { error: photoError }), 'error');
      else addToast(t.fleet.toast.saved, 'success');
      onSaved();
      onClose();
    } catch (err) {
      setError(apiError(err, t.fleet.toast.error));
    } finally {
      setSaving(false);
    }
  };

  const tractors = vehicles.filter((v) => v.status !== 'inactive');
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={trailer ? tf(f.editTitle, { plate: trailer.plate }) : f.addTitle} maxWidth="max-w-lg">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <PhotoPicker kind="trailer" name={form.plate} current={trailer?.photo || ''} value={photo} onChange={setPhoto} onError={setError} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.plate} required>
            <input autoFocus className={INPUT} value={form.plate} onChange={set('plate')} placeholder={f.platePh} />
          </Field>
          <Field label={f.type}>
            <input className={INPUT} value={form.trailer_type} onChange={set('trailer_type')} placeholder={f.typePh} />
          </Field>
          <Field label={f.chassis}>
            <input className={INPUT} value={form.chassis_no} onChange={set('chassis_no')} />
          </Field>
          <Field label={f.payload}>
            <input className={INPUT} value={form.payload} onChange={set('payload')} placeholder={f.payloadPh} />
          </Field>
          <Field label={f.year}>
            <input className={INPUT} value={form.year} onChange={set('year')} placeholder={f.yearPh} inputMode="numeric" maxLength={4} />
          </Field>
          <Field label={f.status}>
            <select className={INPUT} value={form.status} onChange={set('status')}>
              {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{t.fleet.trailer.status[s]}</option>)}
            </select>
          </Field>
          <Field label={f.registration}>
            <input type="date" className={INPUT} value={form.registration_expiry} onChange={set('registration_expiry')} />
          </Field>
          <Field label={f.insurance}>
            <input type="date" className={INPUT} value={form.insurance_expiry} onChange={set('insurance_expiry')} />
          </Field>
          {!trailer && (
            <Field label={f.vehicle} className="col-span-2">
              <select className={INPUT} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={form.status === 'inactive'}>
                <option value="">{f.noVehicle}</option>
                {tractors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {tractorLabel(v, t.fleet.trailer.hitchModal.pulling, t.fleet.vehicleStatus[v.status].toLowerCase())}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {trailer && <p className="text-[11px] text-slate-500 dark:text-slate-400">{f.statusHint}</p>}
        <Field label={f.note}>
          <textarea className={`${INPUT} h-16 py-1.5`} value={form.note} onChange={set('note')} />
        </Field>
        {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        <Footer onCancel={onClose} saving={saving} />
      </form>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Trailer: hitch to / change tractor
// ---------------------------------------------------------------------------
interface HitchProps {
  trailer: FleetTrailer | null;
  vehicles: FleetVehicle[];
  onClose: () => void;
  onSaved: () => void;
}

export const TrailerHitchModal: React.FC<HitchProps> = ({ trailer, vehicles, onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const h = t.fleet.trailer.hitchModal;
  const T = t.fleet.trailer.toast;
  const [vehicleId, setVehicleId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!trailer) return;
    setVehicleId('');
    setReason('');
    setError('');
  }, [trailer]);

  if (!trailer) return null;
  const tractors = vehicles.filter((v) => v.status !== 'inactive' && v.id !== trailer.vehicle?.id);
  const picked = tractors.find((v) => String(v.id) === vehicleId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) {
      setError(h.pickRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await hitchFleetTrailerApi(trailer.id, picked.id, reason.trim());
      addToast(tf(T.hitched, { plate: trailer.plate, vehicle: picked.plate }), 'success');
      if (res.replaced) addToast(tf(T.replaced, { plate: res.replaced, vehicle: picked.plate }), 'info');
      onSaved();
      onClose();
    } catch (err) {
      setError(apiError(err, t.fleet.toast.error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={tf(h.title, { plate: trailer.plate })} maxWidth="max-w-md">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {trailer.vehicle ? tf(h.current, { plate: trailer.vehicle.plate }) : h.currentNone}
        </p>
        <Field label={h.vehicle} required>
          <select autoFocus className={INPUT} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">{h.pick}</option>
            {tractors.map((v) => (
              <option key={v.id} value={v.id}>{tractorLabel(v, h.pulling, t.fleet.vehicleStatus[v.status].toLowerCase())}</option>
            ))}
          </select>
        </Field>
        {picked?.trailer_plate && (
          <p role="status" className="text-xs font-medium text-amber-700 dark:text-amber-300">{tf(h.replaceWarn, { plate: picked.trailer_plate })}</p>
        )}
        <Field label={h.reason}>
          <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={h.reasonPh} />
        </Field>
        {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        <Footer onCancel={onClose} saving={saving} />
      </form>
    </Modal>
  );
};
