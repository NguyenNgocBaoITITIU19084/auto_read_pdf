import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Loader2, X, CheckSquare } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';

export interface BulkAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** Optional tooltip (native title) */
  title?: string;
}

export interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  actions: BulkAction[];
  /**
   * 'floating' (default): fixed pill at the bottom-center of the window.
   * 'sticky': in-flow bar that sticks to the top of its scroll container.
   */
  variant?: 'floating' | 'sticky';
  /** Optional extra content rendered after the count (e.g. "Chọn tất cả 1.234 kết quả" link) */
  extra?: React.ReactNode;
  className?: string;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  count,
  onClear,
  actions,
  variant = 'floating',
  extra,
  className = '',
}) => {
  const { t } = useApp();

  if (count <= 0) return null;

  const container =
    variant === 'floating'
      ? 'fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-fit rounded-2xl shadow-2xl shadow-slate-900/20'
      : 'sticky top-0 z-20 w-full rounded-xl shadow-sm';

  return (
    <div
      role="toolbar"
      aria-label={tf(t.bulk.selectedCount, { count })}
      className={`${container} flex flex-wrap items-center gap-2 px-3 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-primary-200 dark:border-primary-800/70 animate-in fade-in slide-in-from-bottom-2 duration-150 ${className}`}
    >
      <div className="flex items-center gap-2 pr-2 mr-0.5 border-r border-slate-200 dark:border-slate-700 shrink-0">
        <span className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 text-xs font-bold whitespace-nowrap">
          <CheckSquare className="w-3.5 h-3.5" />
          {tf(t.bulk.selectedCount, { count })}
        </span>
        {extra}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => {
          const Icon = action.icon;
          const isDisabled = !!action.disabled || !!action.loading;
          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              disabled={isDisabled}
              title={action.title || action.label}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
                action.danger
                  ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 dark:border-rose-700 shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {action.loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Icon className={`w-3.5 h-3.5 ${action.danger ? '' : 'text-slate-500 dark:text-slate-400'}`} />
              )}
              <span className="hidden sm:inline">{action.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
        title={t.bulk.clearSelection}
      >
        <X className="w-3.5 h-3.5" />
        <span>{t.bulk.clearSelection}</span>
      </button>
    </div>
  );
};
