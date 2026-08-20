import React, { useState, useEffect, useMemo } from 'react';
import { 
  Box, Search, RefreshCw, Trash2, FileSpreadsheet, 
  SlidersHorizontal, Eye, BookmarkPlus, BookmarkCheck, Copy, Filter
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
import { ValueBadge } from '../common/ValueBadge';

interface ContainerTabProps {
  initialSearchQuery?: string;
}

export const ContainerTab: React.FC<ContainerTabProps> = ({ initialSearchQuery }) => {
  const { t, activeCollection, addToast, autoSyncEnabled } = useApp();
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Filter by event type
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('ALL');

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(() => {
    const saved = localStorage.getItem('container_page_size');
    return saved && !isNaN(Number(saved)) ? Number(saved) : 50;
  });
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [searchField, setSearchField] = useState('all');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const [siteId, setSiteId] = useState<string>(() => localStorage.getItem('last_container_site_id') || 'CTL');
  const [containerNosInput, setContainerNosInput] = useState('');
  const [isSearchByInYard, setIsSearchByInYard] = useState<boolean>(() => localStorage.getItem('last_container_is_in_yard') === 'true');
  const [isSearchByBatch, setIsSearchByBatch] = useState<boolean>(() => localStorage.getItem('last_container_is_batch') === 'true');

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
    { key: "in_yard", label: t.container.columns["in_yard"], visible: false },
    { key: "fel", label: t.container.columns["fel"], visible: true },
    { key: "iso", label: t.container.columns["iso"], visible: true },
    { key: "gross", label: t.container.columns["gross"], visible: true },
    { key: "container_gross", label: t.container.columns["container_gross"], visible: false },
    { key: "tare_wt", label: t.container.columns["tare_wt"], visible: false },
    { key: "manifest_wt", label: t.container.columns["manifest_wt"], visible: false },
    { key: "gate_wt", label: t.container.columns["gate_wt"], visible: false },
    { key: "gate_gross_wt", label: t.container.columns["gate_gross_wt"], visible: false },
    { key: "certified_weight", label: t.container.columns["certified_weight"], visible: false },
    { key: "vgm", label: t.container.columns["vgm"], visible: true },
    { key: "category", label: t.container.columns["category"], visible: false },
    { key: "cust", label: t.container.columns["cust"], visible: false },
    { key: "location", label: t.container.columns["location"], visible: true },
    { key: "stack", label: t.container.columns["stack"], visible: false },
    { key: "temp", label: t.container.columns["temp"], visible: false },
    { key: "haz", label: t.container.columns["haz"], visible: false },
    { key: "load_to_vessel", label: t.container.columns["load_to_vessel"], visible: false },
    { key: "pod_destination", label: t.container.columns["pod_destination"], visible: false },
    { key: "truck_vessel", label: t.container.columns["truck_vessel"], visible: true },
    { key: "trans_in", label: t.container.columns["trans_in"], visible: false },
    { key: "trans_out", label: t.container.columns["trans_out"], visible: false },
    { key: "cont_in_ts", label: t.container.columns["cont_in_ts"], visible: false },
    { key: "cont_out_ts", label: t.container.columns["cont_out_ts"], visible: false },
    { key: "line_oper", label: t.container.columns["line_oper"], visible: true },
    { key: "im_exp", label: t.container.columns["im_exp"], visible: true },
    { key: "bill_book", label: t.container.columns["bill_book"], visible: true },
    { key: "cust_approval_date", label: t.container.columns["cust_approval_date"], visible: false },
    { key: "custom_clearance_status", label: t.container.columns["custom_clearance_status"], visible: true },
    { key: "infras_fee_status", label: t.container.columns["infras_fee_status"], visible: true },
    { key: "item_seal_no", label: t.container.columns["item_seal_no"], visible: true },
    { key: "note", label: t.container.columns["note"], visible: true },
    { key: "item_key", label: t.container.columns["item_key"], visible: false },
    { key: "queried_at", label: t.container.columns["queried_at"], visible: true },
  ], [t]);

  const defaultWidths = useMemo(() => ({
    "site_id": 75,
    "containerno": 130,
    "event_type": 130,
    "event_time": 140,
    "in_yard": 75,
    "fel": 65,
    "iso": 75,
    "gross": 85,
    "container_gross": 95,
    "tare_wt": 80,
    "manifest_wt": 85,
    "gate_wt": 80,
    "gate_gross_wt": 95,
    "certified_weight": 90,
    "vgm": 75,
    "category": 85,
    "cust": 75,
    "location": 95,
    "stack": 75,
    "temp": 75,
    "haz": 75,
    "load_to_vessel": 90,
    "pod_destination": 95,
    "truck_vessel": 140,
    "trans_in": 140,
    "trans_out": 140,
    "cont_in_ts": 140,
    "cont_out_ts": 140,
    "line_oper": 80,
    "im_exp": 80,
    "bill_book": 125,
    "cust_approval_date": 140,
    "custom_clearance_status": 120,
    "infras_fee_status": 115,
    "item_seal_no": 105,
    "note": 180,
    "item_key": 95,
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

  // Compute event counts across all containers in current collection
  const eventCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: containers.length };
    containers.forEach((c) => {
      const type = (c.event_type || '').trim().toUpperCase();
      if (type) {
        counts[type] = (counts[type] || 0) + 1;
      }
    });
    return counts;
  }, [containers]);

  // List of distinct event types found in data
  const availableEventTypes = useMemo(() => {
    const list = Object.keys(eventCounts).filter((k) => k !== 'ALL');
    const preferred = ['UNLOAD', 'INGATE', 'OUTGATE', 'STACKING', 'LOAD'];
    const sorted = [
      ...preferred.filter((p) => list.includes(p)),
      ...list.filter((l) => !preferred.includes(l))
    ];
    return sorted;
  }, [eventCounts]);

  // Filter containers by selected event type
  const filteredContainers = useMemo(() => {
    if (eventTypeFilter === 'ALL') return containers;
    return containers.filter(
      (c) => (c.event_type || '').trim().toUpperCase() === eventTypeFilter.toUpperCase()
    );
  }, [containers, eventTypeFilter]);

  const paginatedContainers = useMemo(() => {
    if (pageSize >= filteredContainers.length || pageSize <= 0) return filteredContainers;
    const start = (currentPage - 1) * pageSize;
    return filteredContainers.slice(start, start + pageSize);
  }, [filteredContainers, currentPage, pageSize]);

  // Periodic polling when auto-sync is active to automatically reflect new container statuses
  useEffect(() => {
    if (!autoSyncEnabled || !activeCollection) return;

    const timer = setInterval(() => {
      loadData(false);
    }, 10000);

    return () => clearInterval(timer);
  }, [autoSyncEnabled, activeCollection, searchQuery, searchField]);

  // Match a container item with watchlist strictly (by container_no, site_id, and event_type)
  const getWatchlistItem = (item: ContainerInfo): ContainerWatchlist | undefined => {
    if (!item) return undefined;
    const itemNo = (item.containerno || '').trim().toUpperCase();
    if (!itemNo) return undefined;

    const itemSite = (item.site_id || '').trim().toUpperCase();
    const itemEvent = (item.event_type || '').trim().toUpperCase();

    return watchlist.find((w) => {
      const wNo = (w.container_no || '').trim().toUpperCase();
      if (!wNo || wNo !== itemNo) return false;

      const wSite = (w.site_id || '').trim().toUpperCase();
      if (wSite && itemSite && wSite !== itemSite) return false;

      const wEvent = (w.event_type || '').trim().toUpperCase();
      if (wEvent && itemEvent && wEvent !== itemEvent) return false;

      return true;
    });
  };

  // Toggle add/remove container from watchlist
  const handleToggleWatchlist = async (item: ContainerInfo) => {
    if (!activeCollection) return;
    const cleanItemNo = (item.containerno || '').trim().toUpperCase();
    if (!cleanItemNo) {
      addToast('Không tìm thấy số Container hợp lệ', 'error');
      return;
    }
    const cleanSite = (item.site_id || siteId || localStorage.getItem('last_container_site_id') || 'CTL').trim().toUpperCase();
    const cleanEvent = (item.event_type || '').trim().toUpperCase();

    const matched = getWatchlistItem(item);
    try {
      if (matched) {
        await deleteContainerWatchlist(matched.id);
        setWatchlist((prev) => prev.filter((w) => w.id !== matched.id));
        addToast(`Đã xóa container ${cleanItemNo}${cleanEvent ? ` (${cleanEvent})` : ''} khỏi Watchlist!`, 'success');
      } else {
        await addContainerWatchlist(
          activeCollection.id,
          cleanSite,
          cleanItemNo,
          cleanEvent
        );
        addToast(`Đã thêm container ${cleanItemNo}${cleanEvent ? ` (${cleanEvent})` : ''} vào Watchlist!`, 'success');
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

      const res = await searchContainersApi(
        activeCollection.id,
        siteId,
        cleaned,
        isSearchByInYard,
        isSearchByBatch
      );
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
        <form onSubmit={handleQueryEport} className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
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
          </div>

          {/* Options: IsSearchByInYard & IsSearchByBatch */}
          <div className="flex flex-wrap items-center gap-4 pt-1.5 border-t border-slate-100 dark:border-slate-800 text-xs">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300 font-medium">
              <input
                type="checkbox"
                checked={isSearchByInYard}
                onChange={(e) => {
                  setIsSearchByInYard(e.target.checked);
                  localStorage.setItem('last_container_is_in_yard', String(e.target.checked));
                }}
                className="rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5 cursor-pointer"
              />
              <span title={t.container.searchByInYardTooltip}>{t.container.searchByInYard}</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300 font-medium">
              <input
                type="checkbox"
                checked={isSearchByBatch}
                onChange={(e) => {
                  setIsSearchByBatch(e.target.checked);
                  localStorage.setItem('last_container_is_batch', String(e.target.checked));
                }}
                className="rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5 cursor-pointer"
              />
              <span title={t.container.searchByBatchTooltip}>{t.container.searchByBatch}</span>
            </label>
          </div>
        </form>
      </div>

      {/* Controls: Filter & Table actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value)}
            className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-500 shrink-0"
          >
            <option value="all">{t.common.all}</option>
            <option value="containerno">{getColLabel("containerno", t.container.columns["containerno"])}</option>
            <option value="event_type">{getColLabel("event_type", t.container.columns["event_type"])}</option>
            <option value="location">{getColLabel("location", t.container.columns["location"])}</option>
            <option value="truck_vessel">{getColLabel("truck_vessel", t.container.columns["truck_vessel"])}</option>
            <option value="line_oper">{getColLabel("line_oper", t.container.columns["line_oper"])}</option>
            <option value="bill_book">{getColLabel("bill_book", t.container.columns["bill_book"])}</option>
            <option value="item_seal_no">{getColLabel("item_seal_no", t.container.columns["item_seal_no"])}</option>
            <option value="custom_clearance_status">{getColLabel("custom_clearance_status", t.container.columns["custom_clearance_status"])}</option>
            <option value="infras_fee_status">{getColLabel("infras_fee_status", t.container.columns["infras_fee_status"])}</option>
            <option value="pod_destination">{getColLabel("pod_destination", t.container.columns["pod_destination"])}</option>
            <option value="note">{getColLabel("note", t.container.columns["note"])}</option>
          </select>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.common.search}
              className="w-full pl-8 pr-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Event Type Filter Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 shrink-0">
            <Filter className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400 shrink-0" />
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              {t.container.filterByEvent || 'Tác nghiệp'}:
            </span>
            <select
              value={eventTypeFilter}
              onChange={(e) => {
                setEventTypeFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="text-xs font-bold bg-transparent text-slate-800 dark:text-slate-100 border-none outline-none cursor-pointer pr-1"
            >
              <option value="ALL" className="bg-white dark:bg-slate-800">
                {t.container.allEvents || 'Tất cả'} ({containers.length})
              </option>
              {availableEventTypes.map((type) => (
                <option key={type} value={type} className="bg-white dark:bg-slate-800">
                  {type} ({eventCounts[type] || 0})
                </option>
              ))}
            </select>
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

      {/* Quick Event Filter Pills */}
      {containers.length > 0 && availableEventTypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs shrink-0 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3 text-primary-500" />
            <span>Lọc nhanh sự kiện:</span>
          </span>
          <button
            type="button"
            onClick={() => { setEventTypeFilter('ALL'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              eventTypeFilter === 'ALL'
                ? 'bg-primary-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <span>Tất cả</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              eventTypeFilter === 'ALL'
                ? 'bg-white/20 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 font-semibold'
            }`}>
              {containers.length}
            </span>
          </button>
          {availableEventTypes.map((type) => {
            const count = eventCounts[type] || 0;
            const isActive = eventTypeFilter === type;
            let pillColor = 'hover:bg-slate-100 dark:hover:bg-slate-700';
            if (type.includes('UNLOAD')) pillColor = isActive ? 'bg-sky-600 text-white' : 'hover:bg-sky-50 dark:hover:bg-sky-950/40 text-sky-700 dark:text-sky-300';
            else if (type.includes('INGATE')) pillColor = isActive ? 'bg-emerald-600 text-white' : 'hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300';
            else if (type.includes('OUTGATE')) pillColor = isActive ? 'bg-amber-600 text-white' : 'hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-300';
            else if (type.includes('STACK')) pillColor = isActive ? 'bg-purple-600 text-white' : 'hover:bg-purple-50 dark:hover:bg-purple-950/40 text-purple-700 dark:text-purple-300';
            else if (type.includes('LOAD')) pillColor = isActive ? 'bg-teal-600 text-white' : 'hover:bg-teal-50 dark:hover:bg-teal-950/40 text-teal-700 dark:text-teal-300';

            return (
              <button
                key={type}
                type="button"
                onClick={() => { setEventTypeFilter(type); setCurrentPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                  isActive
                    ? `${pillColor} shadow-xs border-transparent`
                    : `bg-white dark:bg-slate-800 ${pillColor} border-slate-200 dark:border-slate-700`
                }`}
              >
                <span>{type}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 font-semibold'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
                                className="py-1.5 px-2.5 truncate font-mono font-bold"
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
                                    table="container"
                                    columnKey={col.key}
                                    value={val}
                                    className="font-mono font-bold text-slate-900 dark:text-slate-100"
                                    fallbackText="-"
                                  />
                                </div>
                              </td>
                            );
                          }

                          let displayVal = val;
                          if (col.key === 'custom_clearance_status') {
                            if (String(val).toUpperCase() === 'Y') displayVal = 'Đã duyệt (Y)';
                            else if (String(val).toUpperCase() === 'N') displayVal = 'Chưa duyệt (N)';
                          } else if (col.key === 'infras_fee_status') {
                            if (String(val) === '3') displayVal = 'Chưa đóng (3)';
                          }

                          return (
                            <td
                              key={col.key}
                              style={{
                                width: w ? `${w}px` : undefined,
                                maxWidth: w ? `${w}px` : undefined,
                              }}
                              className="py-1.5 px-2.5 truncate"
                              title={`${col.label}: ${String(displayVal ?? '')}`}
                            >
                              <ValueBadge
                                table="container"
                                columnKey={col.key}
                                value={displayVal}
                                fallbackText="-"
                              />
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
          totalItems={filteredContainers.length}
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
        data={filteredContainers}
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
