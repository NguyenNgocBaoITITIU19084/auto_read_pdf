import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Ship, Search, RefreshCw, Trash2, FileSpreadsheet,
  SlidersHorizontal, BookmarkPlus, BookmarkMinus, ClipboardCopy, FolderInput, RotateCw
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { useRowSelection } from '../../hooks/useRowSelection';
import { VesselSchedule, VesselWatchlist, VesselWatchlistBatchItem, PageResult, TableQuery } from '../../types';
import {
  getVessels, getVesselsPage, getVesselIds, getVesselsByIds, searchVesselsApi, deleteVessel, deleteVesselsBatch, clearVessels,
  addVesselWatchlist, getVesselWatchlist, deleteVesselWatchlist,
  addVesselWatchlistBatch, removeVesselWatchlistBatch, resyncVesselsApi,
} from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { ExportModal } from '../common/ExportModal';
import { ColumnConfigModal, ColumnDef } from '../common/ColumnConfigModal';
import { BulkActionBar, BulkAction } from '../common/BulkActionBar';
import { MoveToCollectionModal } from '../common/MoveToCollectionModal';
import { VesselDetailModal } from './VesselDetailModal';
import { VesselWatchlistModal } from './VesselWatchlistModal';
import { VesselRow } from './VesselRow';
import { ResizableTh } from '../common/ResizableTh';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { Tooltip } from '../common/Tooltip';
import { formatRowForCopy, copyTextToClipboard } from '../../utils/formatters';
import { Pagination } from '../common/Pagination';
import { TableSkeleton } from '../common/TableSkeleton';
import { subscribeTourActions } from '../../services/tourService';
import { useServerTable, LoadMode } from '../../hooks/useServerTable';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  useStableCallback, useAutoRefresh, rowsSignature, watchlistSignature, rowsToTSV, errorMessage,
} from './tableHelpers';

interface VesselTabProps {
  initialSearchQuery?: string;
}

const getRowId = (r: VesselSchedule) => r.id;
const normalizeStr = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normSite = (s?: string | null) => (s || '').trim().toUpperCase();

const previewList = (items: string[], max = 5) =>
  items.length > max ? `${items.slice(0, max).join(', ')}, … (+${items.length - max})` : items.join(', ');

