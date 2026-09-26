import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Upload, Sparkles, RefreshCw, Check, X, RotateCw, ZoomIn, ZoomOut, 
  Maximize2, Image as ImageIcon, AlertCircle, AlertTriangle, FileText, ChevronDown, ChevronUp, Key, Settings,
  ClipboardPaste, Loader2, Ship
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { Booking, ImageExtractEngine } from '../../types';
import { extractBookingImageDetailedApi, saveManualBookingApi } from '../../services/api';
import { AISettingsCard } from '../common/AISettingsCard';
import { tf } from '../../services/i18nFormat';
import { useCarrierBadge } from './useCarrierBadge';
import { isImageFile, isPdfFile, readClipboardImageFile } from './clipboard';
import { QuickVesselSearch } from './QuickVesselSearch';
import { getBookingVesselCandidates } from '../../utils/vessel';

interface ImageBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** File to preview + extract immediately (e.g. pasted from clipboard / dropped). A new File object re-triggers extraction. */
  initialFile?: File | null;
  onSavedSuccess?: (savedBooking: Booking) => void;
  /** PDFs picked / dropped inside the modal are handed back to the parent for normal upload */
  onPdfFiles?: (files: File[]) => void;
  /** Photos still waiting in the phone-capture queue (Task 7's MobileBridgeContext). > 0 shows a header badge. */
  pendingCount?: number;
}

const EMPTY_FIELDS: Partial<Booking> = {
  "Tên file PDF": "",
  "Booking No": "",
  "Carrier": "",
  "Port of Discharging": "",
  "Place of Delivery": "",
  "Block": "",
  "T/S Port": "",
  "Equipment Type": "",
  "Q'ty": "",
  "Empty Pick Up CY": "",
  "Full return CY": "",
  "Port Cargo Cut-off": "",
  "Pre Carrier": "",
  "ETD_Pre": "",
  "Trunk Vessel": "",
  "ETD_Trunk": "",
  "Vessel": "",
  "ETD": ""
};

/** Fields that indicate a real extraction (Carrier alone is not enough — it can be guessed from noise). */
const KEY_FIELDS = [
  "Booking No", "Vessel", "Pre Carrier", "Trunk Vessel", "ETD", "Port of Discharging",
  "Place of Delivery", "Equipment Type", "Q'ty", "Empty Pick Up CY", "Full return CY", "Port Cargo Cut-off",
];

const hasValue = (v: unknown) =>
  v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'null';

