import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Upload, RefreshCw, Check, RotateCw, ZoomIn, ZoomOut, Maximize2, Image as ImageIcon, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, Key, ClipboardPaste, Loader2, Ship, Play, Clock, Copy, Trash2,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useImageQueue } from '../../context/ImageQueueContext';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { Booking } from '../../types';
import { AISettingsCard } from '../common/AISettingsCard';
import { tf } from '../../services/i18nFormat';
import { hasValue } from '../../services/imageQueueLogic';
import { useCarrierBadge } from './useCarrierBadge';
import { isPdfFile, readClipboardImageFile } from './clipboard';
import { QuickVesselSearch } from './QuickVesselSearch';
import { ImageQueueList, StatusChip, useEngineLabel } from './ImageQueueList';
import { getBookingVesselCandidates } from '../../utils/vessel';

interface ImageBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Select this queue item when the modal opens / when it changes (e.g. the first image just added). */
  focusItemId?: string | null;
  /** PDFs picked / dropped inside the modal are handed back to the parent for normal upload */
  onPdfFiles?: (files: File[]) => void;
}

const inputCls =
  'w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none disabled:opacity-70';
const editedCls = '!bg-amber-50 dark:!bg-amber-950/30 !border-amber-300 dark:!border-amber-700';
const smallInputCls =
  'w-full px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md disabled:opacity-70';

const norm = (v: unknown) => (hasValue(v) ? String(v).trim() : '');

