import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  UploadCloud, Search, RefreshCw, Trash2, FileSpreadsheet,
  SlidersHorizontal, Eye, Copy, FileText, Sparkles, Ship, Layers, Pencil, Plus, Smartphone
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useMobileBridge } from '../../context/MobileBridgeContext';
import { Booking, PageResult, TableQuery } from '../../types';
import {
  getBookings, getBookingsPage, getBookingIds, getBookingsByIds,
  uploadPDFs, deleteBooking, clearBookings, deleteBookingsBatch, searchVesselsApi
} from '../../services/api';
import { ExportModal } from '../common/ExportModal';
import { ColumnConfigModal, ColumnDef } from '../common/ColumnConfigModal';
import { BookingDetailModal } from './BookingDetailModal';
import { BookingFormModal } from './BookingFormModal';
import { ImageBookingModal } from './ImageBookingModal';
import { PhoneCaptureModal } from './PhoneCaptureModal';
import { QuickVesselSearch } from './QuickVesselSearch';
import { BulkVesselLookupModal, BulkVesselLookupMode } from './BulkVesselLookupModal';
import { ResizableTh } from '../common/ResizableTh';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { useConfirm } from '../../hooks/useConfirm';
import { useRowSelection } from '../../hooks/useRowSelection';
import { Tooltip } from '../common/Tooltip';
import { formatRowForCopy, formatRowsAsTsv, copyTextToClipboard } from '../../utils/formatters';
import { getBookingVesselCandidates, guessSiteFromDepot, splitVesselVoyage, vesselLookupKey } from '../../utils/vessel';
import { Pagination } from '../common/Pagination';
import { TableSkeleton } from '../common/TableSkeleton';
import { ValueBadge } from '../common/ValueBadge';
import { BulkActionBar, BulkAction } from '../common/BulkActionBar';
import { MoveToCollectionModal } from '../common/MoveToCollectionModal';
import { subscribeTourActions } from '../../services/tourEvents';
import { useServerTable, LoadMode } from '../../hooks/useServerTable';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useVirtualRows } from '../../hooks/useVirtualRows';
import { tf } from '../../services/i18nFormat';
import type { TabId } from '../common/Tabs';
import { isImageFile, isPdfFile } from './clipboard';

/** Files pasted anywhere in the app (routed here by App's global paste handler). */
export interface BookingPasteRequest {
  id: number;
  images: File[];
  pdfs: File[];
}

interface BookingTabProps {
  initialSearchQuery?: string;
  onNavigateTab?: (tab: TabId, query?: string) => void;
  pasteRequest?: BookingPasteRequest | null;
  onPasteRequestHandled?: (id: number) => void;
}

const VESSEL_LOOKUP_DELAY_MS = 800;

/** Stable function identity that always calls the latest implementation (keeps memoized rows from re-rendering). */
function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

const getBookingId = (b: Booking) => b.id;

interface BookingRowProps {
  booking: Booking;
  rowNumber: number;
  visibleColumns: ColumnDef[];
  columnWidths: Record<string, number>;
  selected: boolean;
  onToggle: (id: number, shiftKey: boolean) => void;
  onOpen: (booking: Booking) => void;
  onCopy: (booking: Booking) => void;
  onDelete: (id: number) => void;
  onQuickVessel: (booking: Booking) => void;
  onEdit: (booking: Booking) => void;
  vesselTooltip: string;
  editLabel: string;
}

