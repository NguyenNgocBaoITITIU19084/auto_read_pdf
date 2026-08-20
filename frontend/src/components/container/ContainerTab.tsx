import React, { useState, useEffect, useMemo } from 'react';
import { 
  Box, Search, RefreshCw, Trash2, FileSpreadsheet, 
  SlidersHorizontal, Eye, BookmarkPlus, BookmarkCheck, Copy
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ContainerInfo, ContainerWatchlist } from '../../types';
import { 
  getContainers, searchContainersApi, deleteContainer, deleteContainersBatch, clearContainers, 
  addContainerWatchlist, getContainerWatchlist, deleteContainerWatchlist 
} from '../../services/api';
import { ExportModal } from '../common/ExportModal';
import { ColumnConfigModal, ColumnDef } from '../common/ColumnConfigModal';
import { ContainerDetailModal } from './ContainerDetailModal';
import { ContainerWatchlistModal } from './ContainerWatchlistModal';
import { ResizableTh } from '../common/ResizableTh';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { Tooltip } from '../common/Tooltip';
import { formatTimeAgo, isRecentUpdate, formatRowForCopy, copyTextToClipboard } from '../../utils/formatters';
import { Pagination } from '../common/Pagination';
import { TableSkeleton } from '../common/TableSkeleton';

