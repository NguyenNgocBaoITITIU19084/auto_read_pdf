import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

const MENU_HEIGHT_GUESS = 200;

/** "⋯" button with a small menu of a row's less common actions. The menu is fixed-positioned so the scrolling table
 *  never clips it; it opens upward near the bottom of the window and closes on Escape, a click outside or a scroll. */
export const RowMenu: React.FC<{ label: string; items: RowMenuItem[] }> = ({ label, items }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const shown = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    setPos(r.bottom + MENU_HEIGHT_GUESS > window.innerHeight
      ? { position: 'fixed', bottom: window.innerHeight - r.top + 4, right }
      : { position: 'fixed', top: r.bottom + 4, right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button ref={button} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`p-1.5 rounded-md transition-colors ${open ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
          : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} style={pos}
          className="z-50 min-w-[11rem] py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
          {shown.map((item) => (
            <button key={item.label} type="button" role="menuitem"
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm focus:outline-none ${item.danger
                ? 'text-rose-600 hover:bg-rose-50 focus:bg-rose-50 dark:hover:bg-rose-950/30 dark:focus:bg-rose-950/30'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 focus:bg-slate-50 dark:hover:bg-slate-800 dark:focus:bg-slate-800'}`}>
              <span className="w-4 h-4 shrink-0 flex items-center justify-center opacity-80">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
};
