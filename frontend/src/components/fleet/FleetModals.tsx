import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { Modal } from '../common/Modal';
import { tf } from '../../services/i18nFormat';
import {
  createFleetDriverApi, createFleetVehicleApi, deleteFleetDriverPhotoApi, deleteFleetVehiclePhotoApi, getFleetTrailersApi,
  moveDriverTemporaryApi,
  setDriverHomeVehicleApi, setFleetVehicleStatusApi, unassignDriverApi, updateFleetDriverApi, updateFleetVehicleApi,
  uploadFleetDriverPhotoApi, uploadFleetVehiclePhotoApi,
} from '../../services/api';
import { PhotoPicker, type PhotoChoice } from './FleetPhoto';
import {
  DRIVER_STATUSES, VEHICLE_STATUSES, type DriverStatus, type FleetDriver, type FleetVehicle, type VehicleStatus,
} from '../../types';
import { apiError, freeVehicles, isConflict } from './fleetUtils';

export const INPUT = 'w-full h-9 px-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 '
  + 'text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-60';
const LABEL = 'block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1';

export const Field: React.FC<{ label: string; children: React.ReactNode; className?: string; required?: boolean }> = ({
  label, children, className = '', required,
}) => (
  <label className={`block ${className}`}>
    <span className={LABEL}>{label}{required && <span className="text-rose-500"> *</span>}</span>
    {children}
  </label>
);

export const Footer: React.FC<{ onCancel: () => void; saving: boolean; disabled?: boolean; children?: React.ReactNode }> = ({
  onCancel, saving, disabled, children,
}) => {
  const { t } = useApp();
  return (
    <div className="flex items-center justify-end gap-2 pt-4 mt-1 border-t border-slate-100 dark:border-slate-800">
      {children}
      <button type="button" onClick={onCancel}
        className="h-9 px-4 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
        {t.common.cancel}
      </button>
      <button type="submit" disabled={saving || disabled}
        className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50">
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {t.common.save}
      </button>
    </div>
  );
};

export const NO_PHOTO_CHANGE: PhotoChoice = { file: null, remove: false };

/** Apply the form's photo choice once the record exists. Returns null when fine, else what went wrong.
 *  A backend older than the photo feature answers FastAPI's bare 404 "Not Found" (no such route): say to restart. */
export async function savePhoto(
  choice: PhotoChoice, id: number, upload: (id: number, f: File) => Promise<unknown>, remove: (id: number) => Promise<unknown>,
  fallback: string, outdated: string,
): Promise<string | null> {
  try {
    if (choice.file) await upload(id, choice.file);
    else if (choice.remove) await remove(id);
    return null;
  } catch (err: any) {
    const res = err?.response;
    if ((res?.status === 404 && res?.data?.detail === 'Not Found') || res?.status === 405) return outdated;
    return apiError(err, fallback);
  }
}

const vehicleOptionLabel = (v: FleetVehicle, t: ReturnType<typeof useApp>['t']) => {
  const extra = [v.trailer_plate, v.home_driver ? tf(t.fleet.statusModal.homeOf, { name: v.home_driver.name }) : '']
    .filter(Boolean).join(' · ');
  return extra ? `${v.plate} (${extra})` : v.plate;
};

// ---------------------------------------------------------------------------
// Truck: add / edit
// ---------------------------------------------------------------------------
interface VehicleFormProps {
  isOpen: boolean;
  vehicle: FleetVehicle | null;
  onClose: () => void;
  onSaved: () => void;
}

