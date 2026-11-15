import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, History, Loader2, Save, Trash2, Undo2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { useFieldSelection } from '../../hooks/useFieldSelection';
import {
  deleteFleetDriverPhotoApi, fleetPhotoUrl, getFleetHistoryApi, updateFleetDriverApi, uploadFleetDriverPhotoApi,
} from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { copyTextToClipboard } from '../../utils/formatters';
import type { CopyEntry } from '../../utils/fieldCopy';
import { DRIVER_STATUSES, type DriverStatus, type FleetAssignment, type FleetDriver } from '../../types';
import { FieldCopyBar } from '../common/FieldCopyBar';
import { Modal } from '../common/Modal';
import { daysLeftText } from '../common/ReminderViews';
import { DocumentTile, DriverSection, FieldBox, PaperRow } from './DriverPapers';
import type { DetailAction } from './FleetDetailModal';
import { FleetAvatar, photoProblem } from './FleetPhoto';
import { EXPIRY_WARN_DAYS, apiError, daysUntil, formatIsoDate, formatStampShort, todayVnIso } from './fleetUtils';

const HISTORY_SHOWN = 5;

/** What can be edited right here (the home truck / photo / papers have their own controls). */
type Editable = 'name' | 'phone' | 'status' | 'license_class' | 'license_no' | 'license_expiry' | 'id_number' | 'note';
const EDITABLE: Editable[] = ['name', 'phone', 'status', 'license_class', 'license_no', 'license_expiry', 'id_number', 'note'];

type Selection = ReturnType<typeof useFieldSelection>;

/** A box of the details that is both edited in place and picked for copying (like the booking details): its text is
 *  an input; a click on the box around it selects it; the copy button copies it at once. */
