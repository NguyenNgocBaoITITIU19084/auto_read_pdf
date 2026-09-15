import { useState, useEffect, useCallback, useRef } from 'react';
import { ColumnDef } from '../components/common/ColumnConfigModal';

export interface ColumnWidthMap {
  [key: string]: number;
}

export interface ColumnMigrationOptions {
  /** old key -> new key. The new column takes the old column's position & visibility; the old column is kept but hidden. */
  replace?: Record<string, string>;
  /** Keys forced hidden (appended hidden if missing from the stored list). */
  hide?: string[];
}

export interface ColumnMigration extends ColumnMigrationOptions {
  /** Bump to re-run. Applied once per version; stored at `${storageKey}_columns_version`. */
  version: number;
}

/**
 * Migrates a stored column list to a new set of defaults.
 * - Keys in `replace` are swapped in place for their new key (unless the new key is already stored,
 *   in which case the old one is simply hidden). Old keys that still exist in `defaults` are kept, hidden.
 * - Keys in `hide` become `visible: false`.
 * - Stored columns that no longer exist in `defaults` are dropped; missing defaults are appended.
 */
export function migrateColumns(
  stored: ColumnDef[],
  defaults: ColumnDef[],
  options: ColumnMigrationOptions = {}
): ColumnDef[] {
  const replace = options.replace || {};
  const hide = new Set(options.hide || []);
  const defaultsByKey = new Map(defaults.map((d) => [d.key, d]));
  const storedKeys = new Set(stored.map((c) => c.key));

  const result: ColumnDef[] = [];
  const seen = new Set<string>();

  const push = (col: ColumnDef) => {
    if (seen.has(col.key)) return;
    seen.add(col.key);
    result.push(col);
  };

  stored.forEach((col) => {
    const newKey = replace[col.key];
    if (newKey && newKey !== col.key) {
      if (!storedKeys.has(newKey) && !seen.has(newKey)) {
        const def = defaultsByKey.get(newKey);
        push({
          ...(def || { key: newKey, label: newKey }),
          key: newKey,
          defaultLabel: def?.label ?? newKey,
          customLabel: undefined,
          visible: col.visible,
        } as ColumnDef);
      }
      // Old column stays available right after the new one, hidden
      if (defaultsByKey.has(col.key)) push({ ...col, visible: false });
      return;
    }
    if (!defaultsByKey.has(col.key)) return;
    push({ ...col });
  });

  defaults.forEach((def) => {
    if (!seen.has(def.key)) push({ ...def, defaultLabel: def.label });
  });

  return result.map((col) => (hide.has(col.key) ? { ...col, visible: false } : col));
}

interface UseColumnSettingsOptions {
  storageKey: string;
  defaultColumns: ColumnDef[];
  defaultWidths?: ColumnWidthMap;
  /** Optional one-time migration of the stored column list (see `migrateColumns`). */
  migration?: ColumnMigration;
}