export const VehicleFormModal: React.FC<VehicleFormProps> = ({ isOpen, vehicle, onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const f = t.fleet.vehicleForm;
  const [form, setForm] = useState({
    plate: '', trailer_plate: '', vehicle_type: '', registration_expiry: '', insurance_expiry: '', status: 'active' as VehicleStatus, note: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<PhotoChoice>(NO_PHOTO_CHANGE);
  // trailers free to pick (or this tractor's own), offered as the trailer plate's suggestions
  const [freeTrailers, setFreeTrailers] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    getFleetTrailersApi()
      .then((list) => live && setFreeTrailers(list
        .filter((r) => r.status !== 'inactive' && (!r.vehicle || r.vehicle.id === vehicle?.id)).map((r) => r.plate)))
      .catch(() => live && setFreeTrailers([]));
    return () => {
      live = false;
    };
  }, [isOpen, vehicle]);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setPhoto(NO_PHOTO_CHANGE);
    setForm({
      plate: vehicle?.plate || '', trailer_plate: vehicle?.trailer_plate || '', vehicle_type: vehicle?.vehicle_type || '',
      registration_expiry: vehicle?.registration_expiry || '', insurance_expiry: vehicle?.insurance_expiry || '',
      status: vehicle?.status || 'active', note: vehicle?.note || '',
    });
  }, [isOpen, vehicle]);

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
      let id: number;
      if (vehicle) {
        const { status: _ignored, ...rest } = form;
        id = (await updateFleetVehicleApi(vehicle.id, rest)).id;
      } else {
        id = (await createFleetVehicleApi(form)).id;
      }
      const photoError = await savePhoto(photo, id, uploadFleetVehiclePhotoApi, deleteFleetVehiclePhotoApi, t.fleet.toast.error, t.fleet.photo.outdatedBackend);
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={vehicle ? tf(f.editTitle, { plate: vehicle.plate }) : f.addTitle} maxWidth="max-w-lg">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <PhotoPicker kind="vehicle" name={form.plate} current={vehicle?.photo || ''} value={photo} onChange={setPhoto} onError={setError} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.plate} required>
            <input autoFocus className={INPUT} value={form.plate} onChange={set('plate')} placeholder={f.platePh} />
          </Field>
          <Field label={f.trailer}>
            <input className={INPUT} value={form.trailer_plate} onChange={set('trailer_plate')} placeholder={f.trailerPh}
              list="fleet-free-trailers" title={t.fleet.trailer.formHint} />
            <datalist id="fleet-free-trailers">
              {freeTrailers.map((plate) => <option key={plate} value={plate} />)}
            </datalist>
          </Field>
          <Field label={f.type}>
            <input className={INPUT} value={form.vehicle_type} onChange={set('vehicle_type')} placeholder={f.typePh} />
          </Field>
          <Field label={f.status}>
            <select className={INPUT} value={form.status} onChange={set('status')} disabled={!!vehicle}>
              {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{t.fleet.vehicleStatus[s]}</option>)}
            </select>
          </Field>
          <Field label={f.registration}>
            <input type="date" className={INPUT} value={form.registration_expiry} onChange={set('registration_expiry')} />
          </Field>
          <Field label={f.insurance}>
            <input type="date" className={INPUT} value={form.insurance_expiry} onChange={set('insurance_expiry')} />
          </Field>
        </div>
        {vehicle && <p className="text-[11px] text-slate-500 dark:text-slate-400">{f.statusHint}</p>}
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
// Driver: add / edit
// ---------------------------------------------------------------------------
interface DriverFormProps {
  isOpen: boolean;
  driver: FleetDriver | null;
  vehicles: FleetVehicle[];
  onClose: () => void;
  onSaved: () => void;
}

