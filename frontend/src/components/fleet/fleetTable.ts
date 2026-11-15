import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnValueCount } from '../../services/api';
import type { TableSort } from '../../hooks/useTableSort';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 25;

type SortValue = string | number | null | undefined;

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

/** Rows ordered by `sort` (the given order when null). Empty values go last whichever way it sorts; ties keep their
 *  order, so a second sort refines the first. */
export function sortRows<T>(rows: T[], sort: TableSort | null, getters: Record<string, (row: T) => SortValue>): T[] {
  const get = sort ? getters[sort.key] : undefined;
  if (!sort || !get) return rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((a, b) => {
      const ea = a.v === null || a.v === undefined || a.v === '';
      const eb = b.v === null || b.v === undefined || b.v === '';
      if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((x) => x.row);
}

/** The distinct values of a column with how many rows have each, for a ColumnValueFilter ('' = blank). */
export function valueCounts<T>(rows: T[], get: (row: T) => string, order?: string[]): ColumnValueCount[] {
  const counts = new Map<string, number>();
  rows.forEach((r) => {
    const v = get(r);
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  const keys = Array.from(counts.keys());
  keys.sort((a, b) => (order ? order.indexOf(a) - order.indexOf(b) : collator.compare(a, b)));
  return keys.map((k) => ({ carrier: k, count: counts.get(k)! }));
}

/** Rows whose value of every filtered column is one of the picked values. */
export function applyColumnFilters<T>(rows: T[], filters: Record<string, string[]>, getters: Record<string, (row: T) => string>): T[] {
  const active = Object.entries(filters).filter(([key, values]) => values.length > 0 && getters[key]);
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every(([key, values]) => values.includes(getters[key](r))));
}

const readSize = (key: string): number => {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
};

/** Page number and page size of a table (the size remembered per table). Back to page 1 whenever `resetKey` changes
 *  (a new search, filter or sort). */
export function usePaging(storageKey: string, resetKey: string) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => readSize(storageKey));
  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
    try {
      localStorage.setItem(storageKey, String(size));
    } catch {
      /* only a convenience */
    }
  }, [storageKey]);
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  return { page, setPage, pageSize, setPageSize };
}

/** The rows of the current page. */
export function usePageRows<T>(rows: T[], page: number, pageSize: number): T[] {
  return useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);
}
