import React, { useEffect, useState } from 'react';
import { History, Loader2, Pencil } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useFieldSelection } from '../../hooks/useFieldSelection';
import { fleetPhotoUrl, getFleetHistoryApi, getFleetTrailersApi } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import type { CopyEntry } from '../../utils/fieldCopy';
import type { FleetAssignment, FleetDriver, FleetTrailer, FleetVehicle } from '../../types';
import { FieldCopyBar } from '../common/FieldCopyBar';
import { Modal } from '../common/Modal';
import { daysLeftText } from '../common/ReminderViews';
import { FleetAvatar } from './FleetPhoto';
import { DocumentTile, DriverSection, PaperRow, usePaperTitle } from './DriverPapers';
import { DriverDetailModal } from './DriverDetail';
import { PickBox } from './FieldPick';
import { EXPIRY_WARN_DAYS, daysUntil, formatIsoDate, formatStampShort, todayVnIso } from './fleetUtils';

export type FleetDetailTarget = { kind: 'vehicle'; item: FleetVehicle } | { kind: 'driver'; item: FleetDriver };

export interface DetailAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** the row's main action, drawn as the filled button */
  primary?: boolean;
}

const HISTORY_SHOWN = 5;
const VALUE = 'text-sm font-semibold text-slate-800 dark:text-slate-100 break-words';

