import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, IdCard, Phone, User } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';
import { formatIsoDate, grossWeightMissing, licenseExpired, licenseNeeded, type LicenceTarget } from './fleetUtils';

const CARD_W = 300;
const GAP = 6;
const SHOW_DELAY = 80;
const HIDE_DELAY = 150;

export interface LicenceWarnDriver {
  name: string;
  phone?: string;
  license_class: string;
  license_no?: string;
  license_expiry?: string;
}

interface Props {
  driver: LicenceWarnDriver;
  /** the truck they are on, which their licence may not drive */
  plate: string;
  vehicle: LicenceTarget;
}

/** A red warning by a driver on a truck their licence may not drive. Hovering (or focusing) it shows what is wrong,
 *  who the driver is (name, phone, licence) and what to do, in a card kept out of the table's overflow. */
export const LicenceWarn: React.FC<Props> = ({ driver, plate, vehicle }) => {
  const { t } = useApp();
  const L = t.fleet.licence;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const show = () => later(() => setOpen(true), SHOW_DELAY);
  const hide = () => later(() => { setOpen(false); setPos(null); }, HIDE_DELAY);

  // under the icon, or above it when there is no room below; kept inside the window
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !cardRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const h = cardRef.current.offsetHeight;
    const top = a.bottom + GAP + h > window.innerHeight && a.top - GAP - h > 0 ? a.top - GAP - h : a.bottom + GAP;
    const left = Math.max(8, Math.min(a.left - 12, window.innerWidth - CARD_W - 8));
    setPos({ top, left });
  }, [open]);

  const classes = licenseNeeded(vehicle);
  const kind = vehicle.category === 'truck' ? L.kindTruck : L.kindTractor;
  const problem = tf(L.problem, { kind, plate, classes });
  const expired = !!driver.license_expiry && licenseExpired({ license_expiry: driver.license_expiry });
  const row = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <span className="w-16 shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
      <span className="min-w-0 font-medium text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );

  return (
    <span ref={anchorRef} tabIndex={0} role="img" aria-label={`${L.title}: ${problem}`} data-testid="licence-warn"
      onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      className="inline-flex text-rose-600 dark:text-rose-400 cursor-help rounded focus:outline-none focus:ring-2 focus:ring-rose-400/50">
      <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
      {open && createPortal(
        <div ref={cardRef} role="tooltip" data-testid="licence-card" onMouseEnter={show} onMouseLeave={hide}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: CARD_W, zIndex: 9999 }}
          className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 shadow-xl text-xs overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />{L.title}
          </div>
          <div className="px-3 py-2.5 space-y-2.5">
            <p className="text-slate-700 dark:text-slate-200 leading-relaxed">{problem}</p>
            <div className="space-y-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2.5">
              {row(<User className="w-3.5 h-3.5" />, L.driver, driver.name)}
              {row(<Phone className="w-3.5 h-3.5" />, L.phone, driver.phone || <span className="text-slate-400">{t.fleet.none}</span>)}
              {row(<IdCard className="w-3.5 h-3.5" />, L.licence, (
                <span className="space-y-0.5 block">
                  <span className="block">
                    {L.class}{' '}
                    <span className="text-rose-600 dark:text-rose-400 font-bold">{driver.license_class || L.none}</span>
                    <span className="text-slate-500 dark:text-slate-400"> · {tf(L.needsShort, { classes })}</span>
                  </span>
                  {driver.license_no && <span className="block">{tf(L.number, { no: driver.license_no })}</span>}
                  {driver.license_expiry && (
                    <span className={`block ${expired ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                      {tf(expired ? L.expired : L.until, { date: formatIsoDate(driver.license_expiry) })}
                    </span>
                  )}
                </span>
              ))}
            </div>
            {grossWeightMissing(vehicle) && (
              <p className="text-amber-700 dark:text-amber-300 leading-relaxed">{L.noWeight}</p>
            )}
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">{tf(L.fix, { classes })}</p>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
};
