import type { ColumnDef } from './ColumnConfigModal';

interface TableSkeletonProps {
  columns?: ColumnDef[];
  columnWidths?: Record<string, number>;
  rowCount?: number;
  hasCheckbox?: boolean;
  hasActions?: boolean;
  actionColClass?: string;
}

const DEFAULT_SKELETON_COLS: ColumnDef[] = Array.from({ length: 8 }, (_, i) => ({
  key: `col_${i}`,
  label: '',
  visible: true,
}));

export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  columns = DEFAULT_SKELETON_COLS,
  columnWidths = {},
  rowCount = 8,
  hasCheckbox = false,
  hasActions = true,
  actionColClass = "w-16",
}) => {
  const visibleCols = columns.filter((c) => c.visible);

  // Array of varied widths to make skeleton bars look natural
  const widths = ['w-3/4', 'w-1/2', 'w-4/5', 'w-2/3', 'w-3/5', 'w-5/6'];

  return (
    <>
      {Array.from({ length: rowCount }).map((_, rowIdx) => (
        <tr
          key={`skeleton-row-${rowIdx}`}
          className="animate-pulse border-b border-slate-100 dark:border-slate-800/80"
        >
          {/* Checkbox column */}
          {hasCheckbox && (
            <td className="py-2.5 px-2 text-center w-8">
              <div className="w-4 h-4 mx-auto rounded bg-slate-200 dark:bg-slate-700/70" />
            </td>
          )}

          {/* STT column */}
          <td className="py-2.5 px-2.5 text-center w-10">
            <div className="w-4 h-3.5 mx-auto rounded bg-slate-200 dark:bg-slate-700/70" />
          </td>

          {/* Data columns */}
          {visibleCols.map((col, colIdx) => {
            const widthPx = columnWidths[col.key];
            const randomWidthClass = widths[(rowIdx + colIdx) % widths.length];

            return (
              <td
                key={`skeleton-cell-${rowIdx}-${col.key}`}
                style={{
                  width: widthPx ? `${widthPx}px` : undefined,
                  maxWidth: widthPx ? `${widthPx}px` : undefined,
                }}
                className="py-2.5 px-2.5"
              >
                <div
                  className={`h-3.5 rounded bg-slate-200 dark:bg-slate-700/60 ${randomWidthClass}`}
                />
              </td>
            );
          })}

          {/* Actions column */}
          {hasActions && (
            <td className={`py-2.5 px-2.5 text-center ${actionColClass}`}>
              <div className="flex items-center justify-center gap-1.5">
                <div className="w-5 h-5 rounded-md bg-slate-200 dark:bg-slate-700/70" />
                <div className="w-5 h-5 rounded-md bg-slate-200 dark:bg-slate-700/70" />
                <div className="w-5 h-5 rounded-md bg-slate-200 dark:bg-slate-700/70" />
              </div>
            </td>
          )}
        </tr>
      ))}
    </>
  );
};
