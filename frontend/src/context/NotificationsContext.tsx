import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { useToastActions } from './ToastContext';
import { AppNotification } from '../types';
import { clearNotificationsApi, getNotificationsApi, markNotificationsReadApi } from '../services/api';
import { tf } from '../services/i18nFormat';
import { notificationTitle } from '../utils/notifications';
import { getNotificationVoiceRepeatMin, playNotificationVoice } from '../utils/notificationVoice';

export const POLL_MS = 20000;
/** How often the voice reminder checks whether it is due. */
const REMIND_CHECK_MS = 30000;
/** Up to this many new changes get their own toast; more are folded into one. */
const MAX_INDIVIDUAL_TOASTS = 3;

export interface NotificationsValue {
  items: AppNotification[];
  unread: number;
  refresh: () => Promise<void>;
  markRead: (ids: number[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearRead: () => Promise<void>;
  /** The notification shown in the detail dialog (null = closed) */
  detailId: number | null;
  /** Opens the detail dialog and marks the notification read */
  openDetail: (id: number) => void;
  closeDetail: () => void;
  /** Goes up whenever the folder auto-import added bookings (null until the first poll) */
  autoImportSeq: number | null;
  /** Goes up whenever bookings may have met new ePort vessel schedules (null until the first poll) */
  bookingLinksSeq: number | null;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

/**
 * Change notifications (vessel times / container events) recorded by the backend.
 * Polls while the window is visible and right after each auto-sync run; the first load never toasts.
 */
export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, autoSyncStatus } = useApp();
  const { addToast } = useToastActions();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [autoImportSeq, setAutoImportSeq] = useState<number | null>(null);
  const [bookingLinksSeq, setBookingLinksSeq] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const tRef = useRef(t);
  tRef.current = t;
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  /** Highest id already shown; null until the first load so existing notifications don't toast on startup */
  const seenMaxRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  /** Highest id the voice has announced: the toast path and the desktop app's batch path must not both speak */
  const spokenMaxRef = useRef(0);
  /** When the voice last spoke: the next reminder for unread notifications counts from here */
  const spokenAtRef = useRef(Date.now());
  const announce = useCallback((ids: number[]) => {
    const max = Math.max(0, ...ids);
    if (max <= spokenMaxRef.current) return;
    spokenMaxRef.current = max;
    spokenAtRef.current = Date.now();
    playNotificationVoice();
  }, []);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await getNotificationsApi(50);
      if (!mountedRef.current) return;
      setItems(res.items);
      setUnread(res.unread);
      setAutoImportSeq(res.auto_import_seq ?? 0);
      setBookingLinksSeq(res.booking_links_seq ?? 0);
      const maxId = res.items.reduce((m, n) => Math.max(m, n.id), 0);
      const seen = seenMaxRef.current;
      if (seen !== null && document.visibilityState === 'visible') {
        const fresh = res.items.filter((n) => n.id > seen && !n.read).sort((a, b) => a.id - b.id);
        if (fresh.length > MAX_INDIVIDUAL_TOASTS) {
          addToastRef.current(tf(tRef.current.notifications.toastMany, { count: fresh.length }), 'info');
        } else {
          fresh.forEach((n) => addToastRef.current(notificationTitle(n, tRef.current), 'info'));
        }
        if (fresh.length) announce(fresh.map((n) => n.id));
      }
      seenMaxRef.current = Math.max(seen ?? 0, maxId);
      if (seen === null) spokenMaxRef.current = Math.max(spokenMaxRef.current, maxId); // nothing old is announced on startup
    } catch {
      /* the backend may be starting up or busy: the next poll retries, no error spam */
    } finally {
      inFlightRef.current = false;
    }
  }, [announce]);

  // Poll only while the window is visible
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer || document.visibilityState !== 'visible') return;
      void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  // A finished auto-sync cycle is when new changes appear
  const lastRunAt = autoSyncStatus?.last_run_at;
  const seenRunRef = useRef(lastRunAt);
  useEffect(() => {
    if (lastRunAt === seenRunRef.current) return;
    seenRunRef.current = lastRunAt;
    void refresh();
  }, [lastRunAt, refresh]);

  // The desktop app tells us when it has shown a popup / the user clicked one
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onNotificationsChanged) return;
    return api.onNotificationsChanged(() => void refresh());
  }, [refresh]);

  // ...and when it has claimed a new batch (the only path while the window is hidden), say "Có thông báo mới"
  useEffect(() => window.electronAPI?.onNotificationVoice?.(announce), [announce]);

  // Keep saying "Có thông báo mới" every few minutes until nothing is unread (the interval is a setting; 0 = off)
  const hasUnread = unread > 0;
  useEffect(() => {
    if (!hasUnread) return;
    spokenAtRef.current = Math.max(spokenAtRef.current, Date.now() - REMIND_CHECK_MS); // never nag the moment it turns unread
    const timer = setInterval(() => {
      const minutes = getNotificationVoiceRepeatMin();
      if (!minutes || Date.now() - spokenAtRef.current < minutes * 60000) return;
      spokenAtRef.current = Date.now();
      playNotificationVoice();
    }, REMIND_CHECK_MS);
    return () => clearInterval(timer);
  }, [hasUnread]);

  const markRead = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    setItems((prev) => prev.map((n) => (set.has(n.id) ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - ids.length));
    try {
      await markNotificationsReadApi(ids);
    } finally {
      void refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await markNotificationsReadApi();
    } finally {
      void refresh();
    }
  }, [refresh]);

  const clearRead = useCallback(async () => {
    await clearNotificationsApi(true);
    await refresh();
  }, [refresh]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const openDetail = useCallback((id: number) => {
    setDetailId(id);
    const item = itemsRef.current.find((n) => n.id === id);
    if (item && !item.read) void markRead([id]);
  }, [markRead]);
  const closeDetail = useCallback(() => setDetailId(null), []);

  const value = useMemo<NotificationsValue>(
    () => ({
      items, unread, refresh, markRead, markAllRead, clearRead, detailId, openDetail, closeDetail, autoImportSeq, bookingLinksSeq,
    }),
    [items, unread, refresh, markRead, markAllRead, clearRead, detailId, openDetail, closeDetail, autoImportSeq, bookingLinksSeq]
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = (): NotificationsValue => {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within a NotificationsProvider');
  return ctx;
};