export const DriverFormModal: React.FC<DriverFormProps> = ({ isOpen, driver, vehicles, onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const f = t.fleet.driverForm;
  const empty = { name: '', phone: '', id_number: '', license_no: '', license_class: '', license_expiry: '', status: 'active' as DriverStatus, note: '' };
  const [form, setForm] = useState(empty);
  const [homeId, setHomeId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<PhotoChoice>(NO_PHOTO_CHANGE);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setHomeId('');
    setPhoto(NO_PHOTO_CHANGE);
    setForm(driver ? {
      name: driver.name, phone: driver.phone, id_number: driver.id_number, license_no: driver.license_no,
      license_class: driver.license_class, license_expiry: driver.license_expiry, status: driver.status, note: driver.note,
    } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, driver]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  // a new driver can be given a truck nobody has as their own truck yet
  const unassigned = useMemo(() => vehicles.filter((v) => !v.home_driver && v.status !== 'inactive'), [vehicles]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(f.nameRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const id = driver
        ? (await updateFleetDriverApi(driver.id, form)).id
        : (await createFleetDriverApi({ ...form, home_vehicle_id: homeId ? Number(homeId) : null })).id;
      const photoError = await savePhoto(photo, id, uploadFleetDriverPhotoApi, deleteFleetDriverPhotoApi, t.fleet.toast.error, t.fleet.photo.outdatedBackend);
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={driver ? tf(f.editTitle, { name: driver.name }) : f.addTitle} maxWidth="max-w-lg">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <PhotoPicker kind="driver" name={form.name} current={driver?.photo || ''} value={photo} onChange={setPhoto} onError={setError} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.name} required className="col-span-2">
            <input autoFocus className={INPUT} value={form.name} onChange={set('name')} />
          </Field>
          <Field label={f.phone}>
            <input className={INPUT} value={form.phone} onChange={set('phone')} inputMode="tel" />
          </Field>
          <Field label={f.idNumber}>
            <input className={INPUT} value={form.id_number} onChange={set('id_number')} />
          </Field>
          <Field label={f.licenseNo}>
            <input className={INPUT} value={form.license_no} onChange={set('license_no')} />
          </Field>
          <Field label={f.licenseClass}>
            <input className={INPUT} value={form.license_class} onChange={set('license_class')} placeholder={f.licenseClassPh} />
          </Field>
          <Field label={f.licenseExpiry}>
            <input type="date" className={INPUT} value={form.license_expiry} onChange={set('license_expiry')} />
          </Field>
          <Field label={f.status}>
            <select className={INPUT} value={form.status} onChange={set('status')}>
              {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{t.fleet.driverStatus[s]}</option>)}
            </select>
          </Field>
          {!driver && (
            <Field label={f.homeVehicle} className="col-span-2">
              <select className={INPUT} value={homeId} onChange={(e) => setHomeId(e.target.value)}>
                <option value="">{f.noHome}</option>
                {unassigned.map((v) => <option key={v.id} value={v.id}>{vehicleOptionLabel(v, t)}</option>)}
              </select>
            </Field>
          )}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{f.statusHint}</p>
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
// Truck status: report a breakdown and move its driver in the same step
// ---------------------------------------------------------------------------
interface StatusProps {
  vehicle: FleetVehicle | null;
  vehicles: FleetVehicle[];
  onClose: () => void;
  onSaved: () => void;
}

export const VehicleStatusModal: React.FC<StatusProps> = ({ vehicle, vehicles, onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const m = t.fleet.statusModal;
  const [status, setStatus] = useState<VehicleStatus>('broken');
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState<'move' | 'idle'>('move');
  const [spareId, setSpareId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!vehicle) return;
    setStatus(vehicle.status === 'active' ? 'broken' : 'active');
    setReason('');
    setSpareId('');
    setError('');
    setPlan('move');
  }, [vehicle]);

  const spares = useMemo(() => freeVehicles(vehicles, vehicle?.id), [vehicles, vehicle]);
  if (!vehicle) return null;
  const driver = vehicle.current_driver;
  const stops = status !== 'active';
  const asksForDriver = stops && !!driver;
  const moving = asksForDriver && plan === 'move' && spares.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (moving && !spareId) {
      setError(m.pickRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await setFleetVehicleStatusApi(vehicle.id, status, reason, moving ? Number(spareId) : null);
      if (res.moved_driver) {
        addToast(res.moved_driver.to_plate
          ? tf(t.fleet.toast.moved, { name: res.moved_driver.name, plate: res.moved_driver.to_plate })
          : tf(t.fleet.toast.idle, { name: res.moved_driver.name }), 'success');
      } else {
        addToast(t.fleet.toast.saved, 'success');
      }
      if (res.home_driver_away) {
        addToast(tf(t.fleet.toast.homeAway, { name: res.home_driver_away.name, plate: res.home_driver_away.plate }), 'info');
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(apiError(err, t.fleet.toast.error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={tf(m.title, { plate: vehicle.plate })} maxWidth="max-w-lg">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label={m.status}>
          <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value as VehicleStatus)}>
            {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{t.fleet.vehicleStatus[s]}</option>)}
          </select>
        </Field>
        <Field label={m.reason}>
          <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={m.reasonPh} />
        </Field>

        {asksForDriver && (
          <fieldset className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2">
            <legend className="px-1 text-xs font-bold text-amber-800 dark:text-amber-300">{tf(m.driverQuestion, { name: driver!.name })}</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="radio" name="plan" checked={plan === 'move'} onChange={() => setPlan('move')} disabled={spares.length === 0} />
              {m.moveTo}
            </label>
            {plan === 'move' && (spares.length > 0 ? (
              <select aria-label={m.moveTo} className={`${INPUT} ml-6 w-[calc(100%-1.5rem)]`} value={spareId} onChange={(e) => setSpareId(e.target.value)}>
                <option value="">{m.pickSpare}</option>
                {spares.map((v) => <option key={v.id} value={v.id}>{vehicleOptionLabel(v, t)}</option>)}
              </select>
            ) : (
              <p className="ml-6 text-xs text-slate-500">{m.noSpare}</p>
            ))}
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="radio" name="plan" checked={plan === 'idle' || spares.length === 0} onChange={() => setPlan('idle')} />
              {m.idle}
            </label>
          </fieldset>
        )}
        {stops && <p className="text-[11px] text-slate-500 dark:text-slate-400">{m.backHint}</p>}
        {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        <Footer onCancel={onClose} saving={saving} disabled={status === vehicle.status} />
      </form>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Driver: take another truck for now, or change their own truck
// ---------------------------------------------------------------------------
interface MoveProps {
  driver: FleetDriver | null;
  vehicles: FleetVehicle[];
  onClose: () => void;
  onSaved: () => void;
}

export const DriverMoveModal: React.FC<MoveProps> = ({ driver, vehicles, onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const m = t.fleet.moveModal;
  const [mode, setMode] = useState<'temporary' | 'permanent'>('temporary');
  const [vehicleId, setVehicleId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!driver) return;
    setMode(driver.home_vehicle && driver.status === 'active' ? 'temporary' : 'permanent');
    setVehicleId(driver.home_vehicle && driver.status !== 'active' ? String(driver.home_vehicle.id) : '');
    setReason('');
    setError('');
  }, [driver]);

  const temporaryChoices = useMemo(
    () => freeVehicles(vehicles, driver?.home_vehicle?.id ?? null).filter((v) => v.id !== driver?.current_vehicle?.id),
    [vehicles, driver],
  );
  const permanentChoices = useMemo(() => vehicles.filter((v) => v.status !== 'inactive'), [vehicles]);
  if (!driver) return null;

  const choices = mode === 'temporary' ? temporaryChoices : permanentChoices;

  const done = () => {
    onSaved();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'temporary' && !vehicleId) {
      setError(m.pickRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (mode === 'temporary') {
        const res = await moveDriverTemporaryApi(driver.id, Number(vehicleId), reason);
        addToast(tf(t.fleet.toast.moved, { name: res.name, plate: res.current_vehicle?.plate || '' }), 'success');
      } else {
        const target = vehicleId ? Number(vehicleId) : null;
        try {
          await setDriverHomeVehicleApi(driver.id, target);
        } catch (err) {
          if (!isConflict(err)) throw err;
          const ok = await confirm({
            title: m.forceTitle,
            message: tf(m.forceMessage, { message: apiError(err, ''), name: driver.name }),
            confirmText: m.forceConfirm,
            danger: true,
          });
          if (!ok) return;
          await setDriverHomeVehicleApi(driver.id, target, true);
        }
        addToast(t.fleet.toast.saved, 'success');
      }
      done();
    } catch (err) {
      setError(apiError(err, t.fleet.toast.error));
    } finally {
      setSaving(false);
    }
  };

  const getOff = async () => {
    setSaving(true);
    try {
      await unassignDriverApi(driver.id, reason);
      addToast(tf(t.fleet.toast.idle, { name: driver.name }), 'success');
      done();
    } catch (err) {
      setError(apiError(err, t.fleet.toast.error));
    } finally {
      setSaving(false);
    }
  };

  const radio = (value: 'temporary' | 'permanent', label: string, hint: string, disabled = false) => (
    <label className={`flex-1 flex gap-2 p-2.5 rounded-lg border cursor-pointer ${mode === value
      ? 'border-primary-400 bg-primary-50/60 dark:bg-primary-950/30 dark:border-primary-700'
      : 'border-slate-200 dark:border-slate-700'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input type="radio" name="mode" checked={mode === value} disabled={disabled}
        onChange={() => {
          setMode(value);
          setVehicleId(value === 'permanent' && driver.home_vehicle ? String(driver.home_vehicle.id) : '');
          setError('');
        }} />
      <span>
        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
        <span className="block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>
      </span>
    </label>
  );

  return (
    <Modal isOpen onClose={onClose} title={tf(m.title, { name: driver.name })} maxWidth="max-w-lg">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          <span>{driver.current_vehicle ? tf(m.current, { plate: driver.current_vehicle.plate }) : m.currentNone}</span>
          <span>{driver.home_vehicle ? tf(m.home, { plate: driver.home_vehicle.plate }) : m.homeNone}</span>
        </div>
        <div className="flex gap-2">
          {radio('temporary', m.temporary, m.temporaryHint, driver.status !== 'active')}
          {radio('permanent', m.permanent, m.permanentHint)}
        </div>
        <Field label={t.fleet.cols.vehicle}>
          <select aria-label={t.fleet.cols.vehicle} className={INPUT} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">{mode === 'temporary' ? m.pick : m.noHome}</option>
            {choices.map((v) => (
              <option key={v.id} value={v.id}>
                {vehicleOptionLabel(v, t)}{v.status !== 'active' ? ` — ${t.fleet.vehicleStatus[v.status]}` : ''}
              </option>
            ))}
          </select>
          {mode === 'temporary' && temporaryChoices.length === 0 && (
            <p className="mt-1 text-[11px] text-slate-500">{t.fleet.statusModal.noSpare}</p>
          )}
        </Field>
        {mode === 'temporary' && (
          <Field label={m.reason}>
            <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={m.reasonPh} />
          </Field>
        )}
        {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        <Footer onCancel={onClose} saving={saving}>
          {driver.current_vehicle && (
            <button type="button" onClick={getOff} disabled={saving}
              className="mr-auto h-9 px-3 text-sm font-semibold rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50">
              {m.unassign}
            </button>
          )}
        </Footer>
      </form>
    </Modal>
  );
};
