import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Box, CheckCircle2, Loader2, Ship } from 'lucide-react';
import { getBookingLinks } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { ValueBadge } from '../common/ValueBadge';
import type { TabId } from '../common/Tabs';
import type { BookingLinks } from '../../types';

export interface BookingLinksLabels {
  vesselTitle: string;
  vesselEmpty: string;
  vesselEmptyHint: string;
  noVessel: string;
  estimated: string;
  estimatedTooltip: string;
  berth: string;
  departure: string;
  closing: string;
  openTs: string;
  updated: string;
  containerTitle: string;
  gatedIn: string;
  gatedInNoQty: string;
  containerEmpty: string;
  noBookingNo: string;
  gatedBadge: string;
  openVesselTab: string;
  openContainerTab: string;
  loadError: string;
}

interface BookingLinksPanelProps {
  bookingId: number;
  bookingNo: string;
  vessel: string;
  labels: BookingLinksLabels;
  onNavigateTab?: (tab: TabId, query?: string) => void;
  /** Changes whenever vessel schedules were saved: the links are fetched again */
  reloadKey?: number | null;
}

const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'null';
const show = (v: unknown) => (isBlank(v) ? '—' : String(v));

const SectionHeader: React.FC<{ icon: React.ElementType; title: string; extra?: React.ReactNode; action?: React.ReactNode }> = ({
  icon: Icon, title, extra, action,
}) => (
  <div className="flex items-center justify-between gap-2 mb-1.5">
    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 text-slate-400" />
      {title}
      {extra}
    </span>
    {action}
  </div>
);

const OpenTabButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
  >
    {label}
    <ArrowUpRight className="w-3 h-3" />
  </button>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-3 py-2.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-400 dark:text-slate-500">
    {children}
  </p>
);

/** The booking's ePort vessel schedule(s) and containers, under the booking detail. */
export const BookingLinksPanel: React.FC<BookingLinksPanelProps> = ({
  bookingId, bookingNo, vessel, labels, onNavigateTab, reloadKey,
}) => {
  const [links, setLinks] = useState<BookingLinks | null>(null);
  const [failed, setFailed] = useState(false);

  // A new booking starts blank; a reload of the same one (vessel schedules saved meanwhile) keeps what is shown
  const shownIdRef = useRef<number | null>(null);
  useEffect(() => {
    let current = true; // ignore a late answer for a booking that is no longer shown
    if (shownIdRef.current !== bookingId) {
      shownIdRef.current = bookingId;
      setLinks(null);
    }
    setFailed(false);
    (async () => {
      try {
        const res = await getBookingLinks(bookingId);
        if (current) setLinks(res);
      } catch {
        if (current) setFailed(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [bookingId, reloadKey]);

  if (failed) return <Empty>{labels.loadError}</Empty>;
  if (!links) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 aria-label="loading" className="w-4 h-4 animate-spin text-slate-400" />
      </div>
    );
  }

  const { vessels, containers, gated_in: gated, qty } = links;
  const vesselName = vessels[0]?.vessel_name;
  const allGated = qty !== null && gated >= qty && qty > 0;

  return (
    <div className="space-y-3">
      <section>
        <SectionHeader
          icon={Ship}
          title={labels.vesselTitle}
          action={vesselName && onNavigateTab && (
            <OpenTabButton label={labels.openVesselTab} onClick={() => onNavigateTab('vessel', vesselName)} />
          )}
        />
        {vessels.length === 0 ? (
          <Empty>{isBlank(vessel) ? labels.noVessel : `${labels.vesselEmpty} ${labels.vesselEmptyHint}`}</Empty>
        ) : (
          <div className="space-y-1.5">
            {vessels.map((v) => (
              <div key={v.id} className="p-2.5 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/20">
                <div className="flex items-center gap-2 mb-1.5">
                  <ValueBadge table="vessel" columnKey="site_id" value={v.site_id} fallbackText="" />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {v.vessel_name} <span className="font-semibold text-slate-500 dark:text-slate-400">{v.in_out_voyage}</span>
                  </span>
                  {v.queried_at && (
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400 dark:text-slate-500">{tf(labels.updated, { time: v.queried_at })}</span>
                  )}
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px]">
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">{labels.closing}</dt>
                    <dd className="font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1">
                      {show(v.closing_time)}
                      {v.closing_estimated && (
                        <span title={labels.estimatedTooltip} className="px-1 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-[9px] text-amber-700 dark:text-amber-300">
                          {labels.estimated}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">{labels.berth}</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200">{show(v.actual_berth_time)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">{labels.departure}</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200">{show(v.actual_departure_time)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">{labels.openTs}</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200">{show(v.open_ts)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          icon={Box}
          title={labels.containerTitle}
          extra={containers.length > 0 && (
            <span className={`normal-case tracking-normal rounded-full px-1.5 text-[10px] font-bold ${
              allGated
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}>
              {qty !== null ? tf(labels.gatedIn, { gated, qty }) : tf(labels.gatedInNoQty, { gated })}
            </span>
          )}
          action={containers.length > 0 && onNavigateTab && (
            <OpenTabButton label={labels.openContainerTab} onClick={() => onNavigateTab('container', bookingNo)} />
          )}
        />
        {containers.length === 0 ? (
          <Empty>{isBlank(bookingNo) ? labels.noBookingNo : labels.containerEmpty}</Empty>
        ) : (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <table className="w-full text-[11px]">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {containers.map((c) => (
                  <tr key={c.containerno} className="bg-white dark:bg-slate-800/60">
                    <td className="px-2.5 py-1.5 font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {c.containerno}
                      <span className="ml-1.5 font-semibold text-slate-400">{show(c.iso)}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <ValueBadge table="container" columnKey="event_type" value={c.event_type} fallbackText="—" />
                    </td>
                    <td className="px-2 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{show(c.event_time)}</td>
                    <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">{show(c.location)}</td>
                    <td className="px-2 py-1.5">
                      <ValueBadge table="container" columnKey="customs_status" value={c.customs_status} fallbackText="—" />
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      {c.gated_in && (
                        <span title={labels.gatedBadge} className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold whitespace-nowrap">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {labels.gatedBadge}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
