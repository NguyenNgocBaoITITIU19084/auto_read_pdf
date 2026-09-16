import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MobileSession } from '../types';
import {
  startMobileSessionApi,
  getMobileSessionApi,
  stopMobileSessionApi,
  fetchMobilePhotoApi,
  ackMobilePhotoApi,
} from '../services/api';
import { useToastActions } from './ToastContext';
import { useApp } from './AppContext';

export type MobileBridgeStatus = 'idle' | 'starting' | 'active' | 'error';

export interface MobileBridgeValue {
  session: MobileSession | null;
  status: MobileBridgeStatus;
  /** Photos that have been fetched from the desktop-side buffer and are ready to consume. */
  queue: File[];
  start: (ip?: string) => Promise<void>;
  stop: () => Promise<void>;
  /** Pops the first queued File, acking it with the backend. Returns null if the queue is empty. */
  takeNext: () => File | null;
  /** Registers a callback fired once per NEW photo arriving into the queue. Returns an unsubscribe fn. */
  onPhotoArrived: (cb: () => void) => () => void;
}

const POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_FAILURES = 3;

const MobileBridgeContext = createContext<MobileBridgeValue | null>(null);

export const MobileBridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addToast } = useToastActions();
  const { t } = useApp();

  const [session, setSession] = useState<MobileSession | null>(null);
  const [status, setStatus] = useState<MobileBridgeStatus>('idle');
  const [queue, setQueue] = useState<File[]>([]);

  // Internal id<->File bookkeeping. Kept out of the public interface (brief: `queue: File[]`
  // carries no id), so `takeNext()` must consult this ref to know which id to ack.
  //
  // `queueEntriesRef` is the SYNCHRONOUS source of truth for what's actually queued right now.
  // `queue` state is only a rendering mirror derived from it via `syncQueueState()` — never
  // compute a return value by mutating a closure variable inside a `setQueue` updater, since
  // React does not guarantee that updater runs synchronously.
  const queueEntriesRef = useRef<{ id: string; file: File }[]>([]);
  const inFlightIdsRef = useRef<Set<string>>(new Set());
  const fetchedIdsRef = useRef<Set<string>>(new Set());
  const consecutiveFailuresRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listenersRef = useRef<Set<() => void>>(new Set());
  const tRef = useRef(t);
  tRef.current = t;
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  const syncQueueState = useCallback(() => {
    setQueue(queueEntriesRef.current.map((e) => e.file));
  }, []);

  const notifyPhotoArrived = useCallback(() => {
    listenersRef.current.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error('onPhotoArrived listener failed:', e);
      }
    });
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const handleExpired = useCallback(() => {
    stopPolling();
    setSession(null);
    setStatus('idle');
    queueEntriesRef.current = [];
    setQueue([]);
    inFlightIdsRef.current.clear();
    fetchedIdsRef.current.clear();
    consecutiveFailuresRef.current = 0;
    addToastRef.current(tRef.current.booking.phone.sessionExpired, 'info');
  }, [stopPolling]);

  const runPoll = useCallback(async () => {
    let latest: MobileSession;
    try {
      latest = await getMobileSessionApi();
    } catch (e) {
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setStatus('error');
      }
      return;
    }
    consecutiveFailuresRef.current = 0;

    if (!latest.active) {
      handleExpired();
      return;
    }

    setSession(latest);
    setStatus((prev) => (prev === 'error' ? 'active' : prev));

    const pending = latest.pending || [];
    for (const photo of pending) {
      if (fetchedIdsRef.current.has(photo.id) || inFlightIdsRef.current.has(photo.id)) {
        continue;
      }
      inFlightIdsRef.current.add(photo.id);
      fetchMobilePhotoApi(photo.id, photo.filename)
        .then((file) => {
          inFlightIdsRef.current.delete(photo.id);
          fetchedIdsRef.current.add(photo.id);
          queueEntriesRef.current = [...queueEntriesRef.current, { id: photo.id, file }];
          syncQueueState();
          notifyPhotoArrived();
        })
        .catch((e) => {
          inFlightIdsRef.current.delete(photo.id);
          console.error('Failed to fetch mobile photo:', photo.id, e);
        });
    }
  }, [handleExpired, notifyPhotoArrived, syncQueueState]);

  const beginPolling = useCallback(() => {
    stopPolling();
    consecutiveFailuresRef.current = 0;
    pollTimerRef.current = setInterval(() => {
      void runPoll();
    }, POLL_INTERVAL_MS);
  }, [runPoll, stopPolling]);

  const start = useCallback(async (ip?: string) => {
    setStatus('starting');
    try {
      const newSession = await startMobileSessionApi(ip);
      setSession(newSession);
      setStatus('active');
      beginPolling();
    } catch (e) {
      setStatus('idle');
      throw e;
    }
  }, [beginPolling]);

  const stop = useCallback(async () => {
    stopPolling();
    try {
      await stopMobileSessionApi();
    } finally {
      setSession(null);
      setStatus('idle');
      queueEntriesRef.current = [];
      setQueue([]);
      inFlightIdsRef.current.clear();
      fetchedIdsRef.current.clear();
      consecutiveFailuresRef.current = 0;
    }
  }, [stopPolling]);

  const takeNext = useCallback((): File | null => {
    const entry = queueEntriesRef.current[0];
    if (!entry) return null;
    queueEntriesRef.current = queueEntriesRef.current.slice(1);
    syncQueueState();
    ackMobilePhotoApi(entry.id).catch((e) => {
      console.error('Failed to ack mobile photo:', entry.id, e);
    });
    return entry.file;
  }, [syncQueueState]);

  const onPhotoArrived = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  // On mount, restore an already-active session (e.g. after an Electron renderer reload)
  // WITHOUT creating a new one — a single getMobileSessionApi() check only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await getMobileSessionApi();
        if (cancelled) return;
        if (existing.active) {
          setSession(existing);
          setStatus('active');
          beginPolling();
        }
      } catch (e) {
        // Stay idle; user can call start() explicitly.
        console.warn('Failed to check for an existing mobile session:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const value = useMemo<MobileBridgeValue>(() => ({
    session,
    status,
    queue,
    start,
    stop,
    takeNext,
    onPhotoArrived,
  }), [session, status, queue, start, stop, takeNext, onPhotoArrived]);

  return <MobileBridgeContext.Provider value={value}>{children}</MobileBridgeContext.Provider>;
};

export const useMobileBridge = (): MobileBridgeValue => {
  const ctx = useContext(MobileBridgeContext);
  if (!ctx) {
    throw new Error('useMobileBridge must be used within a MobileBridgeProvider');
  }
  return ctx;
};
