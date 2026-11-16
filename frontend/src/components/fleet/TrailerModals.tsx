import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { Modal } from '../common/Modal';
import { tf } from '../../services/i18nFormat';
import {
  createFleetTrailerApi, deleteFleetTrailerDocumentApi, deleteFleetTrailerPhotoApi, hitchFleetTrailerApi, updateFleetTrailerApi,
  uploadFleetTrailerDocumentApi, uploadFleetTrailerPhotoApi,
} from '../../services/api';
import { FleetAvatar, PhotoPicker, type PhotoChoice } from './FleetPhoto';
import { DriverSection, PaperPicker, PaperRow } from './DriverPapers';
import { FormBox } from './FieldPick';
import { FieldCopyBar } from '../common/FieldCopyBar';
import { useFieldSelection } from '../../hooks/useFieldSelection';
import type { CopyEntry } from '../../utils/fieldCopy';
import { Field, Footer, INPUT, LockHint, NO_PHOTO_CHANGE, savePhoto } from './FleetModals';
import {
  VEHICLE_DOCUMENTS, VEHICLE_STATUSES, type FleetTrailer, type FleetVehicle, type TrailerStatus, type VehicleDocument,
} from '../../types';
import { LOCK_FREE_STATUSES, apiError, expiredPapers, formatIsoDate, formatStampShort, isRunning } from './fleetUtils';

/** The company runs one kind of trailer: a new one starts as that (still editable). */
const DEFAULT_TRAILER_TYPE = "Sàn 40'";

/** Tractors a trailer can go on: not out of service, with the trailer each one pulls now. */
const tractorLabel = (v: FleetVehicle, pulling: string, status: string) => {
  const extra = [v.trailer_plate ? tf(pulling, { plate: v.trailer_plate }) : '', !isRunning(v.status) ? status : '']
    .filter(Boolean).join(' · ');
  return extra ? `${v.plate} (${extra})` : v.plate;
};

// ---------------------------------------------------------------------------
// Trailer: add / edit — laid out like the driver form: photo + what it is, the tractor pulling it, its papers
// (facts and front / back scans, uploaded when saved), then the note
// ---------------------------------------------------------------------------
interface TrailerFormProps {
  isOpen: boolean;
  trailer: FleetTrailer | null;
  /** the tractors (trucks never pull a trailer) */
  vehicles: FleetVehicle[];
  onClose: () => void;
  onSaved: () => void;
}

type TrailerPaper = 'registration' | 'insurance' | 'ownership';
const TRAILER_PAPERS: TrailerPaper[] = ['ownership', 'registration', 'insurance'];
type TrailerPaperChoices = Record<VehicleDocument, PhotoChoice>;
const NO_TRAILER_PAPERS = Object.fromEntries(VEHICLE_DOCUMENTS.map((d) => [d, NO_PHOTO_CHANGE])) as TrailerPaperChoices;

