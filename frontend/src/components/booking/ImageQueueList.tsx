import React from 'react';
import {
  AlertTriangle, Check, CheckCircle2, Clock, Copy, FileText, Loader2, Pause, Play, Plus, RotateCw, Trash2, XCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ImageQueueValue } from '../../context/ImageQueueContext';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { tf } from '../../services/i18nFormat';
import { QueueItem, QueueStatus, hasValue, isPdfItem } from '../../services/imageQueueLogic';

export const STATUS_STYLE: Record<QueueStatus, { chip: string; icon: React.ReactNode }> = {
  queued: {
    chip: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    icon: <Clock className="w-3 h-3" />,
  },
  reading: {
    chip: 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  success: {
    chip: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  review: {
    chip: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  failed: {
    chip: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    icon: <XCircle className="w-3 h-3" />,
  },
  saved: {
    chip: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    icon: <Check className="w-3 h-3" />,
  },
};

export const StatusChip: React.FC<{ status: QueueStatus }> = ({ status }) => {
  const { t } = useApp();
  const st = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold whitespace-nowrap ${st.chip}`}>
      {st.icon}
      {t.booking.imageQueue.status[status]}
    </span>
  );
};

/** "Gemini" / "OCR" with the model when known; null while not read yet. */
export function useEngineLabel() {
  const { t } = useApp();
  return (item: Pick<QueueItem, 'engine' | 'model'>): { label: string; cls: string } | null => {
    if (item.engine === 'gemini') {
      return {
        label: item.model ? `${t.booking.paste.engineGemini} · ${item.model}` : t.booking.paste.engineGemini,
        cls: 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
      };
    }
    if (item.engine === 'pdf') {
      return { label: t.booking.paste.enginePdf, cls: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' };
    }
    if (item.engine === 'ocr') {
      return { label: t.booking.paste.engineOcr, cls: 'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' };
    }
    if (item.engine === 'none') {
      return { label: t.booking.paste.engineNone, cls: 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800' };
    }
    return null;
  };
}

const PdfThumb: React.FC = () => (
  <div className="w-10 h-10 rounded-md shrink-0 flex flex-col items-center justify-center border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400">
    <FileText className="w-4 h-4" />
    <span className="text-[8px] font-black leading-none mt-0.5">PDF</span>
  </div>
);

const ImageThumb: React.FC<{ file: File }> = ({ file }) => {
  const url = useObjectUrl(file);
  return url ? (
    <img src={url} alt="" className="w-10 h-10 rounded-md object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100 dark:bg-slate-800" />
  ) : (
    <div className="w-10 h-10 rounded-md bg-slate-100 dark:bg-slate-800 shrink-0" />
  );
};

interface RowProps {
  item: QueueItem;
  selected: boolean;
  duplicate: 'batch' | 'db' | null;
  onSelect: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

const QueueRow: React.FC<RowProps> = React.memo(({ item, selected, duplicate, onSelect, onRetry, onRemove }) => {
  const { t } = useApp();
  const q = t.booking.imageQueue;
  const engineLabel = useEngineLabel();
  const engine = engineLabel(item);
  const first = item.error || item.warnings[0];
  const summary = [item.fields['Booking No'], item.fields['Vessel']].filter(hasValue).join(' · ');

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
      className={`group relative flex gap-2 p-2 rounded-xl border cursor-pointer transition-colors ${
        selected
          ? 'border-primary-400 dark:border-primary-500 bg-primary-50/80 dark:bg-primary-950/40 shadow-[inset_3px_0_0_0_theme(colors.primary.500)]'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-primary-300 dark:hover:border-primary-700'
      }`}
    >
      {isPdfItem(item) ? <PdfThumb /> : <ImageThumb file={item.file} />}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate" title={item.name}>{item.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <StatusChip status={item.status} />
          {engine && (
            <span className={`px-1.5 py-0.5 rounded-md border text-[10px] font-bold truncate max-w-[9rem] ${engine.cls}`} title={engine.label}>
              {engine.label}
            </span>
          )}
          {duplicate && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800">
              <Copy className="w-3 h-3" />
              {duplicate === 'db' ? q.duplicateDb : q.duplicateBatch}
            </span>
          )}
        </div>
        {summary && <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate" title={summary}>{summary}</div>}
        {first && item.status !== 'saved' && (
          <div className={`text-[10px] truncate ${item.status === 'failed' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`} title={first}>
            {first}
          </div>
        )}
      </div>
      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {item.status === 'failed' && (
          <button
            type="button"
            aria-label={q.reRead}
            title={q.reRead}
            onClick={(e) => { e.stopPropagation(); onRetry(item.id); }}
            className="p-1 rounded-md bg-white/90 dark:bg-slate-800/90 text-slate-500 hover:text-primary-600 border border-slate-200 dark:border-slate-700"
          >
            <RotateCw className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          aria-label={q.remove}
          title={q.remove}
          onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
          className="p-1 rounded-md bg-white/90 dark:bg-slate-800/90 text-slate-500 hover:text-rose-600 border border-slate-200 dark:border-slate-700"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
});
QueueRow.displayName = 'QueueRow';

interface ListProps {
  queue: ImageQueueValue;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddFiles: () => void;
}

/** Left strip of the image modal: every queued image with its status, plus batch controls. */
export const ImageQueueList: React.FC<ListProps> = ({ queue, selectedId, onSelect, onAddFiles }) => {
  const { t } = useApp();
  const q = t.booking.imageQueue;
  const { items, stats, paused, batchDuplicates } = queue;
  const busy = stats.queued + stats.reading > 0;
  const pct = stats.total > 0 ? Math.round((stats.finished / stats.total) * 100) : 0;
  const successCount = items.filter((i) => i.status === 'success' && !batchDuplicates.has(i.id) && !i.dbDuplicate).length;
  const btn =
    'flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="w-full md:w-64 shrink-0 flex flex-col min-h-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
      <div className="p-2.5 space-y-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold text-slate-800 dark:text-slate-100">{tf(q.progress, { done: stats.finished, total: stats.total })}</span>
          {busy && (
            <button
              type="button"
              onClick={paused ? queue.resume : queue.pause}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
            >
              {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {paused ? q.resume : q.pause}
            </button>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div className="h-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          {tf(q.summary, { success: stats.success + stats.saved, review: stats.review, failed: stats.failed })}
        </div>
      </div>

      <div role="listbox" aria-label={q.title} className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {items.map((item) => (
          <QueueRow
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            duplicate={item.dbDuplicate ? 'db' : batchDuplicates.has(item.id) ? 'batch' : null}
            onSelect={onSelect}
            onRetry={queue.retry}
            onRemove={queue.remove}
          />
        ))}
      </div>

      <div className="p-2 space-y-1.5 border-t border-slate-200 dark:border-slate-800">
        <button
          type="button"
          disabled={successCount === 0}
          onClick={() => void queue.saveAllSuccessful()}
          className={`${btn} w-full bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {tf(q.saveAll, { count: successCount })}
        </button>
        {stats.failed > 0 && (
          <button type="button" onClick={queue.retryFailed} className={`${btn} w-full border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40`}>
            <RotateCw className="w-3.5 h-3.5" />
            {tf(q.retryFailed, { count: stats.failed })}
          </button>
        )}
        <div className="flex gap-1.5">
          <button type="button" onClick={onAddFiles} className={`${btn} flex-1 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800`}>
            <Plus className="w-3.5 h-3.5" />
            {q.addMore}
          </button>
          {stats.saved > 0 && (
            <button type="button" onClick={queue.clearSaved} className={`${btn} border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800`} title={q.clearSaved}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
