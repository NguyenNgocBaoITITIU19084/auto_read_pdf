import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

interface ResizableThProps {
  colKey: string;
  label: string;
  width?: number;
  minWidth?: number;
  onResize?: (colKey: string, e: React.MouseEvent) => void;
  className?: string;
  align?: 'left' | 'center' | 'right';
  /** Current sort of this column; with `onSort` a sort button shows next to the label. */
  sortDir?: 'asc' | 'desc' | null;
  onSort?: (colKey: string) => void;
  /** Sort button titles (default Vietnamese) */
  sortLabels?: { none: string; asc: string; desc: string };
  /** Extra header control after the sort button (e.g. a filter). */
  extra?: React.ReactNode;
}

export const ResizableTh: React.FC<ResizableThProps> = ({
  colKey,
  label,
  width,
  minWidth = 70,
  onResize,
  className = '',
  align = 'left',
  sortDir = null,
  onSort,
  sortLabels = { none: 'Sắp xếp', asc: 'Đang sắp xếp tăng dần', desc: 'Đang sắp xếp giảm dần' },
  extra,
}) => {
  const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

  return (
    <th
      style={{
        width: width ? `${width}px` : undefined,
        minWidth: `${minWidth}px`,
        maxWidth: width ? `${width}px` : undefined,
      }}
      className={`relative group/th py-2 px-2.5 font-bold text-slate-700 dark:text-slate-200 text-[11px] whitespace-nowrap select-none ${alignClass} ${className}`}
    >
      {onSort ? (
        <div className="flex items-center gap-1 pr-2 min-w-0">
          <span className="truncate">{label}</span>
          <button
            type="button"
            onClick={() => onSort(colKey)}
            title={sortLabels[sortDir || 'none']}
            aria-label={`${sortLabels.none} ${label}`}
            className={`shrink-0 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${
              sortDir ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400 dark:text-slate-500 opacity-60 group-hover/th:opacity-100'
            }`}
          >
            {sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : sortDir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUpDown className="w-3 h-3" />}
          </button>
          {extra}
        </div>
      ) : (
        <span className="truncate block pr-2">{label}</span>
      )}
      {onResize && (
        <div
          onMouseDown={(e) => onResize(colKey, e)}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary-500 active:bg-primary-600 group-hover/th:bg-slate-300 dark:group-hover/th:bg-slate-600 transition-colors z-10"
          title="Kéo để điều chỉnh độ rộng cột"
        />
      )}
    </th>
  );
};
