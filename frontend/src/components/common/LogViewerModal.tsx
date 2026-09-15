import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Copy, Search, ChevronRight } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { getLogsApi, LogEntry } from '../../services/api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { tf } from '../../services/i18nFormat';
import { errorMessage } from '../vessel/tableHelpers';

const LEVEL_BADGE: Record<string, string> = {
  ERROR: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  CRITICAL: 'bg-rose-600 text-white',
  WARNING: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  INFO: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  DEBUG: 'bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500',
};

export const LogViewerModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { t, addToast } = useApp();
  const [source, setSource] = useState<'app' | 'errors'>('errors');
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query, 300);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [logDir, setLogDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLogsApi({ source, level: level || undefined, q: q || undefined, limit: 300 });
      setEntries(res.entries);
      setLogDir(res.log_dir);
    } catch (e) {
      addToast(errorMessage(e, t.common.error), 'error');
    } finally {
      setLoading(false);
    }
  }, [source, level, q, addToast, t]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const copyEntry = async (e: LogEntry) => {
    await navigator.clipboard.writeText(`${e.time} [${e.level}] [${e.logger}] [req=${e.request_id}] ${e.message}`);
    addToast(t.logs.copied, 'success');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.logs.modalTitle} maxWidth="max-w-5xl">
      <div className="flex flex-col gap-3 min-h-[60vh]">
        <div className="flex flex-wrap items-center gap-2">
          <select value={source} onChange={(e) => setSource(e.target.value as 'app' | 'errors')}
            className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
            <option value="errors">{t.logs.sourceErrors}</option>
            <option value="app">{t.logs.sourceApp}</option>
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)}
            className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
            <option value="">{t.logs.levelAll}</option>
            <option value="WARNING">WARNING+</option>
            <option value="ERROR">ERROR+</option>
          </select>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.logs.searchPlaceholder}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary-500" />
          </div>
          <button type="button" onClick={load} title={t.logs.refresh}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex-1 overflow-auto border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
          {entries.length === 0 && !loading && (
            <div className="py-12 text-center text-slate-400 font-sans text-xs">{t.logs.empty}</div>
          )}
          {entries.map((e, i) => {
            const multiline = e.message.includes('\n');
            const open = expanded === i;
            return (
              <div key={`${e.time}-${i}`} className="group px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div className="flex items-start gap-2">
                  <button type="button" disabled={!multiline} onClick={() => setExpanded(open ? null : i)}
                    className="mt-0.5 text-slate-400 disabled:opacity-0">
                    <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
                  </button>
                  <span className="text-slate-400 whitespace-nowrap">{e.time}</span>
                  <span className={`px-1.5 rounded font-bold ${LEVEL_BADGE[e.level] || LEVEL_BADGE.INFO}`}>{e.level}</span>
                  <span className="text-slate-500 whitespace-nowrap">{e.logger}</span>
                  {e.request_id !== '-' && <span className="text-primary-600 dark:text-primary-400 whitespace-nowrap">#{e.request_id}</span>}
                  <span className="flex-1 min-w-0 text-slate-800 dark:text-slate-200 break-words">
                    {open ? <pre className="whitespace-pre-wrap">{e.message}</pre> : e.message.split('\n')[0]}
                  </span>
                  <button type="button" onClick={() => copyEntry(e)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-primary-600">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {logDir && <p className="text-[11px] text-slate-400">{tf(t.logs.location, { path: logDir })}</p>}
      </div>
    </Modal>
  );
};