const EditBox: React.FC<{
  id: string; label: string; copyValue: string; picked: Selection; dirty: boolean; className?: string;
  badge?: React.ReactNode; children: React.ReactElement;
}> = ({ id, label, copyValue, picked, dirty, className = '', badge, children }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const [copied, setCopied] = useState(false);
  const empty = !copyValue.trim();
  const copy = async () => {
    const ok = await copyTextToClipboard(copyValue);
    addToast(ok ? t.common.copySuccess : t.fleet.toast.error, ok ? 'success' : 'error');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div {...picked.cardProps(id, empty)} data-testid={`driver-field-${id}`}
      className={`flex flex-col px-2.5 py-1.5 rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-primary-500/30 ${
        dirty ? 'border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20'
          : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700'} ${picked.cardClass(id, empty)} ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
        {!empty && (
          <button type="button" onClick={() => void copy()} title={t.common.copy} aria-label={`${t.common.copy} ${label}`}
            className="p-0.5 rounded text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        {React.cloneElement(children, {
          'aria-label': label,
          className: 'min-w-0 flex-1 bg-transparent p-0 border-0 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:ring-0',
        })}
        {badge}
      </div>
    </div>
  );
};

interface Props {
  driver: FleetDriver;
  onClose: () => void;
  onOpenPhoto: (photo: string, name: string) => void;
  onShowHistory: () => void;
  actions: DetailAction[];
  onChanged: () => void;
}

/** Everything about one driver, edited in place: change a box, then "Lưu thay đổi". Boxes can be picked and copied
 *  together like the booking details. */
export const DriverDetailModal: React.FC<Props> = ({ driver, onClose, onOpenPhoto, onShowHistory, actions, onChanged }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const f = t.fleet;
  const D = f.detail;
  const F = f.driverForm;
  const [edits, setEdits] = useState<Partial<Record<Editable, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [history, setHistory] = useState<FleetAssignment[] | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const picked = useFieldSelection(driver.id);

  // another driver: start clean (a reload of this one keeps what is being typed)
  useEffect(() => {
    setEdits({});
    setError('');
  }, [driver.id]);

  useEffect(() => {
    let alive = true;
    setHistory(null);
    getFleetHistoryApi({ driver_id: driver.id, limit: HISTORY_SHOWN })
      .then((rows) => alive && setHistory(rows))
      .catch(() => alive && setHistory([]));
    return () => { alive = false; };
  }, [driver.id, driver.updated_at]);

  const value = (k: Editable): string => edits[k] ?? String(driver[k] ?? '');
  const isDirty = (k: Editable) => edits[k] !== undefined && edits[k] !== String(driver[k] ?? '');
  const dirtyKeys = EDITABLE.filter(isDirty);
  const dirty = dirtyKeys.length > 0;
  const set = (k: Editable) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEdits((prev) => ({ ...prev, [k]: e.target.value }));

  const save = async () => {
    if (!value('name').trim()) {
      setError(F.nameRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateFleetDriverApi(driver.id, Object.fromEntries(dirtyKeys.map((k) => [k, value(k)])));
      setEdits({});
      addToast(f.toast.saved, 'success');
      onChanged();
    } catch (err) {
      setError(apiError(err, f.toast.error));
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (dirty && !(await confirm({ message: tf(D.discardConfirm, { name: driver.name }), confirmText: D.discardYes,
      cancelText: D.discardKeep, danger: true }))) return;
    onClose();
  };

  const photo = async (work: () => Promise<unknown>, done: string) => {
    setPhotoBusy(true);
    try {
      await work();
      addToast(done, 'success');
      onChanged();
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    } finally {
      setPhotoBusy(false);
    }
  };
  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      addToast(f.photo[problem], 'error');
      return;
    }
    void photo(() => uploadFleetDriverPhotoApi(driver.id, file), D.photoSaved);
  };
  const removePhoto = async () => {
    if (!(await confirm({ message: tf(D.removePhotoConfirm, { name: driver.name }), confirmText: f.photo.remove, danger: true }))) return;
    void photo(() => deleteFleetDriverPhotoApi(driver.id), D.photoRemoved);
  };

  const expiryDays = daysUntil(value('license_expiry'), todayVnIso());
  const expiryBadge = expiryDays !== null && expiryDays <= EXPIRY_WARN_DAYS ? (
    <span className={`shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${expiryDays < 0
      ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
      : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>{daysLeftText(expiryDays, t)}</span>
  ) : null;
  const current = driver.current_vehicle;
  const currentText = current ? [current.plate, current.kind === 'temporary' ? f.kind.temporary : ''].filter(Boolean).join(' · ') : '';

  // what the copy bar copies, in the order shown
  const entries: CopyEntry[] = [
    { key: 'name', label: F.name, value: value('name') },
    { key: 'phone', label: F.phone, value: value('phone') },
    { key: 'status', label: F.status, value: f.driverStatus[value('status') as DriverStatus] || '' },
    { key: 'vehicle', label: D.currentVehicle, value: currentText },
    { key: 'license_class', label: F.licenseClass, value: value('license_class') },
    { key: 'license_no', label: F.licenseNo, value: value('license_no') },
    { key: 'license_expiry', label: F.licenseExpiry, value: formatIsoDate(value('license_expiry')) },
    { key: 'id_number', label: F.idNumber, value: value('id_number') },
    { key: 'note', label: F.note, value: value('note') },
  ];
  const copyOf = (key: string) => entries.find((e) => e.key === key)?.value || '';
  const box = (k: Editable, label: string, input: React.ReactElement, extra: { className?: string; badge?: React.ReactNode } = {}) => (
    <EditBox id={k} label={label} copyValue={copyOf(k)} picked={picked} dirty={isDirty(k)} {...extra}>{input}</EditBox>
  );
  const doc = (kind: 'license' | 'id', side: 'front' | 'back') => (
    <DocumentTile driver={driver} which={`${kind}_${side}`} doc={kind === 'license' ? D.license : D.idCard}
      side={side === 'front' ? D.front : D.back} onOpen={onOpenPhoto} onChanged={onChanged} />
  );

  return (
    <Modal isOpen onClose={() => void close()} title={tf(D.driverTitle, { name: driver.name })} maxWidth="max-w-3xl">
      <div className="space-y-5" data-testid="fleet-detail">
        {/* who: photo (view, change, remove), name, phone, status, and the truck driven now */}
        <div className="flex items-start gap-4">
          <div className="group relative shrink-0">
            {driver.photo ? (
              <button type="button" onClick={() => onOpenPhoto(driver.photo, driver.name)} aria-label={tf(f.photo.view, { name: driver.name })}
                className="block w-28 h-28 rounded-full overflow-hidden cursor-zoom-in ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-2 hover:ring-primary-400">
                <img src={fleetPhotoUrl(driver.photo)} alt={driver.name} className="w-full h-full object-cover" />
              </button>
            ) : <FleetAvatar photo="" kind="driver" name={driver.name} size="xl" />}
            <div className="absolute -bottom-1 inset-x-0 flex justify-center gap-1">
              <button type="button" onClick={() => photoInput.current?.click()} title={driver.photo ? f.photo.change : f.photo.choose}
                aria-label={driver.photo ? f.photo.change : f.photo.choose}
                className="p-1.5 rounded-full bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 shadow ring-1 ring-slate-200 dark:ring-slate-700 hover:text-primary-600">
                {photoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              </button>
              {driver.photo && (
                <button type="button" onClick={() => void removePhoto()} title={f.photo.remove} aria-label={f.photo.remove}
                  className="p-1.5 rounded-full bg-white dark:bg-slate-800 text-rose-600 shadow ring-1 ring-slate-200 dark:ring-slate-700 opacity-0 group-hover:opacity-100 focus:opacity-100">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" className="hidden"
              data-testid="driver-photo-input" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
            {box('name', F.name, <input value={value('name')} onChange={set('name')} />, { className: 'col-span-2' })}
            {box('phone', F.phone, <input value={value('phone')} onChange={set('phone')} inputMode="tel" />)}
            {box('status', F.status, (
              <select value={value('status')} onChange={set('status')}>
                {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{f.driverStatus[s]}</option>)}
              </select>
            ))}
            {isDirty('status') && <p className="col-span-2 text-[11px] text-amber-700 dark:text-amber-300">{F.statusHint}</p>}
          </div>
          <div {...picked.cardProps('vehicle', !current)} data-testid="driver-current-vehicle"
            className={`self-start min-w-[13rem] rounded-xl border border-slate-200 dark:border-slate-700 p-3 ${picked.cardClass('vehicle', !current)}`}>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{D.currentVehicle}</div>
            {current ? (
              <div className="flex items-center gap-2.5">
                <FleetAvatar photo={current.photo} kind="vehicle" name={current.plate} size="wideSm" />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-100">{current.plate}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {[current.kind === 'temporary' ? f.kind.temporary : '', current.since ? tf(D.since, { time: formatStampShort(current.since) }) : '']
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ) : <span className="text-sm text-slate-400">{f.noVehicle}</span>}
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldCopyBar entries={entries} {...picked.barProps} />
          <p className="text-[11px] text-slate-400">{D.editHint}</p>
        </div>

        <DriverSection title={D.papers}>
          <div className="space-y-3">
            <PaperRow kind="license" front={doc('license', 'front')} back={doc('license', 'back')} facts={(
              <>
                {box('license_class', F.licenseClass, <input value={value('license_class')} onChange={set('license_class')} placeholder={F.licenseClassPh} />)}
                {box('license_no', F.licenseNo, <input value={value('license_no')} onChange={set('license_no')} />)}
                {box('license_expiry', F.licenseExpiry, <input type="date" value={value('license_expiry')} onChange={set('license_expiry')} />,
                  { badge: expiryBadge })}
              </>
            )} />
            <PaperRow kind="id" front={doc('id', 'front')} back={doc('id', 'back')}
              facts={box('id_number', F.idNumber, <input value={value('id_number')} onChange={set('id_number')} />)} />
          </div>
        </DriverSection>

        <DriverSection title={D.other}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,14rem] gap-2 items-start">
            {box('note', F.note, <textarea rows={2} value={value('note')} onChange={set('note')} />)}
            <FieldBox field={{ key: 'created', label: D.added, value: formatStampShort(driver.created_at) }} />
          </div>
        </DriverSection>

        <DriverSection title={D.history} extra={
          <button type="button" onClick={onShowHistory} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline">
            <History className="w-3.5 h-3.5" />{D.allHistory}
          </button>
        }>
          {!history ? (
            <div className="flex justify-center py-3 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-400">{D.noHistory}</p>
          ) : (
            <ol className="space-y-1.5">
              {history.map((h) => (
                <li key={h.id} className="flex items-start gap-2.5 text-sm">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${h.ended_at ? 'bg-slate-300 dark:bg-slate-600' : 'bg-emerald-500'}`} />
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{h.vehicle_plate}</span>
                    {h.kind === 'temporary' && <span className="ml-1.5 text-xs text-sky-700 dark:text-sky-300">{f.kind.temporary}</span>}
                    <span className="block text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatStampShort(h.started_at)} → {h.ended_at ? formatStampShort(h.ended_at) : f.stillOpen}
                      {(h.end_reason || h.reason) && ` · ${h.end_reason || h.reason}`}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </DriverSection>

        {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
          {dirty ? (
            <span className="mr-auto inline-flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-500" />{D.unsaved}
              <button type="button" onClick={() => { setEdits({}); setError(''); }}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                <Undo2 className="w-3.5 h-3.5" />{D.discard}
              </button>
            </span>
          ) : <span className="mr-auto" />}
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={a.onClick} disabled={dirty}
              title={dirty ? D.unsaved : undefined}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
              {a.icon}{a.label}
            </button>
          ))}
          <button type="button" onClick={() => void save()} disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{D.save}
          </button>
        </div>
      </div>
    </Modal>
  );
};
