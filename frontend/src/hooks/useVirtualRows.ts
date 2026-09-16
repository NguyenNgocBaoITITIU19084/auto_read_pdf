import { useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export const VIRTUALIZE_THRESHOLD = 100;
export const ESTIMATED_ROW_HEIGHT = 33;

export function virtualPadding(items: { start: number; end: number }[], totalSize: number) {
  if (items.length === 0) return { top: 0, bottom: 0 };
  return { top: items[0].start, bottom: Math.max(0, totalSize - items[items.length - 1].end) };
}

/**
 * Row virtualization for a plain <table>: render only visible rows plus spacer <tr>s,
 * so sticky headers, resizable <th> and memoized row components keep working unchanged.
 */
export function useVirtualRows(
  count: number,
  scrollRef: React.RefObject<HTMLElement | null>,
  { rowHeight = ESTIMATED_ROW_HEIGHT, overscan = 12, threshold = VIRTUALIZE_THRESHOLD } = {}
) {
  const enabled = count > threshold;
  const virtualizer = useVirtualizer({
    count: enabled ? count : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });
  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return useMemo(() => {
    if (!enabled) {
      return { enabled: false, indexes: Array.from({ length: count }, (_, i) => i), paddingTop: 0, paddingBottom: 0 };
    }
    const { top, bottom } = virtualPadding(items, totalSize);
    return { enabled: true, indexes: items.map((v) => v.index), paddingTop: top, paddingBottom: bottom };
  }, [enabled, count, items, totalSize]);
}