export const ImageBookingModal: React.FC<ImageBookingModalProps> = ({
  isOpen,
  onClose,
  initialFile,
  onSavedSuccess,
  onPdfFiles,
  pendingCount,
}) => {
  const { t, activeCollection } = useApp();
  const { addToast } = useToastActions();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  
  // Image transformation states
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  
  // Extraction states
  const [extracting, setExtracting] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [showAISettings, setShowAISettings] = useState<boolean>(false);
  const [engineUsed, setEngineUsed] = useState<ImageExtractEngine | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [readingClipboard, setReadingClipboard] = useState<boolean>(false);
  const [quickVesselBooking, setQuickVesselBooking] = useState<Partial<Booking> | null>(null);
  
  // Form fields
  const [fields, setFields] = useState<Partial<Booking>>(EMPTY_FIELDS);
  const carrierBadge = useCarrierBadge(fields["Carrier"]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Incremented for every extraction / reset so stale responses are ignored */
  const requestIdRef = useRef(0);

  // Object URL lifecycle: create for the current file, revoke the previous one and on unmount
  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Invalidate in-flight extraction on unmount
  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  const resetState = useCallback(() => {
    requestIdRef.current += 1;
    setImageFile(null);
    setZoom(1);
    setRotation(0);
    setExtracting(false);
    setSaving(false);
    setEngineUsed(null);
    setWarnings([]);
    setQuickVesselBooking(null);
    setFields(EMPTY_FIELDS);
  }, []);

  const triggerExtraction = async (fileToExtract: File) => {
    const reqId = ++requestIdRef.current;
    setExtracting(true);
    setEngineUsed(null);
    setWarnings([]);
    try {
      const result = await extractBookingImageDetailedApi(fileToExtract);
      if (reqId !== requestIdRef.current) return; // a newer paste / reset superseded this response
      const data = result.data || {};
      const resultWarnings = (result.warnings || []).filter((w) => typeof w === 'string' && w.trim());
      setEngineUsed(result.engine_used);
      setWarnings(resultWarnings);
      setFields({
        ...EMPTY_FIELDS,
        ...data,
        "Tên file PDF": fileToExtract.name || "booking_image.jpg"
      });
      const extractedSomething = KEY_FIELDS.some((k) => hasValue((data as Record<string, unknown>)[k]));
      if (!extractedSomething) {
        addToast(resultWarnings[0] || t.booking.paste.extractEmpty, 'error');
      } else if (resultWarnings.length > 0) {
        addToast(t.booking.paste.extractWithWarnings, 'info');
      } else {
        addToast(t.booking.imageModal.extractSuccess, 'success');
      }
    } catch (e: any) {
      if (reqId !== requestIdRef.current) return;
      console.error(e);
      const detail = e?.response?.data?.detail;
      const msg = (typeof detail === 'string' && detail) || e?.message || t.booking.imageModal.extractError;
      setEngineUsed('none');
      setWarnings([msg]);
      addToast(msg, 'error');
    } finally {
      if (reqId === requestIdRef.current) setExtracting(false);
    }
  };

  const processFile = (file: File) => {
    if (isPdfFile(file)) {
      if (onPdfFiles) {
        addToast(t.booking.paste.pdfInImageModal, 'info');
        onPdfFiles([file]);
        onClose();
      } else {
        addToast(t.booking.paste.unsupportedFile, 'error');
      }
      return;
    }
    if (!isImageFile(file)) {
      addToast(t.booking.paste.unsupportedFile, 'error');
      return;
    }
    setImageFile(file); // preview shows immediately (object URL effect)
    setZoom(1);
    setRotation(0);
    setShowAISettings(false);
    setQuickVesselBooking(null);
    void triggerExtraction(file);
  };

  // Initialize or reset when modal opens or a new initial file arrives
  useEffect(() => {
    if (!isOpen) {
      resetState();
      return;
    }
    if (initialFile) {
      processFile(initialFile);
    } else {
      resetState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialFile]);

  const handlePasteFromClipboard = async () => {
    try {
      setReadingClipboard(true);
      const file = await readClipboardImageFile();
      if (file) {
        processFile(file);
      } else {
        addToast(t.booking.paste.clipboardNoImage, 'info');
      }
    } catch (e) {
      console.warn('Clipboard read failed', e);
      addToast(t.booking.paste.clipboardReadError, 'error');
    } finally {
      setReadingClipboard(false);
    }
  };

  const handleFieldChange = (key: string, value: string) => {
    setFields((prev) => {
      const updated = { ...prev, [key]: value };
      
      // Auto synchronize Vessel / ETD if pre-carrier or trunk vessel is edited
      if (key === 'Pre Carrier' && value && value !== 'null') {
        updated['Vessel'] = value;
        if (updated['ETD_Pre'] && updated['ETD_Pre'] !== 'null') {
          updated['ETD'] = updated['ETD_Pre'];
        }
      } else if (key === 'Trunk Vessel' && (!updated['Pre Carrier'] || updated['Pre Carrier'] === 'null')) {
        updated['Vessel'] = value;
        if (updated['ETD_Trunk'] && updated['ETD_Trunk'] !== 'null') {
          updated['ETD'] = updated['ETD_Trunk'];
        }
      }

      return updated;
    });
  };

  const handleSave = async () => {
    if (!activeCollection) {
      addToast(t.common.error, 'error');
      return;
    }

    try {
      setSaving(true);
      const bookingDataToSave = {
        ...fields,
        "Tên file PDF": fields["Tên file PDF"] || imageFile?.name || "booking_photo.jpg"
      };

      const { item: saved, warnings } = await saveManualBookingApi(activeCollection.id, bookingDataToSave);
      warnings.forEach((w) => addToast(w, 'info'));
      addToast(t.booking.imageModal.saveSuccess, 'success');
      if (onSavedSuccess) {
        onSavedSuccess(saved);
      }
      onClose();
    } catch (e: any) {
      addToast(e?.response?.data?.detail || e.message || t.common.error, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      processFile(file);
    }
  };

  const closeQuickVessel = useCallback(() => setQuickVesselBooking(null), []);
  const hasVesselForLookup = getBookingVesselCandidates(fields).length > 0;

  const engineBadge =
    engineUsed === 'gemini'
      ? { label: t.booking.paste.engineGemini, cls: 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800' }
      : engineUsed === 'ocr'
      ? { label: t.booking.paste.engineOcr, cls: 'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' }
      : engineUsed === 'none'
      ? { label: t.booking.paste.engineNone, cls: 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800' }
      : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t.booking.imageModal.title}
      maxWidth="max-w-5xl"
    >
      {!!pendingCount && pendingCount > 0 && (
        <div className="mb-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-900">
          {tf(t.booking.phone.pendingInModal, { count: pendingCount })}
        </div>
      )}
      <div className="flex flex-col md:flex-row gap-4 h-[75vh] max-h-[720px] select-none outline-none">
        {/* Left Side: Image Preview & Manipulation */}
        <div data-tour="ocr-controls" className="w-full md:w-1/2 flex flex-col bg-slate-950/90 rounded-xl overflow-hidden border border-slate-800 relative">
          {imagePreviewUrl ? (
            <>
              {/* Floating Image Control Bar */}
              <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between bg-slate-900/80 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-700/80 text-white shadow-lg">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                    title={t.booking.imageModal.zoomOut}
                    className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-[11px] font-mono px-1.5 text-slate-400">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                    title={t.booking.imageModal.zoomIn}
                    className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    title={t.booking.imageModal.resetZoom}
                    className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    title={t.booking.imageModal.rotate}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-colors"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>{rotation}°</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    disabled={readingClipboard}
                    title={t.booking.paste.pasteImageButton}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-colors disabled:opacity-50"
                  >
                    {readingClipboard ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardPaste className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title={t.booking.imageModal.selectAnother}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-[11px] font-semibold text-white transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{t.booking.imageModal.selectAnother}</span>
                  </button>
                </div>
              </div>

              {/* Scrollable / Zoomable image container */}
              <div className="flex-1 overflow-auto flex items-center justify-center p-4 min-h-0 bg-slate-950">
                <div 
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.15s ease-out'
                  }}
                  className="max-w-full max-h-full flex items-center justify-center shadow-2xl"
                >
                  <img
                    src={imagePreviewUrl}
                    alt="Booking scan"
                    className="max-w-full max-h-[60vh] object-contain rounded-md select-none pointer-events-none"
                  />
                </div>
              </div>

              {/* Bottom Image Info Badge */}
              <div className="px-3 py-1.5 bg-slate-900 border-t border-slate-800 text-[11px] font-medium text-slate-400 flex items-center justify-between">
                <span className="truncate max-w-[200px]" title={imageFile?.name}>
                  {imageFile?.name}
                </span>
                <span>
                  {imageFile?.size ? `${Math.round(imageFile.size / 1024)} KB` : ''}
                </span>
              </div>
            </>
          ) : (
            /* Upload / Dropzone Empty State */
            <div
              data-tour="ocr-dropzone"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex flex-col items-center justify-center p-6 text-center cursor-pointer border-2 border-dashed border-slate-700 hover:border-purple-500 transition-all rounded-xl m-3 bg-slate-900/40 hover:bg-slate-900/80"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 text-white flex items-center justify-center shadow-lg mb-3.5">
                <ImageIcon className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-bold text-slate-100 mb-1">
                {t.booking.imageModal.dropOrPaste}
              </h4>
              <p className="text-xs text-slate-400 max-w-xs mb-4">
                Hỗ trợ các định dạng PNG, JPG, JPEG, WEBP hoặc chụp màn hình rồi nhấn Ctrl+V.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handlePasteFromClipboard();
                  }}
                  disabled={readingClipboard}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-md shadow-indigo-500/20 disabled:opacity-50"
                >
                  {readingClipboard ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />}
                  {t.booking.paste.pasteImageButton}
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-all shadow-md shadow-purple-500/20"
                >
                  {t.booking.imageModal.selectAnother}
                </button>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) processFile(file);
            }}
          />
        </div>

        {/* Right Side: Extracted Fields Form */}
        <div data-tour="ocr-fields" className="w-full md:w-1/2 flex flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          {/* Header Status Bar */}
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/50 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {t.booking.imageModal.detectedCarrier}
              </span>
              <span style={carrierBadge.style} className={`text-[11px] font-bold px-2.5 py-0.5 rounded-lg border ${carrierBadge.className}`}>
                {fields["Carrier"] && fields["Carrier"] !== 'null' ? fields["Carrier"] : 'Chưa nhận diện'}
              </span>
              {engineBadge && !extracting && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${engineBadge.cls}`}
                  title={t.booking.paste.engineLabel}
                >
                  {engineBadge.label}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowAISettings(!showAISettings)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900 border border-purple-200 dark:border-purple-800 transition-colors"
                title="Cài đặt Google Gemini API Key riêng của bạn"
              >
                <Key className="w-3 h-3 text-purple-500" />
                <span>{showAISettings ? 'Ẩn Cài đặt Key' : 'Cài đặt AI Key'}</span>
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 min-h-0 text-xs">
            {showAISettings ? (
              <div className="space-y-3">
                <AISettingsCard />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowAISettings(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600"
                  >
                    Quay lại xem kết quả trích xuất
                  </button>
                </div>
              </div>
            ) : extracting ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400 flex items-center justify-center animate-spin">
                  <RefreshCw className="w-6 h-6" />
                </div>
                <div>
                  <h5 className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                    {t.booking.imageModal.extracting}
                  </h5>
                  <p className="text-xs text-slate-400 mt-1">
                    Đang đọc thông tin chi tiết qua mô hình Google Gemini Vision...
                  </p>
                </div>
              </div>
            ) : (
              <>
                {warnings.length > 0 && (
                  <div role="alert" className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
                    <div className="flex items-center gap-1.5 font-bold text-[11px] mb-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {t.booking.paste.warningsTitle}
                    </div>
                    <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                      {warnings.map((w, i) => (
                        <li key={i} className="break-words">{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                  {t.booking.imageModal.editHint}
                </p>

                {/* Primary Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["Booking No"]} *
                    </label>
                    <input
                      type="text"
                      value={fields["Booking No"] || ''}
                      onChange={(e) => handleFieldChange("Booking No", e.target.value)}
                      placeholder="VD: SGN601175800"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["Carrier"]}
                    </label>
                    <input
                      type="text"
                      value={fields["Carrier"] || ''}
                      onChange={(e) => handleFieldChange("Carrier", e.target.value)}
                      placeholder="VD: PIL, DONGJIN, CULINES..."
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Vessel & ETD */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        {t.booking.columns["Vessel"]}
                      </label>
                      {hasVesselForLookup && (
                        <button
                          type="button"
                          onClick={() => setQuickVesselBooking({ ...fields })}
                          title={t.booking.quickVessel.rowTooltip}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/50 hover:bg-primary-100 dark:hover:bg-primary-900/60 border border-primary-200 dark:border-primary-800"
                        >
                          <Ship className="w-3 h-3" />
                          {t.booking.quickVessel.button}
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={fields["Vessel"] || ''}
                      onChange={(e) => handleFieldChange("Vessel", e.target.value)}
                      placeholder="VD: KOTA NEKAD 0272S"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["ETD"]}
                    </label>
                    <input
                      type="text"
                      value={fields["ETD"] || ''}
                      onChange={(e) => handleFieldChange("ETD", e.target.value)}
                      placeholder="VD: 14/07/2026"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Ports */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["Port of Discharging"]}
                    </label>
                    <input
                      type="text"
                      value={fields["Port of Discharging"] || ''}
                      onChange={(e) => handleFieldChange("Port of Discharging", e.target.value)}
                      placeholder="VD: INCHEON"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["Place of Delivery"]}
                    </label>
                    <input
                      type="text"
                      value={fields["Place of Delivery"] || ''}
                      onChange={(e) => handleFieldChange("Place of Delivery", e.target.value)}
                      placeholder="VD: INCHEON"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Equipment & Qty */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["Equipment Type"]}
                    </label>
                    <input
                      type="text"
                      value={fields["Equipment Type"] || ''}
                      onChange={(e) => handleFieldChange("Equipment Type", e.target.value)}
                      placeholder="VD: 40HC, 20'DRY"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["Q'ty"]}
                    </label>
                    <input
                      type="text"
                      value={fields["Q'ty"] || ''}
                      onChange={(e) => handleFieldChange("Q'ty", e.target.value)}
                      placeholder="VD: 2"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["T/S Port"]}
                    </label>
                    <input
                      type="text"
                      value={fields["T/S Port"] || ''}
                      onChange={(e) => handleFieldChange("T/S Port", e.target.value)}
                      placeholder="VD: SINGAPORE"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Depots */}
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["Empty Pick Up CY"]}
                    </label>
                    <input
                      type="text"
                      value={fields["Empty Pick Up CY"] || ''}
                      onChange={(e) => handleFieldChange("Empty Pick Up CY", e.target.value)}
                      placeholder="VD: TAN CANG HIEP LUC..."
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["Full return CY"]}
                    </label>
                    <input
                      type="text"
                      value={fields["Full return CY"] || ''}
                      onChange={(e) => handleFieldChange("Full return CY", e.target.value)}
                      placeholder="VD: CAT LAI TERMINAL..."
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.booking.columns["Port Cargo Cut-off"]}
                    </label>
                    <input
                      type="text"
                      value={fields["Port Cargo Cut-off"] || ''}
                      onChange={(e) => handleFieldChange("Port Cargo Cut-off", e.target.value)}
                      placeholder="VD: 13/07/2026 02:00"
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Advanced section toggle */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    <span>{showAdvanced ? 'Ẩn thông tin chi tiết tàu' : 'Xem thêm Pre-Carrier & Trunk Vessel'}</span>
                    {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {showAdvanced && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2.5 mt-2 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                          Pre Carrier
                        </label>
                        <input
                          type="text"
                          value={fields["Pre Carrier"] || ''}
                          onChange={(e) => handleFieldChange("Pre Carrier", e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                          ETD Pre Carrier
                        </label>
                        <input
                          type="text"
                          value={fields["ETD_Pre"] || ''}
                          onChange={(e) => handleFieldChange("ETD_Pre", e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                          Trunk Vessel
                        </label>
                        <input
                          type="text"
                          value={fields["Trunk Vessel"] || ''}
                          onChange={(e) => handleFieldChange("Trunk Vessel", e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                          ETD Trunk Vessel
                        </label>
                        <input
                          type="text"
                          value={fields["ETD_Trunk"] || ''}
                          onChange={(e) => handleFieldChange("ETD_Trunk", e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-800/60 shrink-0">
            <button
              type="button"
              disabled={extracting || !imageFile}
              onClick={() => imageFile && triggerExtraction(imageFile)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${extracting ? 'animate-spin' : ''}`} />
              <span>{t.booking.imageModal.reExtract}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition-colors"
              >
                {t.common.cancel}
              </button>

              <button
                type="button"
                disabled={saving || extracting || !fields["Booking No"]}
                onClick={handleSave}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-500/20 transition-all disabled:opacity-40"
              >
                <Check className="w-4 h-4" />
                <span>{saving ? t.common.loading : t.booking.imageModal.saveToCollection}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <QuickVesselSearch
        isOpen={isOpen && !!quickVesselBooking}
        onClose={closeQuickVessel}
        booking={quickVesselBooking}
      />
    </Modal>
  );
};
