import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { Modal } from '../common/Modal';
import { BOOKING_STATUSES, BookingStatus } from '../../types';

export const STATUS_KEY = 'Trạng thái';
export const OVERDUE_KEY = 'Trễ cut-off';

export interface BookingStatusLabels {
  labels: Record<BookingStatus, string>;
  overdue: string;
  overdueTooltip: string;
}

interface StatusStyle {
  /** pill background, text and border */
  pill: string;
  /** the colour dot */
  dot: string;
}

const STATUS_STYLE: Record<BookingStatus, StatusStyle> = {
  new: {
    pill: 'bg-white text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-600',
    dot: 'bg-slate-400',
  },
  dispatched: {
    pill: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800',
    dot: 'bg-sky-500',
  },
  stuffed: {
    pill: 'bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-200 dark:border-violet-800',
    dot: 'bg-violet-500',
  },
  gated_in: {
    pill: 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/60 dark:text-teal-200 dark:border-teal-800',
    dot: 'bg-teal-500',
  },
  done: {
    pill: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800',
    dot: 'bg-emerald-500',
  },
  cancelled: {
    pill: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
    dot: 'bg-rose-400',
  },
};

export const statusOf = (value: unknown): BookingStatus =>
  (BOOKING_STATUSES as readonly string[]).includes(String(value)) ? (value as BookingStatus) : 'new';

const Dot: React.FC<{ status: BookingStatus }> = ({ status }) => (
  <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${STATUS_STYLE[status].dot}`} />
);

const MENU_WIDTH = 210;
const MARGIN = 8;

/** The status cell: a pill button that opens a menu of every status. */
export const BookingStatusCell: React.FC<{
  status: unknown;
  labels: BookingStatusLabels;
  onChange: (status: BookingStatus) => void;
}> = ({ status, labels, onChange }) => {
  const current = statusOf(status);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Below the pill, flipped above when there is no room, and kept inside the window
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const h = menuRef.current?.offsetHeight ?? 240;
    const left = Math.min(Math.max(MARGIN, r.left), window.innerWidth - MENU_WIDTH - MARGIN);
    const below = r.bottom + 4;
    const top = below + h > window.innerHeight - MARGIN ? Math.max(MARGIN, r.top - h - 4) : below;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const pick = (s: BookingStatus) => {
    setOpen(false);
    if (s !== current) onChange(s);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={labels.labels[current]}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className={`w-full max-w-full inline-flex items-center gap-1.5 rounded-full border pl-2 pr-1.5 py-0.5 text-[11px] font-semibold transition-shadow hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${STATUS_STYLE[current].pill}`}
      >
        <Dot status={current} />
        <span className="flex-1 min-w-0 truncate text-left">{labels.labels[current]}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: MENU_WIDTH }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[1000] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1 text-xs"
          >
            {BOOKING_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="menuitemradio"
                aria-checked={s === current}
                onClick={() => pick(s)}
                className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  s === current ? 'bg-slate-50 dark:bg-slate-800/70' : ''
                }`}
              >
                <Dot status={s} />
                <span className="flex-1">{labels.labels[s]}</span>
                {s === current && <Check className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

/** Warning icon beside a cut-off that has passed while the booking is still open. */
export const OverdueMark: React.FC<{ labels: BookingStatusLabels }> = ({ labels }) => (
  <span
    title={labels.overdueTooltip}
    aria-label={labels.overdue}
    className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-rose-100 dark:bg-rose-950/70 px-1.5 text-[10px] font-bold text-rose-700 dark:text-rose-300"
  >
    <AlertTriangle className="w-3 h-3" />
    {labels.overdue}
  </span>
);

/** Pick one status for the selected bookings. */
export const BookingStatusPicker: React.FC<{
  isOpen: boolean;
  title: string;
  hint: string;
  labels: BookingStatusLabels;
  onPick: (status: BookingStatus) => void;
  onClose: () => void;
}> = ({ isOpen, title, hint, labels, onPick, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="max-w-sm">
    <div className="flex flex-col gap-1.5">
      {BOOKING_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className={`w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold hover:shadow-sm transition-shadow ${STATUS_STYLE[s].pill}`}
        >
          <Dot status={s} />
          {labels.labels[s]}
        </button>
      ))}
      <p className="pt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  </Modal>
);
