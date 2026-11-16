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
  uploadFleetDriverPhotoApi, uploadFleetVehiclePhotoApi, uploadFleetDriverDocumentApi, deleteFleetDriverDocumentApi,
  uploadFleetVehicleDocumentApi, deleteFleetVehicleDocumentApi,
} from '../../services/api';
import { DriverSection, FieldInputBox, NO_PAPER_CHANGES, PaperPicker, PaperRow, type PaperChoices } from './DriverPapers';
import { PhotoPicker, type PhotoChoice } from './FleetPhoto';
import { FormBox } from './FieldPick';
import { FieldCopyBar } from '../common/FieldCopyBar';
import { useFieldSelection } from '../../hooks/useFieldSelection';
import type { CopyEntry } from '../../utils/fieldCopy';
import {
  DRIVER_DOCUMENTS, DRIVER_STATUSES, VEHICLE_DOCUMENTS, VEHICLE_STATUSES, type DriverStatus, type FleetDriver, type FleetVehicle,
  type VehicleCategory, type VehicleDocument, type VehicleStatus,
} from '../../types';
import {
  DRIVER_LOCK_FREE_STATUSES, LOCK_FREE_STATUSES, apiError, expiredPapers, formatIsoDate, freeVehicles, isConflict, isRunning, licenseExpired,
  type PaperExpiry,
} from './fleetUtils';

/** Why the status is locked: the expired papers, and that only "Không sẵn sàng" / "Ngưng hoạt động" are left. */
export const LockHint: React.FC<{ papers: PaperExpiry[] }> = ({ papers }) => {
  const { t } = useApp();
  const L = t.fleet.lock;
  return (
    <p role="note" data-testid="paper-lock-hint" className="mt-1 text-[11px] font-medium text-orange-700 dark:text-orange-300">
      {tf(L.hint, { papers: papers.map((p) => L.papers[p]).join(', ') })}
    </p>
  );
};

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
  // a truck (xe tải) says so, since tractors and trucks share these pickers
  const extra = [v.category === 'truck' ? t.fleet.truckChip : v.trailer_plate,
    v.home_driver ? tf(t.fleet.statusModal.homeOf, { name: v.home_driver.name }) : '']
    .filter(Boolean).join(' · ');
  return extra ? `${v.plate} (${extra})` : v.plate;
};

// ---------------------------------------------------------------------------
// Truck: add / edit
// ---------------------------------------------------------------------------
type VehiclePaperChoices = Record<VehicleDocument, PhotoChoice>;
const NO_VEHICLE_PAPERS = Object.fromEntries(VEHICLE_DOCUMENTS.map((d) => [d, NO_PHOTO_CHANGE])) as VehiclePaperChoices;

interface VehicleFormProps {
  isOpen: boolean;
  vehicle: FleetVehicle | null;
  /** what a new one is (an edited one keeps its own): a tractor gets a trailer, a truck its body and payload */
  category?: VehicleCategory;
  onClose: () => void;
  onSaved: () => void;
}

