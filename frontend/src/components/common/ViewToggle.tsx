import React, { useEffect, useState } from 'react';
import { CalendarDays, Table2 } from 'lucide-react';
import { Tooltip } from './Tooltip';

export type TableView = 'table' | 'calendar';

/** Table or calendar for a tab, remembered per tab in localStorage. */
export function useTableView(storageKey: string): [TableView, (view: TableView) => void] {
  const [view, setView] = useState<TableView>(() => {
    try {
      return localStorage.getItem(storageKey) === 'calendar' ? 'calendar' : 'table';
    } catch {
      return 'table';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, view);
    } catch {
      /* only a convenience */
    }
  }, [storageKey, view]);
  return [view, setView];
}

/** Segmented "Table | Calendar" switch. */
export const ViewToggle: React.FC<{
  view: TableView;
  onChange: (view: TableView) => void;
  labels: { viewTable: string; viewCalendar: string; viewTooltip: string };
}> = ({ view, onChange, labels }) => (
  <Tooltip content={labels.viewTooltip}>
    <div role="group" className="shrink-0 inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5">
      {([
        ['table', Table2, labels.viewTable],
        ['calendar', CalendarDays, labels.viewCalendar],
      ] as const).map(([v, Icon, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
            view === v
              ? 'bg-white dark:bg-slate-900 text-primary-700 dark:text-primary-300 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  </Tooltip>
);
