import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { Modal } from '../common/Modal';
import { tf } from '../../services/i18nFormat';
import { setDriverHomeVehicleApi } from '../../services/api';
import type { FleetDriver, FleetVehicle } from '../../types';
import { FleetAvatar } from './FleetPhoto';
import { Footer } from './FleetModals';
import { apiError, isConflict } from './fleetUtils';

interface Props {
  vehicle: FleetVehicle | null;
  drivers: FleetDriver[];
  onClose: () => void;
  onSaved: () => void;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]/g, '');

/** From a truck: give it to a driver for good ("Giao xe"), or hand it to another driver ("Đổi tài xế").
 *  Each driver has one truck, so a driver who owns another truck leaves it. */
export const VehicleDriverModal: React.FC<Props> = ({ vehicle, drivers, onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const m = t.fleet.driverModal;
  const mm = t.fleet.moveModal;
  const [driverId, setDriverId] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDriverId('');
    setQuery('');
    setError('');
  }, [vehicle]);

  const ownerId = vehicle?.home_driver?.id ?? null;
  const shown = useMemo(() => {
    const q = norm(query);
    // this truck's driver first, then drivers with no truck, then the rest; by name within each
    const rank = (d: FleetDriver) => (d.id === ownerId ? 0 : !d.home_vehicle && !d.current_vehicle ? 1 : 2);
    return drivers
      .filter((d) => d.status !== 'left')
      .filter((d) => !q || [d.name, d.phone, d.home_vehicle?.plate || '', d.current_vehicle?.plate || ''].some((s) => norm(s).includes(q)))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'vi'));
  }, [drivers, query, ownerId]);

  if (!vehicle) return null;
  const owner = vehicle.home_driver;
  const picked = drivers.find((d) => String(d.id) === driverId) || null;
  const same = !!picked && picked.id === ownerId;

  const done = () => {
    onSaved();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || same) return;
    setSaving(true);
    setError('');
    try {
      try {
        await setDriverHomeVehicleApi(picked.id, vehicle.id);
      } catch (err) {
        if (!isConflict(err)) throw err;
        const ok = await confirm({
          title: mm.forceTitle,
          message: tf(mm.forceMessage, { message: apiError(err, ''), name: picked.name }),
          confirmText: mm.forceConfirm,
          danger: true,
        });
        if (!ok) return;
        await setDriverHomeVehicleApi(picked.id, vehicle.id, true);
      }
      addToast(t.fleet.toast.saved, 'success');
      done();
    } catch (err) {
      setError(apiError(err, t.fleet.toast.error));
    } finally {
      setSaving(false);
    }
  };

  const unassign = async () => {
    if (!owner) return;
    setSaving(true);
    try {
      await setDriverHomeVehicleApi(owner.id, null);
      addToast(tf(m.unassigned, { plate: vehicle.plate }), 'success');
      done();
    } catch (err) {
      setError(apiError(err, t.fleet.toast.error));
    } finally {
      setSaving(false);
    }
  };

  const tag = (text: string, tone: 'amber' | 'sky' | 'emerald' | 'rose') => {
    const tones = {
      amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
      emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
      rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    };
    return <span className={`inline-flex items-center h-5 px-1.5 rounded text-[11px] font-medium ${tones[tone]}`}>{text}</span>;
  };

  const card = (d: FleetDriver) => {
    const on = String(d.id) === driverId;
    const driving = d.current_vehicle && d.current_vehicle.id !== vehicle.id ? d.current_vehicle : null;
    return (
      <button key={d.id} type="button" role="radio" aria-checked={on} aria-label={d.name}
        onClick={() => { setDriverId(String(d.id)); setError(''); }}
        className={`relative w-full min-h-[5.5rem] flex items-center gap-3.5 p-3 pr-10 rounded-xl border-2 text-left transition-all ${on
          ? 'border-primary-500 bg-primary-50/70 dark:bg-primary-950/40 shadow-sm'
          : 'border-slate-200 dark:border-slate-700 hover:border-primary-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
        <FleetAvatar photo={d.photo} kind="driver" name={d.name} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">{d.name}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{d.phone || ' '}</span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {d.id === ownerId && tag(m.thisTruck, 'sky')}
            {driving && tag(tf(m.driving, { plate: driving.plate }), 'amber')}
            {!d.home_vehicle && !d.current_vehicle && tag(m.noTruck, 'emerald')}
            {d.status !== 'active' && tag(t.fleet.driverStatus[d.status], 'rose')}
          </span>
        </span>
        <span className={`absolute top-2.5 right-2.5 shrink-0 w-5 h-5 rounded-full border flex items-center justify-center ${on
          ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
          {on && <Check className="w-3.5 h-3.5" />}
        </span>
      </button>
    );
  };

  const old = picked && !same ? picked.home_vehicle : null;
  const summary = !picked ? m.summaryPick : same ? tf(m.summarySame, { name: picked.name })
    : [tf(m.summaryGive, { plate: vehicle.plate, name: picked.name }),
      old ? tf(m.summaryLeave, { name: picked.name, old: old.plate }) : '',
      owner ? tf(m.summaryTake, { other: owner.name }) : ''].filter(Boolean).join(' ');
  const warn = !!picked && !same && (!!old || !!owner);

  return (
    <Modal isOpen onClose={onClose} title={tf(owner ? m.changeTitle : m.assignTitle, { plate: vehicle.plate })} maxWidth="max-w-4xl">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div className="flex flex-wrap items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
          <FleetAvatar photo={vehicle.photo} kind="vehicle" name={vehicle.plate} size="wideLg" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">{vehicle.plate}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {[vehicle.category === 'truck' ? vehicle.body_type : vehicle.trailer_plate, vehicle.vehicle_type].filter(Boolean).join(' · ')}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
            {owner ? tf(m.current, { name: owner.name }) : m.currentNone}
          </span>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{m.hint}</p>
        <div>
          <span className="block mb-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">{m.pick}</span>
          {drivers.length > 4 && (
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.search} aria-label={m.search}
                className="w-full h-10 pl-9 pr-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label={m.clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          <div role="radiogroup" aria-label={m.pick} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {shown.map(card)}
            {shown.length === 0 && (
              <p className="sm:col-span-2 py-8 text-center text-sm text-slate-500">{drivers.length ? m.noMatch : m.noDrivers}</p>
            )}
          </div>
        </div>
        <div className="sticky -bottom-5 z-10 -mx-6 -mb-5 px-6 pt-3 pb-5 space-y-3 bg-white dark:bg-slate-900 shadow-[0_-10px_16px_-14px_rgba(15,23,42,0.35)]">
        <p data-testid="driver-summary" className={`text-sm rounded-xl px-4 py-3 ${picked && !same
          ? (warn ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
            : 'bg-primary-50 text-primary-800 dark:bg-primary-950/30 dark:text-primary-200')
          : 'bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400'}`}>
          {summary}
        </p>
        {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        <Footer onCancel={onClose} saving={saving} disabled={!picked || same}>
          {owner && (
            <button type="button" onClick={unassign} disabled={saving}
              className="mr-auto h-9 px-3 text-sm font-semibold rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50">
              {m.unassign}
            </button>
          )}
        </Footer>
        </div>
      </form>
    </Modal>
  );
};
