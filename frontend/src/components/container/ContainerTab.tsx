import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Box, Search, RefreshCw, Trash2, FileSpreadsheet,
  SlidersHorizontal, BookmarkPlus, BookmarkMinus, Filter, ClipboardCopy, FolderInput, RotateCw
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { useRowSelection } from '../../hooks/useRowSelection';
import { ContainerInfo, ContainerWatchlist, ContainerWatchlistBatchItem, PageResult, ContainerPageResult, TableQuery } from '../../types';
import {
  getContainers, getContainersPage, getContainerIds, getContainersByIds, searchContainersApi, deleteContainer, deleteContainersBatch, clearContainers,
  addContainerWatchlist, getContainerWatchlist, deleteContainerWatchlist,
  addContainerWatchlistBatch, removeContainerWatchlistBatch, resyncContainersApi,
} from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { ExportModal } from '../common/ExportModal';
import { ColumnConfigModal, ColumnDef } from '../common/ColumnConfigModal';
import { BulkActionBar, BulkAction } from '../common/BulkActionBar';
import { MoveToCollectionModal } from '../common/MoveToCollectionModal';
import { ContainerDetailModal } from './ContainerDetailModal';
import { ContainerWatchlistModal } from './ContainerWatchlistModal';
import { ContainerRow } from './ContainerRow';
import { ResizableTh } from '../common/ResizableTh';
import { ColumnMigration, useColumnSettings } from '../../hooks/useColumnSettings';
import { Tooltip } from '../common/Tooltip';
import { formatRowForCopy, copyTextToClipboard } from '../../utils/formatters';
import { Pagination } from '../common/Pagination';
import { TableSkeleton } from '../common/TableSkeleton';
import { subscribeTourActions } from '../../services/tourEvents';
import { useServerTable, LoadMode } from '../../hooks/useServerTable';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useVirtualRows } from '../../hooks/useVirtualRows';
import {
  useStableCallback, useAutoRefresh, watchlistSignature, rowsToTSV, errorMessage,
} from '../vessel/tableHelpers';
import { getCustomsStatus, getImdgInfo, sanitizeDisplayValue } from './customs';

interface ContainerTabProps {
  initialSearchQuery?: string;
}

/** v2: merge "Trạng thái thông quan" + "Giám sát HQ" into "Tình trạng thông quan". */
const COLUMN_MIGRATION: ColumnMigration = {
  version: 2,
  replace: { custom_clearance_status: 'customs_status' },
  hide: ['cust'],
};

const getRowId = (r: ContainerInfo) => r.id;
const norm = (s?: string | null) => (s || '').trim().toUpperCase();

const previewList = (items: string[], max = 5) =>
  items.length > max ? `${items.slice(0, max).join(', ')}, … (+${items.length - max})` : items.join(', ');

/** Value used for export / TSV copy (merged customs, IMDG link, no raw HTML). */
const getContainerExportValue = (row: ContainerInfo, key: string): unknown => {
  if (key === 'customs_status') return getCustomsStatus(row);
  if (key === 'haz') {
    const { text, url } = getImdgInfo(row);
    return text || url;
  }
  const v = row[key];
  return v === undefined || v === null ? v : sanitizeDisplayValue(v);
};

const toExportRow = (row: ContainerInfo): ContainerInfo => ({
  ...row,
  customs_status: getCustomsStatus(row),
  haz: String(getContainerExportValue(row, 'haz') || ''),
});

