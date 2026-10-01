import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { useToastActions } from './ToastContext';
import { extractContainerImageApi } from '../services/api';
import { tf } from '../services/i18nFormat';
import { isImageFile } from '../components/booking/clipboard';
import {
  ContainerFields, ContainerQueueItem, containerQueueReducer, containerQueueStats, dedupeContainerFiles,
  duplicateContainerIds, makeContainerQueueItem,
} from '../services/containerImageQueueLogic';

export const MAX_CONTAINER_QUEUE_ITEMS = 40;

/** Why the queue stopped by itself: Gemini says to wait / fix the key, so the rest is not silently read by offline OCR */
export type ContainerPauseReason = 'user' | 'quota' | 'invalid_key' | 'unavailable' | null;

export interface ContainerImageQueueValue {
  items: ContainerQueueItem[];
  stats: ReturnType<typeof containerQueueStats>;
  paused: ContainerPauseReason;
  room: number;
  /** Items showing a container number already read from an earlier photo */
  duplicates: Set<number>;
  enqueue: (files: File[]) => number;
  pause: () => void;
  resume: () => void;
  retry: (id: number) => void;
  retryFailed: () => void;
  remove: (id: number) => void;
  clearUsed: () => void;
  setField: (id: number, field: keyof ContainerFields, value: string) => void;
  markUsed: (ids: number[]) => void;
  setSaving: (id: number, saving: boolean) => void;
}

const Ctx = createContext<ContainerImageQueueValue | null>(null);

/** App-wide batch queue that reads container photos one at a time (so it keeps going when the user changes tab). */
export const ContainerImageQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const [items, dispatch] = useReducer(containerQueueReducer, [] as ContainerQueueItem[]);
  const [paused, setPaused] = useState<ContainerPauseReason>(null);
  const [tick, setTick] = useState(0);
  const processingRef = useRef(false);
  /** id -> run number of the last read we started. A render that has not yet seen our own 'start' / 'done' still lists the item as queued; comparing runs keeps it from being read twice. */
  const startedRunRef = useRef(new Map<number, number>());
  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(addToast);
  toastRef.current = addToast;

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (paused || processingRef.current) return;
    const next = items.find((i) => i.status === 'queued' && i.run === (startedRunRef.current.get(i.id) ?? 0));
    if (!next) return;
    processingRef.current = true;
    const run = next.run + 1;
    startedRunRef.current.set(next.id, run);
    dispatch({ type: 'start', id: next.id });
    const controller = new AbortController();
    abortRef.current = controller;
    (async () => {
      try {
        const result = await extractContainerImageApi(next.file, undefined, controller.signal);
        const kind = result.gemini_error_kind;
        if (kind === 'quota' || kind === 'invalid_key' || kind === 'unavailable') {
          dispatch({ type: 'requeue', id: next.id });
          setPaused(kind);
          return;
        }
        dispatch({ type: 'done', id: next.id, run, result });
      } catch (e: any) {
        if (controller.signal.aborted) return;
        const detail = e?.response?.data?.detail;
        dispatch({ type: 'fail', id: next.id, run, error: typeof detail === 'string' ? detail : e?.message || '' });
      } finally {
        processingRef.current = false;
        setTick((n) => n + 1);
      }
    })();
  }, [items, paused, tick]);

  const enqueue = useCallback((files: File[]) => {
    const images = files.filter(isImageFile);
    if (images.length === 0) return 0;
    const { fresh, skipped } = dedupeContainerFiles(images, itemsRef.current);
    const room = Math.max(0, MAX_CONTAINER_QUEUE_ITEMS - itemsRef.current.length);
    const accepted = fresh.slice(0, room);
    const L = tRef.current.container.imageOcr;
    if (skipped > 0) toastRef.current(tf(L.duplicatesSkipped, { count: skipped }), 'info');
    if (fresh.length > room) toastRef.current(tf(L.tooMany, { max: MAX_CONTAINER_QUEUE_ITEMS, count: fresh.length - room }), 'error');
    if (accepted.length > 0) {
      dispatch({ type: 'add', items: accepted.map(makeContainerQueueItem) });
      setPaused((p) => (p === 'user' ? p : null));
    }
    return accepted.length;
  }, []);

  const value = useMemo<ContainerImageQueueValue>(() => ({
    items,
    stats: containerQueueStats(items),
    paused,
    room: Math.max(0, MAX_CONTAINER_QUEUE_ITEMS - items.length),
    duplicates: duplicateContainerIds(items),
    enqueue,
    pause: () => setPaused('user'),
    resume: () => setPaused(null),
    retry: (id) => { dispatch({ type: 'retry', id }); setPaused((p) => (p === 'user' ? p : null)); },
    retryFailed: () => { dispatch({ type: 'retryFailed' }); setPaused((p) => (p === 'user' ? p : null)); },
    remove: (id) => dispatch({ type: 'remove', id }),
    clearUsed: () => dispatch({ type: 'clearUsed' }),
    setField: (id, field, val) => dispatch({ type: 'setField', id, field, value: val }),
    markUsed: (ids) => dispatch({ type: 'used', ids }),
    setSaving: (id, saving) => dispatch({ type: 'saving', id, saving }),
  }), [items, paused, enqueue]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useContainerImageQueue = (): ContainerImageQueueValue => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useContainerImageQueue must be used within a ContainerImageQueueProvider');
  return ctx;
};