const BookingRow = React.memo(function BookingRow({
  booking,
  rowNumber,
  visibleColumns,
  columnWidths,
  selected,
  onToggle,
  onOpen,
  onCopy,
  onDelete,
  onQuickVessel,
  onEdit,
  vesselTooltip,
  editLabel,
}: BookingRowProps) {
  return (
    <tr
      onDoubleClick={() => onOpen(booking)}
      className={`hover:bg-sky-100/80 dark:hover:bg-sky-950/70 hover:shadow-xs transition-colors group cursor-pointer ${
        selected ? 'bg-primary-50/70 dark:bg-primary-950/30' : ''
      }`}
    >
      <td className="py-1.5 px-2 text-center w-8" onDoubleClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(booking.id, e.shiftKey);
          }}
          className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer align-middle"
        />
      </td>
      <td className="py-1.5 px-2.5 text-center font-medium text-slate-400 w-10">
        {rowNumber}
      </td>
      {visibleColumns.map((col) => {
        const val = booking[col.key];
        const w = columnWidths[col.key];
        return (
          <td
            key={col.key}
            style={{
              width: w ? `${w}px` : undefined,
              maxWidth: w ? `${w}px` : undefined,
            }}
            className="py-1.5 px-2.5 truncate"
            title={String(val || '')}
          >
            <ValueBadge
              table="booking"
              columnKey={col.key}
              value={val}
              fallbackText="null"
            />
          </td>
        );
      })}
      <td className="py-1.5 px-2.5 text-center w-28" onDoubleClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
          <Tooltip content={editLabel}>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(booking); }}
              aria-label={editLabel}
              className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={vesselTooltip}>
            <button
              onClick={(e) => { e.stopPropagation(); onQuickVessel(booking); }}
              className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
            >
              <Ship className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Xem chi tiết đầy đủ">
            <button
              onClick={(e) => { e.stopPropagation(); onOpen(booking); }}
              className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Sao chép toàn bộ dòng">
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(booking); }}
              className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Xóa dòng này">
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(booking.id); }}
              className="p-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
});