export const VesselTab: React.FC<VesselTabProps> = ({ initialSearchQuery }) => {
  const { t, activeCollection, autoSyncEnabled, autoSyncStatus } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const [querying, setQuerying] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

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
  const [exportScope, setExportScope] = useState<'all' | 'selected'>('all');
  const [isMoveOpen, setIsMoveOpen] = useState(false);
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

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);

  const getColLabel = (key: string, fallback: string) => {
    const col = columns.find((c) => c.key === key);
    return col?.label || fallback;
  };

  // ---------------------------------------------------------------------------
  // Data loading (server-paged table + separate watchlist load)
  // ---------------------------------------------------------------------------
  const debouncedQuery = useDebouncedValue(searchQuery, 300);
  const tableQuery = useMemo<TableQuery>(
    () => ({ search_query: debouncedQuery, search_field: searchField }),
    [debouncedQuery, searchField]
  );

  const table = useServerTable<VesselSchedule, PageResult<VesselSchedule>>({
    enabled: !!activeCollection,
    queryKey: JSON.stringify([activeCollection?.id, tableQuery]),
    pageSizeStorageKey: 'vessel_page_size',
    fetchPage: (limit, offset) => getVesselsPage(activeCollection!.id, limit, offset, tableQuery),
    onError: (e) => addToast(errorMessage(e, t.common.error), 'error'),
  });
  const { rows: pageRows, total, loading, currentPage, setCurrentPage, pageSize, setPageSize } = table;

  const watchSigRef = useRef('');
  const loadWatchlist = useStableCallback(async () => {
    if (!activeCollection) return;
    try {
      const data = await getVesselWatchlist(activeCollection.id);
      const wsig = watchlistSignature(data);
      if (wsig !== watchSigRef.current) {
        watchSigRef.current = wsig;
        setWatchlist(data);
      }
    } catch (e) {
      console.error(e);
    }
  });

  /** 'loading' | 'refresh' | 'silent' — reloads the current page and the watchlist together. */
  const loadData = useStableCallback(async (mode: LoadMode = 'refresh') => {
    await Promise.all([table.reload(mode), loadWatchlist()]);
  });

  useEffect(() => {
    loadWatchlist();
  }, [activeCollection?.id, loadWatchlist]);

  const silentRefresh = useCallback(() => {
    loadData('silent');
  }, [loadData]);

  // Refetch when the scheduler finishes a run; 60s safety poll while auto-sync is on; paused when hidden.
  useAutoRefresh({
    enabled: autoSyncEnabled && !!activeCollection,
    lastRunAt: autoSyncStatus?.last_run_at,
    running: autoSyncStatus?.running,
    refresh: silentRefresh,
  });

  const selection = useRowSelection(pageRows, getRowId, [activeCollection?.id, debouncedQuery, searchField], { pruneMissing: false });
  const selectedIdList = useMemo(() => Array.from(selection.selectedIds), [selection.selectedIds]);

  /** Selected rows even when they live on other pages. */
  const resolveSelectedRows = useCallback(async (): Promise<VesselSchedule[]> => {
    if (selection.selectedRows.length === selection.count) return selection.selectedRows;
    return getVesselsByIds(selectedIdList);
  }, [selection.selectedRows, selection.count, selectedIdList]);

  const handleSelectAllResults = useCallback(async () => {
    if (!activeCollection) return;
    try {
      const ids = await getVesselIds(activeCollection.id, tableQuery);
      selection.selectIds(ids, true);
    } catch (e) {
      addToast(errorMessage(e, t.common.error), 'error');
    }
  }, [activeCollection, tableQuery, selection, addToast, t]);

  // Watchlist index: normalized vessel name -> entries (site/voyage checked on the few candidates)
  const watchlistIndex = useMemo(() => {
    const map = new Map<string, VesselWatchlist[]>();
    watchlist.forEach((w) => {
      const name = normalizeStr(w.vessel_name);
      const list = map.get(name);
      if (list) list.push(w);
      else map.set(name, [w]);
    });
    return map;
  }, [watchlist]);

  // Match a schedule item with watchlist
  const findWatchlistItem = useCallback((item: VesselSchedule): VesselWatchlist | undefined => {
    const candidates = watchlistIndex.get(normalizeStr(item.vessel_name));
    if (!candidates) return undefined;
    const itemVoyage = normalizeStr(item.in_out_voyage);
    const itemSite = normSite(item.site_id);
    return candidates.find((w) => {
      const wSite = normSite(w.site_id);
      if (wSite && itemSite && wSite !== itemSite) return false;
      const wVoyage = normalizeStr(w.voyage);
      if (wVoyage && itemVoyage) return wVoyage === itemVoyage;
      return true;
    });
  }, [watchlistIndex]);

  // Toggle add/remove from watchlist
  const handleToggleWatchlist = useStableCallback(async (item: VesselSchedule) => {
    if (!activeCollection) return;
    const matched = findWatchlistItem(item);
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
      addToast(errorMessage(e, t.common.error), 'error');
    }
  });

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
        await loadData('refresh');
      } else {
        addToast(res.message || 'Không tìm thấy thông tin chuyến tàu khớp trên ePort', 'info');
      }
    } catch (e: any) {
      addToast(errorMessage(e, t.common.error), 'error');
    } finally {
      setQuerying(false);
    }
  };

  const handleCopyRow = useStableCallback(async (item: VesselSchedule) => {
    const text = formatRowForCopy(item, columns);
    const success = await copyTextToClipboard(text);
    addToast(success ? t.common.copySuccess : t.common.error, success ? 'success' : 'error');
  });

  const handleDelete = useStableCallback(async (id: number) => {
    const ok = await confirm({ title: t.vessel.deleteOneTitle, message: t.common.deleteConfirm, danger: true });
    if (!ok) return;
    try {
      await deleteVessel(id);
      addToast(t.common.success, 'success');
      selection.selectIds([id], false);
      await loadData('refresh');
    } catch (e: any) {
      addToast(errorMessage(e, t.common.error), 'error');
    }
  });

  const handleClearAll = async () => {
    if (!activeCollection) return;
    const ok = await confirm({ title: t.vessel.clearAllTitle, message: t.common.clearConfirm, danger: true });
    if (!ok) return;
    try {
      await clearVessels(activeCollection.id);
      addToast(t.common.success, 'success');
      selection.clear();
      await loadData('refresh');
    } catch (e: any) {
      addToast(errorMessage(e, t.common.error), 'error');
    }
  };

  // ---------------------------------------------------------------------------
  // Bulk actions
  // ---------------------------------------------------------------------------
  const selectedWatchlistIds = useMemo(() => {
    const ids = new Set<number>();
    selection.selectedRows.forEach((r) => {
      const w = findWatchlistItem(r);
      if (w) ids.add(w.id);
    });
    return Array.from(ids);
  }, [selection.selectedRows, findWatchlistItem]);

  const runBulk = async (key: string, fn: () => Promise<void>) => {
    if (bulkBusy) return;
    setBulkBusy(key);
    try {
      await fn();
    } catch (e: any) {
      addToast(errorMessage(e, t.common.error), 'error');
    } finally {
      setBulkBusy(null);
    }
  };

  const handleBatchDelete = async () => {
    const ids = selectedIdList;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: t.vessel.deleteSelectedTitle,
      message: tf(t.bulk.deleteSelectedConfirm, { count: ids.length }),
      danger: true,
    });
    if (!ok) return;
    await runBulk('delete', async () => {
      await deleteVesselsBatch(ids);
      addToast(tf(t.vessel.deleteSelectedSuccess, { count: ids.length }), 'success');
      selection.selectIds(ids, false);
      await loadData('refresh');
    });
  };

  const handleBatchAddWatchlist = () =>
    runBulk('watch-add', async () => {
      if (!activeCollection) return;
      const rows = await resolveSelectedRows();
      const seen = new Set<string>();
      const items: VesselWatchlistBatchItem[] = [];
      rows.forEach((r) => {
        const name = (r.vessel_name || '').trim();
        if (!name || findWatchlistItem(r)) return;
        const item = {
          site_id: normSite(r.site_id || siteId || 'CTL'),
          vessel_name: name,
          voyage: (r.in_out_voyage || '').trim(),
        };
        const key = `${item.site_id}|${normalizeStr(item.vessel_name)}|${normalizeStr(item.voyage)}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push(item);
      });
      if (items.length === 0) {
        addToast(t.vessel.watchlistBatchAllTracked, 'info');
        return;
      }
      const res = await addVesselWatchlistBatch(activeCollection.id, items);
      addToast(tf(t.vessel.watchlistBatchAdded, { count: res?.added ?? items.length }), 'success');
      await loadWatchlist();
    });

  const handleBatchRemoveWatchlist = () =>
    runBulk('watch-remove', async () => {
      const ids = selectedWatchlistIds;
      if (ids.length === 0) {
        addToast(t.vessel.watchlistBatchNoneTracked, 'info');
        return;
      }
      const res = await removeVesselWatchlistBatch(ids);
      const idSet = new Set(ids);
      setWatchlist((prev) => prev.filter((w) => !idSet.has(w.id)));
      addToast(tf(t.vessel.watchlistBatchRemoved, { count: res?.removed ?? ids.length }), 'success');
    });

  const handleBatchResync = () =>
    runBulk('resync', async () => {
      const ids = selectedIdList;
      if (ids.length === 0) return;
      const res = await resyncVesselsApi(ids);
      const notFound = Array.isArray(res?.not_found) ? res.not_found : [];
      const errors = Array.isArray(res?.errors) ? res.errors : [];
      addToast(
        tf(t.vessel.resyncSummary, { updated: res?.updated ?? 0, notFound: notFound.length, errors: errors.length }),
        errors.length > 0 ? 'error' : notFound.length > 0 ? 'info' : 'success'
      );
      if (notFound.length > 0) addToast(tf(t.vessel.resyncNotFoundDetail, { items: previewList(notFound) }), 'info');
      if (errors.length > 0) addToast(tf(t.vessel.resyncErrorDetail, { items: previewList(errors, 3) }), 'error');
      await loadData('refresh');
    });

  const handleCopySelected = async () => {
    const rows = await resolveSelectedRows();
    if (rows.length === 0) return;
    const cols = visibleColumns.map((c) => ({ key: c.key, label: c.label }));
    const text = rowsToTSV(rows, cols);
    const success = await copyTextToClipboard(text);
    addToast(
      success ? tf(t.vessel.copyRowsSuccess, { count: rows.length }) : t.common.error,
      success ? 'success' : 'error'
    );
  };

  const [exportRows, setExportRows] = useState<VesselSchedule[]>([]);

  const handleOpenExport = async (scope: 'all' | 'selected') => {
    if (!activeCollection) return;
    setExportScope(scope);
    try {
      const rows = scope === 'all'
        ? await getVessels(activeCollection.id, debouncedQuery, searchField)
        : await resolveSelectedRows();
      setExportRows(rows);
      setIsExportOpen(true);
    } catch (e) {
      addToast(errorMessage(e, t.common.error), 'error');
    }
  };

  const bulkActions: BulkAction[] = [
    { key: 'export', label: t.bulk.exportSelected, icon: FileSpreadsheet, onClick: () => handleOpenExport('selected') },
    { key: 'copy', label: t.bulk.copySelected, icon: ClipboardCopy, onClick: handleCopySelected },
    { key: 'watch-add', label: t.bulk.addToWatchlist, icon: BookmarkPlus, onClick: handleBatchAddWatchlist, loading: bulkBusy === 'watch-add', disabled: !!bulkBusy },
    {
      key: 'watch-remove',
      label: t.bulk.removeFromWatchlist,
      icon: BookmarkMinus,
      onClick: handleBatchRemoveWatchlist,
      loading: bulkBusy === 'watch-remove',
      disabled: !!bulkBusy || selectedWatchlistIds.length === 0,
    },
    { key: 'resync', label: t.bulk.resync, icon: RotateCw, onClick: handleBatchResync, loading: bulkBusy === 'resync', disabled: !!bulkBusy },
    { key: 'move', label: t.vessel.moveToCollection, icon: FolderInput, onClick: () => setIsMoveOpen(true), disabled: !!bulkBusy },
    { key: 'delete', label: t.bulk.deleteSelected, icon: Trash2, onClick: handleBatchDelete, danger: true, loading: bulkBusy === 'delete', disabled: !!bulkBusy },
  ];

  const exportData = exportRows;

  const exportColumns = useMemo(() => [
    { key: "STT", label: t.vessel.columns["STT"] },
    ...columns.map((c) => ({ key: c.key, label: c.label })),
  ], [columns, t]);

  // Header checkbox (page) with indeterminate state
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const pageAllSelected = selection.isPageAllSelected(pageRows);
  const pagePartiallySelected = selection.isPagePartiallySelected(pageRows);
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = pagePartiallySelected;
  }, [pagePartiallySelected]);

  const rowOffset = (currentPage - 1) * pageSize;

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
              onClick={() => handleOpenExport('all')}
              disabled={total === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm transition-all"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{t.common.exportExcel}</span>
            </button>
          </Tooltip>

          <Tooltip content="Tải lại dữ liệu lịch tàu">
            <button
              onClick={() => loadData('loading')}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>

          {total > 0 && (
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
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={pageAllSelected}
                    onChange={() => selection.selectPage(pageRows, !pageAllSelected)}
                    className="rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    title={t.bulk.selectPage}
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
              ) : total === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 3}
                    className="py-12 text-center text-slate-400 dark:text-slate-500"
                  >
                    <Ship className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
                    <p className="text-xs font-medium">{t.common.noData}</p>
                  </td>
                </tr>
              ) : (
                pageRows.map((item, idx) => (
                  <VesselRow
                    key={item.id ?? idx}
                    item={item}
                    rowNumber={rowOffset + idx + 1}
                    visibleColumns={visibleColumns}
                    columnWidths={columnWidths}
                    isSelected={selection.selectedIds.has(item.id)}
                    isBookmarked={!!findWatchlistItem(item)}
                    t={t}
                    onToggleSelect={selection.toggle}
                    onOpen={setSelectedSchedule}
                    onCopy={handleCopyRow}
                    onToggleWatchlist={handleToggleWatchlist}
                    onDelete={handleDelete}
                  />
                ))
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
          total > selection.count ? (
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
      <VesselDetailModal
        isOpen={!!selectedSchedule}
        onClose={() => setSelectedSchedule(null)}
        schedule={selectedSchedule}
      />

      <VesselWatchlistModal
        isOpen={isWatchlistOpen}
        onClose={() => setIsWatchlistOpen(false)}
        onDataUpdated={() => loadData('refresh')}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        data={exportData}
        allColumns={exportColumns}
        filenamePrefix={exportScope === 'selected' ? 'vessel_schedules_selected' : 'vessel_schedules'}
      />

      <MoveToCollectionModal
        isOpen={isMoveOpen}
        onClose={() => setIsMoveOpen(false)}
        entity="vessels"
        ids={selectedIdList}
        onDone={(result) => {
          selection.clear();
          if (!result.copy) loadData('refresh');
        }}
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
