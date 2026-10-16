import { useCallback, useState } from 'react';

export interface TableSort {
  key: string;
  dir: 'asc' | 'desc';
}

const read = (storageKey: string): TableSort | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    return saved && typeof saved.key === 'string' && (saved.dir === 'asc' || saved.dir === 'desc') ? saved : null;
  } catch {
    return null;
  }
};

/**
 * Column sort of a server-paged table, remembered per table. Clicking a column cycles
 * ascending -> descending -> default order (null).
 */
export function useTableSort(storageKey: string) {
  const [sort, setSort] = useState<TableSort | null>(() => read(storageKey));

  const toggleSort = useCallback((key: string) => {
    setSort((prev) => {
      const next: TableSort | null =
        prev?.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : null;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* sort is only remembered when storage works */
      }
      return next;
    });
  }, [storageKey]);

  const sortDirOf = useCallback((key: string) => (sort?.key === key ? sort.dir : null), [sort]);

  return { sort, toggleSort, sortDirOf };
}
