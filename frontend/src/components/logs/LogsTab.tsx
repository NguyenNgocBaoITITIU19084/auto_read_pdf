import React from 'react';
import { ScrollText } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { LogViewerPanel } from './LogViewerPanel';

export const LogsTab: React.FC = () => {
  const { t } = useApp();

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-3.5 gap-2.5 bg-slate-50/50 dark:bg-slate-950/50">
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="p-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg">
          <ScrollText className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.logs.modalTitle}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.logs.cardDesc}</p>
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-3 overflow-hidden min-h-0">
        <LogViewerPanel />
      </div>
    </div>
  );
};
