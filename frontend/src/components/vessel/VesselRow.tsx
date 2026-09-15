import React from 'react';
import { Eye, BookmarkPlus, BookmarkCheck, Copy, Trash2 } from 'lucide-react';
import { VesselSchedule } from '../../types';
import { ColumnDef } from '../common/ColumnConfigModal';
import { Tooltip } from '../common/Tooltip';
import { ValueBadge } from '../common/ValueBadge';
import type { AppContextType } from '../../context/AppContext';
import { QueriedAtBadge } from './QueriedAtBadge';

type Translations = AppContextType['t'];

export interface VesselRowProps {
  item: VesselSchedule;
  rowNumber: number;
  visibleColumns: ColumnDef[];
  columnWidths: Record<string, number>;
  isSelected: boolean;
  isBookmarked: boolean;
  t: Translations;
  onToggleSelect: (id: number, shiftKey?: boolean) => void;
  onOpen: (item: VesselSchedule) => void;
  onCopy: (item: VesselSchedule) => void;
  onToggleWatchlist: (item: VesselSchedule) => void;
  onDelete: (id: number) => void;
}

const noop = () => undefined;

const VesselRowInner: React.FC<VesselRowProps> = ({
  item,
  rowNumber,
  visibleColumns,
  columnWidths,
  isSelected,
  isBookmarked,
  t,
  onToggleSelect,
  onOpen,
  onCopy,
  onToggleWatchlist,
  onDelete,
}) => {
  return (
    <tr
      onDoubleClick={() => onOpen(item)}
      className={`hover:bg-sky-100/80 dark:hover:bg-sky-950/70 hover:shadow-xs transition-colors group cursor-pointer ${
        isSelected
          ? 'bg-sky-50 dark:bg-sky-950/50 ring-1 ring-inset ring-sky-300 dark:ring-sky-800'
          : isBookmarked
          ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-l-[3px] border-l-emerald-500'
          : ''
      }`}
    >
      <td className="py-1.5 px-2 text-center w-8" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={noop}
          onClick={(e) => onToggleSelect(item.id, e.shiftKey)}
          className="rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500 cursor-pointer"
        />
      </td>
      <td className="py-1.5 px-2.5 text-center font-medium text-slate-400 w-10">{rowNumber}</td>
      {visibleColumns.map((col) => {
        const val = item[col.key] || 'null';
        const w = columnWidths[col.key];
        const style = w ? { width: `${w}px`, maxWidth: `${w}px` } : undefined;

        if (col.key === 'queried_at') {
          return (
            <td key={col.key} style={style} className="py-1.5 px-2.5 truncate" title={`Thời gian cập nhật: ${String(val)}`}>
              <QueriedAtBadge value={val} />
            </td>
          );
        }

        if (col.key === 'vessel_name') {
          return (
            <td key={col.key} style={style} className="py-1.5 px-2.5 truncate font-bold" title={String(val)}>
              <div className="flex items-center gap-1.5 truncate">
                {isBookmarked && (
                  <span title="Đang trong Watchlist theo dõi" className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                )}
                <ValueBadge
                  table="vessel"
                  columnKey={col.key}
                  value={val}
                  className="font-bold text-slate-900 dark:text-slate-100"
                  fallbackText="-"
                />
              </div>
            </td>
          );
        }

        return (
          <td key={col.key} style={style} className="py-1.5 px-2.5 truncate" title={`${col.label}: ${String(val || '')}`}>
            <ValueBadge table="vessel" columnKey={col.key} value={val} fallbackText="null" />
          </td>
        );
      })}
      <td className="py-1.5 px-2.5 text-center w-24" onDoubleClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
          <Tooltip content="Xem chi tiết đầy đủ lịch tàu">
            <button
              onClick={(e) => { e.stopPropagation(); onOpen(item); }}
              className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Sao chép thông tin dòng">
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(item); }}
              className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip
            content={
              isBookmarked
                ? (t.vessel.inWatchlistTooltip || 'Đang trong Watchlist (Nhấn để hủy theo dõi)')
                : (t.vessel.addToWatchlistTooltip || 'Thêm vào Watchlist để theo dõi')
            }
          >
            <button
              onClick={(e) => { e.stopPropagation(); onToggleWatchlist(item); }}
              className={`p-1 rounded-md transition-all ${
                isBookmarked
                  ? 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-200 dark:border-amber-800 shadow-2xs'
                  : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50'
              }`}
            >
              {isBookmarked ? (
                <BookmarkCheck className="w-3.5 h-3.5 fill-amber-500/20 text-amber-500 dark:text-amber-400" />
              ) : (
                <BookmarkPlus className="w-3.5 h-3.5" />
              )}
            </button>
          </Tooltip>
          <Tooltip content="Xóa dòng lịch tàu này">
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
              className="p-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
};

export const VesselRow = React.memo(VesselRowInner);
VesselRow.displayName = 'VesselRow';
