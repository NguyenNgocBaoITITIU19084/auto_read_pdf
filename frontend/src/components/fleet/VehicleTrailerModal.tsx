import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { Modal } from '../common/Modal';
import { tf } from '../../services/i18nFormat';
import { getFleetTrailersApi, setFleetVehicleTrailerApi } from '../../services/api';
import type { FleetTrailer, FleetVehicle } from '../../types';
import { FleetAvatar } from './FleetPhoto';
import { Footer } from './FleetModals';
import { apiError, fold, isRunning } from './fleetUtils';

interface Props {
  /** the tractor (trucks never pull a trailer) */
  vehicle: FleetVehicle | null;
  onClose: () => void;
  onSaved: () => void;
}

/** From a tractor: "Ghép rơ moóc" / "Đổi rơ moóc". Only a trailer that can run (Sẵn sàng / Đang dùng) can be
 *  picked; one on another tractor comes off it, and this tractor's own trailer comes off. */
export const VehicleTrailerModal: React.FC<Props> = ({ vehicle, onClose, onSaved }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const m = t.fleet.trailerModal;
  const [trailers, setTrailers] = useState<FleetTrailer[] | null>(null);
  const [trailerId, setTrailerId] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTrailerId('');
    setQuery('');
    setError('');
    if (!vehicle) return;
    let live = true;
    setTrailers(null);
    getFleetTrailersApi()
      .then((list) => live && setTrailers(list))
      .catch((err) => live && (setTrailers([]), setError(apiError(err, t.fleet.toast.error))));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle]);

  const shown = useMemo(() => {
    const q = fold(query);
    // free ones that can run first, then those on another tractor, then those that cannot run; by plate
    const rank = (r: FleetTrailer) => (!isRunning(r.status) ? 2 : r.vehicle ? 1 : 0);
    return (trailers || [])
      .filter((r) => r.vehicle?.id !== vehicle?.id)
      .filter((r) => !q || [r.plate, r.trailer_type, r.vehicle?.plate || ''].some((s) => fold(s).includes(q)))
      .sort((a, b) => rank(a) - rank(b) || a.plate.localeCompare(b.plate, 'vi'));
  }, [trailers, query, vehicle]);

  if (!vehicle) return null;
  const picked = shown.find((r) => String(r.id) === trailerId) || null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setSaving(true);
    setError('');
    try {
      const res = await setFleetVehicleTrailerApi(vehicle.id, picked.id);
      addToast(tf(t.fleet.trailer.toast.hitched, { plate: picked.plate, vehicle: vehicle.plate }), 'success');
      if (res.replaced) addToast(tf(t.fleet.trailer.toast.replaced, { plate: res.replaced, vehicle: vehicle.plate }), 'info');
      onSaved();
      onClose();
    } catch (err) {
      setError(apiError(err, t.fleet.toast.error));
    } finally {
      setSaving(false);
    }
  };

  const tag = (text: string, tone: 'amber' | 'emerald' | 'rose') => {
    const tones = {
      amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
      rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    };
    return <span className={`inline-flex items-center h-5 px-1.5 rounded text-[11px] font-medium ${tones[tone]}`}>{text}</span>;
  };

  const card = (r: FleetTrailer) => {
    const on = String(r.id) === trailerId;
    const off = !isRunning(r.status);
    return (
      <button key={r.id} type="button" role="radio" aria-checked={on} aria-label={r.plate} disabled={off}
        title={off ? m.onlyRunning : undefined}
        onClick={() => { setTrailerId(String(r.id)); setError(''); }}
        className={`relative w-full min-h-[5.5rem] flex items-center gap-3.5 p-3 pr-10 rounded-xl border-2 text-left transition-all ${off
          ? 'border-slate-200 dark:border-slate-800 opacity-50 cursor-not-allowed'
          : on
            ? 'border-primary-500 bg-primary-50/70 dark:bg-primary-950/40 shadow-sm'
            : 'border-slate-200 dark:border-slate-700 hover:border-primary-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
        <FleetAvatar photo={r.photo} kind="trailer" name={r.plate} size="wide" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">{r.plate}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{[r.trailer_type, r.payload].filter(Boolean).join(' · ') || ' '}</span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {off ? tag(t.fleet.trailer.status[r.status], 'rose')
              : r.vehicle ? tag(tf(m.onOther, { plate: r.vehicle.plate }), 'amber') : tag(m.free, 'emerald')}
          </span>
        </span>
        <span className={`absolute top-2.5 right-2.5 shrink-0 w-5 h-5 rounded-full border flex items-center justify-center ${on
          ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
          {on && <Check className="w-3.5 h-3.5" />}
        </span>
      </button>
    );
  };

  const own = vehicle.trailer?.plate || vehicle.trailer_plate;
  const summary = !picked ? m.summaryPick
    : [tf(m.summaryHitch, { plate: picked.plate, vehicle: vehicle.plate }),
      picked.vehicle ? tf(m.summaryMove, { plate: picked.plate, from: picked.vehicle.plate }) : '',
      own ? tf(m.summaryReplace, { plate: own }) : ''].filter(Boolean).join(' ');
  const warn = !!picked && (!!picked.vehicle || !!own);

  return (
    <Modal isOpen onClose={onClose} title={tf(own ? m.changeTitle : m.title, { plate: vehicle.plate })} maxWidth="max-w-4xl">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div className="flex flex-wrap items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
          <FleetAvatar photo={vehicle.photo} kind="vehicle" name={vehicle.plate} size="wideLg" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">{vehicle.plate}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {own ? tf(m.current, { plate: own }) : m.currentNone}
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{m.hint}</p>
        <div>
          <span className="block mb-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">{m.pick}</span>
          {(trailers?.length || 0) > 4 && (
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.search} aria-label={m.search}
                className="w-full h-10 pl-9 pr-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label={t.fleet.driverModal.clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          <div role="radiogroup" aria-label={m.pick} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {trailers === null ? <p className="sm:col-span-2 py-8 text-center text-sm text-slate-500">{m.loading}</p>
              : shown.map(card)}
            {trailers !== null && shown.length === 0 && (
              <p className="sm:col-span-2 py-8 text-center text-sm text-slate-500">{query ? m.noMatch : m.none}</p>
            )}
          </div>
        </div>
        <div className="sticky -bottom-5 z-10 -mx-6 -mb-5 px-6 pt-3 pb-5 space-y-3 bg-white dark:bg-slate-900 shadow-[0_-10px_16px_-14px_rgba(15,23,42,0.35)]">
          <p data-testid="trailer-summary" className={`text-sm rounded-xl px-4 py-3 ${picked
            ? (warn ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
              : 'bg-primary-50 text-primary-800 dark:bg-primary-950/30 dark:text-primary-200')
            : 'bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400'}`}>
            {summary}
          </p>
          {error && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
          <Footer onCancel={onClose} saving={saving} disabled={!picked} />
        </div>
      </form>
    </Modal>
  );
};
