import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageResult } from '../types';
import { rowsSignature } from '../components/vessel/tableHelpers';

export type LoadMode = 'loading' | 'refresh' | 'silent';

export interface ServerTableOptions<T, R extends PageResult<T>> {
  enabled: boolean;
  /** Serialized filters (collection, search, event type…). A change resets to page 1. */
  queryKey: string;
  pageSizeStorageKey: string;
  fetchPage: (limit: number, offset: number) => Promise<R>;
  onError?: (e: unknown) => void;
  defaultPageSize?: number;
}

const readPageSize = (key: string, fallback: number) => {
  try {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved > 0 ? saved : fallback;
  } catch {
    return fallback;
  }
};

export function useServerTable<T extends { id?: number | null }, R extends PageResult<T>>({
  enabled, queryKey, pageSizeStorageKey, fetchPage, onError, defaultPageSize = 50,
}: ServerTableOptions<T, R>) {
  const [result, setResult] = useState<R | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => readPageSize(pageSizeStorageKey, defaultPageSize));

  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;
  const sizeRef = useRef(pageSize);
  sizeRef.current = pageSize;
  const seqRef = useRef(0);
  const inFlightRef = useRef(false);
  const sigRef = useRef('');

  const reload = useCallback(async (mode: LoadMode = 'refresh') => {
    if (!enabled) return;
    if (mode === 'silent' && inFlightRef.current) return;
    const seq = ++seqRef.current;
    inFlightRef.current = true;
    if (mode === 'loading') setLoading(true);
    const size = sizeRef.current;
    const page = pageRef.current;
    try {
      const data = await fetchRef.current(size, (page - 1) * size);
      if (seq !== seqRef.current) return;
      const lastPage = Math.max(1, Math.ceil(data.total / size));
      if (data.total > 0 && page > lastPage) {
        setCurrentPageState(lastPage);
        return; // the page effect loads the last page
      }
      const sig = `${data.total}|${rowsSignature(data.items as { id?: number | null; queried_at?: string | null }[])}`;
      if (mode !== 'silent' || sig !== sigRef.current) {
        sigRef.current = sig;
        setResult(data);
      }
    } catch (e) {
      if (mode !== 'silent' && seq === seqRef.current) onErrorRef.current?.(e);
    } finally {
      if (seq === seqRef.current) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [enabled]);

  // Filters changed -> page 1 with skeleton
  const lastQueryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const queryChanged = lastQueryRef.current !== queryKey;
    lastQueryRef.current = queryKey;
    if (queryChanged) {
      pageRef.current = 1;
      setCurrentPageState(1);
      void reload('loading');
    }
  }, [enabled, queryKey, reload]);

  // Page / page size changed -> keep old rows until the new page arrives
  const firstPageEffect = useRef(true);
  useEffect(() => {
    if (firstPageEffect.current) {
      firstPageEffect.current = false;
      return;
    }
    void reload('refresh');
  }, [currentPage, pageSize, reload]);

  const setCurrentPage = useCallback((p: number) => setCurrentPageState(Math.max(1, Math.floor(p))), []);
  const setPageSize = useCallback((n: number) => {
    const size = Math.max(1, Math.floor(n));
    try {
      localStorage.setItem(pageSizeStorageKey, String(size));
    } catch {
      /* ignore */
    }
    setPageSizeState(size);
    setCurrentPageState(1);
  }, [pageSizeStorageKey]);

  return {
    rows: (result?.items ?? []) as T[],
    total: result?.total ?? 0,
    result,
    loading,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    reload,
  };
}