export const ContainerTab: React.FC = () => {
  const { t, activeCollection, addToast, autoSyncEnabled } = useApp();
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(() => {
    const saved = localStorage.getItem('container_page_size');
    return saved && !isNaN(Number(saved)) ? Number(saved) : 50;
  });
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState('all');

  const [siteId, setSiteId] = useState<string>(() => localStorage.getItem('last_container_site_id') || 'CTL');
  const [containerNosInput, setContainerNosInput] = useState('');

  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null);
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [watchlist, setWatchlist] = useState<ContainerWatchlist[]>([]);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);

  const defaultColumns: ColumnDef[] = useMemo(() => [
    { key: "site_id", label: t.container.columns["site_id"], visible: true },
    { key: "containerno", label: t.container.columns["containerno"], visible: true },
    { key: "event_type", label: t.container.columns["event_type"], visible: true },
    { key: "event_time", label: t.container.columns["event_time"], visible: true },
    { key: "fel", label: t.container.columns["fel"], visible: true },
    { key: "iso", label: t.container.columns["iso"], visible: true },
    { key: "category", label: t.container.columns["category"], visible: false },
    { key: "gross", label: t.container.columns["gross"], visible: true },
    { key: "vgm", label: t.container.columns["vgm"], visible: true },
    { key: "location", label: t.container.columns["location"], visible: true },
    { key: "truck_vessel", label: t.container.columns["truck_vessel"], visible: true },
    { key: "im_exp", label: t.container.columns["im_exp"], visible: true },
    { key: "bill_book", label: t.container.columns["bill_book"], visible: true },
    { key: "custom_clearance_status", label: t.container.columns["custom_clearance_status"], visible: true },
    { key: "infras_fee_status", label: t.container.columns["infras_fee_status"], visible: true },
    { key: "note", label: t.container.columns["note"], visible: false },
    { key: "item_seal_no", label: t.container.columns["item_seal_no"], visible: false },
    { key: "queried_at", label: t.container.columns["queried_at"], visible: true },
  ], [t]);

  const defaultWidths = useMemo(() => ({
    "site_id": 75,
    "containerno": 130,
    "event_type": 130,
    "event_time": 140,
    "fel": 60,
    "iso": 70,
    "category": 90,
    "gross": 80,
    "vgm": 80,
    "location": 90,
    "truck_vessel": 130,
    "im_exp": 70,
    "bill_book": 120,
    "custom_clearance_status": 110,
    "infras_fee_status": 110,
    "note": 120,
    "item_seal_no": 110,
    "queried_at": 140,
  }), []);

  const { columns, setColumns, resetColumns, columnWidths, startResize } = useColumnSettings({
    storageKey: 'container_table',
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
      const data = await getContainerWatchlist(activeCollection.id);
      setWatchlist(data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadData = async (showLoading = true) => {
    if (!activeCollection) return;
    try {
      if (showLoading) setLoading(true);
      const data = await getContainers(activeCollection.id, searchQuery, searchField);
      setContainers(data);
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

  const paginatedContainers = useMemo(() => {
    if (pageSize >= containers.length || pageSize <= 0) return containers;
    const start = (currentPage - 1) * pageSize;
    return containers.slice(start, start + pageSize);
  }, [containers, currentPage, pageSize]);

  // Periodic polling when auto-sync is active to automatically reflect new container statuses
  useEffect(() => {
    if (!autoSyncEnabled || !activeCollection) return;

    const timer = setInterval(() => {
      loadData(false);
    }, 10000);

    return () => clearInterval(timer);
  }, [autoSyncEnabled, activeCollection, searchQuery, searchField]);

  // Match a container item with watchlist
  const getWatchlistItem = (item: ContainerInfo): ContainerWatchlist | undefined => {
    const itemNo = (item.containerno || '').trim().toUpperCase();
    const itemSite = (item.site_id || '').trim().toUpperCase();

    return watchlist.find((w) => {
      const wSite = (w.site_id || '').trim().toUpperCase();
      if (wSite && itemSite && wSite !== itemSite) return false;
      return (w.container_no || '').trim().toUpperCase() === itemNo;
    });
  };

  // Toggle add/remove container from watchlist
  const handleToggleWatchlist = async (item: ContainerInfo) => {
    if (!activeCollection) return;
    const matched = getWatchlistItem(item);
    try {
      if (matched) {
        await deleteContainerWatchlist(matched.id);
        setWatchlist((prev) => prev.filter((w) => w.id !== matched.id));
        addToast(`Đã xóa container ${item.containerno} khỏi Watchlist!`, 'success');
      } else {
        await addContainerWatchlist(
          activeCollection.id,
          item.site_id || siteId || localStorage.getItem('last_container_site_id') || 'CTL',
          item.containerno
        );
        addToast(`Đã thêm container ${item.containerno} vào Watchlist!`, 'success');
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
    const pageIds = paginatedContainers.map((c) => c.id).filter((id): id is number => typeof id === 'number');
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
    if (!window.confirm(`Bạn có chắc chắn muốn xóa ${selectedIds.length} container đã chọn?`)) return;
    try {
      await deleteContainersBatch(selectedIds);
      addToast(`Đã xóa thành công ${selectedIds.length} container!`, 'success');
      setContainers((prev) => prev.filter((c) => !selectedIds.includes(c.id)));
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleQueryEport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCollection) return;
    if (!containerNosInput.trim()) {
      addToast('Vui lòng nhập danh sách số Container', 'error');
      return;
    }

    try {
      setQuerying(true);
      localStorage.setItem('last_container_site_id', siteId);
      const cleaned = containerNosInput
        .split(/[\s,\n]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .join(',');

      const res = await searchContainersApi(activeCollection.id, siteId, cleaned);
      if (res.count > 0) {
        addToast(`Tìm thấy ${res.count} kết quả tra cứu container!`, 'success');
      } else {
        addToast(res.message || 'Không tìm thấy thông tin container trên ePort', 'info');
      }
      await loadData();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    } finally {
      setQuerying(false);
    }
  };

  const handleCopyRow = async (item: ContainerInfo) => {
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
      await deleteContainer(id);
      addToast(t.common.success, 'success');
      setContainers((prev) => prev.filter((c) => c.id !== id));
      setSelectedIds((prev) => prev.filter((i) => i !== id));
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleClearAll = async () => {
    if (!activeCollection) return;
    if (!window.confirm(t.common.clearConfirm)) return;
    try {
      await clearContainers(activeCollection.id);
      addToast(t.common.success, 'success');
      setContainers([]);
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-3.5 gap-2.5 bg-slate-50/50 dark:bg-slate-950/50">
      {/* Top Searcher Form */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
        <form onSubmit={handleQueryEport} className="flex flex-wrap items-center gap-2.5">
          <div className="w-52 shrink-0">
            <select
              value={siteId}
              onChange={(e) => {
                const val = e.target.value;
                setSiteId(val);
                localStorage.setItem('last_container_site_id', val);
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

          <div className="flex-1 min-w-[240px]">
            <input
              type="text"
              required
              value={containerNosInput}
              onChange={(e) => setContainerNosInput(e.target.value.toUpperCase())}
              placeholder="Nhập danh sách số container (VD: TEMU1234567, TCLU7654321)..."
              className="w-full text-xs font-medium uppercase bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <button
            type="submit"
            disabled={querying}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition-all shrink-0"
          >
            <Search className={`w-3.5 h-3.5 ${querying ? 'animate-spin' : ''}`} />
            <span>{querying ? t.common.loading : t.container.queryBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsWatchlistOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 hover:bg-primary-100 transition-colors ml-auto shrink-0"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>{t.container.watchlistTitle}</span>
          </button>
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
            <option value="containerno">{getColLabel("containerno", t.container.columns["containerno"])}</option>
            <option value="location">{getColLabel("location", t.container.columns["location"])}</option>
            <option value="item_seal_no">{getColLabel("item_seal_no", t.container.columns["item_seal_no"])}</option>
            <option value="line_oper">{getColLabel("line_oper", t.container.columns["line_oper"])}</option>
            <option value="bill_book">{getColLabel("bill_book", t.container.columns["bill_book"])}</option>
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

          <Tooltip content="Xuất danh sách Container ra file Excel">
            <button
              onClick={() => setIsExportOpen(true)}
              disabled={containers.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm transition-all"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{t.common.exportExcel}</span>
            </button>
          </Tooltip>

          <Tooltip content="Tải lại dữ liệu Container">
            <button
              onClick={() => loadData(true)}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>

          {containers.length > 0 && (
            <Tooltip content="Xóa tất cả Container trong bộ sưu tập này">
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

      {/* Container Table */}
      <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm min-h-0">
        <div className="flex-1 overflow-x-auto overflow-y-auto w-full">
          <table className="min-w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
              <tr>
                <th className="py-2 px-2 text-center w-8 shrink-0">
                  <input
                    type="checkbox"
                    checked={paginatedContainers.length > 0 && paginatedContainers.every((c) => selectedIds.includes(c.id))}
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
              ) : containers.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.filter((c) => c.visible).length + 3}
                    className="py-12 text-center text-slate-400 dark:text-slate-500"
                  >
                    <Box className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
                    <p className="text-xs font-medium">{t.common.noData}</p>
                  </td>
                </tr>
              ) : (
                paginatedContainers.map((item, idx) => {
                  const isRecent = isRecentUpdate(item.queried_at, 45);
                  const watchlistItem = getWatchlistItem(item);
                  const isBookmarked = !!watchlistItem;
                  const isSelected = selectedIds.includes(item.id);
                  return (
                    <tr
                      key={item.id || idx}
                      onDoubleClick={() => setSelectedContainer(item)}
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
                          const val = item[col.key] !== undefined && item[col.key] !== null ? item[col.key] : 'null';
                          const isNull = val === 'null' || val === '' || val === 0;
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

                          if (col.key === 'containerno') {
                            return (
                              <td
                                key={col.key}
                                style={{
                                  width: w ? `${w}px` : undefined,
                                  maxWidth: w ? `${w}px` : undefined,
                                }}
                                className="py-1.5 px-2.5 truncate font-mono font-bold text-slate-900 dark:text-slate-100"
                                title={String(val)}
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  {isBookmarked && (
                                    <span
                                      title="Đang trong Watchlist theo dõi"
                                      className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
                                    />
                                  )}
                                  <span className="truncate">{String(val)}</span>
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
                              className={`py-1.5 px-2.5 truncate ${
                                isNull ? 'text-slate-400 dark:text-slate-500 italic' : 'text-slate-800 dark:text-slate-200 font-medium'
                              }`}
                              title={String(val)}
                            >
                              {String(val)}
                            </td>
                          );
                        })}
                    <td className="py-1.5 px-2.5 text-center w-24">
                      <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <Tooltip content="Xem chi tiết đầy đủ thông tin Container">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedContainer(item); }}
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
                              ? (t.container.inWatchlistTooltip || 'Đang trong Watchlist (Nhấn để hủy theo dõi)')
                              : (t.container.addToWatchlistTooltip || 'Thêm vào Watchlist để theo dõi')
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
                        <Tooltip content="Xóa dòng Container này">
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
          totalItems={containers.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            localStorage.setItem('container_page_size', String(newSize));
            setCurrentPage(1);
          }}
        />
      </div>

      {/* Modals */}
      <ContainerDetailModal
        isOpen={!!selectedContainer}
        onClose={() => setSelectedContainer(null)}
        container={selectedContainer}
      />

      <ContainerWatchlistModal
        isOpen={isWatchlistOpen}
        onClose={() => setIsWatchlistOpen(false)}
        onDataUpdated={loadData}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        data={containers}
        allColumns={[
          { key: "STT", label: t.container.columns["STT"] },
          ...columns.map((c) => ({ key: c.key, label: c.label })),
        ]}
        filenamePrefix="containers"
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
