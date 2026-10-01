import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import { useApp } from './AppContext';
import { useToastActions } from './ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { checkBookingDuplicatesApi, extractBookingImageDetailedApi, saveManualBookingApi } from '../services/api';
import { tf } from '../services/i18nFormat';
import { isImageFile, isPdfFile } from '../components/booking/clipboard';
import {
  QueueItem, QueueSource, QueueStats, batchDuplicateIds, bookingKey, dedupeIncoming, isPdfItem, makeQueueItem, queueReducer, queueStats,
} from '../services/imageQueueLogic';

export const MAX_QUEUE_ITEMS = 60;

/** Google-side overload answers (503) get one more try after this pause before the queue stops. Mutable for tests. */
export const RETRY_DELAYS = { transientMs: 4000 };

/** Why the worker stopped by itself */
export type PauseReason = 'user' | 'quota' | 'invalid_key' | 'unavailable';

export interface EnqueueResult {
  ids: string[];
  added: number;
  duplicates: number;
  rejected: number;
}

export interface ImageQueueValue {
  items: QueueItem[];
  stats: QueueStats;
  paused: PauseReason | null;
  /** How many more images the queue can take */
  room: number;
  /** Items repeating an earlier Booking No of the batch */
  batchDuplicates: ReadonlySet<string>;
  /** "no_key" once an image was read without a Gemini key (offline OCR) */
  geminiIssue: 'no_key' | null;
  /** Bumped after every booking saved from the queue; `lastSaved` says where. */
  savedVersion: number;
  lastSaved: { collectionId: number; bookingId: number } | null;
  enqueue: (files: File[], source: QueueSource) => EnqueueResult;
  pause: () => void;
  resume: () => void;
  retry: (id: string) => void;
  retryFailed: () => void;
  remove: (id: string) => void;
  clearSaved: () => void;
  setField: (id: string, key: string, value: string) => void;
  /** Saves one item; asks first when its Booking No is a duplicate. Resolves true when saved. */
  save: (id: string) => Promise<boolean>;
  saveAllSuccessful: () => Promise<void>;
}

const ImageQueueContext = createContext<ImageQueueValue | null>(null);

const isCancel = (e: any) => e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError';

