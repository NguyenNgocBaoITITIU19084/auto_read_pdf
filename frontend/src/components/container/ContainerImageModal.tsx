import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Copy, Image as ImageIcon, Key, Loader2, Maximize2, Pause,
  Play, Plus, RefreshCw, RotateCw, Trash2, Upload, XCircle, ClipboardPaste, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useContainerImageQueue } from '../../context/ContainerImageQueueContext';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { tf } from '../../services/i18nFormat';
import { ContainerFields, ContainerQueueItem, ContainerQueueStatus, containerNoIssue } from '../../services/containerImageQueueLogic';
import { Modal } from '../common/Modal';
import { AISettingsCard } from '../common/AISettingsCard';
import { STATUS_STYLE, useEngineLabel } from '../booking/ImageQueueList';
import { readClipboardImageFile } from '../booking/clipboard';

export interface ContainerLookupResult {
  /** Rows ePort returned (and that were added to the table) */
  count: number;
  message?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Terminal the lookup runs on (shared with the Container tab's selector) */
  siteId: string;
  onSiteChange: (siteId: string) => void;
  collectionName?: string;
  /** Looks the container up on ePort and adds the result to the table */
  onLookup: (containerNo: string) => Promise<ContainerLookupResult>;
}

const SITES = ['CTL', 'GNL', 'THP', 'CMS', 'IST', 'TNT'] as const;
const inputCls = 'w-full text-sm font-mono font-semibold rounded-lg px-3 py-1.5 border focus:ring-2 focus:ring-purple-500 focus:outline-none text-slate-900 dark:text-slate-100';
const editedCls = 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700';
const plainCls = 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700';

const Chip: React.FC<{ status: ContainerQueueStatus }> = ({ status }) => {
  const { t } = useApp();
  const st = STATUS_STYLE[status === 'used' ? 'saved' : status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold whitespace-nowrap ${st.chip}`}>
      {st.icon}
      {t.container.imageOcr.status[status]}
    </span>
  );
};

const Thumb: React.FC<{ file: File }> = ({ file }) => {
  const url = useObjectUrl(file);
  return url
    ? <img src={url} alt="" className="w-10 h-10 rounded-md object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100 dark:bg-slate-800" />
    : <div className="w-10 h-10 rounded-md bg-slate-100 dark:bg-slate-800 shrink-0" />;
};

export const ContainerImageModal: React.FC<Props> = ({ isOpen, onClose, siteId, onSiteChange, collectionName, onLookup }) => {
  const { t } = useApp();
  const L = t.container.imageOcr;
  const q = t.booking.imageQueue;
  const { addToast } = useToastActions();
  const queue = useContainerImageQueue();
  const { items, stats, paused, duplicates } = queue;
  const engineLabel = useEngineLabel();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showAISettings, setShowAISettings] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [readingClipboard, setReadingClipboard] = useState(false);
  const [savingAll, setSavingAll] = useState(false);

  const showList = items.length > 1;
  const selected = items.find((i) => i.id === selectedId) || null;
  const previewUrl = useObjectUrl(selected?.file);
  const engine = selected && selected.engine ? engineLabel({ engine: selected.engine, model: selected.model }) : null;
  const noKey = !paused && items.some((i) => i.errorKind === 'no_key');
  const readyAll = items.filter((i) => i.status === 'success' && !duplicates.has(i.id));
  const isBusy = !!selected?.saving || savingAll;

  // Keep a valid selection: the first photo still to review
  useEffect(() => {
    if (!isOpen) return;
    if (selectedId !== null && items.some((i) => i.id === selectedId)) return;
    setSelectedId((items.find((i) => i.status !== 'used') ?? items[0] ?? null)?.id ?? null);
  }, [isOpen, items, selectedId]);

  useEffect(() => { setZoom(1); setRotation(0); }, [selectedId]);
  useEffect(() => { if (!isOpen) setShowAISettings(false); }, [isOpen]);

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const before = items.length;
    const added = queue.enqueue(files);
    if (added > 0 && before === 0) setShowAISettings(false);
  };

  const pasteFromClipboard = async () => {
    try {
      setReadingClipboard(true);
      const file = await readClipboardImageFile();
      if (file) addFiles([file]);
      else addToast(t.booking.paste.clipboardNoImage, 'info');
    } catch {
      addToast(t.booking.paste.clipboardReadError, 'error');
    } finally {
      setReadingClipboard(false);
    }
  };

  /** Looks one photo's container up on ePort and adds it to the table. Returns true when ePort had it. */
  const lookupItem = async (item: ContainerQueueItem, quiet = false): Promise<boolean> => {
    const no = item.fields.container_no;
    if (!no || item.saving) return false;
    queue.setSaving(item.id, true);
    try {
      const res = await onLookup(no);
      if (res.count > 0) {
        queue.markUsed([item.id]);
        if (!quiet) addToast(tf(L.added, { no, count: res.count }), 'success');
        return true;
      }
      queue.setSaving(item.id, false);
      if (!quiet) addToast(res.message || tf(L.notFound, { no }), 'info');
      return false;
    } catch (e: any) {
      queue.setSaving(item.id, false);
      if (!quiet) addToast(tf(L.lookupFailed, { error: e?.response?.data?.detail || e?.message || '' }), 'error');
      return false;
    }
  };

  const handleApprove = async () => {
    if (!selected) return;
    const ok = await lookupItem(selected);
    if (!ok) return;
    const next = items.find((i) => i.id !== selected.id && i.status !== 'used' && i.status !== 'queued' && i.status !== 'reading');
    if (next) setSelectedId(next.id);
    else if (items.every((i) => i.id === selected.id || i.status === 'used')) onClose();
  };

  const handleApproveAll = async () => {
    setSavingAll(true);
    let added = 0;
    let missed = 0;
    for (const item of readyAll) {
      if (await lookupItem(item, true)) added += 1;
      else missed += 1;
    }
    setSavingAll(false);
    addToast(tf(L.addedAll, { added, missed }), missed > 0 ? 'info' : 'success');
  };

  const field = (item: ContainerQueueItem, key: keyof ContainerFields, label: string, extra?: React.ReactNode) => {
    const edited = item.fields[key] !== item.original[key];
    const locked = item.status === 'used';
    return (
      <div>
        <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
          {label}
          {edited && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">· {q.edited}</span>}
        </label>
        <input
          value={item.fields[key]}
          disabled={locked}
          onChange={(e) => queue.setField(item.id, key, e.target.value)}
          inputMode={key === 'container_no' ? 'text' : 'numeric'}
          className={`${inputCls} ${edited ? editedCls : plainCls} disabled:opacity-60`}
        />
        {extra}
      </div>
    );
  };

  const issueNote = (item: ContainerQueueItem) => {
    const no = item.fields.container_no;
    if (!no) return null;
    const issue = containerNoIssue(no);
    if (issue === 'format') return <span className="block mt-1 text-[11px] text-rose-600 dark:text-rose-400">{L.issueFormat}</span>;
    if (issue === 'check_digit') return <span className="block mt-1 text-[11px] text-amber-700 dark:text-amber-400">{L.issueCheck}</span>;
    return (
      <span className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />{L.checkOk}
      </span>
    );
  };

  const banner = (tone: 'amber' | 'sky', text: string, action?: React.ReactNode) => (
    <div role={tone === 'amber' ? 'alert' : 'status'} className={`mb-2.5 flex items-start gap-2 p-2.5 rounded-lg border text-[11px] ${
      tone === 'amber'
        ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
        : 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300'
    }`}>
      <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
      <span className="flex-1">{text}</span>
      {action}
    </div>
  );
  const aiKeyBtn = (
    <button type="button" onClick={() => setShowAISettings(true)} className="inline-flex items-center gap-1 font-bold underline shrink-0">
      <Key className="w-3 h-3" />AI
    </button>
  );

  const listBtn = 'flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={L.title} maxWidth={showList ? 'max-w-7xl' : 'max-w-5xl'}>
      {paused && banner('amber',
        paused === 'quota' ? L.pausedQuota : paused === 'invalid_key' ? L.pausedInvalidKey : paused === 'unavailable' ? L.pausedUnavailable : L.pausedUser,
        <>
          {paused === 'invalid_key' && aiKeyBtn}
          <button type="button" onClick={queue.resume} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold shrink-0">
            <Play className="w-3 h-3" />{L.resume}
          </button>
        </>)}
      {noKey && banner('sky', L.noKey, aiKeyBtn)}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files || [])); }}
        className="flex flex-col md:flex-row gap-3 h-[75vh] max-h-[720px] select-none outline-none"
      >
        {showList && (
          <div className="w-full md:w-64 shrink-0 flex flex-col min-h-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
            <div className="p-2.5 space-y-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-slate-800 dark:text-slate-100">{tf(L.progress, { done: stats.done, total: stats.total })}</span>
                {stats.queued + stats.reading > 0 && (
                  <button type="button" onClick={paused ? queue.resume : queue.pause} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold">
                    {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                    {paused ? L.resume : L.pause}
                  </button>
                )}
              </div>
              <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div className="h-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {tf(L.summary, { success: stats.success + stats.used, review: stats.review, failed: stats.failed })}
              </div>
            </div>

            <div role="listbox" aria-label={L.title} className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
              {items.map((item) => {
                const eng = item.engine ? engineLabel({ engine: item.engine, model: item.model }) : null;
                const first = item.error || item.warnings[0];
                const on = item.id === selectedId;
                return (
                  <div
                    key={item.id}
                    role="option"
                    aria-selected={on}
                    tabIndex={0}
                    onClick={() => setSelectedId(item.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(item.id); } }}
                    className={`group relative flex gap-2 p-2 rounded-xl border cursor-pointer transition-colors ${
                      on
                        ? 'border-primary-400 dark:border-primary-500 bg-primary-50/80 dark:bg-primary-950/40 shadow-[inset_3px_0_0_0_theme(colors.primary.500)]'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-primary-300 dark:hover:border-primary-700'
                    }`}
                  >
                    <Thumb file={item.file} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <span className="block text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate" title={item.name}>{item.name}</span>
                      <div className="flex flex-wrap items-center gap-1">
                        <Chip status={item.status} />
                        {eng && <span className={`px-1.5 py-0.5 rounded-md border text-[10px] font-bold truncate max-w-[9rem] ${eng.cls}`} title={eng.label}>{eng.label}</span>}
                        {duplicates.has(item.id) && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800">
                            <Copy className="w-3 h-3" />{L.duplicate}
                          </span>
                        )}
                      </div>
                      {item.fields.container_no && <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate">{item.fields.container_no}</div>}
                      {first && item.status !== 'used' && (
                        <div className={`text-[10px] truncate ${item.status === 'failed' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`} title={first}>{first}</div>
                      )}
                    </div>
                    <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {item.status === 'failed' && (
                        <button type="button" aria-label={L.retry} title={L.retry} onClick={(e) => { e.stopPropagation(); queue.retry(item.id); }} className="p-1 rounded-md bg-white/90 dark:bg-slate-800/90 text-slate-500 hover:text-primary-600 border border-slate-200 dark:border-slate-700">
                          <RotateCw className="w-3 h-3" />
                        </button>
                      )}
                      <button type="button" aria-label={L.remove} title={L.remove} onClick={(e) => { e.stopPropagation(); queue.remove(item.id); }} className="p-1 rounded-md bg-white/90 dark:bg-slate-800/90 text-slate-500 hover:text-rose-600 border border-slate-200 dark:border-slate-700">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-2 space-y-1.5 border-t border-slate-200 dark:border-slate-800">
              <button type="button" disabled={readyAll.length === 0 || isBusy} onClick={() => void handleApproveAll()} className={`${listBtn} w-full bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600`}>
                {savingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {tf(L.lookupAll, { count: readyAll.length })}
              </button>
              {stats.failed > 0 && (
                <button type="button" onClick={queue.retryFailed} className={`${listBtn} w-full border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40`}>
                  <RotateCw className="w-3.5 h-3.5" />
                  {tf(L.retryFailed, { count: stats.failed })}
                </button>
              )}
              <div className="flex gap-1.5">
                <button type="button" onClick={() => fileInputRef.current?.click()} className={`${listBtn} flex-1 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800`}>
                  <Plus className="w-3.5 h-3.5" />{L.addMore}
                </button>
                {stats.used > 0 && (
                  <button type="button" onClick={queue.clearUsed} className={`${listBtn} border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800`} title={L.clearUsed} aria-label={L.clearUsed}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Preview */}
        <div className="w-full md:flex-1 min-w-0 flex flex-col bg-slate-950/90 rounded-xl overflow-hidden border border-slate-800 relative">
          {previewUrl ? (
            <>
              <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between bg-slate-900/80 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-700/80 text-white shadow-lg">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} title={t.booking.imageModal.zoomOut} className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"><ZoomOut className="w-4 h-4" /></button>
                  <span className="text-[11px] font-mono px-1.5 text-slate-400">{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} title={t.booking.imageModal.zoomIn} className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"><ZoomIn className="w-4 h-4" /></button>
                  <button type="button" onClick={() => setZoom(1)} title={t.booking.imageModal.resetZoom} className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"><Maximize2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} title={t.booking.imageModal.rotate} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-colors">
                    <RotateCw className="w-3.5 h-3.5" /><span>{rotation}°</span>
                  </button>
                  <button type="button" onClick={() => void pasteFromClipboard()} disabled={readingClipboard} title={t.booking.paste.pasteImageButton} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-colors disabled:opacity-50">
                    {readingClipboard ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardPaste className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={() => fileInputRef.current?.click()} title={L.addMore} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-[11px] font-semibold text-white transition-colors">
                    <Upload className="w-3.5 h-3.5" /><span>{L.addMore}</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto flex items-center justify-center p-4 min-h-0 bg-slate-950">
                <div style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: 'center center', transition: 'transform 0.15s ease-out' }} className="max-w-full max-h-full flex items-center justify-center shadow-2xl">
                  <img src={previewUrl} alt="Container" className="max-w-full max-h-[60vh] object-contain rounded-md select-none pointer-events-none" />
                </div>
              </div>
              <div className="px-3 py-1.5 bg-slate-900 border-t border-slate-800 text-[11px] font-medium text-slate-400 flex items-center justify-between">
                <span className="truncate max-w-[200px]" title={selected?.name}>{selected?.name}</span>
                <span>{selected?.file.size ? `${Math.round(selected.file.size / 1024)} KB` : ''}</span>
              </div>
            </>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex flex-col items-center justify-center p-6 text-center cursor-pointer border-2 border-dashed border-slate-700 hover:border-purple-500 transition-all rounded-xl m-3 bg-slate-900/40 hover:bg-slate-900/80"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 text-white flex items-center justify-center shadow-lg mb-3.5">
                <ImageIcon className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-bold text-slate-100 mb-1">{t.booking.imageModal.dropOrPaste}</h4>
              <p className="text-xs text-slate-400 max-w-xs mb-4">Hỗ trợ các định dạng PNG, JPG, JPEG, WEBP hoặc chụp màn hình rồi nhấn Ctrl+V. Có thể chọn nhiều ảnh cùng lúc.</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void pasteFromClipboard(); }}
                  disabled={readingClipboard}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-md shadow-indigo-500/20 disabled:opacity-50"
                >
                  {readingClipboard ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />}
                  {t.booking.paste.pasteImageButton}
                </button>
                <button type="button" className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-all shadow-md shadow-purple-500/20">
                  {t.booking.imageModal.selectAnother}
                </button>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              addFiles(files);
            }}
          />
        </div>

        {/* Result / form */}
        <div className="w-full md:flex-1 min-w-0 flex flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/50 shrink-0">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{L.site}:</span>
              <select
                value={siteId}
                onChange={(e) => onSiteChange(e.target.value)}
                aria-label={L.site}
                className="text-[11px] font-bold px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
              >
                {SITES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {selected && <Chip status={selected.status} />}
              {engine && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${engine.cls}`} title={`${q.readBy}: ${engine.label}`}>{engine.label}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowAISettings(!showAISettings)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900 border border-purple-200 dark:border-purple-800 transition-colors shrink-0"
              title="Cài đặt Google Gemini API Key riêng của bạn"
            >
              <Key className="w-3 h-3 text-purple-500" />
              <span>{showAISettings ? 'Ẩn Cài đặt Key' : 'Cài đặt AI Key'}</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 min-h-0 text-xs">
            {showAISettings ? (
              <div className="space-y-3">
                <AISettingsCard />
                <div className="flex justify-end">
                  <button type="button" onClick={() => setShowAISettings(false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600">
                    Quay lại xem kết quả trích xuất
                  </button>
                </div>
              </div>
            ) : !selected ? (
              <div className="h-full flex items-center justify-center text-center text-slate-400 dark:text-slate-500 text-xs">{L.selectImage}</div>
            ) : selected.status === 'reading' || selected.status === 'queued' ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div className={`w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400 flex items-center justify-center ${selected.status === 'reading' ? 'animate-spin' : ''}`}>
                  {selected.status === 'reading' ? <RefreshCw className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
                </div>
                <div>
                  <h5 className="font-bold text-slate-800 dark:text-slate-200 text-sm">{selected.status === 'reading' ? L.extracting : L.status.queued}</h5>
                  {selected.status === 'queued' && <p className="text-xs text-slate-400 mt-1">{L.waiting}</p>}
                </div>
              </div>
            ) : selected.status === 'failed' ? (
              <div role="alert" className="p-3 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-[11px]"><XCircle className="w-4 h-4" />{L.status.failed}</div>
                <p className="text-[11px] break-words">{tf(L.failedNote, { error: selected.error || selected.warnings[0] || '' })}</p>
                {selected.warnings.length > 1 && <ul className="list-disc pl-5 space-y-0.5 text-[11px]">{selected.warnings.slice(1).map((w, i) => <li key={i}>{w}</li>)}</ul>}
              </div>
            ) : (
              <>
                {selected.warnings.length > 0 && (
                  <div role="alert" className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
                    <div className="flex items-center gap-1.5 font-bold text-[11px] mb-1"><AlertTriangle className="w-3.5 h-3.5" />{L.warningsTitle}</div>
                    <ul className="list-disc pl-5 space-y-0.5 text-[11px]">{selected.warnings.map((w, i) => <li key={i} className="break-words">{w}</li>)}</ul>
                  </div>
                )}
                {duplicates.has(selected.id) && (
                  <div role="status" className="flex items-center gap-1.5 p-2 rounded-lg border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 text-[11px] font-semibold">
                    <Copy className="w-3.5 h-3.5" />{L.duplicate}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="italic">{L.editHint}</span>
                  <span className="shrink-0 font-semibold">{tf(L.toCollection, { name: collectionName || '—', site: siteId })}</span>
                </div>

                {field(selected, 'container_no', `${L.containerNo} *`, issueNote(selected))}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {field(selected, 'tare', L.tare)}
                  {field(selected, 'max_gross', L.maxGross)}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button type="button" onClick={() => setShowOriginal(!showOriginal)} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:underline">
                    <span>{L.aiOriginal}</span>
                    {showOriginal ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {showOriginal && (
                    <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                      {([['container_no', L.containerNo], ['tare', L.tare], ['max_gross', L.maxGross]] as const).filter(([k]) => selected.original[k]).map(([k, label]) => (
                        <div key={k} className={`flex gap-2 px-2.5 py-1 ${selected.fields[k] !== selected.original[k] ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}>
                          <span className="w-32 shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-100 break-words min-w-0">{selected.original[k]}</span>
                        </div>
                      ))}
                      <div className="px-2.5 py-1 text-[10px] text-slate-400 italic">{L.aiOriginalHint}</div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-800/60 shrink-0">
            <button
              type="button"
              disabled={!selected || selected.status === 'reading' || selected.status === 'queued' || selected.status === 'used'}
              onClick={() => selected && queue.retry(selected.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${selected?.status === 'reading' ? 'animate-spin' : ''}`} />
              <span>{L.retry}</span>
            </button>
            <div className="flex items-center gap-2">
              {selected && (
                <button type="button" onClick={() => queue.remove(selected.id)} aria-label={L.remove} title={L.remove} className="p-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition-colors">
                {L.close}
              </button>
              <button
                type="button"
                disabled={!selected || isBusy || selected.status === 'used' || selected.status === 'queued' || selected.status === 'reading' || !selected.fields.container_no}
                onClick={() => void handleApprove()}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-500/20 transition-all disabled:opacity-40"
              >
                {selected?.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{selected?.saving ? L.looking : L.lookupAndAdd}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
