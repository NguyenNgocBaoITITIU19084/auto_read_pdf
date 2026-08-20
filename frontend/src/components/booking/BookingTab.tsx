import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  UploadCloud, Search, RefreshCw, Trash2, FileSpreadsheet, 
  SlidersHorizontal, Eye, Copy, FileText, Sparkles, Camera, Image as ImageIcon
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Booking } from '../../types';
import { getBookings, uploadPDFs, deleteBooking, clearBookings } from '../../services/api';
import { ExportModal } from '../common/ExportModal';
import { ColumnConfigModal, ColumnDef } from '../common/ColumnConfigModal';
import { BookingDetailModal } from './BookingDetailModal';
import { ImageBookingModal } from './ImageBookingModal';
import { ResizableTh } from '../common/ResizableTh';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { Tooltip } from '../common/Tooltip';
import { formatRowForCopy, copyTextToClipboard } from '../../utils/formatters';
import { Pagination } from '../common/Pagination';
import { TableSkeleton } from '../common/TableSkeleton';
import { ValueBadge } from '../common/ValueBadge';
import { subscribeTourActions } from '../../services/tourService';

interface BookingTabProps {
  initialSearchQuery?: string;
}

export const BookingTab: React.FC<BookingTabProps> = ({ initialSearchQuery }) => {
  const { t, activeCollection, addToast } = useApp();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [searchField, setSearchField] = useState('all');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(() => {
    const saved = localStorage.getItem('booking_page_size');
    return saved && !isNaN(Number(saved)) ? Number(saved) : 50;
  });
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal states
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [activeImageFile, setActiveImageFile] = useState<File | null>(null);
  const [activeImageBlob, setActiveImageBlob] = useState<Blob | null>(null);

  // Global clipboard paste listener (Ctrl+V / Cmd+V)
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            e.preventDefault();
            setActiveImageFile(null);
            setActiveImageBlob(blob);
            setIsImageModalOpen(true);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => {
      window.removeEventListener('paste', handleGlobalPaste);
    };
  }, []);

  // Listen to interactive tour triggers (open/close AI image OCR modal)
  useEffect(() => {
    const unsubscribe = subscribeTourActions((action) => {
      if (action === 'openImageModal') {
        setActiveImageFile(null);
        setActiveImageBlob(null);
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

  const getColLabel = (key: string, fallback: string) => {
    const col = columns.find((c) => c.key === key);
    return col?.label || fallback;
  };

  const loadData = async () => {
    if (!activeCollection) return;
    try {
      setLoading(true);
      const data = await getBookings(activeCollection.id, searchQuery, searchField);
      setBookings(data);
    } catch (e: any) {
      console.error(e);
      addToast(e.message || t.common.error, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    loadData();
  }, [activeCollection, searchQuery, searchField]);

  const paginatedBookings = useMemo(() => {
    if (pageSize >= bookings.length || pageSize <= 0) return bookings;
    const start = (currentPage - 1) * pageSize;
    return bookings.slice(start, start + pageSize);
  }, [bookings, currentPage, pageSize]);

  const handleFilesUpload = async (files: FileList | File[]) => {
    if (!activeCollection || files.length === 0) return;
    
    const validExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp'];
    const fileArray = Array.from(files).filter(f => {
      const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
      return validExtensions.includes(ext);
    });

    if (fileArray.length === 0) {
      addToast('Vui lòng chọn file định dạng PDF hoặc hình ảnh (.png, .jpg, .jpeg, .webp, .bmp)', 'error');
      return;
    }

    // If exactly 1 image file is uploaded/dropped, open the interactive review modal
    const isSingleImage = fileArray.length === 1 && !fileArray[0].name.toLowerCase().endsWith('.pdf');
    if (isSingleImage) {
      setActiveImageFile(fileArray[0]);
      setActiveImageBlob(null);
      setIsImageModalOpen(true);
      return;
    }

    // Batch upload processing
    try {
      setUploading(true);
      const res = await uploadPDFs(activeCollection.id, fileArray);
      addToast(t.booking.uploadSuccess.replace('{count}', res.count.toString()), 'success');
      await loadData();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFilesUpload(e.dataTransfer.files);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t.common.deleteConfirm)) return;
    try {
      await deleteBooking(id);
      addToast(t.common.success, 'success');
      setBookings((prev) => prev.filter((b) => b.id !== id));
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleClearAll = async () => {
    if (!activeCollection) return;
    if (!window.confirm(t.common.clearConfirm)) return;
    try {
      await clearBookings(activeCollection.id);
      addToast(t.common.success, 'success');
      setBookings([]);
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const copyRow = async (booking: Booking) => {
    const text = formatRowForCopy(booking, columns);
    const success = await copyTextToClipboard(text);
    if (success) {
      addToast(t.common.copySuccess, 'success');
    } else {
      addToast(t.common.error, 'error');
    }
  };

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
          onChange={(e) => e.target.files && handleFilesUpload(e.target.files)}
        />
        <div className="p-2 bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 rounded-lg shrink-0">
          <UploadCloud className="w-5 h-5" />
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
          <div data-tour="booking-ai-ocr">
            <Tooltip content={t.booking.scanImageTooltip}>
              <button
                onClick={() => {
                  setActiveImageFile(null);
                  setActiveImageBlob(null);
                  setIsImageModalOpen(true);
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-sm transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t.booking.scanImage}</span>
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
                onClick={() => setIsExportOpen(true)}
                disabled={bookings.length === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm transition-all"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>{t.common.exportExcel}</span>
              </button>
            </Tooltip>
          </div>

          <Tooltip content="Tải lại dữ liệu">
            <button
              onClick={loadData}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>

          {bookings.length > 0 && (
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
        <div className="flex-1 overflow-x-auto overflow-y-auto w-full">
          <table className="min-w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
              <tr>
                <th className="py-2 px-2.5 font-bold text-slate-600 dark:text-slate-300 text-center w-10 shrink-0 text-[11px]">
                  {t.common.stt}
                </th>
                {columns
                  .filter((c) => c.visible)
                  .map((col) => (
                    <ResizableTh
                      key={col.key}
                      colKey={col.key}
                      label={col.label}
                      width={columnWidths[col.key]}
                      onResize={startResize}
                    />
                  ))}
                <th className="py-2 px-2.5 font-bold text-slate-600 dark:text-slate-300 text-center w-16 text-[11px]">
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
                  hasCheckbox={false}
                  hasActions={true}
                  actionColClass="w-16"
                />
              ) : bookings.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.filter((c) => c.visible).length + 2}
                    className="py-12 text-center text-slate-400 dark:text-slate-500"
                  >
                    <FileText className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
                    <p className="text-xs font-medium">{t.common.noData}</p>
                  </td>
                </tr>
              ) : (
                paginatedBookings.map((booking, idx) => (
                  <tr
                    key={booking.id || idx}
                    onDoubleClick={() => setSelectedBooking(booking)}
                    className="hover:bg-sky-100/80 dark:hover:bg-sky-950/70 hover:shadow-xs transition-colors group cursor-pointer"
                  >
                    <td className="py-1.5 px-2.5 text-center font-medium text-slate-400 w-10">
                      {(currentPage - 1) * pageSize + idx + 1}
                    </td>
                    {columns
                      .filter((c) => c.visible)
                      .map((col) => {
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
                    <td className="py-1.5 px-2.5 text-center w-16">
                      <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <Tooltip content="Xem chi tiết đầy đủ">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedBooking(booking); }}
                            className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip content="Sao chép toàn bộ dòng">
                          <button
                            onClick={(e) => { e.stopPropagation(); copyRow(booking); }}
                            className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip content="Xóa dòng này">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(booking.id); }}
                            className="p-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <Pagination
          currentPage={currentPage}
          totalItems={bookings.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            localStorage.setItem('booking_page_size', String(newSize));
            setCurrentPage(1);
          }}
        />
      </div>

      {/* Modals */}
      <BookingDetailModal
        isOpen={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
        booking={selectedBooking}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        data={bookings}
        allColumns={[
          { key: "STT", label: t.booking.columns["STT"] },
          ...columns.map((c) => ({ key: c.key, label: c.label })),
        ]}
        filenamePrefix="bookings"
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
        initialImageFile={activeImageFile}
        initialImageBlob={activeImageBlob}
        onSavedSuccess={loadData}
      />
    </div>
  );
};