export const ImageBookingModal: React.FC<ImageBookingModalProps> = ({ isOpen, onClose, focusItemId, onPdfFiles }) => {
  const { t } = useApp();
  const q = t.booking.imageQueue;
  const { addToast } = useToastActions();
  const queue = useImageQueue();
  const { items, stats, paused, geminiIssue } = queue;
  const engineLabel = useEngineLabel();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [readingClipboard, setReadingClipboard] = useState(false);
  const [quickVesselBooking, setQuickVesselBooking] = useState<Partial<Booking> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** The focus id already applied: focus is a one-shot hint, not a pin that fights the user's own clicks */
  const appliedFocusRef = useRef<string | null>(null);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  const previewUrl = useObjectUrl(selected?.file);
  const fields = selected?.fields ?? {};
  const carrierBadge = useCarrierBadge(fields['Carrier']);
  const showList = items.length > 1;

  // Keep a valid selection: the focused image, else the first one still to review
  useEffect(() => {
    if (!isOpen) {
      appliedFocusRef.current = null;
      return;
    }
    if (focusItemId && focusItemId !== appliedFocusRef.current && items.some((i) => i.id === focusItemId)) {
      appliedFocusRef.current = focusItemId;
      setSelectedId(focusItemId);
      return;
    }
    if (selectedId && items.some((i) => i.id === selectedId)) return;
    const next = items.find((i) => i.status !== 'saved') ?? items[0] ?? null;
    setSelectedId(next?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, items, focusItemId]);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setQuickVesselBooking(null);
  }, [selectedId]);

  useEffect(() => {
    if (!isOpen) {
      setShowAISettings(false);
      setQuickVesselBooking(null);
    }
  }, [isOpen]);

  const addFiles = useCallback((files: File[], source: 'upload' | 'drop' | 'paste') => {
    if (files.length === 0) return;
    const pdfs = files.filter(isPdfFile);
    const images = files.filter((f) => !isPdfFile(f));
    if (pdfs.length > 0) {
      if (onPdfFiles) {
        addToast(t.booking.paste.pdfInImageModal, 'info');
        onPdfFiles(pdfs);
        if (images.length === 0 && items.length === 0) onClose();
      } else {
        addToast(t.booking.paste.unsupportedFile, 'error');
      }
    }
    if (images.length > 0) {
      const res = queue.enqueue(images, source);
      if (res.added > 1) addToast(tf(q.added, { count: res.added }), 'info');
      if (res.ids[0]) {
        setSelectedId(res.ids[0]);
        setShowAISettings(false);
      }
    }
  }, [addToast, items.length, onClose, onPdfFiles, q.added, queue, t]);

  const handlePasteFromClipboard = async () => {
    try {
      setReadingClipboard(true);
      const file = await readClipboardImageFile();
      if (file) addFiles([file], 'paste');
      else addToast(t.booking.paste.clipboardNoImage, 'info');
    } catch (e) {
      console.warn('Clipboard read failed', e);
      addToast(t.booking.paste.clipboardReadError, 'error');
    } finally {
      setReadingClipboard(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files || []), 'drop');
  };

  const handleSave = async () => {
    if (!selected) return;
    const savedId = selected.id;
    const ok = await queue.save(savedId);
    if (!ok) return;
    const remaining = items.filter((i) => i.id !== savedId && i.status !== 'saved');
    if (remaining.length === 0) {
      // Everything is saved: leave a clean queue and close, like the old single-image flow
      queue.clearSaved();
      onClose();
      return;
    }
    const next = remaining.find((i) => i.status === 'success' || i.status === 'review') ?? remaining[0];
    setSelectedId(next.id);
  };

  /**
   * Closing keeps the queue running in the background. The exception is a lone image the user just
   * brought in themselves (paste / drop / pick) and did not save: closing discards it, as this window always
   * did — the button would otherwise show a stale "1/1" forever. Phone photos are never discarded this way.
   */
  const handleClose = () => {
    if (items.length === 1 && items[0].status !== 'saved' && items[0].source !== 'phone') queue.remove(items[0].id);
    onClose();
  };

  const closeQuickVessel = useCallback(() => setQuickVesselBooking(null), []);
  const hasVesselForLookup = getBookingVesselCandidates(fields).length > 0;

  const isEdited = (key: string) =>
    !!selected && selected.status !== 'queued' && selected.status !== 'reading' && selected.status !== 'failed'
    && norm(selected.fields[key]) !== norm(selected.original[key]);
  const editedCount = selected ? Object.keys({ ...selected.fields, ...selected.original }).filter(isEdited).length : 0;
  const locked = selected?.status === 'saved';
  const canEdit = !!selected && (selected.status === 'success' || selected.status === 'review' || selected.status === 'saved');
  const duplicateNote = selected
    ? selected.dbDuplicate ? q.duplicateDb : queue.batchDuplicates.has(selected.id) ? q.duplicateBatch : null
    : null;
  const engine = selected ? engineLabel(selected) : null;

  const textField = (key: string, label: React.ReactNode, placeholder: string, extra?: React.ReactNode) => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">{label}</label>
        {extra}
      </div>
      <input
        type="text"
        value={norm(fields[key]) ? String(fields[key]) : ''}
        disabled={locked}
        onChange={(e) => selected && queue.setField(selected.id, key, e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} ${isEdited(key) ? editedCls : ''}`}
      />
    </div>
  );
  const col = t.booking.columns as Record<string, string>;

  const pauseBanner = paused && (
    <div role="alert" className="mb-2.5 flex items-start gap-2 p-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-300">
      <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
      <span className="flex-1">{paused === 'quota' ? q.pausedQuota : paused === 'invalid_key' ? q.pausedInvalidKey : paused === 'unavailable' ? q.pausedUnavailable : q.pausedUser}</span>
      {paused === 'invalid_key' && (
        <button type="button" onClick={() => setShowAISettings(true)} className="inline-flex items-center gap-1 font-bold underline shrink-0">
          <Key className="w-3 h-3" />AI
        </button>
      )}
      <button type="button" onClick={queue.resume} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold shrink-0">
        <Play className="w-3 h-3" />{q.resume}
      </button>
    </div>
  );
  const noKeyBanner = geminiIssue === 'no_key' && !paused && (
    <div role="status" className="mb-2.5 flex items-start gap-2 p-2.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-[11px] text-sky-800 dark:text-sky-300">
      <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
      <span className="flex-1">{q.noKey}</span>
      <button type="button" onClick={() => setShowAISettings(true)} className="inline-flex items-center gap-1 font-bold underline shrink-0">
        <Key className="w-3 h-3" />AI
      </button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t.booking.imageModal.title} maxWidth={showList ? 'max-w-7xl' : 'max-w-5xl'}>
      {pauseBanner}
      {noKeyBanner}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex flex-col md:flex-row gap-3 h-[75vh] max-h-[720px] select-none outline-none"
      >
        {showList && (
          <ImageQueueList queue={queue} selectedId={selectedId} onSelect={setSelectedId} onAddFiles={() => fileInputRef.current?.click()} />
        )}

        {/* Preview */}
        <div data-tour="ocr-controls" className="w-full md:flex-1 min-w-0 flex flex-col bg-slate-950/90 rounded-xl overflow-hidden border border-slate-800 relative">
          {previewUrl ? (
            <>
              <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between bg-slate-900/80 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-700/80 text-white shadow-lg">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} title={t.booking.imageModal.zoomOut} className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors">
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-[11px] font-mono px-1.5 text-slate-400">{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} title={t.booking.imageModal.zoomIn} className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors">
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setZoom(1)} title={t.booking.imageModal.resetZoom} className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors">
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} title={t.booking.imageModal.rotate} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-colors">
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>{rotation}°</span>
                  </button>
                  <button type="button" onClick={handlePasteFromClipboard} disabled={readingClipboard} title={t.booking.paste.pasteImageButton} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-colors disabled:opacity-50">
                    {readingClipboard ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardPaste className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={() => fileInputRef.current?.click()} title={q.addMore} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-[11px] font-semibold text-white transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{q.addMore}</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto flex items-center justify-center p-4 min-h-0 bg-slate-950">
                <div
                  style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: 'center center', transition: 'transform 0.15s ease-out' }}
                  className="max-w-full max-h-full flex items-center justify-center shadow-2xl"
                >
                  <img src={previewUrl} alt="Booking scan" className="max-w-full max-h-[60vh] object-contain rounded-md select-none pointer-events-none" />
                </div>
              </div>
              <div className="px-3 py-1.5 bg-slate-900 border-t border-slate-800 text-[11px] font-medium text-slate-400 flex items-center justify-between">
                <span className="truncate max-w-[200px]" title={selected?.name}>{selected?.name}</span>
                <span>{selected?.size ? `${Math.round(selected.size / 1024)} KB` : ''}</span>
              </div>
            </>
          ) : (
            <div
              data-tour="ocr-dropzone"
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
                  onClick={(e) => { e.stopPropagation(); void handlePasteFromClipboard(); }}
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
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              addFiles(files, 'upload');
            }}
          />
        </div>

        {/* Result / form */}
        <div data-tour="ocr-fields" className="w-full md:flex-1 min-w-0 flex flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/50 shrink-0">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{t.booking.imageModal.detectedCarrier}</span>
              <span style={carrierBadge.style} className={`text-[11px] font-bold px-2.5 py-0.5 rounded-lg border ${carrierBadge.className}`}>
                {hasValue(fields['Carrier']) ? fields['Carrier'] : 'Chưa nhận diện'}
              </span>
              {selected && <StatusChip status={selected.status} />}
              {engine && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${engine.cls}`} title={`${q.readBy}: ${engine.label}`}>
                  {engine.label}
                </span>
              )}
              {selected?.readMs !== undefined && selected.status !== 'reading' && (
                <span className="text-[10px] text-slate-400">{(selected.readMs / 1000).toFixed(1)}s</span>
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
              <div className="h-full flex items-center justify-center text-center text-slate-400 dark:text-slate-500 text-xs">{q.selectImage}</div>
            ) : selected.status === 'reading' || selected.status === 'queued' ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div className={`w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400 flex items-center justify-center ${selected.status === 'reading' ? 'animate-spin' : ''}`}>
                  {selected.status === 'reading' ? <RefreshCw className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
                </div>
                <div>
                  <h5 className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                    {selected.status === 'reading' ? t.booking.imageModal.extracting : q.status.queued}
                  </h5>
                  <p className="text-xs text-slate-400 mt-1">
                    {selected.status === 'reading' ? 'Đang đọc thông tin chi tiết qua mô hình Google Gemini Vision...' : q.waitingHint}
                  </p>
                </div>
              </div>
            ) : selected.status === 'failed' ? (
              <div role="alert" className="p-3 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-[11px]">
                  <XCircle className="w-4 h-4" />
                  {q.status.failed}
                </div>
                <p className="text-[11px] break-words">{tf(q.failedNote, { error: selected.error || selected.warnings[0] || t.booking.imageModal.extractError })}</p>
                {selected.warnings.length > 1 && (
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px]">{selected.warnings.slice(1).map((w, i) => <li key={i}>{w}</li>)}</ul>
                )}
              </div>
            ) : (
              <>
                {selected.warnings.length > 0 && (
                  <div role="alert" className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
                    <div className="flex items-center gap-1.5 font-bold text-[11px] mb-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {t.booking.paste.warningsTitle}
                    </div>
                    <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                      {selected.warnings.map((w, i) => <li key={i} className="break-words">{w}</li>)}
                    </ul>
                  </div>
                )}
                {duplicateNote && !locked && (
                  <div role="status" className="flex items-center gap-1.5 p-2 rounded-lg border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 text-[11px] font-semibold">
                    <Copy className="w-3.5 h-3.5" />
                    {duplicateNote}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="italic">{t.booking.imageModal.editHint}</span>
                  <span className="shrink-0 font-semibold">{tf(q.toCollection, { name: selected.collectionName })}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {textField('Booking No', <>{col['Booking No']} *</>, 'VD: SGN601175800')}
                  {textField('Carrier', col['Carrier'], 'VD: PIL, DONGJIN, CULINES...')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {textField('Vessel', col['Vessel'], 'VD: KOTA NEKAD 0272S', hasVesselForLookup && (
                    <button
                      type="button"
                      onClick={() => setQuickVesselBooking({ ...fields })}
                      title={t.booking.quickVessel.rowTooltip}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/50 hover:bg-primary-100 dark:hover:bg-primary-900/60 border border-primary-200 dark:border-primary-800"
                    >
                      <Ship className="w-3 h-3" />
                      {t.booking.quickVessel.button}
                    </button>
                  ))}
                  {textField('ETD', col['ETD'], 'VD: 14/07/2026')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {textField('Port of Discharging', col['Port of Discharging'], 'VD: INCHEON')}
                  {textField('Place of Delivery', col['Place of Delivery'], 'VD: INCHEON')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {textField('Equipment Type', col['Equipment Type'], "VD: 40HC, 20'DRY")}
                  {textField("Q'ty", col["Q'ty"], 'VD: 2')}
                  {textField('T/S Port', col['T/S Port'], 'VD: SINGAPORE')}
                </div>
                <div className="space-y-2.5">
                  {textField('Empty Pick Up CY', col['Empty Pick Up CY'], 'VD: TAN CANG HIEP LUC...')}
                  {textField('Full return CY', col['Full return CY'], 'VD: CAT LAI TERMINAL...')}
                  {textField('Port Cargo Cut-off', col['Port Cargo Cut-off'], 'VD: 13/07/2026 02:00')}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline">
                    <span>{showAdvanced ? 'Ẩn thông tin chi tiết tàu' : 'Xem thêm Pre-Carrier & Trunk Vessel'}</span>
                    {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {showAdvanced && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2.5 mt-2 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg">
                      {([['Pre Carrier', 'Pre Carrier'], ['ETD_Pre', 'ETD Pre Carrier'], ['Trunk Vessel', 'Trunk Vessel'], ['ETD_Trunk', 'ETD Trunk Vessel']] as const).map(([key, label]) => (
                        <div key={key}>
                          <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{label}</label>
                          <input
                            type="text"
                            value={norm(fields[key]) ? String(fields[key]) : ''}
                            disabled={locked}
                            onChange={(e) => queue.setField(selected.id, key, e.target.value)}
                            className={`${smallInputCls} ${isEdited(key) ? editedCls : ''}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* What the AI / OCR read, untouched */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button type="button" onClick={() => setShowOriginal(!showOriginal)} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:underline">
                    <span>{q.aiOriginal}{editedCount > 0 ? ` · ${editedCount} ${q.edited}` : ''}</span>
                    {showOriginal ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {showOriginal && (
                    <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                      {Object.entries(selected.original).filter(([k, v]) => k !== 'Tên file PDF' && hasValue(v)).map(([k, v]) => (
                        <div key={k} className={`flex gap-2 px-2.5 py-1 ${isEdited(k) ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}>
                          <span className="w-32 shrink-0 text-slate-500 dark:text-slate-400">{col[k] || k}</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-100 break-words min-w-0">{String(v)}</span>
                        </div>
                      ))}
                      <div className="px-2.5 py-1 text-[10px] text-slate-400 italic">{q.aiOriginalHint}</div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-800/60 shrink-0">
            <button
              type="button"
              disabled={!selected || selected.status === 'reading' || selected.status === 'queued' || selected.status === 'saved'}
              onClick={() => selected && queue.retry(selected.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${selected?.status === 'reading' ? 'animate-spin' : ''}`} />
              <span>{q.reRead}</span>
            </button>
            <div className="flex items-center gap-2">
              {selected && (
                <button
                  type="button"
                  onClick={() => queue.remove(selected.id)}
                  aria-label={q.remove}
                  title={q.remove}
                  className="p-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button type="button" onClick={handleClose} className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition-colors">
                {t.common.close}
              </button>
              <button
                type="button"
                disabled={!canEdit || locked || !!selected?.saving || !hasValue(fields['Booking No'])}
                onClick={handleSave}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-500/20 transition-all disabled:opacity-40"
              >
                {selected?.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{selected?.saving ? t.common.loading : t.booking.imageModal.saveToCollection}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <QuickVesselSearch isOpen={isOpen && !!quickVesselBooking} onClose={closeQuickVessel} booking={quickVesselBooking} />
    </Modal>
  );
};
