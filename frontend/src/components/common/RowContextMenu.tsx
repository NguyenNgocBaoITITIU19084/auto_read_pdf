import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import type { BulkAction } from './BulkActionBar';

export interface MenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}

export interface MenuGroup {
  /** Small caption above the group (e.g. "3 rows selected") */
  label?: string;
  items: MenuItem[];
}

/** State of an open row menu: where it was opened and for which row. */
export interface RowMenuState<T> {
  x: number;
  y: number;
  row: T;
}

/** Open/close state for a table's context menu. */
export function useRowContextMenu<T>() {
  const [state, setState] = useState<RowMenuState<T> | null>(null);
  const open = useCallback((row: T, x: number, y: number) => setState({ x, y, row }), []);
  const close = useCallback(() => setState(null), []);
  return { state, open, close };
}

/**
 * The tab's bulk actions as menu items. When only the clicked row is selected, its own
 * "copy" / "delete" entries (added by the caller) replace the bulk ones so they don't appear twice.
 */
export function bulkMenuItems(actions: BulkAction[], selectedCount: number, alsoRowLevel = ['copy', 'delete']): MenuItem[] {
  return actions.filter((a) => selectedCount !== 1 || !alsoRowLevel.includes(a.key));
}

interface RowContextMenuProps {
  /** null = closed */
  position: { x: number; y: number } | null;
  groups: MenuGroup[];
  onClose: () => void;
}

const MARGIN = 8;

/** Right-click menu for a table row, drawn in a portal and kept inside the window. */
export const RowContextMenu: React.FC<RowContextMenuProps> = ({ position, groups, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Keep the menu on screen (measured before paint so it never flashes in the wrong place)
  useLayoutEffect(() => {
    if (!position) {
      setPos(null);
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    const w = rect?.width ?? 0;
    const h = rect?.height ?? 0;
    setPos({
      left: Math.max(MARGIN, Math.min(position.x, window.innerWidth - w - MARGIN)),
      top: Math.max(MARGIN, Math.min(position.y, window.innerHeight - h - MARGIN)),
    });
  }, [position, groups.length]);

  // Focus the first item once the menu is placed and visible (a hidden element can't take focus)
  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [placed]);

  useEffect(() => {
    if (!position) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    // Scrolling the table (capture: it doesn't bubble), resizing or leaving the window closes it too
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [position, onClose]);

  if (!position) return null;
  const visibleGroups = groups.filter((g) => g.items.length > 0);

  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = at <= 0 ? items.length - 1 : at - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
      return;
    }
    if (next !== null) {
      e.preventDefault();
      items[next].focus();
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onKeyDown={move}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? position.x, top: pos?.top ?? position.y, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[60] min-w-52 max-w-72 max-h-[calc(100vh-16px)] overflow-y-auto py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl shadow-slate-900/20 select-none"
    >
      {visibleGroups.map((group, gi) => (
        <div key={gi} role="group" className={gi > 0 ? 'mt-1 pt-1 border-t border-slate-100 dark:border-slate-800' : ''}>
          {group.label && (
            <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {group.label}
            </div>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                title={item.title}
                disabled={item.disabled || item.loading}
                onClick={() => {
                  onClose();
                  item.onClick();
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs font-medium transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
                  item.danger
                    ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus:bg-rose-50 dark:focus:bg-rose-950/40'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800'
                }`}
              >
                {item.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Icon className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body
  );
};