export const TrailerFormModal: React.FC<TrailerFormProps> = ({ isOpen, trailer, vehicles, onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const f = t.fleet.trailer.form;
  const D = t.fleet.detail;
  const empty = {
    plate: '', trailer_type: DEFAULT_TRAILER_TYPE, chassis_no: '', payload: '', year: '', ownership_expiry: '', registration_expiry: '',
    insurance_expiry: '', status: 'active' as TrailerStatus, note: '',
  };
  const [form, setForm] = useState(empty);
  const [vehicleId, setVehicleId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<PhotoChoice>(NO_PHOTO_CHANGE);
  const [papers, setPapers] = useState<TrailerPaperChoices>(NO_TRAILER_PAPERS);
  const selection = useFieldSelection(isOpen ? trailer?.id ?? 'new' : null);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setPhoto(NO_PHOTO_CHANGE);
    setPapers(NO_TRAILER_PAPERS);
    setVehicleId(trailer?.vehicle ? String(trailer.vehicle.id) : '');
    setForm(trailer ? {
      plate: trailer.plate, trailer_type: trailer.trailer_type, chassis_no: trailer.chassis_no, payload: trailer.payload,
      year: trailer.year, ownership_expiry: trailer.ownership_expiry, registration_expiry: trailer.registration_expiry, insurance_expiry: trailer.insurance_expiry,
      status: trailer.status, note: trailer.note,
    } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, trailer]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  // expired papers in the form: only not_ready / inactive; a status it can't keep shows (and saves) as not_ready
  const expired = expiredPapers(form);
  const locked = expired.length > 0;
  const status: TrailerStatus = locked && !LOCK_FREE_STATUSES.includes(form.status)
    ? (trailer && LOCK_FREE_STATUSES.includes(trailer.status) ? trailer.status : 'not_ready') : form.status;
  // out of service / not ready: off its tractor, and none can be picked
  const inactive = status === 'inactive' || status === 'not_ready';
  const current = trailer?.vehicle || null;
  const picked = vehicles.find((v) => String(v.id) === vehicleId) || null;
  // a tractor pulling another trailer: that one comes off it
  const replacing = picked && picked.trailer_plate && picked.id !== current?.id ? picked.trailer_plate : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.plate.trim()) {
      setError(f.plateRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const target = vehicleId && !inactive ? Number(vehicleId) : null;
      let id: number;
      const data = { ...form, status };
      if (trailer) {
        id = (await updateFleetTrailerApi(trailer.id, data)).id;
        // going out of service unhitches it on the server already
        if (!inactive && target !== (current?.id ?? null)) await hitchFleetTrailerApi(id, target);
      } else {
        id = (await createFleetTrailerApi({ ...data, vehicle_id: target })).id;
      }
      const errors = [await savePhoto(photo, id, uploadFleetTrailerPhotoApi, deleteFleetTrailerPhotoApi, t.fleet.toast.error,
        t.fleet.photo.outdatedBackend)];
      for (const which of VEHICLE_DOCUMENTS) {
        errors.push(await savePhoto(papers[which], id, (i, file) => uploadFleetTrailerDocumentApi(i, which, file),
          (i) => deleteFleetTrailerDocumentApi(i, which), t.fleet.toast.error, t.fleet.photo.outdatedBackend));
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

  const tractors = vehicles.filter((v) => v.status !== 'inactive' || v.id === current?.id);
  const paperTitle = { registration: D.inspection, insurance: D.insuranceDoc, ownership: D.ownership };

  // editing: boxes are picked and copied together like the booking details (what is typed now is what is copied)
  const pick = trailer ? selection : null;
  const entries: CopyEntry[] = [
    { key: 'plate', label: f.plate, value: form.plate },
    { key: 'trailer_type', label: f.type, value: form.trailer_type },
    { key: 'payload', label: f.payload, value: form.payload },
    { key: 'status', label: f.status, value: t.fleet.trailer.status[status] },
    { key: 'vehicle', label: f.vehicle, value: inactive ? '' : picked?.plate || '' },
    { key: 'ownership_expiry', label: f.ownership, value: formatIsoDate(form.ownership_expiry) },
    { key: 'chassis_no', label: f.chassis, value: form.chassis_no },
    { key: 'year', label: f.year, value: form.year },
    { key: 'registration_expiry', label: f.registration, value: formatIsoDate(form.registration_expiry) },
    { key: 'insurance_expiry', label: f.insurance, value: formatIsoDate(form.insurance_expiry) },
    { key: 'note', label: f.note, value: form.note },
  ];
  const copyOf = (key: string) => entries.find((e) => e.key === key)?.value || '';
  const box = (key: string, label: string, input: React.ReactElement, extra: { required?: boolean; className?: string } = {}) => (
    <FormBox id={key} label={label} copyValue={copyOf(key)} picked={pick} {...extra}>{input}</FormBox>
  );

  const facts: Record<TrailerPaper, React.ReactNode> = {
    ownership: (
      <>
        {box('ownership_expiry', f.ownership, <input type="date" value={form.ownership_expiry} onChange={set('ownership_expiry')} />)}
        {box('chassis_no', f.chassis, <input value={form.chassis_no} onChange={set('chassis_no')} />)}
        {box('year', f.year, <input value={form.year} onChange={set('year')} placeholder={f.yearPh} inputMode="numeric" maxLength={4} />)}
      </>
    ),
    registration: box('registration_expiry', f.registration,
      <input type="date" value={form.registration_expiry} onChange={set('registration_expiry')} />),
    insurance: box('insurance_expiry', f.insurance, <input type="date" value={form.insurance_expiry} onChange={set('insurance_expiry')} />),
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={trailer ? tf(f.editTitle, { plate: trailer.plate }) : f.addTitle} maxWidth="max-w-3xl">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div className="flex items-start gap-4">
          <PhotoPicker kind="trailer" name={form.plate} current={trailer?.photo || ''} value={photo} onChange={setPhoto} onError={setError} stacked />
          <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
            {box('plate', f.plate, <input autoFocus value={form.plate} onChange={set('plate')} placeholder={f.platePh} />,
              { required: true, className: 'col-span-2' })}
            {box('trailer_type', f.type, <input value={form.trailer_type} onChange={set('trailer_type')} placeholder={f.typePh} />)}
            {box('payload', f.payload, <input value={form.payload} onChange={set('payload')} placeholder={f.payloadPh} />)}
            <div className="col-span-2">
              {box('status', f.status, (
                <select value={status} onChange={set('status')}>
                  {VEHICLE_STATUSES.map((s) => (
                    <option key={s} value={s} disabled={locked && !LOCK_FREE_STATUSES.includes(s)}>{t.fleet.trailer.status[s]}</option>
                  ))}
                </select>
              ))}
              {locked && <LockHint papers={expired} />}
              {!locked && !!trailer?.status_forced && status === 'not_ready' && (
                <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">{t.fleet.lock.renewed}</p>
              )}
            </div>
          </div>
        </div>

        {pick && (
          <div className="space-y-1.5">
            <FieldCopyBar entries={entries} {...pick.barProps} />
            <p className="text-[11px] text-slate-400">{D.editHint}</p>
          </div>
        )}

        {/* which tractor pulls it: shown, and changed here */}
        <DriverSection title={f.connection}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-stretch">
            <div data-testid="trailer-connection"
              className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40">
              {current ? (
                <>
                  <FleetAvatar photo={current.photo} kind="vehicle" name={current.plate} size="wideSm" />
                  <div className="min-w-0 text-xs text-slate-500 dark:text-slate-400">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{tf(f.connectedTo, { plate: current.plate })}</div>
                    <div>{current.driver_name ? tf(f.driver, { name: current.driver_name }) : f.noDriver}</div>
                    {current.since && <div>{tf(D.since, { time: formatStampShort(current.since) })}</div>}
                  </div>
                </>
              ) : (
                <span className="text-sm text-slate-400">{f.notConnected}</span>
              )}
            </div>
            <div className="space-y-1">
              {box('vehicle', f.vehicle, (
                <select value={inactive ? '' : vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={inactive}>
                  <option value="">{f.noVehicle}</option>
                  {tractors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id === current?.id ? v.plate
                        : tractorLabel(v, t.fleet.trailer.hitchModal.pulling, t.fleet.vehicleStatus[v.status].toLowerCase())}
                    </option>
                  ))}
                </select>
              ))}
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {inactive ? f.inactiveHint : replacing ? tf(t.fleet.trailer.hitchModal.replaceWarn, { plate: replacing })
                  : trailer ? f.changeHint : ''}
              </p>
            </div>
          </div>
        </DriverSection>

        <DriverSection title={D.papers}>
          <div className="space-y-3">
            {TRAILER_PAPERS.map((kind) => {
              const picker = (side: 'front' | 'back') => {
                const which = `${kind}_${side}` as VehicleDocument;
                return (
                  <PaperPicker which={which} doc={paperTitle[kind]} side={side === 'front' ? D.front : D.back}
                    current={trailer?.[which] || ''} value={papers[which]}
                    onChange={(next) => setPapers((prev) => ({ ...prev, [which]: next }))} onError={setError} />
                );
              };
              return <PaperRow key={kind} kind={kind} front={picker('front')} back={picker('back')} facts={facts[kind]} />;
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
