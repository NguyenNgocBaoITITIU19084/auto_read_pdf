import React, { useEffect, useState } from 'react';
import { Copy, History, Loader2, Pencil } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { fleetPhotoUrl, getFleetHistoryApi } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { copyTextToClipboard } from '../../utils/formatters';
import type { FleetAssignment, FleetDriver, FleetVehicle } from '../../types';
import { Modal } from '../common/Modal';
import { daysLeftText } from '../common/ReminderViews';
import { FleetAvatar } from './FleetPhoto';
import { DriverPaperCard } from './DriverPapers';
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

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="font-medium text-slate-800 dark:text-slate-100 break-words">{children}</dd>
  </>
);

const DateValue: React.FC<{ iso: string }> = ({ iso }) => {
  const { t } = useApp();
  const days = daysUntil(iso, todayVnIso());
  if (days === null) return <span className="text-slate-400">{t.fleet.none}</span>;
  const warn = days <= EXPIRY_WARN_DAYS;
  return (
    <span>
      {formatIsoDate(iso)}
      {warn && (
        <span className={`ml-2 inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${days < 0
          ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
          : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>
          {daysLeftText(days, t)}
        </span>
      )}
    </span>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode; extra?: React.ReactNode }> = ({ title, children, extra }) => (
  <section className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h4>
      {extra}
    </div>
    {children}
  </section>
);

const Person: React.FC<{ photo: string; name: string; lines: React.ReactNode[] }> = ({ photo, name, lines }) => (
  <div className="flex items-center gap-2.5">
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
  /** after a change made here (a driver's licence / CCCD scan): reload the row */
  onChanged?: () => void;
}

/** Everything about one truck or driver, opened by double-clicking its row. Its actions are the row's own. */
export const FleetDetailModal: React.FC<Props> = ({ target, onClose, onOpenPhoto, onShowHistory, onEdit, actions, onChanged }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const f = t.fleet;
  const D = f.detail;
  const [history, setHistory] = useState<FleetAssignment[] | null>(null);
  const key = target ? `${target.kind}-${target.item.id}-${target.item.updated_at}` : '';

  useEffect(() => {
    if (!target) return;
    let alive = true;
    setHistory(null);
    getFleetHistoryApi(target.kind === 'vehicle'
      ? { vehicle_id: target.item.id, limit: HISTORY_SHOWN }
      : { driver_id: target.item.id, limit: HISTORY_SHOWN })
      .then((rows) => alive && setHistory(rows))
      .catch(() => alive && setHistory([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!target) return null;

  const copyPhone = async (phone: string) => {
    const ok = await copyTextToClipboard(phone);
    addToast(ok ? tf(D.phoneCopied, { phone }) : f.toast.error, ok ? 'success' : 'error');
  };
  const phoneLine = (phone: string) => phone ? (
    <button type="button" onClick={() => void copyPhone(phone)} title={D.copyPhone} aria-label={`${D.copyPhone} ${phone}`}
      className="inline-flex items-center gap-1 hover:text-primary-600">
      {phone}<Copy className="w-3 h-3" />
    </button>
  ) : null;

  const isVehicle = target.kind === 'vehicle';
  const title = isVehicle ? tf(D.vehicleTitle, { plate: target.item.plate }) : tf(D.driverTitle, { name: target.item.name });
  const name = isVehicle ? target.item.plate : target.item.name;
  const status = isVehicle ? f.vehicleStatus[target.item.status] : f.driverStatus[target.item.status];
  const statusTone = target.item.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    : target.item.status === 'broken' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
      : target.item.status === 'maintenance' || target.item.status === 'leave'
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';

  return (
    <Modal isOpen onClose={onClose} title={title} maxWidth={isVehicle ? 'max-w-2xl' : 'max-w-3xl'}>
      <div className="space-y-5" data-testid="fleet-detail">
        <div className="flex items-center gap-4">
          {target.item.photo ? (
            <button type="button" onClick={() => onOpenPhoto(target.item.photo, name)} aria-label={tf(f.photo.view, { name })}
              className={`shrink-0 overflow-hidden cursor-zoom-in ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-2 hover:ring-primary-400 ${
                isVehicle ? 'w-48 h-32 rounded-xl' : 'w-28 h-28 rounded-full'}`}>
              <img src={fleetPhotoUrl(target.item.photo)} alt={name} className="w-full h-full object-cover" />
            </button>
          ) : (
            <FleetAvatar photo="" kind={target.kind} name={name} size={isVehicle ? 'wide' : 'md'} />
          )}
          <div className="min-w-0 space-y-1.5">
            <div className="text-xl font-bold text-slate-900 dark:text-slate-100">{name}</div>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusTone}`}>{status}</span>
            {isVehicle && target.item.vehicle_type && <div className="text-sm text-slate-500 dark:text-slate-400">{target.item.vehicle_type}</div>}
            {!isVehicle && target.item.phone && <div className="text-sm text-slate-500 dark:text-slate-400">{phoneLine(target.item.phone)}</div>}
          </div>
          {!isVehicle && (
            <div className="ml-auto self-start min-w-[13rem] rounded-xl border border-slate-200 dark:border-slate-700 p-3" data-testid="driver-current-vehicle">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{D.currentVehicle}</div>
              {target.item.current_vehicle ? (
                <div className="flex items-center gap-2.5">
                  <FleetAvatar photo={target.item.current_vehicle.photo} kind="vehicle" name={target.item.current_vehicle.plate} size="wideSm" />
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{target.item.current_vehicle.plate}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {[target.item.current_vehicle.kind === 'temporary' ? f.kind.temporary : '',
                        target.item.current_vehicle.since ? tf(D.since, { time: formatStampShort(target.item.current_vehicle.since) }) : '']
                        .filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              ) : <span className="text-sm text-slate-400">{f.noVehicle}</span>}
            </div>
          )}
        </div>

        {isVehicle ? (
          <Section title={D.driving}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <div>
                <div className="mb-1.5 text-[11px] text-slate-400">{D.driving}</div>
                {target.item.current_driver ? (
                  <Person photo={target.item.current_driver.photo} name={target.item.current_driver.name} lines={[
                    phoneLine(target.item.current_driver.phone),
                    target.item.current_driver.kind === 'temporary' ? f.kind.temporary : null,
                    target.item.current_driver.since ? tf(D.since, { time: formatStampShort(target.item.current_driver.since) }) : null,
                  ]} />
                ) : <span className="text-sm text-slate-400">{f.noDriver}</span>}
              </div>
              <div>
                <div className="mb-1.5 text-[11px] text-slate-400">{D.owner}</div>
                {target.item.home_driver ? (
                  <Person photo={target.item.home_driver.photo} name={target.item.home_driver.name} lines={[
                    target.item.home_driver.status !== 'active' ? f.driverStatus[target.item.home_driver.status] : null,
                    target.item.home_driver.driving_vehicle_id && target.item.home_driver.driving_vehicle_id !== target.item.id
                      ? tf(f.homeAway, { plate: target.item.home_driver.driving_plate }) : null,
                  ]} />
                ) : <span className="text-sm text-slate-400">{f.none}</span>}
              </div>
            </div>
          </Section>
        ) : (
          <Section title={D.papers}>
            <div className="space-y-3">
              <DriverPaperCard driver={target.item} kind="license" onOpen={onOpenPhoto} onChanged={() => onChanged?.()} facts={
                <>
                  <div>{D.licenseClass} <b className="font-semibold text-slate-700 dark:text-slate-200">{target.item.license_class || f.none}</b></div>
                  <div>{D.number} <b className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{target.item.license_no || f.none}</b></div>
                  <div>{D.expiry} <b className="font-semibold text-slate-700 dark:text-slate-200"><DateValue iso={target.item.license_expiry} /></b></div>
                </>
              } />
              <DriverPaperCard driver={target.item} kind="id" onOpen={onOpenPhoto} onChanged={() => onChanged?.()} facts={
                <div>{D.number} <b className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{target.item.id_number || f.none}</b></div>
              } />
            </div>
          </Section>
        )}

        <Section title={isVehicle ? D.info : D.other}>
          <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
            {isVehicle ? (
              <>
                <Row label={f.vehicleForm.trailer}>{target.item.trailer_plate || f.none}</Row>
                <Row label={f.vehicleForm.registration}><DateValue iso={target.item.registration_expiry} /></Row>
                <Row label={f.vehicleForm.insurance}><DateValue iso={target.item.insurance_expiry} /></Row>
              </>
            ) : null}
            <Row label={f.vehicleForm.note}><span className="whitespace-pre-wrap">{target.item.note || f.none}</span></Row>
            <Row label={D.added}>{formatStampShort(target.item.created_at)}</Row>
          </dl>
        </Section>

        <Section title={D.history} extra={
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
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{isVehicle ? h.driver_name : h.vehicle_plate}</span>
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
        </Section>

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