export const BookingTab: React.FC<BookingTabProps> = ({
  initialSearchQuery,
  onNavigateTab,
  pasteRequest,
  onPasteRequestHandled,
}) => {
  const { t, activeCollection } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [searchField, setSearchField] = useState('all');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal states
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'all' | 'selected'>('all');
  const [exportRows, setExportRows] = useState<Booking[]>([]);
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [activeImageFile, setActiveImageFile] = useState<File | null>(null);
  const [isPhoneCaptureOpen, setIsPhoneCaptureOpen] = useState(false);
  const mobile = useMobileBridge();
  const [quickVesselBooking, setQuickVesselBooking] = useState<Booking | null>(null);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isBulkVesselLookupOpen, setIsBulkVesselLookupOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState<{ mode: 'create' | 'edit'; booking: Booking | null } | null>(null);

  // Bulk action state
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [vesselLookupProgress, setVesselLookupProgress] = useState<{ current: number; total: number } | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Listen to interactive tour triggers (open/close AI image OCR modal)
  useEffect(() => {
    const unsubscribe = subscribeTourActions((action) => {
      if (action === 'openImageModal') {
        setActiveImageFile(null);
        setIsImageModalOpen(true);
      } else if (action === 'closeImageModal') {
        setIsImageModalOpen(false);
      }
    });
    return unsubscribe;
  }, []);

  const defaultColumns: ColumnDef[] = useMemo(() => [
    { key: "Tên file PDF", label: t.booking.columns["Tên file PDF"], visible: true },
    { key: "Booking No", label: t.booking.columns["Booking No"], visible: true },
    { key: "Carrier", label: t.booking.columns["Carrier"], visible: true },
    { key: "Vessel", label: t.booking.columns["Vessel"], visible: true },
    { key: "ETD", label: t.booking.columns["ETD"], visible: true },
    { key: "Port of Discharging", label: t.booking.columns["Port of Discharging"], visible: true },
    { key: "Place of Delivery", label: t.booking.columns["Place of Delivery"], visible: true },
    { key: "T/S Port", label: t.booking.columns["T/S Port"], visible: true },
    { key: "Block", label: t.booking.columns["Block"], visible: false },
    { key: "Equipment Type", label: t.booking.columns["Equipment Type"], visible: true },
    { key: "Q'ty", label: t.booking.columns["Q'ty"], visible: true },
    { key: "Empty Pick Up CY", label: t.booking.columns["Empty Pick Up CY"], visible: true },
    { key: "Full return CY", label: t.booking.columns["Full return CY"], visible: true },
    { key: "Port Cargo Cut-off", label: t.booking.columns["Port Cargo Cut-off"], visible: true },
  ], [t]);

  const defaultWidths = useMemo(() => ({
    "Tên file PDF": 160,
    "Booking No": 130,
    "Carrier": 110,
    "Vessel": 170,
    "ETD": 110,
    "Port of Discharging": 140,
    "Place of Delivery": 140,
    "T/S Port": 120,
    "Block": 80,
    "Equipment Type": 110,
    "Q'ty": 70,
    "Empty Pick Up CY": 180,
    "Full return CY": 150,
    "Port Cargo Cut-off": 140,
  }), []);

  const { columns, setColumns, resetColumns, columnWidths, startResize } = useColumnSettings({
    storageKey: 'booking_table',
    defaultColumns,
    defaultWidths,
  });

  // Keep labels updated if language changes
  useEffect(() => {
    setColumns((prev) =>
      prev.map((c) => {
        const def = defaultColumns.find((d) => d.key === c.key);
        const defLabel = def ? def.label : c.key;
        return {
          ...c,
          defaultLabel: defLabel,
          label: c.customLabel !== undefined && c.customLabel !== '' ? c.customLabel : defLabel,
        };
      })
    );
  }, [t, defaultColumns, setColumns]);

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);

  const exportColumns = useMemo(() => [
    { key: "STT", label: t.booking.columns["STT"] },
    ...columns.map((c) => ({ key: c.key, label: c.label })),
  ], [columns, t]);

  const getColLabel = (key: string, fallback: string) => {
    const col = columns.find((c) => c.key === key);
    return col?.label || fallback;
  };

  // ---------------------------------------------------------------------------
  // Data loading (server-paged table)
  // ---------------------------------------------------------------------------
  const debouncedQuery = useDebouncedValue(searchQuery, 300);
  const tableQuery = useMemo<TableQuery>(
    () => ({ search_query: debouncedQuery, search_field: searchField }),
    [debouncedQuery, searchField]
  );

  const table = useServerTable<Booking, PageResult<Booking>>({
    enabled: !!activeCollection,
    queryKey: JSON.stringify([activeCollection?.id, tableQuery]),
    pageSizeStorageKey: 'booking_page_size',
    fetchPage: (limit, offset) => getBookingsPage(activeCollection!.id, limit, offset, tableQuery),
    onError: (e: any) => {
      const detail = e?.response?.data?.detail;
      addToast((typeof detail === 'string' && detail) || e?.message || t.common.error, 'error');
    },
  });
  const { rows: pageRows, total, loading, currentPage, setCurrentPage, pageSize, setPageSize } = table;

  const loadData = useStableCallback(async (mode: LoadMode = 'refresh') => {
    await table.reload(mode);
  });

  const selection = useRowSelection<Booking>(
    pageRows,
    getBookingId,
    [activeCollection?.id, debouncedQuery, searchField],
    { pruneMissing: false }
  );
  const selectedIdList = useMemo(() => Array.from(selection.selectedIds), [selection.selectedIds]);

  /** Selected rows even when they live on other pages. */
  const resolveSelectedRows = useCallback(async (): Promise<Booking[]> => {
    if (selection.selectedRows.length === selection.count) return selection.selectedRows;
    return getBookingsByIds(selectedIdList);
  }, [selection.selectedRows, selection.count, selectedIdList]);

  const handleSelectAllResults = useCallback(async () => {
    if (!activeCollection) return;
    try {
      const ids = await getBookingIds(activeCollection.id, tableQuery);
      selection.selectIds(ids, true);
    } catch (e: any) {
      addToast(e?.message || t.common.error, 'error');
    }
  }, [activeCollection, tableQuery, selection, addToast, t]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualRows(pageRows.length, scrollRef);
  const colSpan = visibleColumns.length + 3;

  // Back to the top when the page or filters change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [currentPage, pageSize, tableQuery]);

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const pageAllSelected = selection.isPageAllSelected(pageRows);
  const pagePartiallySelected = selection.isPagePartiallySelected(pageRows);
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = pagePartiallySelected;
  }, [pagePartiallySelected]);

  const uploadFiles = useStableCallback(async (fileArray: File[]) => {
    if (!activeCollection) {
      addToast(t.booking.paste.noCollection, 'error');
      return;
    }
    if (fileArray.length === 0) return;
    try {
      setUploading(true);
      const res = await uploadPDFs(activeCollection.id, fileArray);
      addToast(t.booking.uploadSuccess.replace('{count}', res.count.toString()), 'success');
      if (mountedRef.current) await loadData('refresh');
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      addToast((typeof detail === 'string' && detail) || e.message || t.common.error, 'error');
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  });

  const handleFilesUpload = async (files: FileList | File[]) => {
    if (!activeCollection || files.length === 0) return;

    const fileArray = Array.from(files).filter((f) => isPdfFile(f) || isImageFile(f));

    if (fileArray.length === 0) {
      addToast('Vui lòng chọn file định dạng PDF hoặc hình ảnh (.png, .jpg, .jpeg, .webp, .bmp)', 'error');
      return;
    }

    // If exactly 1 image file is uploaded/dropped, open the interactive review modal
    const isSingleImage = fileArray.length === 1 && !isPdfFile(fileArray[0]);
    if (isSingleImage) {
      setActiveImageFile(fileArray[0]);
      setIsImageModalOpen(true);
      return;
    }

    // Batch upload processing
    await uploadFiles(fileArray);
  };

  // Files pasted anywhere in the app (App-level paste handler)
  const handledPasteIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pasteRequest || handledPasteIdRef.current === pasteRequest.id) return;
    handledPasteIdRef.current = pasteRequest.id;
    const { images, pdfs, id } = pasteRequest;
    if (pdfs.length > 0) {
      if (activeCollection) {
        addToast(tf(t.booking.paste.pdfUploading, { count: pdfs.length }), 'info');
      }
      void uploadFiles(pdfs);
    }
    if (images.length > 0) {
      if (images.length > 1) {
        addToast(tf(t.booking.paste.multipleImages, { count: images.length }), 'info');
      }
      setActiveImageFile(images[0]);
      setIsImageModalOpen(true);
    }
    onPasteRequestHandled?.(id);
  }, [pasteRequest, activeCollection, addToast, t, uploadFiles, onPasteRequestHandled]);

  // Photos arriving from a paired phone: open them one at a time in the review modal, only
  // once the previous one has been saved/dismissed, so a fresh photo never clobbers an
  // in-progress edit.
  useEffect(() => {
    if (isImageModalOpen || mobile.queue.length === 0) return;
    const file = mobile.takeNext();
    if (file) {
      setActiveImageFile(file);
      setIsImageModalOpen(true);
    }
  }, [isImageModalOpen, mobile.queue.length, mobile]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFilesUpload(e.dataTransfer.files);
    }
  };

  const handleDelete = useStableCallback(async (id: number) => {
    const ok = await confirm({ message: t.common.deleteConfirm, danger: true });
    if (!ok) return;
    try {
      await deleteBooking(id);
      addToast(t.common.success, 'success');
      selection.selectIds([id], false);
      await loadData('refresh');
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  });

  const handleClearAll = async () => {
    if (!activeCollection) return;
    const ok = await confirm({ message: t.common.clearConfirm, danger: true });
    if (!ok) return;
    try {
      await clearBookings(activeCollection.id);
      addToast(t.common.success, 'success');
      selection.clear();
      await loadData('refresh');
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const copyRow = useStableCallback(async (booking: Booking) => {
    const text = formatRowForCopy(booking, columns);
    const success = await copyTextToClipboard(text);
    if (success) {
      addToast(t.common.copySuccess, 'success');
    } else {
      addToast(t.common.error, 'error');
    }
  });

  const openBooking = useCallback((b: Booking) => setSelectedBooking(b), []);
  const openQuickVessel = useCallback((b: Booking) => setQuickVesselBooking(b), []);
  const closeQuickVessel = useCallback(() => setQuickVesselBooking(null), []);
  const closeDetail = useCallback(() => setSelectedBooking(null), []);

  const openCreateBooking = useCallback(() => setBookingForm({ mode: 'create', booking: null }), []);
  const openEditBooking = useStableCallback((booking: Booking) => setBookingForm({ mode: 'edit', booking }));

  const handleBookingSaved = useStableCallback(async (item: Booking, mode: 'create' | 'edit') => {
    if (mode === 'create') {
      // new rows are appended (ORDER BY id ASC) -> jump to the last page so the user sees it
      setCurrentPage(Math.max(1, Math.ceil((total + 1) / pageSize)));
    }
    if (selectedBooking?.id === item.id) setSelectedBooking(item);
    await loadData('refresh');
  });

  // ---------------------------------------------------------------------------
  // Bulk actions
  // ---------------------------------------------------------------------------
  const handleBulkDelete = async () => {
    const ids = selectedIdList;
    if (ids.length === 0) return;
    const ok = await confirm({
      message: tf(t.bulk.deleteSelectedConfirm, { count: ids.length }),
      danger: true,
    });
    if (!ok) return;
    try {
      setBulkDeleting(true);
      const res = await deleteBookingsBatch(ids);
      const deleted = typeof res?.deleted === 'number' ? res.deleted : ids.length;
      selection.selectIds(ids, false);
      await loadData('refresh');
      addToast(tf(t.booking.bulkActions.deleteSuccess, { count: deleted }), 'success');
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      addToast((typeof detail === 'string' && detail) || e.message || t.common.error, 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkCopy = async () => {
    const rows = await resolveSelectedRows();
    if (rows.length === 0) return;
    const ok = await copyTextToClipboard(formatRowsAsTsv(rows, columns, true));
    addToast(
      ok ? tf(t.booking.bulkActions.copySuccess, { count: rows.length }) : t.common.error,
      ok ? 'success' : 'error'
    );
  };

  const handleBulkVesselLookup = async (mode: BulkVesselLookupMode = 'auto') => {
    if (!activeCollection || vesselLookupProgress) return;
    const collectionId = activeCollection.id;
    let fallbackSite = 'CTL';
    try {
      fallbackSite = localStorage.getItem('last_vessel_site_id') || 'CTL';
    } catch {
      /* ignore */
    }

    if (mode !== 'auto' && mode.site) {
      try {
        localStorage.setItem('last_vessel_site_id', mode.site);
      } catch {
        /* ignore */
      }
    }

    const rows = await resolveSelectedRows();
    const targets = new Map<string, { site: string; name: string; voyage: string }>();
    let skipped = 0;
    rows.forEach((b) => {
      const candidate = getBookingVesselCandidates(b)[0];
      const { name, voyage } = splitVesselVoyage(candidate?.value);
      if (!name) {
        skipped += 1;
        return;
      }
      const site = mode === 'auto' ? (guessSiteFromDepot(b["Full return CY"]) || fallbackSite) : mode.site;
      const key = vesselLookupKey(site, name, voyage);
      if (!targets.has(key)) targets.set(key, { site, name, voyage });
    });

    if (targets.size === 0) {
      addToast(t.booking.bulkActions.lookupNoVessel, 'error');
      return;
    }

    const list = Array.from(targets.values());
    let found = 0;
    let notFound = 0;
    let errors = 0;
    setVesselLookupProgress({ current: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      if (!mountedRef.current) return;
      if (i > 0) await new Promise((r) => setTimeout(r, VESSEL_LOOKUP_DELAY_MS));
      if (!mountedRef.current) return;
      setVesselLookupProgress({ current: i + 1, total: list.length });
      const item = list[i];
      try {
        const res = await searchVesselsApi(collectionId, item.site, item.name, item.voyage);
        if (Number(res?.count) > 0) found += 1;
        else notFound += 1;
      } catch (e) {
        console.error('Vessel lookup failed', item, e);
        errors += 1;
      }
    }
    if (mountedRef.current) setVesselLookupProgress(null);
    const summary = tf(t.booking.bulkActions.lookupSummary, { total: list.length, found, notFound, errors });
    const skippedText = skipped > 0 ? ` · ${tf(t.booking.bulkActions.lookupSkipped, { count: skipped })}` : '';
    addToast(summary + skippedText, errors > 0 ? 'error' : found > 0 ? 'success' : 'info');
  };

  const handleOpenExport = async (scope: 'all' | 'selected') => {
    if (!activeCollection) return;
    setExportScope(scope);
    try {
      const rows = scope === 'all'
        ? await getBookings(activeCollection.id, debouncedQuery, searchField)
        : await resolveSelectedRows();
      setExportRows(rows);
      setIsExportOpen(true);
    } catch (e: any) {
      addToast(e?.message || t.common.error, 'error');
    }
  };

  const bulkActions: BulkAction[] = [
    {
      key: 'lookup-vessels',
      label: vesselLookupProgress
        ? tf(t.booking.bulkActions.lookupProgress, vesselLookupProgress)
        : t.booking.bulkActions.lookupVessels,
      icon: Ship,
      onClick: () => setIsBulkVesselLookupOpen(true),
      loading: !!vesselLookupProgress,
    },
    {
      key: 'export',
      label: t.bulk.exportSelected,
      icon: FileSpreadsheet,
      onClick: () => handleOpenExport('selected'),
    },
    {
      key: 'copy',
      label: t.bulk.copySelected,
      icon: Copy,
      onClick: handleBulkCopy,
    },
    {
      key: 'move',
      label: t.booking.bulkActions.moveToCollection,
      icon: Layers,
      onClick: () => setIsMoveOpen(true),
    },
    {
      key: 'delete',
      label: t.bulk.deleteSelected,
      icon: Trash2,
      onClick: handleBulkDelete,
      danger: true,
      loading: bulkDeleting,
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-3.5 gap-2.5 bg-slate-50/50 dark:bg-slate-950/50">
      {/* Top Dropzone */}
      <div
        data-tour="booking-dropzone"
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative cursor-pointer p-3 rounded-xl border-2 border-dashed transition-all flex items-center justify-center gap-3 bg-white dark:bg-slate-900/60 shadow-sm shrink-0 ${
          isDragging
            ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/20 scale-[1.005]'
            : 'border-slate-200 dark:border-slate-800 hover:border-primary-400 dark:hover:border-primary-600 hover:bg-slate-50/50 dark:hover:bg-slate-900'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            if (files.length) handleFilesUpload(files);
          }}
        />
        <div className="p-2 bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 rounded-lg shrink-0">
          <UploadCloud className={`w-5 h-5 ${uploading ? 'animate-pulse' : ''}`} />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-slate-800 dark:text-slate-100">
            {uploading ? t.booking.uploading : t.booking.dropzoneTitle}
          </span>
          <span className="text-slate-400 hidden sm:inline">•</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
            (PDF, PNG, JPG, Screenshot Ctrl+V)
          </span>
        </div>
      </div>

      {/* Control Bar: Search & Action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
        {/* Search */}
        <div data-tour="booking-search" className="flex items-center gap-2 flex-1 max-w-md">
          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value)}
            className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-500 shrink-0"
          >
            <option value="all">{t.common.all}</option>
            <option value="booking_no">{getColLabel("Booking No", t.booking.columns["Booking No"])}</option>
            <option value="carrier">{getColLabel("Carrier", t.booking.columns["Carrier"])}</option>
            <option value="vessel">{getColLabel("Vessel", t.booking.columns["Vessel"])}</option>
            <option value="port_of_discharging">{getColLabel("Port of Discharging", t.booking.columns["Port of Discharging"])}</option>
            <option value="place_of_delivery">{getColLabel("Place of Delivery", t.booking.columns["Place of Delivery"])}</option>
            <option value="ts_port">{getColLabel("T/S Port", t.booking.columns["T/S Port"])}</option>
            <option value="equipment_type">{getColLabel("Equipment Type", t.booking.columns["Equipment Type"])}</option>
            <option value="empty_pickup_cy">{getColLabel("Empty Pick Up CY", t.booking.columns["Empty Pick Up CY"])}</option>
            <option value="full_return_cy">{getColLabel("Full return CY", t.booking.columns["Full return CY"])}</option>
            <option value="pdf_name">{getColLabel("Tên file PDF", t.booking.columns["Tên file PDF"])}</option>
          </select>

          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.common.search}
              className="w-full pl-8 pr-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Tooltip content={t.booking.form.addTooltip}>
            <button
              type="button"
              onClick={openCreateBooking}
              disabled={!activeCollection}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.booking.form.addButton}</span>
            </button>
          </Tooltip>

          <div data-tour="booking-ai-ocr">
            <Tooltip content={t.booking.scanImageTooltip}>
              <button
                onClick={() => {
                  setActiveImageFile(null);
                  setIsImageModalOpen(true);
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-sm transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t.booking.scanImage}</span>
              </button>
            </Tooltip>
          </div>

          <div data-tour="booking-phone-capture">
            <Tooltip content={t.booking.phone.scanHint}>
              <button
                onClick={() => setIsPhoneCaptureOpen(true)}
                className="relative flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>{mobile.session?.active ? t.booking.phone.connected : t.booking.phone.button}</span>
                {mobile.session?.active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                )}
              </button>
            </Tooltip>
          </div>

          <div data-tour="booking-col-config">
            <Tooltip content="Cấu hình hiển thị và sắp xếp thứ tự các cột">
              <button
                onClick={() => setIsColumnConfigOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{t.common.columnsConfig}</span>
              </button>
            </Tooltip>
          </div>

          <div data-tour="booking-export">
            <Tooltip content="Xuất danh sách Booking ra file Excel">
              <button
                onClick={() => handleOpenExport('all')}
                disabled={total === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm transition-all"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>{t.common.exportExcel}</span>
              </button>
            </Tooltip>
          </div>

          <Tooltip content="Tải lại dữ liệu">
            <button
              onClick={() => loadData('loading')}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>

          {total > 0 && (
            <Tooltip content="Xóa tất cả Booking trong bộ sưu tập này">
              <button
                onClick={handleClearAll}
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Main Table */}
      <div data-tour="booking-table" className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto w-full">
          <table className="min-w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
              <tr>
                <th className="py-2 px-2 text-center w-8">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    aria-label={t.bulk.selectPage}
                    title={t.bulk.selectPage}
                    checked={pageAllSelected}
                    disabled={loading || pageRows.length === 0}
                    onChange={() => selection.selectPage(pageRows, !pageAllSelected)}
                    className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer align-middle"
                  />
                </th>
                <th className="py-2 px-2.5 font-bold text-slate-600 dark:text-slate-300 text-center w-10 shrink-0 text-[11px]">
                  {t.common.stt}
                </th>
                {visibleColumns.map((col) => (
                  <ResizableTh
                    key={col.key}
                    colKey={col.key}
                    label={col.label}
                    width={columnWidths[col.key]}
                    onResize={startResize}
                  />
                ))}
                <th className="py-2 px-2.5 font-bold text-slate-600 dark:text-slate-300 text-center w-28 text-[11px]">
                  {t.common.actions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {loading ? (
                <TableSkeleton
                  columns={columns}
                  columnWidths={columnWidths}
                  rowCount={Math.min(pageSize, 8)}
                  hasCheckbox={true}
                  hasActions={true}
                  actionColClass="w-28"
                />
              ) : pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="py-12 text-center text-slate-400 dark:text-slate-500"
                  >
                    <FileText className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
                    <p className="text-xs font-medium">{t.common.noData}</p>
                  </td>
                </tr>
              ) : (
                <>
                  {virtual.paddingTop > 0 && (
                    <tr aria-hidden="true" style={{ height: virtual.paddingTop }}>
                      <td colSpan={colSpan} />
                    </tr>
                  )}
                  {virtual.indexes.map((i) => {
                    const booking = pageRows[i];
                    return (
                      <BookingRow
                        key={booking.id ?? i}
                        booking={booking}
                        rowNumber={(currentPage - 1) * pageSize + i + 1}
                        visibleColumns={visibleColumns}
                        columnWidths={columnWidths}
                        selected={selection.selectedIds.has(booking.id)}
                        onToggle={selection.toggle}
                        onOpen={openBooking}
                        onCopy={copyRow}
                        onDelete={handleDelete}
                        onQuickVessel={openQuickVessel}
                        onEdit={openEditBooking}
                        vesselTooltip={t.booking.quickVessel.rowTooltip}
                        editLabel={t.booking.form.editTooltip}
                      />
                    );
                  })}
                  {virtual.paddingBottom > 0 && (
                    <tr aria-hidden="true" style={{ height: virtual.paddingBottom }}>
                      <td colSpan={colSpan} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      <BulkActionBar
        count={selection.count}
        onClear={selection.clear}
        actions={bulkActions}
        extra={
          !selection.isAllSelected && total > selection.count ? (
            <button
              type="button"
              onClick={handleSelectAllResults}
              className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap"
            >
              {tf(t.bulk.selectAllResults, { count: total })}
            </button>
          ) : undefined
        }
      />

      {/* Modals */}
      <BookingDetailModal
        isOpen={!!selectedBooking}
        onClose={closeDetail}
        booking={selectedBooking}
        onNavigateTab={onNavigateTab}
        onEdit={openEditBooking}
      />

      <QuickVesselSearch
        isOpen={!!quickVesselBooking}
        onClose={closeQuickVessel}
        booking={quickVesselBooking}
        onNavigateTab={onNavigateTab}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        data={exportRows}
        allColumns={exportColumns}
        filenamePrefix={exportScope === 'selected' ? 'bookings_selected' : 'bookings'}
      />

      <MoveToCollectionModal
        isOpen={isMoveOpen}
        onClose={() => setIsMoveOpen(false)}
        entity="bookings"
        ids={selectedIdList}
        onDone={(result) => {
          selection.clear();
          if (!result.copy) loadData('refresh');
        }}
      />

      <BulkVesselLookupModal
        isOpen={isBulkVesselLookupOpen}
        onClose={() => setIsBulkVesselLookupOpen(false)}
        selectedCount={selection.count}
        onStart={(mode) => handleBulkVesselLookup(mode)}
      />

      <ColumnConfigModal
        isOpen={isColumnConfigOpen}
        onClose={() => setIsColumnConfigOpen(false)}
        columns={columns}
        onChange={setColumns}
        onReset={resetColumns}
      />

      <ImageBookingModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        initialFile={activeImageFile}
        onSavedSuccess={() => loadData('refresh')}
        onPdfFiles={(files) => void uploadFiles(files)}
        pendingCount={mobile.queue.length}
      />

      <PhoneCaptureModal
        isOpen={isPhoneCaptureOpen}
        onClose={() => setIsPhoneCaptureOpen(false)}
      />

      <BookingFormModal
        isOpen={!!bookingForm}
        mode={bookingForm?.mode ?? 'create'}
        booking={bookingForm?.booking}
        onClose={() => setBookingForm(null)}
        onSaved={handleBookingSaved}
      />
    </div>
  );
};

