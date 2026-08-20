import React from 'react';

interface ResizableThProps {
  colKey: string;
  label: string;
  width?: number;
  minWidth?: number;
  onResize?: (colKey: string, e: React.MouseEvent) => void;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export const ResizableTh: React.FC<ResizableThProps> = ({
  colKey,
  label,
  width,
  minWidth = 70,
  onResize,
  className = '',
  align = 'left',
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
      <span className="truncate block pr-2">{label}</span>
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
