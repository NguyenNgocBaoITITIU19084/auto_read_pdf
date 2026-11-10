import React, { useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useNotifications } from '../../context/NotificationsContext';
import { useToastActions } from '../../context/ToastContext';
import { getNotificationBookingsApi } from '../../services/api';
import { copyTextToClipboard } from '../../utils/formatters';
import { isVesselChangeNotification, vesselChangeMessage } from '../../utils/vesselChangeMessage';
import type { Booking } from '../../types';
import { notificationChange, notificationChanges, notificationTitle } from '../../utils/notifications';
import { Modal } from './Modal';
import { CutoffReminderDetail, MorningBriefDetail, formatStamp } from './ReminderViews';
import { AutoImportDetail } from './AutoImportDetail';
import { VesselChangeList } from './VesselChangeList';
import type { TabId } from './Tabs';

interface Props {
  onNavigateTab: (tabId: TabId, searchKeyword?: string) => void;
}

/** Full content of one change notification, opened from the bell or a desktop popup. */
export const NotificationDetailModal: React.FC<Props> = ({ onNavigateTab }) => {
  const { t } = useApp();
  const d = t.notifications.detail;
  const { items, detailId, closeDetail } = useNotifications();
  const { addToast } = useToastActions();
  const [copying, setCopying] = useState(false);
  const item = detailId === null ? null : items.find((n) => n.id === detailId) || null;
  if (!item) return null;

  const info = item.detail || {};
  const r = t.notifications.reminder;
  const changes = notificationChanges(item, t);
  const isBrief = item.kind === 'morning_brief';
  const isCutoff = item.kind === 'booking_cutoff';
  const isAutoImport = item.kind === 'booking_auto_import';
  const isReminder = isBrief || isCutoff || isAutoImport;
  const rows: [string, string | undefined][] = [
    [d.vessel, isReminder ? undefined : info.vessel],
    [d.voyage, info.voyage],
    [d.container, info.container],
    [d.event, info.event_type],
    [d.bookings, !isReminder && info.bookings && info.bookings.length > 0 ? info.bookings.join(', ') : undefined],
    [d.source, isAutoImport ? undefined : item.source === 'auto_sync' ? t.notifications.sourceAuto : t.notifications.sourceManual],
    [d.time, formatStamp(item.created_at)],
  ];

  const canCopy = isVesselChangeNotification(item) && (changes.length > 0 || !!item.old_value);
  const m = t.notifications.message;
  /** The schedule-change message with the open bookings on the voyage, ready to paste into Zalo. Without the
   *  bookings (an older backend, offline) it still copies, listing the numbers kept in the notification. */
  const copyMessage = async () => {
    setCopying(true);
    let bookings: Booking[] | null = null;
    try {
      bookings = await getNotificationBookingsApi(item.id);
    } catch {
      bookings = null;
    }
    const ok = await copyTextToClipboard(vesselChangeMessage(item, bookings, t));
    setCopying(false);
    if (!ok) addToast(m.copyFailed, 'error');
    else addToast(bookings ? m.copied : m.copiedNumbersOnly, bookings ? 'success' : 'info');
  };

  const goToTab = () => {
    closeDetail();
    if (item.nav_tab) onNavigateTab(item.nav_tab, item.nav_query || undefined);
  };

  return (
    <Modal isOpen onClose={closeDetail} title={d.title} maxWidth={changes.length > 0 || isBrief ? "max-w-xl" : "max-w-md"}>
      <div className="space-y-4" data-testid="notification-detail">
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{notificationTitle(item, t)}</h4>
          {isBrief && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{r.allCollections}</p>}
        </div>

        {isBrief ? (
          <MorningBriefDetail item={item} />
        ) : isCutoff ? (
          <CutoffReminderDetail item={item} />
        ) : isAutoImport ? (
          <AutoImportDetail item={item} />
        ) : changes.length > 0 ? (
          <VesselChangeList item={item} variant="full" />
        ) : item.old_value ? (
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
              <div className="text-[10px] font-sans uppercase text-slate-400 mb-1">{d.before}</div>
              <div className="text-slate-600 dark:text-slate-300 line-through decoration-slate-400">{item.old_value}</div>
            </div>
            <div className="rounded-lg border border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-950/20 p-2.5">
              <div className="text-[10px] font-sans uppercase text-primary-600 dark:text-primary-400 mb-1">{d.after}</div>
              <div className="font-bold text-slate-900 dark:text-slate-100">{item.new_value}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 text-xs">
            <div className="text-[10px] uppercase text-slate-400 mb-1">{d.value}</div>
            <div className="font-mono font-bold text-slate-900 dark:text-slate-100" title={notificationChange(item)}>{item.new_value}</div>
          </div>
        )}

        <dl className={`grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-xs ${isReminder ? 'pt-3 border-t border-slate-100 dark:border-slate-800' : ''}`}>
          {rows.filter(([, value]) => value).map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200 break-words">{value}</dd>
            </React.Fragment>
          ))}
        </dl>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {isBrief && (
            <button
              type="button"
              onClick={() => {
                closeDetail();
                onNavigateTab('tasks');
              }}
              className="mr-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/40 hover:bg-primary-100 dark:hover:bg-primary-900/50"
            >
              <Copy className="w-3.5 h-3.5" />
              {t.booking.tasks.openFromBrief}
            </button>
          )}
          {canCopy && (
            <button
              type="button"
              onClick={copyMessage}
              disabled={copying}
              title={m.copyHint}
              className="mr-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/40 hover:bg-primary-100 dark:hover:bg-primary-900/50 disabled:opacity-60"
            >
              {copying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
              {m.copy}
            </button>
          )}
          <button type="button" onClick={closeDetail} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            {d.close}
          </button>
          {item.nav_tab && (
            <button type="button" onClick={goToTab} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white">
              {item.nav_tab === 'vessel' ? d.openVessel : item.nav_tab === 'booking' ? d.openBooking : d.openContainer}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

