import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StickyNote } from 'lucide-react';

export const NOTE_KEY = 'Ghi chú';

/** The booking's note, or '' when empty / "null". */
export const getBookingNote = (booking: Record<string, unknown>): string => {
  const v = booking[NOTE_KEY];
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s.toLowerCase() === 'null' ? '' : s;
};

interface NoteHoverProps {
  note: string;
  title: string;
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

const CARD_W = 300;
const GAP = 6;

/**
 * Shows the booking note in a floating card while the pointer is over `children`.
 * Rendered in a portal with fixed positioning so the table's overflow never clips it.
 */
export const NoteHover: React.FC<NoteHoverProps> = ({ note, title, children, className = '', delay = 250 }) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(() => {
    if (!note) return;
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [note, delay]);
  const hide = useCallback(() => {
    clear();
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => clear, []);

  // Place below the anchor; flip above when there is no room; keep inside the viewport horizontally.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !cardRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const h = cardRef.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = a.bottom + GAP + h > vh && a.top - GAP - h > 0 ? a.top - GAP - h : a.bottom + GAP;
    const left = Math.max(8, Math.min(a.left, vw - CARD_W - 8));
    setPos({ top, left });
  }, [open, note]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [open, hide]);

  return (
    <span
      ref={anchorRef}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && note && createPortal(
        <div
          ref={cardRef}
          role="tooltip"
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: CARD_W, zIndex: 9999 }}
          className="pointer-events-none rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-slate-800 shadow-lg p-3 text-xs"
        >
          <div className="flex items-center gap-1.5 mb-1.5 font-semibold text-amber-700 dark:text-amber-400">
            <StickyNote className="w-3.5 h-3.5" />
            {title}
          </div>
          <div className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200 max-h-60 overflow-hidden leading-relaxed">
            {note}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
};
