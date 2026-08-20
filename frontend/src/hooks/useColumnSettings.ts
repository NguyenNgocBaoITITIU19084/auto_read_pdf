import { useState, useEffect, useCallback, useRef } from 'react';
import { ColumnDef } from '../components/common/ColumnConfigModal';

export interface ColumnWidthMap {
  [key: string]: number;
}

interface UseColumnSettingsOptions {
  storageKey: string;
  defaultColumns: ColumnDef[];
  defaultWidths?: ColumnWidthMap;
}

export function useColumnSettings({
  storageKey,
  defaultColumns,
  defaultWidths = {},
}: UseColumnSettingsOptions) {
  // Load initial column configuration
  const [columns, setColumnsState] = useState<ColumnDef[]>(() => {
    try {
      const saved = localStorage.getItem(`${storageKey}_columns`);
      if (saved) {
        const parsed: ColumnDef[] = JSON.parse(saved);
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

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const newWidth = Math.max(50, Math.round(startWidth + deltaX));

        setColumnWidths((prev) => ({
          ...prev,
          [targetColKey]: newWidth,
        }));
      };

      const onMouseUp = (upEvent: MouseEvent) => {
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