export const VehicleFormModal: React.FC<VehicleFormProps> = ({ isOpen, vehicle, category = 'tractor', onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const isTruck = (vehicle?.category || category) === 'truck';
  const f = isTruck ? { ...t.fleet.vehicleForm, ...t.fleet.truckForm } : t.fleet.vehicleForm;
  const [form, setForm] = useState({
    plate: '', trailer_plate: '', vehicle_type: '', body_type: '', payload: '', ownership_expiry: '', registration_expiry: '',
    insurance_expiry: '', status: 'active' as VehicleStatus, note: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<PhotoChoice>(NO_PHOTO_CHANGE);
  const [papers, setPapers] = useState<VehiclePaperChoices>(NO_VEHICLE_PAPERS);
  const D = t.fleet.detail;
  const picked = useFieldSelection(isOpen ? vehicle?.id ?? 'new' : null);
  // trailers free to pick (or this tractor's own), offered as the trailer plate's suggestions
  const [freeTrailers, setFreeTrailers] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen || isTruck) return;
    let live = true;
    getFleetTrailersApi()
      .then((list) => live && setFreeTrailers(list
        .filter((r) => r.status !== 'inactive' && r.status !== 'not_ready' && (!r.vehicle || r.vehicle.id === vehicle?.id))
        .map((r) => r.plate)))
      .catch(() => live && setFreeTrailers([]));
    return () => {
      live = false;
    };
  }, [isOpen, vehicle, isTruck]);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setPhoto(NO_PHOTO_CHANGE);
    setPapers(NO_VEHICLE_PAPERS);
    setForm({
      plate: vehicle?.plate || '', trailer_plate: vehicle?.trailer_plate || '', vehicle_type: vehicle?.vehicle_type || '',
      body_type: vehicle?.body_type || '', payload: vehicle?.payload || '', ownership_expiry: vehicle?.ownership_expiry || '',
      registration_expiry: vehicle?.registration_expiry || '', insurance_expiry: vehicle?.insurance_expiry || '',
      status: vehicle?.status || 'active', note: vehicle?.note || '',
    });
  }, [isOpen, vehicle]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  // expired papers in the form: it is saved as not_ready (the server forces it too)
  const formExpired = expiredPapers(form);
  const formLocked = formExpired.length > 0;

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
      // a tractor has no body / payload, a truck no trailer
      const { body_type, payload, trailer_plate, ...common } = form;
      const data = isTruck ? { ...common, body_type, payload } : { ...common, trailer_plate };
      if (vehicle) {
        const { status: _ignored, ...rest } = data;
        id = (await updateFleetVehicleApi(vehicle.id, rest)).id;
      } else {
        id = (await createFleetVehicleApi({ ...data, category: isTruck ? 'truck' : 'tractor' })).id;
      }
      const errors = [await savePhoto(photo, id, uploadFleetVehiclePhotoApi, deleteFleetVehiclePhotoApi, t.fleet.toast.error,
        t.fleet.photo.outdatedBackend)];
      for (const which of VEHICLE_DOCUMENTS) {
        errors.push(await savePhoto(papers[which], id, (i, file) => uploadFleetVehicleDocumentApi(i, which, file),
          (i) => deleteFleetVehicleDocumentApi(i, which), t.fleet.toast.error, t.fleet.photo.outdatedBackend));
      }
      const failed = errors.filter((x): x is string => x !== null);
      if (failed.length) addToast(tf(t.fleet.photo.uploadFailed, { error: [...new Set(failed)].join('; ') }), 'error');
      else addToast(t.fleet.toast.saved, 'success');
      onSaved();
      onClose();
    } catch (err) {
      setError(apiError(err, t.fleet.toast.error));
    } finally {
      setSaving(false);
    }
  };

  const statusValue = formLocked && !vehicle && !LOCK_FREE_STATUSES.includes(form.status) ? 'not_ready' : form.status;
  const paperTitle = { ownership: D.ownership, registration: D.inspection, insurance: D.insuranceDoc };
  const expiryField = { ownership: 'ownership_expiry', registration: 'registration_expiry', insurance: 'insurance_expiry' } as const;
  const expiryLabel = { ownership: t.fleet.vehicleForm.ownership, registration: f.registration, insurance: f.insurance };

  // editing: boxes are picked and copied together like the booking details (what is typed now is what is copied)
  const pick = vehicle ? picked : null;
  const entries: CopyEntry[] = [
    { key: 'plate', label: f.plate, value: form.plate },
    { key: 'vehicle_type', label: f.type, value: form.vehicle_type },
    ...(isTruck ? [
      { key: 'body_type', label: t.fleet.truckForm.body, value: form.body_type },
      { key: 'payload', label: t.fleet.truckForm.payload, value: form.payload },
    ] : [{ key: 'trailer_plate', label: f.trailer, value: form.trailer_plate }]),
    { key: 'status', label: f.status, value: t.fleet.vehicleStatus[statusValue] },
    { key: 'ownership_expiry', label: expiryLabel.ownership, value: formatIsoDate(form.ownership_expiry) },
    { key: 'registration_expiry', label: expiryLabel.registration, value: formatIsoDate(form.registration_expiry) },
    { key: 'insurance_expiry', label: expiryLabel.insurance, value: formatIsoDate(form.insurance_expiry) },
    { key: 'note', label: f.note, value: form.note },
  ];
  const copyOf = (key: string) => entries.find((e) => e.key === key)?.value || '';
  const box = (key: keyof typeof form, label: string, input: React.ReactElement, extra: { required?: boolean; className?: string } = {}) => (
    <FormBox id={key} label={label} copyValue={copyOf(key)} picked={pick} {...extra}>{input}</FormBox>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={vehicle ? tf(f.editTitle, { plate: vehicle.plate }) : f.addTitle} maxWidth="max-w-3xl">
      {/* laid out like the trailer and driver forms: photo + what it is, then its papers (with scans), then the note */}
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div className="flex items-start gap-4">
          <PhotoPicker kind="vehicle" name={form.plate} current={vehicle?.photo || ''} value={photo} onChange={setPhoto} onError={setError} stacked />
          <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
            {box('plate', f.plate, <input autoFocus value={form.plate} onChange={set('plate')} placeholder={f.platePh} />,
              { required: true, className: 'col-span-2' })}
            {box('vehicle_type', f.type, <input value={form.vehicle_type} onChange={set('vehicle_type')} placeholder={f.typePh} />)}
            {isTruck
              ? box('body_type', t.fleet.truckForm.body,
                <input value={form.body_type} onChange={set('body_type')} placeholder={t.fleet.truckForm.bodyPh} list="fleet-truck-bodies" />)
              : box('trailer_plate', f.trailer, <input value={form.trailer_plate} onChange={set('trailer_plate')} placeholder={f.trailerPh}
                list="fleet-free-trailers" title={t.fleet.trailer.formHint} />)}
            {isTruck && box('payload', t.fleet.truckForm.payload,
              <input value={form.payload} onChange={set('payload')} placeholder={t.fleet.truckForm.payloadPh} />)}
            {box('status', f.status, (
              <select value={statusValue} onChange={set('status')} disabled={!!vehicle}>
                {VEHICLE_STATUSES.map((s) => (
                  <option key={s} value={s} disabled={formLocked && !LOCK_FREE_STATUSES.includes(s)}>{t.fleet.vehicleStatus[s]}</option>
                ))}
              </select>
            ), { className: isTruck ? '' : 'col-span-2' })}
            <div className="col-span-2">
              {formLocked && <LockHint papers={formExpired} />}
              {vehicle && <p className="text-[11px] text-slate-500 dark:text-slate-400">{f.statusHint}</p>}
            </div>
            <datalist id="fleet-free-trailers">
              {freeTrailers.map((plate) => <option key={plate} value={plate} />)}
            </datalist>
            <datalist id="fleet-truck-bodies">
              {t.fleet.truckForm.bodies.map((b) => <option key={b} value={b} />)}
            </datalist>
          </div>
        </div>

        {pick && (
          <div className="space-y-1.5">
            <FieldCopyBar entries={entries} {...pick.barProps} />
            <p className="text-[11px] text-slate-400">{D.editHint}</p>
          </div>
        )}

        <DriverSection title={D.papers}>
          <div className="space-y-3">
            {(['ownership', 'registration', 'insurance'] as const).map((kind) => {
              const picker = (side: 'front' | 'back') => {
                const which = `${kind}_${side}` as VehicleDocument;
                return (
                  <PaperPicker which={which} doc={paperTitle[kind]} side={side === 'front' ? D.front : D.back}
                    current={vehicle?.[which] || ''} value={papers[which]}
                    onChange={(next) => setPapers((prev) => ({ ...prev, [which]: next }))} onError={setError} />
                );
              };
              const field = expiryField[kind];
              return (
                <PaperRow key={kind} kind={kind} front={picker('front')} back={picker('back')}
                  facts={box(field, expiryLabel[kind], <input type="date" value={form[field]} onChange={set(field)} />)} />
              );
            })}
          </div>
        </DriverSection>

        <DriverSection title={D.other}>
          {box('note', f.note, <textarea rows={2} value={form.note} onChange={set('note')} />)}
        </DriverSection>

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
  const [papers, setPapers] = useState<PaperChoices>(NO_PAPER_CHANGES);
  const D = t.fleet.detail;

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setHomeId('');
    setPhoto(NO_PHOTO_CHANGE);
    setPapers(NO_PAPER_CHANGES);
    setForm(driver ? {
      name: driver.name, phone: driver.phone, id_number: driver.id_number, license_no: driver.license_no,
      license_class: driver.license_class, license_expiry: driver.license_expiry, status: driver.status, note: driver.note,
    } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, driver]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  // an expired licence in the form: only not_ready / leave / left; a status it can't keep shows (and saves) as not_ready
  const licenceLocked = licenseExpired(form);
  const driverStatus: DriverStatus = licenceLocked && !DRIVER_LOCK_FREE_STATUSES.includes(form.status)
    ? (driver && DRIVER_LOCK_FREE_STATUSES.includes(driver.status) ? driver.status : 'not_ready') : form.status;

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
      const data = { ...form, status: driverStatus };
      const id = driver
        ? (await updateFleetDriverApi(driver.id, data)).id
        : (await createFleetDriverApi({ ...data, home_vehicle_id: homeId ? Number(homeId) : null })).id;
      const errors = [await savePhoto(photo, id, uploadFleetDriverPhotoApi, deleteFleetDriverPhotoApi, t.fleet.toast.error,
        t.fleet.photo.outdatedBackend)];
      for (const which of DRIVER_DOCUMENTS) {
        errors.push(await savePhoto(papers[which], id, (i, file) => uploadFleetDriverDocumentApi(i, which, file),
          (i) => deleteFleetDriverDocumentApi(i, which), t.fleet.toast.error, t.fleet.photo.outdatedBackend));
      }
      const failed = errors.filter((x): x is string => x !== null);
      if (failed.length) addToast(tf(t.fleet.photo.uploadFailed, { error: [...new Set(failed)].join('; ') }), 'error');
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
    <Modal isOpen={isOpen} onClose={onClose} title={driver ? tf(f.editTitle, { name: driver.name }) : f.addTitle} maxWidth="max-w-3xl">
      {/* laid out like the driver details: photo + who they are, then the papers, then the rest */}
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div className="flex items-start gap-4">
          <PhotoPicker kind="driver" name={form.name} current={driver?.photo || ''} value={photo} onChange={setPhoto} onError={setError} stacked />
          <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <FieldInputBox label={f.name} required>
                <input autoFocus value={form.name} onChange={set('name')} />
              </FieldInputBox>
            </div>
            <FieldInputBox label={f.phone}>
              <input value={form.phone} onChange={set('phone')} inputMode="tel" />
            </FieldInputBox>
            <FieldInputBox label={f.status}>
              <select value={driverStatus} onChange={set('status')}>
                {DRIVER_STATUSES.map((s) => (
                  <option key={s} value={s} disabled={licenceLocked && !DRIVER_LOCK_FREE_STATUSES.includes(s)}>{t.fleet.driverStatus[s]}</option>
                ))}
              </select>
            </FieldInputBox>
            {licenceLocked && (
              <p role="note" data-testid="licence-lock-hint" className="col-span-2 text-[11px] font-medium text-orange-700 dark:text-orange-300">
                {t.fleet.licenseLock.hint}
              </p>
            )}
            {!driver && (
              <div className="col-span-2">
                <FieldInputBox label={f.homeVehicle}>
                  <select value={homeId} onChange={(e) => setHomeId(e.target.value)}>
                    <option value="">{f.noHome}</option>
                    {unassigned.map((v) => <option key={v.id} value={v.id}>{vehicleOptionLabel(v, t)}</option>)}
                  </select>
                </FieldInputBox>
              </div>
            )}
            <p className="col-span-2 text-[11px] text-slate-500 dark:text-slate-400">{f.statusHint}</p>
          </div>
        </div>

        <DriverSection title={D.papers}>
          <div className="space-y-3">
            {(['license', 'id'] as const).map((kind) => {
              const doc = kind === 'license' ? D.license : D.idCard;
              const picker = (side: 'front' | 'back') => {
                const which = `${kind}_${side}` as const;
                return (
                  <PaperPicker which={which} doc={doc} side={side === 'front' ? D.front : D.back}
                    current={driver?.[which] || ''} value={papers[which]}
                    onChange={(next) => setPapers((prev) => ({ ...prev, [which]: next }))} onError={setError} />
                );
              };
              return (
                <PaperRow key={kind} kind={kind} front={picker('front')} back={picker('back')} facts={kind === 'license' ? (
                  <>
                    <FieldInputBox label={f.licenseClass}>
                      <input value={form.license_class} onChange={set('license_class')} placeholder={f.licenseClassPh} />
                    </FieldInputBox>
                    <FieldInputBox label={f.licenseNo}>
                      <input value={form.license_no} onChange={set('license_no')} />
                    </FieldInputBox>
                    <FieldInputBox label={f.licenseExpiry}>
                      <input type="date" value={form.license_expiry} onChange={set('license_expiry')} />
                    </FieldInputBox>
                  </>
                ) : (
                  <FieldInputBox label={f.idNumber}>
                    <input value={form.id_number} onChange={set('id_number')} />
                  </FieldInputBox>
                )} />
              );
            })}
          </div>
        </DriverSection>

        <DriverSection title={D.other}>
          <FieldInputBox label={f.note}>
            <textarea rows={2} value={form.note} onChange={set('note')} />
          </FieldInputBox>
        </DriverSection>

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

  // expired papers: only not_ready / inactive can be picked
  const expired = vehicle ? expiredPapers(vehicle) : [];
  const locked = expired.length > 0;

  useEffect(() => {
    if (!vehicle) return;
    setStatus(expiredPapers(vehicle).length ? (vehicle.status === 'not_ready' ? 'inactive' : 'not_ready')
      : isRunning(vehicle.status) ? 'broken' : 'ready');
    setReason('');
    setSpareId('');
    setError('');
    setPlan('move');
  }, [vehicle]);

  const spares = useMemo(() => freeVehicles(vehicles, vehicle?.id), [vehicles, vehicle]);
  if (!vehicle) return null;
  const driver = vehicle.current_driver;
  const stops = !isRunning(status);
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
            {VEHICLE_STATUSES.map((s) => (
              <option key={s} value={s} disabled={locked && !LOCK_FREE_STATUSES.includes(s)}>{t.fleet.vehicleStatus[s]}</option>
            ))}
          </select>
          {locked && <LockHint papers={expired} />}
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
                {vehicleOptionLabel(v, t)}{!isRunning(v.status) ? ` — ${t.fleet.vehicleStatus[v.status]}` : ''}
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
