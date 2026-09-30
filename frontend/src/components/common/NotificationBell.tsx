import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Box, CheckCheck, Clock, LogIn, LogOut, Ship, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useNotifications } from '../../context/NotificationsContext';
import { AppNotification, NotificationKind } from '../../types';
import { formatTimeAgo } from '../../utils/formatters';
import { notificationChange, notificationTitle } from '../../utils/notifications';
import { tf } from '../../services/i18nFormat';
import { Tooltip } from './Tooltip';
import type { TabId } from './Tabs';

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  container_customs: <ShieldCheck className="w-4 h-4" />,
  container_ingate: <LogIn className="w-4 h-4" />,
  container_outgate: <LogOut className="w-4 h-4" />,
  vessel_closing: <Ship className="w-4 h-4" />,
  vessel_closing_icd: <Ship className="w-4 h-4" />,
  vessel_open_gate: <Ship className="w-4 h-4" />,
  vessel_eta: <Clock className="w-4 h-4" />,
  vessel_etd: <Clock className="w-4 h-4" />,
  test: <Bell className="w-4 h-4" />,
};

interface BellProps {
  onNavigateTab?: (tabId: TabId, searchKeyword?: string) => void;
}

/** Header bell: unread badge + a panel with the latest vessel / container changes. */
export const NotificationBell: React.FC<BellProps> = ({ onNavigateTab }) => {
  const { t } = useApp();
  const n = t.notifications;
  const { items, unread, markRead, markAllRead, clearRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openItem = (item: AppNotification) => {
    if (!item.read) void markRead([item.id]);
    setOpen(false);
    if (item.nav_tab && onNavigateTab) onNavigateTab(item.nav_tab, item.nav_query || undefined);
  };

  const hasRead = items.some((i) => i.read);
  const badge = unread > 99 ? '99+' : String(unread);

  return (
    <div ref={rootRef} data-tour="notifications" className="relative">
      <Tooltip content={unread > 0 ? `${n.bell} · ${tf(n.unread, { count: unread })}` : n.bell} position="bottom">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={n.bell}
          aria-expanded={open}
          className="relative p-1.5 text-slate-600 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span
              data-testid="notification-badge"
              className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center tabular-nums"
            >
              {badge}
            </span>
          )}
        </button>
      </Tooltip>

      {open && (
        <div
          role="dialog"
          aria-label={n.title}
          className="absolute right-0 top-full mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] z-50 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl shadow-slate-900/20 overflow-hidden"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
              {n.title}
              {unread > 0 && <span className="ml-1.5 font-semibold text-rose-600 dark:text-rose-400">{tf(n.unread, { count: unread })}</span>}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={unread === 0}
                onClick={() => void markAllRead()}
                title={n.markAllRead}
                aria-label={n.markAllRead}
                className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={!hasRead}
                onClick={() => void clearRead()}
                title={n.clearRead}
                aria-label={n.clearRead}
                className="p-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                <BellOff className="w-7 h-7 mx-auto mb-2 opacity-50" />
                <p className="text-xs font-semibold">{n.empty}</p>
                <p className="text-[11px] mt-1">{n.emptyHint}</p>
              </div>
            ) : (
              <ul>
                {items.map((item) => {
                  const bookings = item.detail?.bookings || [];
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openItem(item)}
                        className={`w-full flex gap-2.5 px-3 py-2.5 text-left border-b border-slate-100 dark:border-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${
                          item.read ? '' : 'bg-primary-50/50 dark:bg-primary-950/20'
                        }`}
                      >
                        <span
                          className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            item.kind.startsWith('container_')
                              ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400'
                              : 'bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400'
                          }`}
                        >
                          {KIND_ICON[item.kind] || <Box className="w-4 h-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start gap-1.5">
                            <span className={`text-xs leading-snug ${item.read ? 'font-medium text-slate-600 dark:text-slate-300' : 'font-bold text-slate-900 dark:text-slate-100'}`}>
                              {notificationTitle(item, t)}
                            </span>
                            {!item.read && <span aria-label="unread" className="mt-1 w-2 h-2 rounded-full bg-primary-500 shrink-0" />}
                          </span>
                          <span className="block text-[11px] font-mono text-slate-600 dark:text-slate-300 mt-0.5">{notificationChange(item)}</span>
                          {bookings.length > 0 && (
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{tf(n.bookings, { list: bookings.join(', ') })}</span>
                          )}
                          <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                            {formatTimeAgo(item.created_at)} · {item.source === 'auto_sync' ? n.sourceAuto : n.sourceManual}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
