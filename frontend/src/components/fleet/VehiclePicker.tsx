import React, { useMemo, useState } from 'react';
import { Check, Search, Truck, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';
import type { FleetVehicle } from '../../types';
import { FleetAvatar } from './FleetPhoto';
import { isRunning } from './fleetUtils';

type Filter = 'all' | 'tractor' | 'truck';

interface Props {
  vehicles: FleetVehicle[];
  /** the picked vehicle's id as a string, '' = none */
  value: string;
  onChange: (value: string) => void;
  /** a first card for "no vehicle" (its label), when that is a choice */
  noneLabel?: string;
  /** the driver being moved: the truck they drive now is not marked as someone else's */
  driverId?: number;
  label: string;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]/g, '');

/** Pick one vehicle from cards (photo, plate, trailer / truck body, who has it), filtered by kind and searchable. */
export const VehiclePicker: React.FC<Props> = ({ vehicles, value, onChange, noneLabel, driverId, label }) => {
  const { t } = useApp();
  const m = t.fleet.moveModal;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => ({
    all: vehicles.length,
    tractor: vehicles.filter((v) => v.category !== 'truck').length,
    truck: vehicles.filter((v) => v.category === 'truck').length,
  }), [vehicles]);

  // cannot be given to this driver: someone else drives it now (take it back first), or it cannot run
  // (Không sẵn sàng / Hư hỏng / Bảo dưỡng / Ngưng hoạt động)
  const locked = (v: FleetVehicle) => (!!v.current_driver && v.current_driver.id !== driverId) || !isRunning(v.status);
  const rank = (v: FleetVehicle) => (locked(v) ? 1 : 0);

  const shown = useMemo(() => {
    const q = norm(query);
    return vehicles
      .filter((v) => filter === 'all' || (filter === 'truck') === (v.category === 'truck'))
      .filter((v) => !q || [v.plate, v.trailer_plate, v.vehicle_type, v.body_type, v.current_driver?.name || ''].some((s) => norm(s).includes(q)))
      // free trucks first, then the ones that cannot be picked; by plate within each
      .sort((a, b) => rank(a) - rank(b) || a.plate.localeCompare(b.plate));
  }, [vehicles, filter, query, driverId]);

  const chip = (key: Filter, text: string) => (
    <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
      className={`h-7 px-2.5 rounded-full text-xs font-semibold border transition-colors ${filter === key
        ? 'bg-primary-600 border-primary-600 text-white'
        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
      {text} <span className="opacity-70">{counts[key]}</span>
    </button>
  );

  const card = (key: string, picked: boolean, body: React.ReactNode, aria: string, disabled = false) => (
    <button key={key} type="button" role="radio" aria-checked={picked} aria-label={aria} disabled={disabled}
      onClick={() => onChange(key === 'none' ? '' : key)}
      className={`relative w-full min-h-[5.5rem] flex items-center gap-3.5 p-3 pr-10 rounded-xl border-2 text-left transition-all ${disabled
        ? 'border-slate-200 dark:border-slate-800 opacity-50 cursor-not-allowed'
        : picked
          ? 'border-primary-500 bg-primary-50/70 dark:bg-primary-950/40 shadow-sm'
          : 'border-slate-200 dark:border-slate-700 hover:border-primary-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
      {body}
      <span className={`absolute top-2.5 right-2.5 shrink-0 w-5 h-5 rounded-full border flex items-center justify-center ${picked
        ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
        {picked && <Check className="w-3.5 h-3.5" />}
      </span>
    </button>
  );

  const tag = (text: string, tone: 'slate' | 'amber' | 'sky' | 'emerald' | 'rose' | 'violet') => {
    const tones = {
      slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
      amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
      emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
      rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
      violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    };
    return <span className={`inline-flex items-center h-5 px-1.5 rounded text-[11px] font-medium ${tones[tone]}`}>{text}</span>;
  };

  const vehicleBody = (v: FleetVehicle) => {
    const isTruck = v.category === 'truck';
    const what = isTruck ? [v.body_type, v.payload].filter(Boolean).join(' · ') : (v.trailer_plate ? tf(m.trailer, { plate: v.trailer_plate }) : m.noTrailer);
    const driving = v.current_driver && v.current_driver.id !== driverId ? v.current_driver : null;
    return (
      <>
        <FleetAvatar photo={v.photo} kind="vehicle" name={v.plate} size="wideLg" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">{v.plate}</span>
            {tag(isTruck ? t.fleet.views.trucks : t.fleet.views.vehicles, isTruck ? 'violet' : 'slate')}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
            {[what, v.vehicle_type].filter(Boolean).join(' · ') || ' '}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {driving && tag(tf(m.drivenBy, { name: driving.name }), 'slate')}
            {!driving && isRunning(v.status) && tag(m.free, 'emerald')}
            {!isRunning(v.status) && tag(t.fleet.vehicleStatus[v.status], 'rose')}
          </span>
        </span>
      </>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        {counts.tractor > 0 && counts.truck > 0 && (
          <div className="flex gap-1.5">
            {chip('all', t.common.all)}
            {chip('tractor', t.fleet.views.vehicles)}
            {chip('truck', t.fleet.views.trucks)}
          </div>
        )}
      </div>
      {vehicles.length > 4 && (
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
      <div role="radiogroup" aria-label={label} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {noneLabel && card('none', value === '', (
          <>
            <span className="w-24 h-16 shrink-0 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-400">
              <Truck className="w-5 h-5" />
            </span>
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{noneLabel}</span>
          </>
        ), noneLabel)}
        {shown.map((v) => card(String(v.id), value === String(v.id), vehicleBody(v), v.plate, locked(v)))}
        {shown.length === 0 && (
          <p className="sm:col-span-2 py-8 text-center text-sm text-slate-500">{vehicles.length ? m.noMatch : t.fleet.statusModal.noSpare}</p>
        )}
      </div>
    </div>
  );
};
