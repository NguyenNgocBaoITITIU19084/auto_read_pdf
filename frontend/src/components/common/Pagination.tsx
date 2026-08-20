import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, 
  Settings2, Check, X 
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Tooltip } from './Tooltip';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100, 200],
  className = '',
}) => {
  const { t } = useApp();
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customInput, setCustomInput] = useState<string>(String(pageSize));
  const customInputRef = useRef<HTMLInputElement>(null);

  const isAll = pageSize >= totalItems && totalItems > 0 && pageSize > 200;
  const totalPages = isAll || pageSize <= 0 ? 1 : Math.max(1, Math.ceil(totalItems / pageSize));

  // Ensure current page is valid when totalPages changes
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      onPageChange(totalPages);
    }
  }, [currentPage, totalPages, onPageChange]);

  useEffect(() => {
    setCustomInput(String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    if (isCustomOpen) {
      setTimeout(() => customInputRef.current?.focus(), 50);
    }
  }, [isCustomOpen]);

  const fromItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toItem = isAll ? totalItems : Math.min(currentPage * pageSize, totalItems);

  // Generate page numbers to display with smart ellipsis
  const getPageNumbers = (): (number | string)[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages];
    }

    if (currentPage >= totalPages - 3) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }

    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
  };

  const handleSelectPageSize = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'custom') {
      setIsCustomOpen(true);
      return;
    }
    if (val === 'all') {
      onPageSizeChange(Math.max(totalItems, 999999));
      return;
    }
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) {
      onPageSizeChange(parsed);
    }
  };

  const handleApplyCustom = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parsed = parseInt(customInput.trim(), 10);
    if (isNaN(parsed) || parsed < 1) {
      return;
    }
    // Cap custom page size between 1 and 2000 for reasonable DOM safety
    const clamped = Math.min(Math.max(1, parsed), 2000);
    onPageSizeChange(clamped);
    setIsCustomOpen(false);
  };

  const pages = getPageNumbers();

  return (
    <div
      className={`px-3.5 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300 shrink-0 ${className}`}
    >
      {/* Left: Summary info */}
      <div className="flex items-center gap-1.5 font-medium">
        <span>{t.common.showing}</span>
        <strong className="font-bold text-slate-900 dark:text-slate-100">
          {totalItems === 0 ? '0' : `${fromItem} - ${toItem}`}
        </strong>
        <span>{t.common.of}</span>
        <strong className="font-bold text-slate-900 dark:text-slate-100">{totalItems}</strong>
        <span>{t.common.items}</span>
      </div>

      {/* Right: Page Size Selector & Pagination Buttons */}
      <div className="flex items-center flex-wrap gap-2.5 ml-auto">
        {/* Page Size Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {t.common.rowsPerPage}
          </span>

          {!isCustomOpen ? (
            <div className="flex items-center gap-1">
              <select
                value={
                  isAll
                    ? 'all'
                    : pageSizeOptions.includes(pageSize)
                    ? String(pageSize)
                    : 'custom'
                }
                onChange={handleSelectPageSize}
                className="text-xs font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 focus:ring-2 focus:ring-primary-500 cursor-pointer shadow-2xs"
              >
                {pageSizeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt} {t.common.perPage}
                  </option>
                ))}
                {!pageSizeOptions.includes(pageSize) && !isAll && (
                  <option value="custom">
                    {pageSize} {t.common.perPage} ({t.common.custom})
                  </option>
                )}
                <option value="all">{t.common.allRows}</option>
                <option value="custom">{t.common.custom}</option>
              </select>

              <Tooltip content={t.common.customPageSize}>
                <button
                  type="button"
                  onClick={() => setIsCustomOpen(true)}
                  className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </div>
          ) : (
            <form onSubmit={handleApplyCustom} className="flex items-center gap-1">
              <input
                ref={customInputRef}
                type="number"
                min="1"
                max="2000"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="Số dòng"
                className="w-16 text-xs font-bold text-center bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-primary-400 dark:border-primary-500 rounded-lg py-1 px-1 focus:ring-2 focus:ring-primary-500"
              />
              <Tooltip content={t.common.apply}>
                <button
                  type="submit"
                  className="p-1 rounded-md bg-primary-600 hover:bg-primary-700 text-white shadow-2xs transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
              <Tooltip content={t.common.cancel}>
                <button
                  type="button"
                  onClick={() => setIsCustomOpen(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </form>
          )}
        </div>

        {/* Page Nav Buttons */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1 border-l border-slate-200 dark:border-slate-700 pl-2.5">
            {/* First page */}
            <Tooltip content={t.common.firstPage}>
              <button
                type="button"
                onClick={() => onPageChange(1)}
                disabled={currentPage === 1}
                className="p-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
            </Tooltip>

            {/* Previous page */}
            <Tooltip content={t.common.prevPage}>
              <button
                type="button"
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </Tooltip>

            {/* Page number buttons */}
            <div className="flex items-center gap-1">
              {pages.map((p, idx) => {
                if (p === '...') {
                  return (
                    <span
                      key={`ellipsis-${idx}`}
                      className="px-1 text-slate-400 text-xs font-semibold select-none"
                    >
                      …
                    </span>
                  );
                }

                const pageNum = Number(p);
                const isActive = pageNum === currentPage;

                return (
                  <button
                    key={`page-${pageNum}`}
                    type="button"
                    onClick={() => onPageChange(pageNum)}
                    className={`min-w-[26px] h-[26px] px-1 text-xs font-bold rounded-lg transition-all flex items-center justify-center ${
                      isActive
                        ? 'bg-primary-600 text-white shadow-2xs font-extrabold scale-105'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-800'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            {/* Next page */}
            <Tooltip content={t.common.nextPage}>
              <button
                type="button"
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </Tooltip>

            {/* Last page */}
            <Tooltip content={t.common.lastPage}>
              <button
                type="button"
                onClick={() => onPageChange(totalPages)}
                disabled={currentPage === totalPages}
                className="p-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
};