export function useColumnSettings({
  storageKey,
  defaultColumns,
  defaultWidths = {},
  migration,
}: UseColumnSettingsOptions) {
  // Load initial column configuration
  const [columns, setColumnsState] = useState<ColumnDef[]>(() => {
    try {
      const saved = localStorage.getItem(`${storageKey}_columns`);
      if (saved) {
        let parsed: ColumnDef[] = JSON.parse(saved);
        if (migration) {
          const versionKey = `${storageKey}_columns_version`;
          const storedVersion = Number(localStorage.getItem(versionKey) || 0);
          if (storedVersion < migration.version) {
            parsed = migrateColumns(parsed, defaultColumns, migration);
            localStorage.setItem(`${storageKey}_columns`, JSON.stringify(parsed));
            localStorage.setItem(versionKey, String(migration.version));
          }
        }
        const existingKeys = new Set(parsed.map((c) => c.key));
        const merged: ColumnDef[] = parsed.map((col) => {
          const def = defaultColumns.find((d) => d.key === col.key);
          const defLabel = def ? def.label : col.key;
          const hasCustomLabel = col.customLabel !== undefined && col.customLabel !== '';
          return {
            ...col,
            defaultLabel: defLabel,
            customLabel: hasCustomLabel ? col.customLabel : undefined,
            label: hasCustomLabel ? (col.customLabel as string) : (col.label || defLabel),
          };
        });
        defaultColumns.forEach((col) => {
          if (!existingKeys.has(col.key)) {
            merged.push({
              ...col,
              defaultLabel: col.label,
            });
          }
        });
        return merged;
      }
    } catch (e) {
      console.error('Error loading saved columns:', e);
    }
    if (migration) {
      try {
        localStorage.setItem(`${storageKey}_columns_version`, String(migration.version));
      } catch {
        /* ignore */
      }
    }
    return defaultColumns.map((col) => ({
      ...col,
      defaultLabel: col.label,
    }));
  });

  // Load initial column widths
  const [columnWidths, setColumnWidths] = useState<ColumnWidthMap>(() => {
    try {
      const saved = localStorage.getItem(`${storageKey}_widths`);
      if (saved) {
        return { ...defaultWidths, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error('Error loading saved column widths:', e);
    }
    return defaultWidths;
  });

  // Save columns on change
  const setColumns = useCallback(
    (action: ColumnDef[] | ((prev: ColumnDef[]) => ColumnDef[])) => {
      setColumnsState((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        try {
          localStorage.setItem(`${storageKey}_columns`, JSON.stringify(next));
        } catch (e) {
          console.error('Error saving columns to localStorage:', e);
        }
        return next;
      });
    },
    [storageKey]
  );

  // Reset columns to defaults
  const resetColumns = useCallback(() => {
    const resetList = defaultColumns.map((col) => ({
      ...col,
      defaultLabel: col.label,
      customLabel: undefined,
    }));
    setColumnsState(resetList);
    try {
      localStorage.removeItem(`${storageKey}_columns`);
    } catch (e) {
      console.error('Error resetting columns in localStorage:', e);
    }
  }, [defaultColumns, storageKey]);

  // Save widths on change
  const saveWidths = useCallback(
    (newWidths: ColumnWidthMap) => {
      setColumnWidths(newWidths);
      try {
        localStorage.setItem(`${storageKey}_widths`, JSON.stringify(newWidths));
      } catch (e) {
        console.error('Error saving widths to localStorage:', e);
      }
    },
    [storageKey]
  );

  // Active resize state ref to avoid closure bugs
  const activeResizeRef = useRef<{
    colKey: string;
    startX: number;
    startWidth: number;
    cleanup?: () => void;
  } | null>(null);

  // Clean up any stray window listeners if component unmounts during drag
  useEffect(() => {
    return () => {
      if (activeResizeRef.current?.cleanup) {
        activeResizeRef.current.cleanup();
      }
    };
  }, []);

  const startResize = useCallback(
    (colKey: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Clean up previous if any
      if (activeResizeRef.current?.cleanup) {
        activeResizeRef.current.cleanup();
      }

      const startX = e.clientX;
      const currentTh = (e.target as HTMLElement).closest('th');
      const startWidth = currentTh
        ? currentTh.getBoundingClientRect().width
        : (columnWidths[colKey] || 120);

      const targetColKey = colKey;

      // Throttle width updates to one per animation frame
      let rafId: number | null = null;
      let pendingWidth: number | null = null;

      const flushWidth = () => {
        rafId = null;
        if (pendingWidth === null) return;
        const w = pendingWidth;
        pendingWidth = null;
        setColumnWidths((prev) => (prev[targetColKey] === w ? prev : { ...prev, [targetColKey]: w }));
      };

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        pendingWidth = Math.max(50, Math.round(startWidth + deltaX));
        if (rafId === null) {
          rafId = window.requestAnimationFrame(flushWidth);
        }
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        pendingWidth = null;
        const deltaX = upEvent.clientX - startX;
        const finalWidth = Math.max(50, Math.round(startWidth + deltaX));

        setColumnWidths((prev) => {
          const updated = {
            ...prev,
            [targetColKey]: finalWidth,
          };
          try {
            localStorage.setItem(`${storageKey}_widths`, JSON.stringify(updated));
          } catch (err) {
            console.error('Error saving column widths to localStorage:', err);
          }
          return updated;
        });

        cleanup();
      };

      const cleanup = () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        activeResizeRef.current = null;
      };

      activeResizeRef.current = {
        colKey: targetColKey,
        startX,
        startWidth,
        cleanup,
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [columnWidths, storageKey]
  );

  return {
    columns,
    setColumns,
    resetColumns,
    columnWidths,
    startResize,
    saveWidths,
  };
}