/** A date and, once inside the reminder window, the days left. */
const DateValue: React.FC<{ iso: string }> = ({ iso }) => {
  const { t } = useApp();
  const days = daysUntil(iso, todayVnIso());
  if (days === null) return <span className="text-sm text-slate-400">{t.fleet.none}</span>;
  const warn = days <= EXPIRY_WARN_DAYS;
  return (
    <span className={`${VALUE} flex flex-wrap items-center gap-2`}>
      {formatIsoDate(iso)}
      {warn && (
        <span className={`inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${days < 0
          ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
          : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>
          {daysLeftText(days, t)}
        </span>
      )}
    </span>
  );
};

const Person: React.FC<{ photo: string; name: string; lines: React.ReactNode[] }> = ({ photo, name, lines }) => (
  <div className="flex items-center gap-2.5 mt-1">
    <FleetAvatar photo={photo} kind="driver" name={name} size="sm" />
    <div className="min-w-0">
      <div className="font-semibold text-slate-800 dark:text-slate-100">{name}</div>
      {lines.filter(Boolean).map((l, i) => <div key={i} className="text-xs text-slate-500 dark:text-slate-400">{l}</div>)}
    </div>
  </div>
);

interface Props {
  target: FleetDetailTarget | null;
  onClose: () => void;
  onOpenPhoto: (photo: string, name: string) => void;
  onShowHistory: () => void;
  onEdit: () => void;
  actions: DetailAction[];
  /** after a change made here (a driver's edits, scans, photo): reload the row */
  onChanged?: () => void;
}

/** Everything about one truck or driver, opened by double-clicking its row. Its actions are the row's own. A driver's
 *  details are edited in place (DriverDetailModal); a truck's are read here. Both let boxes be picked and copied
 *  together, like the booking details. */
export const FleetDetailModal: React.FC<Props> = ({ target, onClose, onOpenPhoto, onShowHistory, onEdit, actions, onChanged }) => {
  if (!target) return null;
  if (target.kind === 'driver') {
    return (
      <DriverDetailModal driver={target.item} onClose={onClose} onOpenPhoto={onOpenPhoto} onShowHistory={onShowHistory}
        actions={actions} onChanged={() => onChanged?.()} />
    );
  }
  return (
    <VehicleDetailModal vehicle={target.item} onClose={onClose} onOpenPhoto={onOpenPhoto} onShowHistory={onShowHistory}
      onEdit={onEdit} actions={actions} onChanged={() => onChanged?.()} />
  );
};

const VehicleDetailModal: React.FC<{
  vehicle: FleetVehicle; onClose: () => void; onOpenPhoto: (photo: string, name: string) => void; onShowHistory: () => void;
  onEdit: () => void; actions: DetailAction[]; onChanged: () => void;
}> = ({ vehicle: v, onClose, onOpenPhoto, onShowHistory, onEdit, actions, onChanged }) => {
  const paperTitle = usePaperTitle();
  const { t } = useApp();
  const f = t.fleet;
  const D = f.detail;
  // a truck (xe tải) carries its own load where a tractor has its trailer
  const isTruck = v.category === 'truck';
  const VF = isTruck ? { ...f.vehicleForm, ...f.truckForm } : f.vehicleForm;
  const [history, setHistory] = useState<FleetAssignment[] | null>(null);
  // the trailer it pulls, for its type / photo / since (the truck row carries only the plate)
  const [trailer, setTrailer] = useState<FleetTrailer | null>(null);
  const picked = useFieldSelection(v.id);

  useEffect(() => {
    let alive = true;
    if (!v.trailer_plate || isTruck) {
      setTrailer(null);
      return;
    }
    getFleetTrailersApi()
      .then((list) => alive && setTrailer(list.find((r) => r.vehicle?.id === v.id) || null))
      .catch(() => alive && setTrailer(null));
    return () => { alive = false; };
  }, [v.id, v.trailer_plate, isTruck]);

  useEffect(() => {
    let alive = true;
    setHistory(null);
    getFleetHistoryApi({ vehicle_id: v.id, limit: HISTORY_SHOWN })
      .then((rows) => alive && setHistory(rows))
      .catch(() => alive && setHistory([]));
    return () => { alive = false; };
  }, [v.id, v.updated_at]);

  const statusTone = v.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    : v.status === 'broken' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
      : v.status === 'maintenance' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  const c = v.current_driver;
  const trailerFacts = trailer ? [trailer.trailer_type, trailer.payload].filter(Boolean).join(' · ') : '';

  // what the boxes copy, in the order shown (the copy bar copies the picked ones in this order)
  const entries: CopyEntry[] = [
    { key: 'plate', label: VF.plate, value: v.plate },
    { key: 'status', label: VF.status, value: f.vehicleStatus[v.status] },
    { key: 'type', label: VF.type, value: v.vehicle_type },
    { key: 'driver', label: D.driving, value: c ? [c.name, c.phone].filter(Boolean).join(' – ') : '' },
    ...(isTruck ? [
      { key: 'body', label: f.truckForm.body, value: v.body_type },
      { key: 'payload', label: f.truckForm.payload, value: v.payload },
    ] : [
      { key: 'trailer', label: t.tabs.trailers, value: [v.trailer_plate, trailerFacts].filter(Boolean).join(' – ') },
    ]),
    { key: 'registration', label: VF.registration, value: formatIsoDate(v.registration_expiry) },
    { key: 'insurance', label: VF.insurance, value: formatIsoDate(v.insurance_expiry) },
    { key: 'note', label: VF.note, value: v.note },
    { key: 'created', label: D.added, value: formatStampShort(v.created_at) },
  ];
  const value = (key: string) => entries.find((e) => e.key === key)?.value || '';
  const label = (key: string) => entries.find((e) => e.key === key)?.label || '';
  const box = (key: string, content?: React.ReactNode, className = '') => (
    <PickBox id={key} label={label(key)} copyValue={value(key)} picked={picked} className={className}>
      {content ?? (value(key) ? <div className={VALUE}>{value(key)}</div> : <div className="text-sm text-slate-400">{f.none}</div>)}
    </PickBox>
  );

  return (
    <Modal isOpen onClose={onClose} title={tf(isTruck ? D.truckTitle : D.vehicleTitle, { plate: v.plate })} maxWidth="max-w-3xl">
      <div className="space-y-5" data-testid="fleet-detail">
        {/* the truck: photo, then plate / status / type */}
        <div className="flex items-start gap-4">
          {v.photo ? (
            <button type="button" onClick={() => onOpenPhoto(v.photo, v.plate)} aria-label={tf(f.photo.view, { name: v.plate })}
              className="shrink-0 overflow-hidden cursor-zoom-in ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-2 hover:ring-primary-400 w-48 h-32 rounded-xl">
              <img src={fleetPhotoUrl(v.photo)} alt={v.plate} className="w-full h-full object-cover" />
            </button>
          ) : (
            <FleetAvatar photo="" kind="vehicle" name={v.plate} size="wide" />
          )}
          <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
            {box('plate', <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{v.plate}</div>, 'col-span-2')}
            {box('status', <span className={`mt-0.5 self-start inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusTone}`}>{f.vehicleStatus[v.status]}</span>)}
            {box('type')}
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldCopyBar entries={entries} {...picked.barProps} />
          <p className="text-[11px] text-slate-400">{D.pickHint}</p>
        </div>

        <DriverSection title={isTruck ? D.crewTruck : D.crew}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {box('driver', c ? (
              <Person photo={c.photo} name={c.name} lines={[
                c.phone,
                c.kind === 'temporary' ? f.kind.temporary : null,
                c.since ? tf(D.since, { time: formatStampShort(c.since) }) : null,
              ]} />
            ) : <div className="text-sm text-slate-400">{f.noDriver}</div>, isTruck ? 'sm:col-span-2' : '')}
            {isTruck && box('body')}
            {isTruck && box('payload')}
            {!isTruck && box('trailer', v.trailer_plate ? (
              <div className="flex items-center gap-2.5 mt-1">
                <FleetAvatar photo={trailer?.photo || ''} kind="trailer" name={v.trailer_plate} size="wideSm" />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 dark:text-slate-100">{v.trailer_plate}</div>
                  {trailerFacts && <div className="text-xs text-slate-500 dark:text-slate-400">{trailerFacts}</div>}
                  {trailer?.vehicle?.since && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">{tf(D.since, { time: formatStampShort(trailer.vehicle.since) })}</div>
                  )}
                </div>
              </div>
            ) : <div className="text-sm text-slate-400">{D.noTrailer}</div>)}
          </div>
        </DriverSection>

        {/* its papers, laid out like a driver's: the facts, then front and back scans (saved at once) */}
        <DriverSection title={D.papers}>
          <div className="space-y-3">
            {(['registration', 'insurance', 'ownership'] as const).map((kind) => {
              const tile = (side: 'front' | 'back') => (
                <DocumentTile kind="vehicle" item={v} which={`${kind}_${side}`} doc={paperTitle(kind)}
                  side={side === 'front' ? D.front : D.back} onOpen={onOpenPhoto} onChanged={onChanged} />
              );
              return (
                <PaperRow key={kind} kind={kind} front={tile('front')} back={tile('back')}
                  hint={kind === 'ownership' ? D.ifAny : undefined}
                  facts={kind === 'registration' ? box('registration', <DateValue iso={v.registration_expiry} />)
                    : kind === 'insurance' ? box('insurance', <DateValue iso={v.insurance_expiry} />) : null} />
              );
            })}
          </div>
        </DriverSection>

        <DriverSection title={D.other}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,14rem] gap-2 items-start">
            {box('note', v.note ? <div className={`${VALUE} whitespace-pre-wrap font-medium`}>{v.note}</div> : undefined)}
            {box('created')}
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
              {history.map((row) => (
                <li key={row.id} className="flex items-start gap-2.5 text-sm">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${row.ended_at ? 'bg-slate-300 dark:bg-slate-600' : 'bg-emerald-500'}`} />
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{row.driver_name}</span>
                    {row.kind === 'temporary' && <span className="ml-1.5 text-xs text-sky-700 dark:text-sky-300">{f.kind.temporary}</span>}
                    <span className="block text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatStampShort(row.started_at)} → {row.ended_at ? formatStampShort(row.ended_at) : f.stillOpen}
                      {(row.end_reason || row.reason) && ` · ${row.end_reason || row.reason}`}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </DriverSection>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onEdit}
            className="mr-auto inline-flex items-center gap-1.5 h-9 px-3 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            <Pencil className="w-4 h-4" />{f.menu.edit}
          </button>
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={a.onClick}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-semibold rounded-lg ${a.primary
                ? 'bg-primary-600 hover:bg-primary-700 text-white'
                : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
              {a.icon}{a.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
};
