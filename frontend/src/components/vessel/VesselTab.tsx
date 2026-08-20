import React, { useState, useEffect, useMemo } from 'react';
import { 
  Ship, Search, RefreshCw, Trash2, FileSpreadsheet, 
  SlidersHorizontal, Eye, BookmarkPlus, BookmarkCheck, Copy
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { VesselSchedule, VesselWatchlist } from '../../types';
import { 
  getVessels, searchVesselsApi, deleteVessel, deleteVesselsBatch, clearVessels, 
  addVesselWatchlist, getVesselWatchlist, deleteVesselWatchlist 
} from '../../services/api';
import { ExportModal } from '../common/ExportModal';
import { ColumnConfigModal, ColumnDef } from '../common/ColumnConfigModal';
import { VesselDetailModal } from './VesselDetailModal';
import { VesselWatchlistModal } from './VesselWatchlistModal';
import { ResizableTh } from '../common/ResizableTh';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { Tooltip } from '../common/Tooltip';
import { formatTimeAgo, isRecentUpdate, formatRowForCopy, copyTextToClipboard } from '../../utils/formatters';
import { Pagination } from '../common/Pagination';
import { TableSkeleton } from '../common/TableSkeleton';
import { ValueBadge } from '../common/ValueBadge';
import { subscribeTourActions } from '../../services/tourService';

interface VesselTabProps {
  initialSearchQuery?: string;
}

export const VesselTab: React.FC<VesselTabProps> = ({ initialSearchQuery }) => {
  const { t, activeCollection, addToast, autoSyncEnabled } = useApp();
  const [schedules, setSchedules] = useState<VesselSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(() => {
    const saved = localStorage.getItem('vessel_page_size');
    return saved && !isNaN(Number(saved)) ? Number(saved) : 50;
  });
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Search in database
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [searchField, setSearchField] = useState('all');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // ePort query inputs
  const [siteId, setSiteId] = useState<string>(() => localStorage.getItem('last_vessel_site_id') || 'CTL');
  const [vesselName, setVesselName] = useState('');
  const [voyage, setVoyage] = useState('');

  const [selectedSchedule, setSelectedSchedule] = useState<VesselSchedule | null>(null);
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [watchlist, setWatchlist] = useState<VesselWatchlist[]>([]);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);

  // Listen to interactive tour triggers (open/close Vessel Watchlist modal)
  useEffect(() => {
    const unsubscribe = subscribeTourActions((action) => {
      if (action === 'openVesselWatchlist') {
        setIsWatchlistOpen(true);
      } else if (action === 'closeVesselWatchlist') {
        setIsWatchlistOpen(false);
      }
    });
    return unsubscribe;
  }, []);

  const defaultColumns: ColumnDef[] = useMemo(() => [
    { key: "site_id", label: t.vessel.columns["site_id"], visible: true },
    { key: "agent", label: t.vessel.columns["agent"], visible: true },
    { key: "vessel_name", label: t.vessel.columns["vessel_name"], visible: true },
    { key: "in_out_voyage", label: t.vessel.columns["in_out_voyage"], visible: true },
    { key: "actual_berth_time", label: t.vessel.columns["actual_berth_time"], visible: true },
    { key: "actual_departure_time", label: t.vessel.columns["actual_departure_time"], visible: true },
    { key: "closing_time", label: t.vessel.columns["closing_time"], visible: true },
    { key: "closing_time_icd", label: t.vessel.columns["closing_time_icd"], visible: false },
    { key: "in_gate", label: t.vessel.columns["in_gate"], visible: true },
    { key: "open_ts", label: t.vessel.columns["open_ts"], visible: true },
    { key: "reefer_open_ts", label: t.vessel.columns["reefer_open_ts"], visible: false },
    { key: "oog_open_ts", label: t.vessel.columns["oog_open_ts"], visible: false },
    { key: "haz_open_ts", label: t.vessel.columns["haz_open_ts"], visible: false },
    { key: "remarks", label: t.vessel.columns["remarks"], visible: true },
    { key: "queried_at", label: t.vessel.columns["queried_at"], visible: true },
  ], [t]);

  const defaultWidths = useMemo(() => ({
    "site_id": 75,
    "agent": 75,
    "vessel_name": 140,
    "in_out_voyage": 120,
    "actual_berth_time": 150,
    "actual_departure_time": 150,
    "closing_time": 140,
    "closing_time_icd": 140,
    "in_gate": 80,
    "open_ts": 130,
    "reefer_open_ts": 130,
    "oog_open_ts": 130,
    "haz_open_ts": 130,
    "remarks": 140,
    "queried_at": 140,
  }), []);

  const { columns, setColumns, resetColumns, columnWidths, startResize } = useColumnSettings({
    storageKey: 'vessel_table',
    defaultColumns,
    defaultWidths,
  });

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

  const loadWatchlist = async () => {
    if (!activeCollection) return;
    try {
      const data = await getVesselWatchlist(activeCollection.id);
      setWatchlist(data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadData = async (showLoading = true) => {
    if (!activeCollection) return;
    try {
      if (showLoading) setLoading(true);
      const data = await getVessels(activeCollection.id, searchQuery, searchField);
      setSchedules(data);
      loadWatchlist();
    } catch (e: any) {
      console.error(e);
      if (showLoading) addToast(e.message || t.common.error, 'error');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedIds([]);
    setCurrentPage(1);
    loadData(true);
    loadWatchlist();
  }, [activeCollection, searchQuery, searchField]);

  const paginatedSchedules = useMemo(() => {
    if (pageSize >= schedules.length || pageSize <= 0) return schedules;
    const start = (currentPage - 1) * pageSize;
    return schedules.slice(start, start + pageSize);
  }, [schedules, currentPage, pageSize]);

  // Periodic polling when auto-sync is active to automatically reflect new vessel schedules & statuses
  useEffect(() => {
    if (!autoSyncEnabled || !activeCollection) return;

    const timer = setInterval(() => {
      loadData(false);
    }, 10000);

    return () => clearInterval(timer);
  }, [autoSyncEnabled, activeCollection, searchQuery, searchField]);

  const normalizeStr = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Match a schedule item with watchlist
  const getWatchlistItem = (item: VesselSchedule): VesselWatchlist | undefined => {
    const itemName = normalizeStr(item.vessel_name);
    const itemVoyage = normalizeStr(item.in_out_voyage);
    const itemSite = (item.site_id || '').trim().toUpperCase();

    return watchlist.find((w) => {
      const wSite = (w.site_id || '').trim().toUpperCase();
      if (wSite && itemSite && wSite !== itemSite) return false;

      const wName = normalizeStr(w.vessel_name);
      if (wName !== itemName) return false;

      const wVoyage = normalizeStr(w.voyage);
      if (wVoyage && itemVoyage) {
        return wVoyage === itemVoyage;
      }

      return true;
    });
  };

  // Toggle add/remove from watchlist
  const handleToggleWatchlist = async (item: VesselSchedule) => {
    if (!activeCollection) return;
    const matched = getWatchlistItem(item);
    try {
      if (matched) {
        await deleteVesselWatchlist(matched.id);
        setWatchlist((prev) => prev.filter((w) => w.id !== matched.id));
        addToast(`Đã xóa tàu ${item.vessel_name} (${item.in_out_voyage || ''}) khỏi Watchlist!`, 'success');
      } else {
        await addVesselWatchlist(
          activeCollection.id,
          item.site_id || siteId || localStorage.getItem('last_vessel_site_id') || 'CTL',
          item.vessel_name,
          item.in_out_voyage || ''
        );
        addToast(`Đã thêm tàu ${item.vessel_name} (${item.in_out_voyage || ''}) vào Watchlist!`, 'success');
        await loadWatchlist();
      }
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    const pageIds = paginatedSchedules.map((s) => s.id).filter((id): id is number => typeof id === 'number');
    if (pageIds.length === 0) return;
    const allPageSelected = pageIds.every((id) => selectedIds.includes(id));
    if (allPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa ${selectedIds.length} dòng lịch tàu đã chọn?`)) return;
    try {
      await deleteVesselsBatch(selectedIds);
      addToast(`Đã xóa thành công ${selectedIds.length} dòng lịch tàu!`, 'success');
      setSchedules((prev) => prev.filter((s) => !selectedIds.includes(s.id)));
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleQueryEport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCollection) return;
    if (!vesselName.trim()) {
      addToast('Vui lòng nhập tên tàu để tra cứu', 'error');
      return;
    }

    try {
      setQuerying(true);
      localStorage.setItem('last_vessel_site_id', siteId);
      const res = await searchVesselsApi(activeCollection.id, siteId, vesselName.trim(), voyage.trim());
      if (res.count > 0) {
        addToast(`Tìm thấy ${res.count} kết quả lịch tàu khớp!`, 'success');
        await loadData();
      } else {
        addToast(res.message || 'Không tìm thấy thông tin chuyến tàu khớp trên ePort', 'info');
      }
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    } finally {
      setQuerying(false);
    }
  };

  const handleCopyRow = async (item: VesselSchedule) => {
    const text = formatRowForCopy(item, columns);
    const success = await copyTextToClipboard(text);
    if (success) {
      addToast(t.common.copySuccess, 'success');
    } else {
      addToast(t.common.error, 'error');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t.common.deleteConfirm)) return;
    try {
      await deleteVessel(id);
      addToast(t.common.success, 'success');
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      setSelectedIds((prev) => prev.filter((i) => i !== id));
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleClearAll = async () => {
    if (!activeCollection) return;
    if (!window.confirm(t.common.clearConfirm)) return;
    try {
      await clearVessels(activeCollection.id);
      addToast(t.common.success, 'success');
      setSchedules([]);
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-3.5 gap-2.5 bg-slate-50/50 dark:bg-slate-950/50">
      {/* Top Searcher Form */}
      <div data-tour="vessel-query-form" className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
        <form onSubmit={handleQueryEport} className="flex flex-wrap items-center gap-2.5">
          <div className="w-52 shrink-0">
            <select
              value={siteId}
              onChange={(e) => {
                const val = e.target.value;
                setSiteId(val);
                localStorage.setItem('last_vessel_site_id', val);
              }}
              className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-500"
            >
              <option value="CTL">{t.vessel.siteCTL}</option>
              <option value="GNL">{t.vessel.siteGNL}</option>
              <option value="THP">{t.vessel.siteTHP}</option>
              <option value="CMS">{t.vessel.siteCMS}</option>
              <option value="IST">{t.vessel.siteIST}</option>
              <option value="TNT">{t.vessel.siteTNT}</option>
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              required
              value={vesselName}
              onChange={(e) => setVesselName(e.target.value)}
              placeholder={t.vessel.vesselNamePlaceholder}
              className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="w-44 shrink-0">
            <input
              type="text"
              value={voyage}
              onChange={(e) => setVoyage(e.target.value)}
              placeholder={t.vessel.voyagePlaceholder}
              className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <button
            type="submit"
            disabled={querying}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition-all shrink-0"
          >
            <Search className={`w-3.5 h-3.5 ${querying ? 'animate-spin' : ''}`} />
            <span>{querying ? t.common.loading : t.vessel.queryBtn}</span>
          </button>

          <div data-tour="vessel-watchlist-btn" className="ml-auto shrink-0">
            <button
              type="button"
              onClick={() => setIsWatchlistOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 hover:bg-primary-100 transition-colors shrink-0"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>{t.vessel.watchlistTitle}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Controls: Filter & Table actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value)}
            className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-500 shrink-0"
          >
            <option value="all">{t.common.all}</option>
            <option value="vessel_name">{getColLabel("vessel_name", t.vessel.columns["vessel_name"])}</option>
            <option value="in_out_voyage">{getColLabel("in_out_voyage", t.vessel.columns["in_out_voyage"])}</option>
            <option value="agent">{getColLabel("agent", t.vessel.columns["agent"])}</option>
            <option value="site_id">{getColLabel("site_id", t.vessel.columns["site_id"])}</option>
            <option value="remarks">{getColLabel("remarks", t.vessel.columns["remarks"])}</option>
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

        <div className="flex items-center gap-1.5 shrink-0">
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-1.5 mr-2 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 px-2 py-1 rounded-lg animate-in fade-in">
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa đã chọn ({selectedIds.length})</span>
              </button>
              <button
                onClick={() => setSelectedIds([])}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline px-1"
              >
                Bỏ chọn
              </button>
            </div>
          )}

          <Tooltip content="Cấu hình hiển thị và sắp xếp thứ tự các cột">
            <button
              onClick={() => setIsColumnConfigOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{t.common.columnsConfig}</span>
            </button>
          </Tooltip>

          <Tooltip content="Xuất danh sách lịch tàu ra file Excel">
            <button
              onClick={() => setIsExportOpen(true)}
              disabled={schedules.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm transition-all"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{t.common.exportExcel}</span>
            </button>
          </Tooltip>

          <Tooltip content="Tải lại dữ liệu lịch tàu">
            <button
              onClick={() => loadData(true)}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>

          {schedules.length > 0 && (
            <Tooltip content="Xóa tất cả lịch tàu trong bộ sưu tập này">
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

      {/* Vessel Schedules Table */}
      <div data-tour="vessel-table" className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm min-h-0">
        <div className="flex-1 overflow-x-auto overflow-y-auto w-full">
          <table className="min-w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
              <tr>
                <th className="py-2 px-2 text-center w-8 shrink-0">
                  <input
                    type="checkbox"
                    checked={paginatedSchedules.length > 0 && paginatedSchedules.every((s) => selectedIds.includes(s.id))}
                    onChange={handleSelectAll}
                    className="rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    title="Chọn tất cả trên trang này / Bỏ chọn"
                  />
                </th>
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
                <th className="py-2 px-2.5 font-bold text-slate-600 dark:text-slate-300 text-center w-24 text-[11px]">
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
                  actionColClass="w-24"
                />
              ) : schedules.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.filter((c) => c.visible).length + 3}
                    className="py-12 text-center text-slate-400 dark:text-slate-500"
                  >
                    <Ship className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
                    <p className="text-xs font-medium">{t.common.noData}</p>
                  </td>
                </tr>
              ) : (
                paginatedSchedules.map((item, idx) => {
                  const isRecent = isRecentUpdate(item.queried_at, 45);
                  const watchlistItem = getWatchlistItem(item);
                  const isBookmarked = !!watchlistItem;
                  const isSelected = selectedIds.includes(item.id);
                  return (
                    <tr
                      key={item.id || idx}
                      onDoubleClick={() => setSelectedSchedule(item)}
                      className={`hover:bg-sky-100/80 dark:hover:bg-sky-950/70 hover:shadow-xs transition-colors group cursor-pointer ${
                        isSelected
                          ? 'bg-sky-50 dark:bg-sky-950/50 ring-1 ring-inset ring-sky-300 dark:ring-sky-800'
                          : isBookmarked
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-l-[3px] border-l-emerald-500'
                          : ''
                      }`}
                    >
                      <td className="py-1.5 px-2 text-center w-8" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.id)}
                          className="rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-1.5 px-2.5 text-center font-medium text-slate-400 w-10">
                        {(currentPage - 1) * pageSize + idx + 1}
                      </td>
                      {columns
                        .filter((c) => c.visible)
                        .map((col) => {
                          const val = item[col.key] || 'null';
                          const isNull = val === 'null' || !val;
                          const w = columnWidths[col.key];

                          if (col.key === 'queried_at') {
                            return (
                              <td
                                key={col.key}
                                style={{
                                  width: w ? `${w}px` : undefined,
                                  maxWidth: w ? `${w}px` : undefined,
                                }}
                                className="py-1.5 px-2.5 truncate"
                                title={`Thời gian cập nhật: ${String(val)}`}
                              >
                                {isNull ? (
                                  <span className="text-slate-400 dark:text-slate-500 italic text-[11px]">Chưa cập nhật</span>
                                ) : (
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-tight border ${
                                      isRecent
                                        ? 'bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-2xs'
                                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                    }`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        isRecent ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                                      }`}
                                    />
                                    <span>{formatTimeAgo(val)}</span>
                                  </span>
                                )}
                              </td>
                            );
                          }

                          if (col.key === 'vessel_name') {
                            return (
                              <td
                                key={col.key}
                                style={{
                                  width: w ? `${w}px` : undefined,
                                  maxWidth: w ? `${w}px` : undefined,
                                }}
                                className="py-1.5 px-2.5 truncate font-bold"
                                title={String(val)}
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  {isBookmarked && (
                                    <span
                                      title="Đang trong Watchlist theo dõi"
                                      className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
                                    />
                                  )}
                                  <ValueBadge
                                    table="vessel"
                                    columnKey={col.key}
                                    value={val}
                                    className="font-bold text-slate-900 dark:text-slate-100"
                                    fallbackText="-"
                                  />
                                </div>
                              </td>
                            );
                          }

                          return (
                            <td
                              key={col.key}
                              style={{
                                width: w ? `${w}px` : undefined,
                                maxWidth: w ? `${w}px` : undefined,
                              }}
                              className="py-1.5 px-2.5 truncate"
                              title={`${col.label}: ${String(val || '')}`}
                            >
                              <ValueBadge
                                table="vessel"
                                columnKey={col.key}
                                value={val}
                                fallbackText="null"
                              />
                            </td>
                          );
                        })}
                    <td className="py-1.5 px-2.5 text-center w-24">
                      <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <Tooltip content="Xem chi tiết đầy đủ lịch tàu">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedSchedule(item); }}
                            className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip content="Sao chép thông tin dòng">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopyRow(item); }}
                            className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip
                          content={
                            isBookmarked
                              ? (t.vessel.inWatchlistTooltip || 'Đang trong Watchlist (Nhấn để hủy theo dõi)')
                              : (t.vessel.addToWatchlistTooltip || 'Thêm vào Watchlist để theo dõi')
                          }
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggleWatchlist(item); }}
                            className={`p-1 rounded-md transition-all ${
                              isBookmarked
                                ? 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-200 dark:border-amber-800 shadow-2xs'
                                : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50'
                            }`}
                          >
                            {isBookmarked ? (
                              <BookmarkCheck className="w-3.5 h-3.5 fill-amber-500/20 text-amber-500 dark:text-amber-400" />
                            ) : (
                              <BookmarkPlus className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </Tooltip>
                        <Tooltip content="Xóa dòng lịch tàu này">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                            className="p-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <Pagination
          currentPage={currentPage}
          totalItems={schedules.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            localStorage.setItem('vessel_page_size', String(newSize));
            setCurrentPage(1);
          }}
        />
      </div>

      {/* Modals */}
      <VesselDetailModal
        isOpen={!!selectedSchedule}
        onClose={() => setSelectedSchedule(null)}
        schedule={selectedSchedule}
      />

      <VesselWatchlistModal
        isOpen={isWatchlistOpen}
        onClose={() => setIsWatchlistOpen(false)}
        onDataUpdated={() => {
          loadData();
          loadWatchlist();
        }}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        data={schedules}
        allColumns={[
          { key: "STT", label: t.vessel.columns["STT"] },
          ...columns.map((c) => ({ key: c.key, label: c.label })),
        ]}
        filenamePrefix="vessel_schedules"
      />

      <ColumnConfigModal
        isOpen={isColumnConfigOpen}
        onClose={() => setIsColumnConfigOpen(false)}
        columns={columns}
        onChange={setColumns}
        onReset={resetColumns}
      />
    </div>
  );
};