export const ImageQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, activeCollection } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();

  const [items, dispatch] = useReducer(queueReducer, [] as QueueItem[]);
  const [paused, setPaused] = useState<PauseReason | null>(null);
  const [tick, setTick] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [lastSaved, setLastSaved] = useState<ImageQueueValue['lastSaved']>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const tRef = useRef(t);
  tRef.current = t;
  const activeCollectionRef = useRef(activeCollection);
  activeCollectionRef.current = activeCollection;
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  const processingRef = useRef(false);
  const controllersRef = useRef(new Map<string, AbortController>());
  const transientRetriesRef = useRef(new Map<string, number>());
  const dupTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((c) => c.abort());
      dupTimersRef.current.forEach((h) => clearTimeout(h));
    };
  }, []);

  // ---- duplicate check against the target collection ------------------------------------------
  const checkDbDuplicate = useCallback(async (id: string, collectionId: number, fields: QueueItem['fields']) => {
    const key = bookingKey(fields);
    if (!key) {
      dispatch({ type: 'setDbDuplicate', id, value: false });
      return;
    }
    try {
      const existing = await checkBookingDuplicatesApi(collectionId, [String(fields['Booking No']).trim()]);
      if (mountedRef.current) dispatch({ type: 'setDbDuplicate', id, value: existing.length > 0 });
    } catch {
      /* the check is advisory: manual-save still warns */
    }
  }, []);

  // ---- worker: one image at a time -------------------------------------------------------------
  const runItem = useCallback(async (item: QueueItem) => {
    const controller = new AbortController();
    controllersRef.current.set(item.id, controller);
    const started = performance.now();
    try {
      const result = await extractBookingImageDetailedApi(item.file, undefined, controller.signal);
      const readMs = Math.round(performance.now() - started);
      if (!mountedRef.current) return;
      const kind = result.gemini_error_kind;
      if (kind === 'quota' || kind === 'invalid_key') {
        // Gemini was refused: the backend fell back to offline OCR, which would quietly degrade the rest of
        // the batch. Keep this image for later and stop instead.
        dispatch({ type: 'requeue', id: item.id });
        setPaused(kind);
        return;
      }
      if (kind === 'unavailable') {
        // Google is overloaded (503): usually gone in seconds. Try this image once more, then stop the queue
        // rather than accept a weaker offline-OCR reading.
        dispatch({ type: 'requeue', id: item.id });
        const tries = transientRetriesRef.current.get(item.id) ?? 0;
        if (tries < 1) {
          transientRetriesRef.current.set(item.id, tries + 1);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, RETRY_DELAYS.transientMs);
            controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
          });
        } else {
          transientRetriesRef.current.delete(item.id);
          setPaused('unavailable');
        }
        return;
      }
      transientRetriesRef.current.delete(item.id);
      dispatch({ type: 'done', id: item.id, run: item.run, result, readMs });
      const no = result.data?.['Booking No'];
      if (no && String(no).trim() && String(no).trim().toLowerCase() !== 'null') {
        void checkDbDuplicate(item.id, item.collectionId, { 'Booking No': String(no) });
      }
    } catch (e: any) {
      if (isCancel(e) || !mountedRef.current) return;
      const detail = e?.response?.data?.detail;
      const message = (typeof detail === 'string' && detail) || e?.message || tRef.current.booking.imageModal.extractError;
      dispatch({ type: 'fail', id: item.id, run: item.run, error: message, readMs: Math.round(performance.now() - started) });
    } finally {
      controllersRef.current.delete(item.id);
    }
  }, [checkDbDuplicate]);

  useEffect(() => {
    if (processingRef.current) return;
    // A pause is about Gemini (quota, key, overload) or the user's images: PDFs are read locally and keep going
    const next = items.find((i) => i.status === 'queued' && (!paused || isPdfItem(i)));
    if (!next) return;
    processingRef.current = true; // ref guard: an effect re-run can never start the same image twice
    dispatch({ type: 'start', id: next.id });
    void runItem(next).finally(() => {
      processingRef.current = false;
      if (mountedRef.current) setTick((n) => n + 1);
    });
  }, [items, paused, tick, runItem]);

  // ---- actions ---------------------------------------------------------------------------------
  const enqueue = useCallback((files: File[], source: QueueSource): EnqueueResult => {
    const tt = tRef.current.booking.imageQueue;
    const collection = activeCollectionRef.current;
    const empty: EnqueueResult = { ids: [], added: 0, duplicates: 0, rejected: 0 };
    if (!collection) {
      addToastRef.current(tRef.current.booking.paste.noCollection, 'error');
      return empty;
    }
    const readable = files.filter((f) => isImageFile(f) || isPdfFile(f));
    if (readable.length < files.length) addToastRef.current(tt.onlyImages, 'info');
    const { fresh, duplicates } = dedupeIncoming(itemsRef.current, readable);
    const room = Math.max(0, MAX_QUEUE_ITEMS - itemsRef.current.length);
    const accepted = fresh.slice(0, room);
    const rejected = fresh.length - accepted.length;
    if (rejected > 0) addToastRef.current(tf(tt.tooMany, { max: MAX_QUEUE_ITEMS, count: rejected }), 'error');
    if (duplicates > 0) addToastRef.current(tf(tt.duplicatesSkipped, { count: duplicates }), 'info');
    if (accepted.length === 0) return { ...empty, duplicates, rejected };
    const newItems = accepted.map((f) => makeQueueItem(f, source, { id: collection.id, name: collection.name }));
    dispatch({ type: 'add', items: newItems });
    return { ids: newItems.map((i) => i.id), added: newItems.length, duplicates, rejected };
  }, []);

  const pause = useCallback(() => setPaused((p) => p ?? 'user'), []);
  const resume = useCallback(() => setPaused(null), []);
  const retry = useCallback((id: string) => dispatch({ type: 'retry', id }), []);
  const retryFailed = useCallback(() => dispatch({ type: 'retryFailed' }), []);
  const clearSaved = useCallback(() => dispatch({ type: 'clearSaved' }), []);

  const remove = useCallback((id: string) => {
    controllersRef.current.get(id)?.abort();
    transientRetriesRef.current.delete(id);
    const timer = dupTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    dupTimersRef.current.delete(id);
    dispatch({ type: 'remove', id });
  }, []);

  const setField = useCallback((id: string, key: string, value: string) => {
    dispatch({ type: 'setField', id, key, value });
    if (key !== 'Booking No') return;
    // Re-check the edited Booking No once typing settles
    const previous = dupTimersRef.current.get(id);
    if (previous) clearTimeout(previous);
    dupTimersRef.current.set(id, setTimeout(() => {
      dupTimersRef.current.delete(id);
      const item = itemsRef.current.find((i) => i.id === id);
      if (item && item.status !== 'saved') void checkDbDuplicate(id, item.collectionId, item.fields);
    }, 600));
  }, [checkDbDuplicate]);

  const batchDuplicates = useMemo(() => batchDuplicateIds(items), [items]);
  const batchDuplicatesRef = useRef(batchDuplicates);
  batchDuplicatesRef.current = batchDuplicates;

  const persist = useCallback(async (item: QueueItem): Promise<boolean> => {
    const tt = tRef.current.booking.imageQueue;
    dispatch({ type: 'saving', id: item.id, value: true });
    try {
      const { item: saved, warnings } = await saveManualBookingApi(item.collectionId, {
        ...item.fields,
        'Tên file PDF': item.fields['Tên file PDF'] || item.name,
      });
      warnings.forEach((w) => addToastRef.current(w, 'info'));
      if (mountedRef.current) {
        dispatch({ type: 'saved', id: item.id, bookingId: saved.id });
        setLastSaved({ collectionId: item.collectionId, bookingId: saved.id });
        setSavedVersion((n) => n + 1);
      }
      return true;
    } catch (e: any) {
      if (mountedRef.current) dispatch({ type: 'saving', id: item.id, value: false });
      const detail = e?.response?.data?.detail;
      addToastRef.current(tf(tt.saveFailed, { error: (typeof detail === 'string' && detail) || e?.message || '' }), 'error');
      return false;
    }
  }, []);

  const save = useCallback(async (id: string): Promise<boolean> => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item || item.saving || (item.status !== 'success' && item.status !== 'review')) return false;
    const tt = tRef.current.booking.imageQueue;
    const inBatch = batchDuplicatesRef.current.has(id);
    if (inBatch || item.dbDuplicate) {
      const ok = await confirm({
        title: tt.saveDuplicateTitle,
        message: tf(tt.saveDuplicateMessage, {
          no: String(item.fields['Booking No'] || ''),
          where: item.dbDuplicate ? tt.whereDb : tt.whereBatch,
        }),
        confirmText: tt.saveAnyway,
      });
      if (!ok) return false;
    }
    const saved = await persist(item);
    if (saved) addToastRef.current(tf(tt.savedOne, { no: String(item.fields['Booking No'] || item.name) }), 'success');
    return saved;
  }, [confirm, persist]);

  const saveAllSuccessful = useCallback(async () => {
    const tt = tRef.current.booking.imageQueue;
    const targets = itemsRef.current.filter((i) => i.status === 'success' && !i.saving);
    let savedCount = 0;
    let skipped = 0;
    for (const item of targets) {
      // Repeated Booking Nos are skipped by default; save them one by one if they are really wanted
      const current = itemsRef.current.find((i) => i.id === item.id);
      if (!current || current.status !== 'success') continue;
      if (batchDuplicatesRef.current.has(current.id) || current.dbDuplicate) {
        skipped += 1;
        continue;
      }
      if (await persist(current)) savedCount += 1;
    }
    if (savedCount === 0 && skipped === 0) return;
    addToastRef.current(
      skipped > 0 ? tf(tt.savedAllSkipped, { saved: savedCount, skipped }) : tf(tt.savedAll, { count: savedCount }),
      savedCount > 0 ? 'success' : 'info'
    );
  }, [persist]);

  const stats = useMemo(() => queueStats(items), [items]);
  const geminiIssue = useMemo(() => (items.some((i) => i.errorKind === 'no_key') ? ('no_key' as const) : null), [items]);

  const value = useMemo<ImageQueueValue>(() => ({
    items, stats, paused, room: Math.max(0, MAX_QUEUE_ITEMS - items.length), batchDuplicates, geminiIssue, savedVersion, lastSaved,
    enqueue, pause, resume, retry, retryFailed, remove, clearSaved, setField, save, saveAllSuccessful,
  }), [items, stats, paused, batchDuplicates, geminiIssue, savedVersion, lastSaved,
    enqueue, pause, resume, retry, retryFailed, remove, clearSaved, setField, save, saveAllSuccessful]);

  return <ImageQueueContext.Provider value={value}>{children}</ImageQueueContext.Provider>;
};

export const useImageQueue = (): ImageQueueValue => {
  const ctx = useContext(ImageQueueContext);
  if (!ctx) throw new Error('useImageQueue must be used within an ImageQueueProvider');
  return ctx;
};