export const ContainerTab: React.FC<ContainerTabProps> = ({ initialSearchQuery }) => {
  const { t, activeCollection, autoSyncEnabled, autoSyncStatus } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const [querying, setQuerying] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  // Filter by event type
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('ALL');

  // Search in database
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
  const [exportScope, setExportScope] = useState<'all' | 'selected'>('all');
  const [exportRows, setExportRows] = useState<ContainerInfo[]>([]);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);

  // Listen to interactive tour triggers (open/close Container Watchlist modal)
  useEffect(() => {
    const unsubscribe = subscribeTourActions((action) => {
      if (action === 'openContainerWatchlist') {
        setIsWatchlistOpen(true);
      } else if (action === 'closeContainerWatchlist') {
        setIsWatchlistOpen(false);
      }
    });
    return unsubscribe;
  }, []);

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
    { key: "customs_status", label: t.container.columns["customs_status"], visible: true },
    { key: "custom_clearance_status", label: t.container.columns["custom_clearance_status"], visible: false },
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
    "haz": 110,
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
    "customs_status": 165,
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
    migration: COLUMN_MIGRATION,
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
    () => ({
      search_query: debouncedQuery,
      search_field: searchField,
      event_type: eventTypeFilter === 'ALL' ? undefined : eventTypeFilter,
    }),
    [debouncedQuery, searchField, eventTypeFilter]
  );

  const table = useServerTable<ContainerInfo, ContainerPageResult>({
    enabled: !!activeCollection,
    queryKey: JSON.stringify([activeCollection?.id, tableQuery]),
    pageSizeStorageKey: 'container_page_size',
    fetchPage: (limit, offset) => getContainersPage(activeCollection!.id, limit, offset, tableQuery),
    onError: (e) => addToast(errorMessage(e, t.common.error), 'error'),
  });
  const { rows: pageRows, total, loading, currentPage, setCurrentPage, pageSize, setPageSize } = table;

  const watchSigRef = useRef('');
  const loadWatchlist = useStableCallback(async () => {
    if (!activeCollection) return;
    try {
      const data = await getContainerWatchlist(activeCollection.id);
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

  // Event counts from server result or fallback
  const eventCounts = useMemo(() => {
    return table.result?.event_type_counts || { ALL: total };
  }, [table.result?.event_type_counts, total]);

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

  const selection = useRowSelection(
    pageRows,
    getRowId,
    [activeCollection?.id, debouncedQuery, searchField, eventTypeFilter],
    { pruneMissing: false }
  );
  const selectedIdList = useMemo(() => Array.from(selection.selectedIds), [selection.selectedIds]);

  /** Selected rows even when they live on other pages. */
  const resolveSelectedRows = useCallback(async (): Promise<ContainerInfo[]> => {
    if (selection.selectedRows.length === selection.count) return selection.selectedRows;
    return getContainersByIds(selectedIdList);
  }, [selection.selectedRows, selection.count, selectedIdList]);

  const handleSelectAllResults = useCallback(async () => {
    if (!activeCollection) return;
    try {
      const ids = await getContainerIds(activeCollection.id, tableQuery);
      selection.selectIds(ids, true);
    } catch (e) {
      addToast(errorMessage(e, t.common.error), 'error');
    }
  }, [activeCollection, tableQuery, selection, addToast, t]);

  // Watchlist index: container_no -> entries (site/event checked on the few candidates)
  const watchlistIndex = useMemo(() => {
    const map = new Map<string, ContainerWatchlist[]>();
    watchlist.forEach((w) => {
      const no = norm(w.container_no);
      if (!no) return;
      const list = map.get(no);
      if (list) list.push(w);
      else map.set(no, [w]);
    });
    return map;
  }, [watchlist]);

  // Match a container item with watchlist strictly (by container_no, site_id, and event_type)
  const findWatchlistItem = useCallback((item: ContainerInfo): ContainerWatchlist | undefined => {
    const itemNo = norm(item?.containerno);
    if (!itemNo) return undefined;
    const candidates = watchlistIndex.get(itemNo);
    if (!candidates) return undefined;
    const itemSite = norm(item.site_id);
    const itemEvent = norm(item.event_type);
    return candidates.find((w) => {
      const wSite = norm(w.site_id);
      if (wSite && itemSite && wSite !== itemSite) return false;
      const wEvent = norm(w.event_type);
      if (wEvent && itemEvent && wEvent !== itemEvent) return false;
      return true;
    });
  }, [watchlistIndex]);

  // Toggle add/remove container from watchlist
  const handleToggleWatchlist = useStableCallback(async (item: ContainerInfo) => {
    if (!activeCollection) return;
    const cleanItemNo = norm(item.containerno);
    if (!cleanItemNo) {
      addToast('Không tìm thấy số Container hợp lệ', 'error');
      return;
    }
    const cleanSite = norm(item.site_id || siteId || localStorage.getItem('last_container_site_id') || 'CTL');
    const cleanEvent = norm(item.event_type);

    const matched = findWatchlistItem(item);
    try {
      if (matched) {
        await deleteContainerWatchlist(matched.id);
        setWatchlist((prev) => prev.filter((w) => w.id !== matched.id));
        addToast(`Đã xóa container ${cleanItemNo}${cleanEvent ? ` (${cleanEvent})` : ''} khỏi Watchlist!`, 'success');
      } else {
        await addContainerWatchlist(activeCollection.id, cleanSite, cleanItemNo, cleanEvent);
        addToast(`Đã thêm container ${cleanItemNo}${cleanEvent ? ` (${cleanEvent})` : ''} vào Watchlist!`, 'success');
        await loadWatchlist();
      }
    } catch (e: any) {
      addToast(errorMessage(e, t.common.error), 'error');
    }
  });

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
      await loadData('refresh');
    } catch (e: any) {
      addToast(errorMessage(e, t.common.error), 'error');
    } finally {
      setQuerying(false);
    }
  };

  const handleCopyRow = useStableCallback(async (item: ContainerInfo) => {
    const text = formatRowForCopy(
      { ...item, customs_status: getCustomsStatus(item), haz: getContainerExportValue(item, 'haz') },
      columns
    );
    const success = await copyTextToClipboard(text);
    addToast(success ? t.common.copySuccess : t.common.error, success ? 'success' : 'error');
  });

  const handleDelete = useStableCallback(async (id: number) => {
    const ok = await confirm({ title: t.container.deleteOneTitle, message: t.common.deleteConfirm, danger: true });
    if (!ok) return;
    try {
      await deleteContainer(id);
      addToast(t.common.success, 'success');
      selection.selectIds([id], false);
      await loadData('refresh');
    } catch (e: any) {
      addToast(errorMessage(e, t.common.error), 'error');
    }
  });

  const handleClearAll = async () => {
    if (!activeCollection) return;
    const ok = await confirm({ title: t.container.clearAllTitle, message: t.common.clearConfirm, danger: true });
    if (!ok) return;
    try {
      await clearContainers(activeCollection.id);
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
      title: t.container.deleteSelectedTitle,
      message: tf(t.bulk.deleteSelectedConfirm, { count: ids.length }),
      danger: true,
    });
    if (!ok) return;
    await runBulk('delete', async () => {
      await deleteContainersBatch(ids);
      addToast(tf(t.container.deleteSelectedSuccess, { count: ids.length }), 'success');
      selection.selectIds(ids, false);
      await loadData('refresh');
    });
  };

  const handleBatchAddWatchlist = () =>
    runBulk('watch-add', async () => {
      if (!activeCollection) return;
      const rows = await resolveSelectedRows();
      const seen = new Set<string>();
      const items: ContainerWatchlistBatchItem[] = [];
      rows.forEach((r) => {
        const containerNo = norm(r.containerno);
        if (!containerNo || findWatchlistItem(r)) return;
        const item = {
          site_id: norm(r.site_id || siteId || 'CTL'),
          container_no: containerNo,
          event_type: norm(r.event_type),
        };
        const key = `${item.site_id}|${item.container_no}|${item.event_type}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push(item);
      });
      if (items.length === 0) {
        addToast(t.container.watchlistBatchAllTracked, 'info');
        return;
      }
      const res = await addContainerWatchlistBatch(activeCollection.id, items);
      addToast(tf(t.container.watchlistBatchAdded, { count: res?.added ?? items.length }), 'success');
      await loadWatchlist();
    });

  const handleBatchRemoveWatchlist = () =>
    runBulk('watch-remove', async () => {
      const rows = await resolveSelectedRows();
      const ids = new Set<number>();
      rows.forEach((r) => {
        const w = findWatchlistItem(r);
        if (w) ids.add(w.id);
      });
      const idList = Array.from(ids);
      if (idList.length === 0) {
        addToast(t.container.watchlistBatchNoneTracked, 'info');
        return;
      }
      const res = await removeContainerWatchlistBatch(idList);
      const idSet = new Set(idList);
      setWatchlist((prev) => prev.filter((w) => !idSet.has(w.id)));
      addToast(tf(t.container.watchlistBatchRemoved, { count: res?.removed ?? idList.length }), 'success');
    });

  const handleBatchResync = (allEvents = false) =>
    runBulk(allEvents ? 'resync-all' : 'resync', async () => {
      const ids = selectedIdList;
      if (ids.length === 0) return;
      const res = await resyncContainersApi(ids, { allEvents });
      const notFound = Array.isArray(res?.not_found) ? res.not_found : [];
      const errors = Array.isArray(res?.errors) ? res.errors : [];
      addToast(
        tf(t.container.resyncSummary, { updated: res?.updated ?? 0, notFound: notFound.length, errors: errors.length }),
        errors.length > 0 ? 'error' : notFound.length > 0 ? 'info' : 'success'
      );
      if (notFound.length > 0) addToast(tf(t.container.resyncNotFoundDetail, { items: previewList(notFound) }), 'info');
      if (errors.length > 0) addToast(tf(t.container.resyncErrorDetail, { items: previewList(errors, 3) }), 'error');
      await loadData('refresh');
    });

  const handleCopySelected = async () => {
    const rows = await resolveSelectedRows();
    if (rows.length === 0) return;
    const cols = visibleColumns.map((c) => ({ key: c.key, label: c.label }));
    const text = rowsToTSV(rows, cols, getContainerExportValue);
    const success = await copyTextToClipboard(text);
    addToast(
      success ? tf(t.container.copyRowsSuccess, { count: rows.length }) : t.common.error,
      success ? 'success' : 'error'
    );
  };

  const handleOpenExport = async (scope: 'all' | 'selected') => {
    if (!activeCollection) return;
    setExportScope(scope);
    try {
      const rows = scope === 'all'
        ? await getContainers(activeCollection.id, debouncedQuery, searchField)
        : await resolveSelectedRows();
      const filtered = eventTypeFilter === 'ALL' || scope === 'selected'
        ? rows
        : rows.filter((c) => (c.event_type || '').trim().toUpperCase() === eventTypeFilter.toUpperCase());
      setExportRows(filtered.map(toExportRow));
      setIsExportOpen(true);
    } catch (e) {
      addToast(errorMessage(e, t.common.error), 'error');
    }
  };

  // Order matters: BulkActionBar shows the first 3 non-danger actions as labelled
  // buttons and collapses the rest into a "Thêm" menu (E Task 5). Kept in the
  // tab's pre-existing order (export, copy, watch-add first) rather than
  // re-guessing priority.
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
      disabled: !!bulkBusy,
    },
    { key: 'resync', label: t.bulk.resync, title: t.bulk.resyncSameEventTooltip, icon: RotateCw, onClick: () => handleBatchResync(false), loading: bulkBusy === 'resync', disabled: !!bulkBusy },
    { key: 'resync-all', label: t.bulk.resyncAllEvents, title: t.bulk.resyncAllEventsTooltip, icon: RotateCw, onClick: () => handleBatchResync(true), loading: bulkBusy === 'resync-all', disabled: !!bulkBusy },
    { key: 'move', label: t.container.moveToCollection, icon: FolderInput, onClick: () => setIsMoveOpen(true), disabled: !!bulkBusy },
    { key: 'delete', label: t.bulk.deleteSelected, icon: Trash2, onClick: handleBatchDelete, danger: true, loading: bulkBusy === 'delete', disabled: !!bulkBusy },
  ];

  const exportData = exportRows;

  const exportColumns = useMemo(() => [
    { key: "STT", label: t.container.columns["STT"] },
    ...columns.map((c) => ({ key: c.key, label: c.label })),
  ], [columns, t]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualRows(pageRows.length, scrollRef);
  const colSpan = visibleColumns.length + 3;

  // Back to the top when the page or filters change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [currentPage, pageSize, tableQuery]);

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
      <div data-tour="container-query-form" className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
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

            <div data-tour="container-watchlist-btn" className="ml-auto shrink-0">
              <button
                type="button"
                onClick={() => setIsWatchlistOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 hover:bg-primary-100 transition-colors shrink-0"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>{t.container.watchlistTitle}</span>
              </button>
            </div>
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
            <option value="customs_status">{getColLabel("customs_status", t.container.columns["customs_status"])}</option>
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
          <div data-tour="container-event-pills" className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 shrink-0">
            <Filter className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400 shrink-0" />
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              {t.container.filterByEvent || 'Tác nghiệp'}:
            </span>
            <select
              value={eventTypeFilter}
              onChange={(e) => {
                setEventTypeFilter(e.target.value);
              }}
              className="text-xs font-bold bg-transparent text-slate-800 dark:text-slate-100 border-none outline-none cursor-pointer pr-1"
            >
              <option value="ALL" className="bg-white dark:bg-slate-800">
                {t.container.allEvents || 'Tất cả'} ({eventCounts['ALL'] ?? total})
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
              onClick={() => handleOpenExport('all')}
              disabled={total === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm transition-all"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{t.common.exportExcel}</span>
            </button>
          </Tooltip>

          <Tooltip content="Tải lại dữ liệu Container">
            <button
              onClick={() => loadData('loading')}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>

          {total > 0 && (
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
      {availableEventTypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs shrink-0 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3 text-primary-500" />
            <span>Lọc nhanh sự kiện:</span>
          </span>
          <button
            type="button"
            onClick={() => { setEventTypeFilter('ALL'); }}
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
              {eventCounts['ALL'] ?? total}
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
                onClick={() => { setEventTypeFilter(type); }}
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
      <div data-tour="container-table" className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto w-full">
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
              ) : pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="py-12 text-center text-slate-400 dark:text-slate-500"
                  >
                    <Box className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
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
                    const item = pageRows[i];
                    return (
                      <ContainerRow
                        key={item.id ?? i}
                        item={item}
                        rowNumber={rowOffset + i + 1}
                        visibleColumns={visibleColumns}
                        columnWidths={columnWidths}
                        isSelected={selection.selectedIds.has(item.id)}
                        isBookmarked={!!findWatchlistItem(item)}
                        t={t}
                        onToggleSelect={selection.toggle}
                        onOpen={setSelectedContainer}
                        onCopy={handleCopyRow}
                        onToggleWatchlist={handleToggleWatchlist}
                        onDelete={handleDelete}
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
      <ContainerDetailModal
        isOpen={!!selectedContainer}
        onClose={() => setSelectedContainer(null)}
        container={selectedContainer}
      />

      <ContainerWatchlistModal
        isOpen={isWatchlistOpen}
        onClose={() => setIsWatchlistOpen(false)}
        onDataUpdated={() => loadData('refresh')}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        data={exportData}
        allColumns={exportColumns}
        filenamePrefix={exportScope === 'selected' ? 'containers_selected' : 'containers'}
      />

      <MoveToCollectionModal
        isOpen={isMoveOpen}
        onClose={() => setIsMoveOpen(false)}
        entity="containers"
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

