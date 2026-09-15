import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface RowSelection<T> {
  selectedIds: Set<number>;
  isSelected: (id: number) => boolean;
  /** Toggle one row. With shiftKey, applies the clicked row's new state to the range from the last clicked row (in `rows` order). */
  toggle: (id: number, shiftKey?: boolean) => void;
  /** Select / deselect all rows of the current page */
  selectPage: (pageRows: T[], checked: boolean) => void;
  /** Select / deselect every row in `rows` (all filtered results) */
  selectAll: (checked: boolean) => void;
  /** Select / deselect an explicit list of ids */
  selectIds: (ids: number[], checked: boolean) => void;
  clear: () => void;
  count: number;
  /** Selected rows in `rows` order */
  selectedRows: T[];
  isPageAllSelected: (pageRows: T[]) => boolean;
  isPagePartiallySelected: (pageRows: T[]) => boolean;
  /** True when every row in `rows` is selected (and rows is non-empty) */
  isAllSelected: boolean;
}

const EMPTY_SET: Set<number> = new Set();

/**
 * Set-based multi-row selection.
 * - `rows`: the full (filtered) list in display order — used for shift-range and pruning.
 * - `getId`: row -> numeric id (may be an inline arrow; it is read through a ref).
 * - `resetKeys`: selection is cleared whenever any of these values change (e.g. collection, filter).
 *   Keep the array length constant between renders.
 * Ids that disappear from `rows` are pruned automatically.
 */
export function useRowSelection<T>(
  rows: T[],
  getId: (r: T) => number,
  resetKeys: unknown[]
): RowSelection<T> {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(EMPTY_SET);
  const getIdRef = useRef(getId);
  getIdRef.current = getId;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const anchorRef = useRef<number | null>(null);

  const rowIds = useMemo(() => rows.map((r) => getIdRef.current(r)), [rows]);
  const rowIdSet = useMemo(() => new Set(rowIds), [rowIds]);

  // Clear on reset keys change (skip first mount)
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    anchorRef.current = null;
    setSelectedIds((prev) => (prev.size === 0 ? prev : EMPTY_SET));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetKeys);

  // Prune ids that are no longer present in rows
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (rowIdSet.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
    if (anchorRef.current !== null && !rowIdSet.has(anchorRef.current)) {
      anchorRef.current = null;
    }
  }, [rowIdSet]);

  const isSelected = useCallback((id: number) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id: number, shiftKey: boolean = false) => {
    // Capture before scheduling: updater functions may run after anchorRef is reassigned below.
    const anchor = anchorRef.current;
    const ids = shiftKey ? rowsRef.current.map((r) => getIdRef.current(r)) : null;
    setSelectedIds((prev) => {
      const willSelect = !prev.has(id);
      const next = new Set(prev);
      if (ids && anchor !== null && anchor !== id) {
        const from = ids.indexOf(anchor);
        const to = ids.indexOf(id);
        if (from !== -1 && to !== -1) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (let i = start; i <= end; i++) {
            if (willSelect) next.add(ids[i]);
            else next.delete(ids[i]);
          }
          return next;
        }
      }
      if (willSelect) next.add(id);
      else next.delete(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  const selectIds = useCallback((ids: number[], checked: boolean) => {
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      ids.forEach((id) => {
        if (checked && !next.has(id)) {
          next.add(id);
          changed = true;
        } else if (!checked && next.has(id)) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const selectPage = useCallback((pageRows: T[], checked: boolean) => {
    selectIds(pageRows.map((r) => getIdRef.current(r)), checked);
  }, [selectIds]);

  const selectAll = useCallback((checked: boolean) => {
    if (!checked) {
      anchorRef.current = null;
      setSelectedIds((prev) => (prev.size === 0 ? prev : EMPTY_SET));
      return;
    }
    setSelectedIds(new Set(rowsRef.current.map((r) => getIdRef.current(r))));
  }, []);

  const clear = useCallback(() => {
    anchorRef.current = null;
    setSelectedIds((prev) => (prev.size === 0 ? prev : EMPTY_SET));
  }, []);

  const selectedRows = useMemo(
    () => (selectedIds.size === 0 ? [] : rows.filter((_, i) => selectedIds.has(rowIds[i]))),
    [rows, rowIds, selectedIds]
  );

  const isPageAllSelected = useCallback(
    (pageRows: T[]) => pageRows.length > 0 && pageRows.every((r) => selectedIds.has(getIdRef.current(r))),
    [selectedIds]
  );

  const isPagePartiallySelected = useCallback(
    (pageRows: T[]) => {
      if (pageRows.length === 0 || selectedIds.size === 0) return false;
      let some = false;
      let all = true;
      for (const r of pageRows) {
        if (selectedIds.has(getIdRef.current(r))) some = true;
        else all = false;
        if (some && !all) return true;
      }
      return false;
    },
    [selectedIds]
  );

  // count reflects only ids still present (pruning effect runs after render)
  const count = useMemo(() => {
    if (selectedIds.size === 0) return 0;
    let n = 0;
    selectedIds.forEach((id) => {
      if (rowIdSet.has(id)) n += 1;
    });
    return n;
  }, [selectedIds, rowIdSet]);

  const isAllSelected = rowIds.length > 0 && count === rowIds.length;

  return {
    selectedIds,
    isSelected,
    toggle,
    selectPage,
    selectAll,
    selectIds,
    clear,
    count,
    selectedRows,
    isPageAllSelected,
    isPagePartiallySelected,
    isAllSelected,
  };
}
