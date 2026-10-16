import React, { useRef } from 'react';
import { CalendarDays, FileSpreadsheet, FolderOpen } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';
import { fileDate, insertPlaceholder, resolveFilename } from './exportTemplates';

/** File name with {date} / {collection} buttons that show what they put in, and the resulting name. */
export const FilenameField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  collectionName?: string;
  fallback: string;
}> = ({ label, value, onChange, collectionName, fallback }) => {
  const { t } = useApp();
  const e = t.exportManager;
  const inputRef = useRef<HTMLInputElement>(null);

  const insert = (token: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const next = insertPlaceholder(value, token, start, end);
    onChange(next.text);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(next.caret, next.caret);
    });
  };

  const tokens: [string, React.ReactNode, string][] = [
    ['{date}', <CalendarDays key="d" className="w-3 h-3" />, tf(e.tokenDateValue, { value: fileDate() })],
    ['{collection}', <FolderOpen key="c" className="w-3 h-3" />, tf(e.tokenCollectionValue, { value: collectionName || '—' })],
  ];

  return (
    <div>
      <label className="block">
        <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">{label}</span>
        <span className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus-within:ring-2 focus-within:ring-primary-500">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(ev) => onChange(ev.target.value)}
            aria-label={label}
            className="flex-1 min-w-0 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none"
          />
          <span className="px-2 text-xs text-slate-400">.xlsx</span>
        </span>
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-slate-500 dark:text-slate-400">{e.filenameHint}</span>
        {tokens.map(([token, icon, text]) => (
          <button
            key={token}
            type="button"
            onClick={() => insert(token)}
            title={tf(e.tokenTitle, { token })}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 font-semibold text-slate-600 dark:text-slate-300 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-950/40"
          >
            {icon}
            {text}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-800 dark:text-emerald-300 min-w-0">
        <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
        <span className="shrink-0">{e.filenameResult}</span>
        <span className="font-semibold truncate" title={resolveFilename(value, { collection: collectionName, fallback })}>
          {resolveFilename(value, { collection: collectionName, fallback })}
        </span>
      </div>
    </div>
  );
};
