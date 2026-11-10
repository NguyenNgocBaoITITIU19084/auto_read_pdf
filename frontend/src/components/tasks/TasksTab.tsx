import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Copy, Loader2, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { getBookingTasksApi, getCollections } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { copyTextToClipboard } from '../../utils/formatters';
import { bookingTasksMessage, taskTime } from '../../utils/bookingTasksMessage';
import type { Booking, BookingStatus, BookingTask, BookingTasks, Collection } from '../../types';
import type { TabId } from '../common/Tabs';
import { BookingDetailModal } from '../booking/BookingDetailModal';

interface Props {
  onNavigateTab?: (tab: TabId, query?: string) => void;
}

const SCOPE_STORAGE_KEY = 'tasks.collectionId';

const TONE = {
  late: {
    head: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/60',
    badge: 'bg-rose-600 text-white',
    time: 'text-rose-700 dark:text-rose-300',
    bar: 'bg-rose-500',
  },
  today: {
    head: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900/60',
    badge: 'bg-amber-500 text-white',
    time: 'text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500',
  },
  tomorrow: {
    head: 'bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-900/60',
    badge: 'bg-sky-600 text-white',
    time: 'text-sky-700 dark:text-sky-300',
    bar: 'bg-sky-500',
  },
} as const;

const readScope = (): number | null => {
  try {
    const n = Number(localStorage.getItem(SCOPE_STORAGE_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

const clean = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return s && s.toLowerCase() !== 'null' ? s : '';
};

/** Open bookings (not gated in yet) whose cut-off has passed, is later today or tomorrow, side by side in three
 *  columns, and the button that copies them as one message for the team's chat. Loaded fresh each time the tab opens. */
export const TasksTab: React.FC<Props> = ({ onNavigateTab }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const k = t.booking.tasks;
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState<number | null>(readScope);
  const [tasks, setTasks] = useState<BookingTasks | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Booking | null>(null);

  useEffect(() => {
    getCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setTasks(await getBookingTasksApi(collectionId));
    } catch {
      setTasks(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeScope = (id: number | null) => {
    setCollectionId(id);
    try {
      if (id) localStorage.setItem(SCOPE_STORAGE_KEY, String(id));
      else localStorage.removeItem(SCOPE_STORAGE_KEY);
    } catch {
      /* only a convenience */
    }
  };

  const scopeName = collectionId ? collections.find((c) => c.id === collectionId)?.name : undefined;
  const copy = async () => {
    if (!tasks) return;
    const ok = await copyTextToClipboard(bookingTasksMessage(tasks, t, scopeName));
    addToast(ok ? k.copied : k.copyFailed, ok ? 'success' : 'error');
  };

  const columns: { key: keyof typeof TONE; title: string; items: BookingTask[]; withDay: boolean }[] = tasks ? [
    { key: 'late', title: k.late, items: tasks.late, withDay: true },
    { key: 'today', title: tf(k.today, { date: tasks.date.slice(0, 5) }), items: tasks.today, withDay: false },
    { key: 'tomorrow', title: tf(k.tomorrow, { date: tasks.tomorrow_date.slice(0, 5) }), items: tasks.tomorrow, withDay: false },
  ] : [];
  const count = columns.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-3.5 gap-3 bg-slate-50/50 dark:bg-slate-950/50" data-testid="booking-tasks">
      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
        <div className="p-2 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-lg">
          <CalendarClock className="w-5 h-5" />
        </div>
        <div className="mr-auto min-w-0">
          <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100">{k.title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {k.buttonTooltip}
            {tasks && ` · ${tf(k.updated, { time: tasks.generated_at.slice(11, 16) })}`}
          </p>
        </div>

        <select
          aria-label={k.scopeLabel}
          value={collectionId ?? ''}
          onChange={(e) => changeScope(e.target.value ? Number(e.target.value) : null)}
          className="h-8 px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
        >
          <option value="">{k.scopeAll}</option>
          {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {k.refresh}
        </button>
        <button
          type="button"
          onClick={copy}
          disabled={!tasks || loading || count === 0}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white shadow-sm disabled:opacity-50"
        >
          <Copy className="w-3.5 h-3.5" />
          {k.copy}
        </button>
      </div>

      {failed ? (
        <div role="alert" className="flex items-center justify-between gap-2 p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
          <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{k.error}</span>
          <button type="button" onClick={() => void load()} className="font-bold underline">{k.retry}</button>
        </div>
      ) : !tasks ? (
        <div className="flex-1 flex justify-center items-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : count === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400">
          <CheckCircle2 className="w-9 h-9 text-emerald-500/70" />
          {k.empty}
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-3 overflow-y-auto lg:overflow-hidden">
          {columns.map((col) => {
            const tone = TONE[col.key];
            return (
              <section
                key={col.key}
                aria-label={col.title}
                className="flex flex-col min-h-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden"
              >
                <h2 className={`flex items-center justify-between gap-2 px-3 py-2 border-b text-xs font-bold ${tone.head}`}>
                  <span className="truncate">{col.title}</span>
                  <span className={`shrink-0 min-w-[1.5rem] text-center px-1.5 py-0.5 rounded-full text-[11px] ${tone.badge}`}>
                    {col.items.length}
                  </span>
                </h2>
                {col.items.length === 0 ? (
                  <p className="flex-1 flex items-center justify-center py-8 text-xs text-slate-400 dark:text-slate-500">{k.columnEmpty}</p>
                ) : (
                  <ul className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
                    {col.items.map((b) => {
                      const qty = clean(b["Q'ty"]);
                      const type = clean(b['Equipment Type']);
                      const details = [clean(b.Carrier), clean(b.Vessel), qty && type ? `${qty}x${type}` : '']
                        .filter(Boolean).join(' · ');
                      const cy = clean(b['Full return CY']);
                      return (
                        <li key={b.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(b)}
                            className="relative w-full text-left flex gap-3 pl-3.5 pr-2.5 py-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                          >
                            <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-full ${tone.bar}`} />
                            <span className={`shrink-0 w-[4.5rem] font-mono text-xs font-bold ${tone.time}`}>
                              {taskTime(b, col.withDay, t)}
                            </span>
                            <span className="min-w-0 flex-1 space-y-0.5">
                              <span className="flex items-center gap-2">
                                <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">{b['Booking No']}</span>
                                <span className="ml-auto shrink-0 px-1.5 py-px rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {t.booking.status.labels[b['Trạng thái'] as BookingStatus] || b['Trạng thái']}
                                </span>
                              </span>
                              {details && <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{details}</span>}
                              {(cy || !collectionId) && (
                                <span className="flex flex-wrap gap-1 pt-0.5">
                                  {cy && (
                                    <span className="px-1.5 py-px rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                      {tf(t.notifications.message.returnCy, { cy })}
                                    </span>
                                  )}
                                  {!collectionId && clean(b['Bộ sưu tập']) && (
                                    <span className="px-1.5 py-px rounded text-[10px] font-medium bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300">
                                      {b['Bộ sưu tập']}
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <BookingDetailModal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        booking={selected}
        onNavigateTab={onNavigateTab}
      />
    </div>
  );
};
