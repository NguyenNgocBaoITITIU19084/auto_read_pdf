import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArchiveRestore, Container, Lock, Copy, FileSpreadsheet, History, Info, Link2, Link2Off, ListChecks, Loader2, MoreHorizontal,
  Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Trash2, X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { tf } from '../../services/i18nFormat';
import {
  deleteFleetTrailerApi, getFleetHitchPageApi, getFleetTrailersApi, getFleetTrashCountApi, getFleetVehiclesApi, hitchFleetTrailerApi,
  updateFleetTrailerApi,
} from '../../services/api';
import { useRowSelection } from '../../hooks/useRowSelection';
import { BulkActionBar, type BulkAction } from '../common/BulkActionBar';
import { copyTextToClipboard, formatRowsAsTsv } from '../../utils/formatters';
import { SelectCell, SelectHeader, StatusPickerModal, rowTone, runEach } from './FleetBulk';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { ColumnConfigModal, type ColumnDef } from '../common/ColumnConfigModal';
import { TRASH_KEEP_DAYS } from '../common/TrashModal';
import { ExportModal } from '../common/ExportModal';
import { useTableSort } from '../../hooks/useTableSort';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ResizableTh } from '../common/ResizableTh';
import { ColumnValueFilter } from '../common/ColumnValueFilter';
import { Pagination } from '../common/Pagination';
import { RowContextMenu, useRowContextMenu, type MenuGroup } from '../common/RowContextMenu';
import {
  VEHICLE_STATUSES, type ExportTab, type FleetDocumentKind, type FleetHitch, type FleetHitchPage, type FleetTrailer, type FleetVehicle,
  type TrailerStatus,
} from '../../types';
import { FleetTrashModal } from './FleetTrashModal';
import { FleetAvatar, PhotoLightbox } from './FleetPhoto';
import { TrailerFormModal, TrailerHitchModal } from './TrailerModals';
import { PAGE_SIZE_OPTIONS, applyColumnFilters, sortRows, usePageRows, usePaging, valueCounts } from './fleetTable';
import {
  DOC_STATES, DateCell, DocsCell, MUTED, NoteIcon, ROW, StatusBadge, SttTd, SttTh, TD, TH, VEHICLE_TONE, sttOf, docState, docWarnings, fromControl,
  soonestDays, type DocState,
} from './fleetCells';
import {
  LOCK_FREE_STATUSES, apiError, expiredPapers, formatIsoDate, formatStampShort, isRunning, matches, todayVnIso,
} from './fleetUtils';

type View = 'trailers' | 'history';
type Filter = 'all' | 'hitched' | 'free' | 'down' | 'expiring';
type HistoryFilter = { trailer_id?: number; label: string } | null;

const VIEW_KEY = 'fleet.trailers.view';
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'history' ? 'history' : 'trailers';
  } catch {
    return 'trailers';
  }
};

const docsOf = (r: FleetTrailer): [FleetDocumentKind, string][] =>
  [['ownership', r.ownership_expiry], ['registration', r.registration_expiry], ['insurance', r.insurance_expiry]];
/** a trailer in these is off its tractor and cannot be hitched */
const canHitch = (r: FleetTrailer) => r.status !== 'inactive' && r.status !== 'not_ready';

interface Props {
  initialSearchQuery?: string;
}

/** Trailers (rơ moóc): their records and documents, which tractor pulls each one, and the hitch history.
 *  One obvious action per row ("Gắn đầu kéo" / "Đổi đầu kéo"), the rest in the "⋯" / right-click menu. */
export const TrailerTab: React.FC<Props> = ({ initialSearchQuery }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const f = t.fleet;
  const R = f.trailer;
  const T = f.table;
  const [view, setView] = useState<View>(readView);
  const [trailers, setTrailers] = useState<FleetTrailer[] | null>(null);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [history, setHistory] = useState<FleetHitchPage | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [cols, setCols] = useState<Record<string, string[]>>({});
  const [historyCols, setHistoryCols] = useState<Record<string, string[]>>({});
  const sort = useTableSort('fleet_trailers_sort');
  const historySort = useTableSort('fleet_hitches_sort');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState(initialSearchQuery || '');
  const [form, setForm] = useState<{ open: boolean; trailer: FleetTrailer | null }>({ open: false, trailer: null });
  const [hitchFor, setHitchFor] = useState<FleetTrailer | null>(null);
  const [viewing, setViewing] = useState<{ photo: string; name: string } | null>(null);
  const menu = useRowContextMenu<number>();
  const closeViewer = useCallback(() => setViewing(null), []);
  const openPhoto = (photo: string, name: string) => () => setViewing({ photo, name });
  const today = todayVnIso();

  useEffect(() => {
    if (initialSearchQuery) setQuery(initialSearchQuery);
  }, [initialSearchQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [list, trucks] = await Promise.all([getFleetTrailersApi(), getFleetVehiclesApi()]);
      setTrailers(list);
      // only tractors pull a trailer (a truck, xe tải, carries its own load)
      setVehicles(trucks.filter((v) => (v.category || 'tractor') === 'tractor'));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const historyQuery = useDebouncedValue(query, 300);
  const historyPaging = usePaging('fleet.hitches.pageSize', JSON.stringify([historyFilter, historyCols, historySort.sort, historyQuery]));
  const historyParams = useCallback((limit: number, offset: number) => ({
    trailer_id: historyFilter?.trailer_id, states: historyCols.ended_at, q: historyQuery.trim() || undefined,
    sort_by: historySort.sort?.key, sort_dir: historySort.sort?.dir, limit, offset,
  }), [historyFilter, historyCols, historyQuery, historySort.sort]);
  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getFleetHitchPageApi(historyParams(historyPaging.pageSize, (historyPaging.page - 1) * historyPaging.pageSize)));
    } catch {
      setHistory({ items: [], total: 0 });
    }
  }, [historyParams, historyPaging.page, historyPaging.pageSize]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (view === 'history') void loadHistory();
  }, [view, loadHistory]);

  // ---- trash ----
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashBadge, setTrashBadge] = useState(0);
  const loadTrashCount = useCallback(() => {
    getFleetTrashCountApi().then((c) => setTrashBadge(c.trailer || 0)).catch(() => {});
  }, []);
  useEffect(() => {
    loadTrashCount();
  }, [loadTrashCount]);

  /** The quick note form of a trailer with no note (like the booking table's) */
  const saveNote = (r: FleetTrailer) => async (note: string) => {
    try {
      await updateFleetTrailerApi(r.id, { note });
    } catch (err) {
      throw apiError(err, f.toast.error);
    }
    addToast(tf(note.trim() ? f.list.noteSaved : f.list.noteCleared, { name: r.plate }), 'success');
    reload();
  };

  const reload = useCallback(() => {
    void load();
    if (view === 'history') void loadHistory();
  }, [load, loadHistory, view]);

  const changeView = (next: View) => {
    setView(next);
    if (next !== 'history') setHistoryFilter(null);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* only a convenience */
    }
  };
  const showHistory = (r: FleetTrailer) => {
    setHistoryFilter({ trailer_id: r.id, label: r.plate });
    setView('history');
  };

  const rows = trailers || [];
  const tests: Record<Filter, (r: FleetTrailer) => boolean> = useMemo(() => ({
    all: () => true,
    hitched: (r) => !!r.vehicle,
    free: (r) => isRunning(r.status) && !r.vehicle,
    down: (r) => r.status === 'broken' || r.status === 'maintenance' || r.status === 'not_ready',
    expiring: (r) => r.status !== 'inactive' && docWarnings(docsOf(r), today).length > 0,
  }), [today]);
  const shown = useMemo(() => rows.filter((r) => tests[filter](r) && matches(query, r.plate, r.trailer_type, r.chassis_no,
    r.payload, r.note, r.vehicle?.plate, r.vehicle?.driver_name)), [rows, query, filter, tests]);

  const value: Record<string, (r: FleetTrailer) => string> = useMemo(() => ({
    plate: (r) => r.trailer_type,
    status: (r) => r.status,
    vehicle: (r) => (r.vehicle ? 'hitched' : 'free'),
    docs: (r) => docState(docsOf(r), today),
    year: (r) => r.year,
  }), [today]);
  const sortValue = useMemo(() => ({
    plate: (r: FleetTrailer) => r.plate,
    status: (r: FleetTrailer) => VEHICLE_STATUSES.indexOf(r.status),
    vehicle: (r: FleetTrailer) => r.vehicle?.plate ?? null,
    docs: (r: FleetTrailer) => soonestDays(docsOf(r), today),
    type: (r: FleetTrailer) => r.trailer_type,
    chassis: (r: FleetTrailer) => r.chassis_no,
    payload: (r: FleetTrailer) => r.payload,
    year: (r: FleetTrailer) => r.year,
    ownership: (r: FleetTrailer) => r.ownership_expiry,
    registration: (r: FleetTrailer) => r.registration_expiry,
    insurance: (r: FleetTrailer) => r.insurance_expiry,
    note: (r: FleetTrailer) => r.note,
    created: (r: FleetTrailer) => r.created_at,
  }), [today]);
  const sorted = useMemo(() => sortRows(applyColumnFilters(shown, cols, value), sort.sort, sortValue),
    [shown, cols, value, sort.sort, sortValue]);
  const paging = usePaging('fleet.trailers.pageSize', JSON.stringify([query, filter, cols, sort.sort]));
  const pageRows = usePageRows(sorted, paging.page, paging.pageSize);
  // multi-select, like the booking table (rows that drop out of the search / filters drop out of it)
  const sel = useRowSelection(sorted, (r: FleetTrailer) => r.id, [view]);
  const colFilterCount = Object.values(view === 'trailers' ? cols : historyCols).filter((v) => v.length).length;
  const clearColFilters = () => (view === 'trailers' ? setCols({}) : setHistoryCols({}));

  // ---- column settings ----
  const C = R.cols;
  const defaults = (keys: [string, string, boolean][]): ColumnDef[] => keys.map(([key, label, visible]) => ({ key, label, visible }));
  const listDefaults = useMemo(() => defaults([
    ['plate', C.plate, true], ['status', C.status, true], ['vehicle', C.vehicle, true], ['docs', C.docs, true],
    ['type', C.type, false], ['chassis', C.chassis, false], ['payload', C.payload, false], ['year', C.year, false],
    ['ownership', C.ownership, false], ['registration', C.registration, false], ['insurance', C.insurance, false], ['note', C.note, false],
    ['created', C.created, false],
  ]), [C]);
  const historyDefaults = useMemo(() => defaults([
    ['started_at', C.started, true], ['ended_at', C.ended, true], ['trailer_plate', C.plate, true],
    ['vehicle_plate', f.list.vehicle, true], ['reason', C.reason, true], ['end_reason', C.endReason, true],
  ]), [C, f.list.vehicle]);
  const listColumns = useColumnSettings({ storageKey: 'fleet_trailers_table', defaultColumns: listDefaults });
  const historyColumns = useColumnSettings({ storageKey: 'fleet_hitches_table', defaultColumns: historyDefaults });
  const activeColumns = view === 'trailers' ? listColumns : historyColumns;
  const [columnsOpen, setColumnsOpen] = useState(false);

  // ---- actions ----
  const unhitch = async (r: FleetTrailer) => {
    setBusyId(r.id);
    try {
      await hitchFleetTrailerApi(r.id, null);
      addToast(tf(R.toast.unhitched, { plate: r.plate }), 'success');
      reload();
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (r: FleetTrailer) => {
    if (!(await confirm({ message: tf(R.confirmDelete, { plate: r.plate, days: TRASH_KEEP_DAYS }), confirmText: f.actions.delete, danger: true }))) return;
    try {
      await deleteFleetTrailerApi(r.id);
      addToast(f.toast.deleted, 'success');
      reload();
      loadTrashCount();
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    }
  };
  /** "Đổi trạng thái" in the row menu, like the booking table: the selection when the row is part of one. */
  const statusGroup = (r: FleetTrailer): MenuGroup => {
    const ids = sel.count > 1 && sel.isSelected(r.id) ? [...sel.selectedIds] : [r.id];
    return {
      label: ids.length > 1 ? tf(f.bulk.statusTitle, { count: ids.length }) : f.bulk.status,
      items: VEHICLE_STATUSES.map((s) => ({
        key: `status-${s}`, label: R.status[s], icon: ListChecks,
        // expired papers: only not_ready / inactive (the server refuses the rest)
        disabled: ids.length === 1 && (r.status === s || (expiredPapers(r, today).length > 0 && !LOCK_FREE_STATUSES.includes(s))),
        onClick: () => void applyStatus(ids, s),
      })),
    };
  };
  const menuFor = (r: FleetTrailer): MenuGroup[] => [
    { label: r.plate, items: [
      { key: 'edit', label: f.menu.edit, icon: Pencil, onClick: () => setForm({ open: true, trailer: r }) },
      ...(canHitch(r)
        ? [{ key: 'hitch', label: r.vehicle ? R.actions.change : R.actions.hitch, icon: Link2, onClick: () => setHitchFor(r) }] : []),
      ...(r.vehicle ? [{ key: 'unhitch', label: R.actions.unhitch, icon: Link2Off, onClick: () => void unhitch(r) }] : []),
      { key: 'history', label: f.menu.history, icon: History, onClick: () => showHistory(r) },
    ] },
    statusGroup(r),
    { items: [{ key: 'delete', label: f.menu.delete, icon: Trash2, danger: true, onClick: () => void remove(r) }] },
  ];
  const menuRow = menu.state ? rows.find((r) => r.id === menu.state!.row) : undefined;

  const rowEvents = (r: FleetTrailer) => ({
    tabIndex: 0,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      menu.open(r.id, e.clientX, e.clientY);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      if (!fromControl(e)) setForm({ open: true, trailer: r });
    },
    onMouseDown: (e: React.MouseEvent) => {
      if (e.detail > 1 && !fromControl(e)) e.preventDefault();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        setForm({ open: true, trailer: r });
      } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        menu.open(r.id, box.left + 24, box.top + box.height / 2);
      }
    },
  });

  // ---- Excel export: every matching row (not just this page), every column ----
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRows, setExportRows] = useState<Record<string, string | number>[]>([]);
  const [exporting, setExporting] = useState(false);
  const exportTab: ExportTab = view === 'trailers' ? 'fleet_trailer' : 'fleet_hitch';
  const exportColumns = useMemo(() => [
    { key: 'STT', label: t.common.stt },
    ...activeColumns.columns.map((c) => ({ key: c.key, label: c.label })),
  ], [activeColumns.columns, t.common.stt]);
  const trailerText = (r: FleetTrailer): Record<string, string> => ({
    plate: r.plate,
    status: R.status[r.status],
    vehicle: r.vehicle ? [r.vehicle.plate, r.vehicle.driver_name].filter(Boolean).join(' — ') : '',
    docs: T.docState[docState(docsOf(r), today)],
    type: r.trailer_type,
    chassis: r.chassis_no,
    payload: r.payload,
    year: r.year,
    ownership: formatIsoDate(r.ownership_expiry),
    registration: formatIsoDate(r.registration_expiry),
    insurance: formatIsoDate(r.insurance_expiry),
    note: r.note,
    created: formatStampShort(r.created_at),
  });
  const hitchText = (h: FleetHitch): Record<string, string> => ({
    started_at: formatStampShort(h.started_at),
    ended_at: h.ended_at ? formatStampShort(h.ended_at) : R.stillOpen,
    trailer_plate: h.trailer_plate,
    vehicle_plate: h.vehicle_plate,
    reason: h.reason,
    end_reason: h.end_reason,
  });
  const allHistory = async (): Promise<FleetHitch[]> => {
    const out: FleetHitch[] = [];
    const size = 1000;
    for (let offset = 0; ; offset += size) {
      const res = await getFleetHitchPageApi(historyParams(size, offset));
      out.push(...res.items);
      if (res.items.length < size || out.length >= res.total) return out;
    }
  };
  /** `selected`: only the picked rows (the bottom bar's "Xuất Excel đã chọn"). */
  const openExport = async (selected = false) => {
    setExporting(true);
    try {
      const list: Record<string, string>[] = view === 'trailers' ? (selected ? sel.selectedRows : sorted).map(trailerText)
        : (await allHistory()).map(hitchText);
      const filled = list.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v || f.none])));
      setExportRows(filled.map((r, i) => ({ STT: i + 1, ...r })));
      setExportOpen(true);
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    } finally {
      setExporting(false);
    }
  };

  // ---- the bottom bar: what to do with the picked trailers ----
  const B = f.bulk;
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<'status' | 'unhitch' | 'delete' | null>(null);
  const report = (total: number, res: { ok: number; errors: string[] }, done: string) => {
    if (res.ok) addToast(tf(done, { count: res.ok }), 'success');
    if (res.errors.length) addToast(tf(B.failed, { count: total - res.ok, error: res.errors.join('; ') }), 'error');
  };
  const bulkCopy = async () => {
    const ok = await copyTextToClipboard(formatRowsAsTsv(sel.selectedRows.map(trailerText), listColumns.columns, true));
    addToast(ok ? tf(B.copied, { count: sel.count }) : f.toast.error, ok ? 'success' : 'error');
  };
  /** New status for the selection (bottom bar) or the right-clicked trailer (with the selection it is part of). */
  const applyStatus = async (ids: number[], status: string) => {
    setStatusPickerOpen(false);
    setBulkBusy('status');
    const picked = rows.filter((r) => ids.includes(r.id));
    const todo = picked.filter((r) => r.status !== status);   // the others need nothing
    const res = await runEach(todo, (r) => updateFleetTrailerApi(r.id, { status: status as TrailerStatus }), f.toast.error);
    report(picked.length, { ok: res.ok + (picked.length - todo.length), errors: res.errors },
      picked.length === 1 ? tf(B.statusOne, { name: picked[0].plate, status: R.status[status as TrailerStatus] }) : B.statusDone);
    setBulkBusy(null);
    reload();
  };
  const bulkStatus = (status: string) => applyStatus([...sel.selectedIds], status);
  const bulkUnhitch = async () => {
    setBulkBusy('unhitch');
    const hitched = sel.selectedRows.filter((r) => r.vehicle);
    const res = await runEach(hitched, (r) => hitchFleetTrailerApi(r.id, null), f.toast.error);
    report(hitched.length, res, B.unhitched);
    setBulkBusy(null);
    reload();
  };
  const bulkDelete = async () => {
    const total = sel.count;
    if (!(await confirm({ message: tf(B.deleteConfirm, { count: total, days: TRASH_KEEP_DAYS }), confirmText: f.actions.delete, danger: true }))) return;
    setBulkBusy('delete');
    const res = await runEach(sel.selectedRows, (r) => deleteFleetTrailerApi(r.id), f.toast.error);
    report(total, res, B.deleted);
    setBulkBusy(null);
    sel.clear();
    reload();
    loadTrashCount();
  };
  const anyHitched = sel.selectedRows.some((r) => r.vehicle);
  const bulkActions: BulkAction[] = [
    { key: 'status', label: B.status, icon: ListChecks, onClick: () => setStatusPickerOpen(true), loading: bulkBusy === 'status' },
    { key: 'unhitch', label: B.unhitch, icon: Link2Off, onClick: () => void bulkUnhitch(), disabled: !anyHitched, loading: bulkBusy === 'unhitch' },
    { key: 'export', label: t.bulk.exportSelected, icon: FileSpreadsheet, onClick: () => void openExport(true), loading: exporting },
    { key: 'copy', label: t.bulk.copySelected, icon: Copy, onClick: () => void bulkCopy() },
    { key: 'delete', label: t.bulk.deleteSelected, icon: Trash2, onClick: () => void bulkDelete(), danger: true, loading: bulkBusy === 'delete' },
  ];

  // ---- tables ----
  type Spec<Row> = {
    render: (row: Row) => React.ReactNode;
    td?: string;
    filter?: { options: () => { carrier: string; count: number }[]; value: string[]; onChange: (v: string[]) => void;
      format: (v: string) => string; column?: string };
  };
  const setCol = (setter: React.Dispatch<React.SetStateAction<Record<string, string[]>>>, key: string) =>
    (values: string[]) => setter((prev) => ({ ...prev, [key]: values }));
  const plainCell = (text: string) => text ? <span className="text-slate-700 dark:text-slate-200">{text}</span>
    : <span className="text-slate-300 dark:text-slate-600">{f.none}</span>;

  const specs: Record<string, Spec<FleetTrailer>> = {
    plate: {
      filter: { column: C.type, options: () => valueCounts(shown, value.plate), value: cols.plate || [],
        onChange: setCol(setCols, 'plate'), format: (v) => v || t.common.columnFilter.empty },
      render: (r) => {
        const sub = [r.trailer_type, r.payload, r.year].filter(Boolean).join(' · ');
        return (
          <div className="flex items-center gap-3">
            <FleetAvatar photo={r.photo} kind="trailer" name={r.plate} size="wide" onClick={openPhoto(r.photo, r.plate)} />
            <div className="min-w-0">
              <div className="font-bold text-[15px] text-slate-900 dark:text-slate-100 whitespace-nowrap">{r.plate}<NoteIcon note={r.note} name={r.plate} onSave={saveNote(r)} /></div>
              {sub && <div className={`${MUTED} truncate max-w-[16rem]`}>{sub}</div>}
            </div>
          </div>
        );
      },
    },
    status: {
      filter: { options: () => valueCounts(shown, value.status, [...VEHICLE_STATUSES]), value: cols.status || [],
        onChange: setCol(setCols, 'status'), format: (v) => R.status[v as TrailerStatus] ?? v },
      render: (r) => (
        <span title={r.status_forced ? f.lock.forced : undefined} data-testid={r.status_forced ? 'status-forced' : undefined}>
          <StatusBadge tone={VEHICLE_TONE[r.status]}>{R.status[r.status]}{!!r.status_forced && <Lock className="w-3 h-3" aria-hidden />}</StatusBadge>
        </span>
      ),
    },
    vehicle: {
      filter: { options: () => valueCounts(shown, value.vehicle, ['hitched', 'free']), value: cols.vehicle || [],
        onChange: setCol(setCols, 'vehicle'), format: (v) => R.vehicleState[v as 'hitched' | 'free'] ?? v },
      render: (r) => {
        const v = r.vehicle;
        if (!v) return <span className="text-sm text-slate-400 dark:text-slate-500">{R.noVehicle}</span>;
        return (
          <div className="flex items-center gap-2.5">
            <FleetAvatar photo={v.photo} kind="vehicle" name={v.plate} size="wideSm" onClick={openPhoto(v.photo, v.plate)} />
            <div className="min-w-0">
              <div className="font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{v.plate}</div>
              <div className={MUTED}>{v.driver_name ? tf(R.driver, { name: v.driver_name }) : f.noDriver}</div>
            </div>
          </div>
        );
      },
    },
    docs: {
      filter: { options: () => valueCounts(shown, value.docs, DOC_STATES), value: cols.docs || [],
        onChange: setCol(setCols, 'docs'), format: (v) => T.docState[v as DocState] ?? v },
      render: (r) => <DocsCell entries={docsOf(r)} today={today} muted={r.status === 'inactive'} />,
    },
    type: { render: (r) => plainCell(r.trailer_type) },
    chassis: { td: 'whitespace-nowrap font-mono text-xs', render: (r) => plainCell(r.chassis_no) },
    payload: { td: 'whitespace-nowrap', render: (r) => plainCell(r.payload) },
    year: {
      td: 'whitespace-nowrap tabular-nums',
      filter: { options: () => valueCounts(shown, value.year), value: cols.year || [], onChange: setCol(setCols, 'year'),
        format: (v) => v || t.common.columnFilter.empty },
      render: (r) => plainCell(r.year),
    },
    ownership: { render: (r) => <DateCell iso={r.ownership_expiry} today={today} muted={r.status === 'inactive'} /> },
    registration: { render: (r) => <DateCell iso={r.registration_expiry} today={today} muted={r.status === 'inactive'} /> },
    insurance: { render: (r) => <DateCell iso={r.insurance_expiry} today={today} muted={r.status === 'inactive'} /> },
    note: { td: 'max-w-[18rem]', render: (r) => <span className="line-clamp-2 text-slate-600 dark:text-slate-300">{r.note || f.none}</span> },
    created: { td: 'whitespace-nowrap tabular-nums', render: (r) => plainCell(formatStampShort(r.created_at)) },
  };

  // filtered on the server: fixed choices, counts unknown (-1: not shown)
  const historySpecs: Record<string, Spec<FleetHitch>> = {
    started_at: { td: 'whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-200', render: (h) => formatStampShort(h.started_at) },
    ended_at: {
      td: 'whitespace-nowrap tabular-nums',
      filter: { options: () => ['open', 'closed'].map((v) => ({ carrier: v, count: -1 })), value: historyCols.ended_at || [],
        onChange: setCol(setHistoryCols, 'ended_at'), format: (v) => R.historyState[v as 'open' | 'closed'] ?? v },
      render: (h) => (h.ended_at ? <span className="text-slate-700 dark:text-slate-200">{formatStampShort(h.ended_at)}</span>
        : <StatusBadge tone={VEHICLE_TONE.active}>{R.stillOpen}</StatusBadge>),
    },
    trailer_plate: { td: 'font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap', render: (h) => h.trailer_plate },
    vehicle_plate: { td: 'font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap', render: (h) => h.vehicle_plate },
    reason: { td: 'text-slate-600 dark:text-slate-300', render: (h) => h.reason || f.none },
    end_reason: { td: 'text-slate-600 dark:text-slate-300', render: (h) => h.end_reason || (h.ended_at ? f.none : '') },
  };

  type Settings = ReturnType<typeof useColumnSettings>;
  const visible = <Row,>(settings: Settings, table: Record<string, Spec<Row>>) => settings.columns.filter((c) => c.visible && table[c.key]);
  const headerRow = <Row,>(settings: Settings, table: Record<string, Spec<Row>>, sorter: ReturnType<typeof useTableSort>, actions: boolean,
    select?: React.ReactNode) => (
    <tr>
      {select}
      <SttTh label={t.common.stt} />
      {visible(settings, table).map((c) => {
        const fl = table[c.key].filter;
        return (
          <ResizableTh key={c.key} colKey={c.key} label={c.label} className="px-4 py-2.5" sortDir={sorter.sortDirOf(c.key)}
            onSort={sorter.toggleSort} width={settings.columnWidths[c.key]} onResize={settings.startResize} sortLabels={t.common.sort}
            extra={fl && (
              <ColumnValueFilter column={fl.column || c.label} loadOptions={async () => fl.options()} value={fl.value}
                onChange={fl.onChange} labels={t.common.columnFilter} formatOption={fl.format} />
            )} />
        );
      })}
      {actions && <th className={TH}><span className="sr-only">{f.cols.actions}</span></th>}
    </tr>
  );
  const cells = <Row,>(settings: Settings, table: Record<string, Spec<Row>>, row: Row) => visible(settings, table).map((c) => (
    <td key={c.key} className={`${TD} ${table[c.key].td || ''}`}
      style={settings.columnWidths[c.key] ? { maxWidth: settings.columnWidths[c.key] } : undefined}>
      {table[c.key].render(row)}
    </td>
  ));
  const THEAD = 'sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800';
  const emptyRow = (span: number, text: string) => (
    <tbody><tr><td colSpan={span} className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">{text}</td></tr></tbody>
  );

  const listTable = () => {
    if (rows.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400">
          <Container className="w-9 h-9 text-slate-300 dark:text-slate-600" />
          {R.empty.list}
        </div>
      );
    }
    return (
      <table className="min-w-full text-sm">
        <thead className={THEAD}>{headerRow(listColumns, specs, sort, true, (
          <SelectHeader checked={sel.isPageAllSelected(pageRows)} partial={sel.isPagePartiallySelected(pageRows)} disabled={pageRows.length === 0}
            onChange={() => sel.selectPage(pageRows, !sel.isPageAllSelected(pageRows))} />
        ))}</thead>
        {pageRows.length === 0 && emptyRow(visible(listColumns, specs).length + 3,
          filter !== 'all' || colFilterCount ? f.filters.empty : f.empty.search)}
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {pageRows.map((r, i) => (
            <tr key={r.id} data-testid={`trailer-${r.id}`} {...rowEvents(r)}
              className={`${ROW} ${rowTone(sel.isSelected(r.id), menu.state?.row === r.id)} ${r.status === 'inactive' ? 'opacity-60' : ''}`}>
              <SelectCell checked={sel.isSelected(r.id)} label={tf(B.rowLabel, { name: r.plate })} onToggle={(shift) => sel.toggle(r.id, shift)} />
              <SttTd n={sttOf(paging.page, paging.pageSize, i)} />
              {cells(listColumns, specs, r)}
              <td className={`${TD} text-right whitespace-nowrap w-0`}>
                <div className="inline-flex items-center gap-1">
                  {canHitch(r) && (r.vehicle ? (
                    <button type="button" onClick={() => setHitchFor(r)} disabled={busyId === r.id}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                      <Link2 className="w-3.5 h-3.5" />{R.actions.change}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setHitchFor(r)}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white">
                      <Link2 className="w-3.5 h-3.5" />{R.actions.hitch}
                    </button>
                  ))}
                  <button type="button" aria-label={`${f.menu.more} · ${r.plate}`} title={f.menu.more} aria-haspopup="menu"
                    onClick={(e) => {
                      const box = e.currentTarget.getBoundingClientRect();
                      menu.open(r.id, box.left - 160, box.bottom + 4);
                    }}
                    className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800">
                    {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const historyTable = () => {
    if (!history) return <div className="flex-1 flex justify-center items-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>;
    return (
      <table className="min-w-full text-sm">
        <thead className={THEAD}>{headerRow(historyColumns, historySpecs, historySort, false)}</thead>
        {history.items.length === 0 && emptyRow(visible(historyColumns, historySpecs).length + 1,
          historyQuery || colFilterCount ? f.filters.empty : R.empty.history)}
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {history.items.map((h, i) => (
            <tr key={h.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
              <SttTd n={sttOf(historyPaging.page, historyPaging.pageSize, i)} />
              {cells(historyColumns, historySpecs, h)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const tone = {
    neutral: 'text-slate-600 dark:text-slate-300', green: 'text-emerald-700 dark:text-emerald-300', red: 'text-rose-700 dark:text-rose-300',
    amber: 'text-amber-800 dark:text-amber-300', sky: 'text-sky-700 dark:text-sky-300',
  };
  const chips = ([
    ['all', R.filters.all, tone.neutral], ['hitched', R.filters.hitched, tone.green], ['free', R.filters.free, tone.sky],
    ['down', R.filters.down, tone.red], ['expiring', R.filters.expiring, tone.amber],
  ] as [Filter, string, string][]).map(([id, label, color]) => ({ id, label, color, count: rows.filter(tests[id]).length }));
  const tabs: { id: View; label: string; count?: number }[] = [
    { id: 'trailers', label: R.views.list, count: trailers?.length },
    { id: 'history', label: R.views.history },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-4 gap-2.5 bg-slate-50/50 dark:bg-slate-950/50" data-testid="trailer-tab">
      {/* One row: what you look at (table switch), narrow it down, find, act on it */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
        <div role="tablist" className="inline-flex p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} onClick={() => changeView(tab.id)}
              className={`h-8 px-3.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${view === tab.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}>
              {tab.label}{tab.count !== undefined && <span className="ml-1.5 text-xs font-medium text-slate-400">{tab.count}</span>}
            </button>
          ))}
        </div>
        {view === 'trailers' ? (
          <div role="group" aria-label={f.filters.label} className="flex flex-wrap items-center gap-1.5">
            {trailers && chips.filter((c) => c.id === 'all' || c.count > 0 || filter === c.id).map((c) => (
              <button key={c.id} type="button" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold border transition-colors ${filter === c.id
                  ? 'border-primary-500 bg-primary-600 text-white'
                  : `border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600 ${c.color}`}`}>
                {c.label}
                <span className={`min-w-[1.25rem] px-1 rounded-full text-[11px] ${filter === c.id ? 'bg-white/25' : 'bg-slate-100 dark:bg-slate-800'}`}>{c.count}</span>
              </button>
            ))}
          </div>
        ) : historyFilter ? (
          <div className="inline-flex items-center gap-2 h-8 pl-3 pr-1 rounded-full border border-primary-200 dark:border-primary-900 bg-primary-50 dark:bg-primary-950/30 text-xs font-semibold text-primary-800 dark:text-primary-200">
            {tf(f.historyFor, { name: historyFilter.label })}
            <button type="button" onClick={() => setHistoryFilter(null)} aria-label={f.clearFilter} title={f.clearFilter}
              className="p-1 rounded-full hover:bg-primary-100 dark:hover:bg-primary-900/50"><X className="w-3.5 h-3.5" /></button>
          </div>
        ) : null}
        {colFilterCount > 0 && (
          <button type="button" onClick={clearColFilters}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-xs font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/30">
            <X className="w-3.5 h-3.5" />{tf(T.clearFilters, { count: colFilterCount })}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-44 min-[1800px]:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={R.search} aria-label={R.search}
              className="w-full h-8 pl-9 pr-8 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
            {query && (
              <button type="button" aria-label={f.clearFilter} onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            )}
          </div>
          <span className="text-slate-400 dark:text-slate-500 cursor-help" title={f.detail.hint} aria-label={f.detail.hint}>
            <Info className="w-4 h-4" />
          </span>
          <div role="toolbar" aria-label={f.toolbar}
            className="inline-flex items-stretch h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-x divide-slate-200 dark:divide-slate-700 overflow-hidden">
            <button type="button" onClick={() => void openExport(false)} disabled={exporting || (view === 'trailers' ? !rows.length : !history?.total)}
              title={f.exportHint} aria-label={t.common.exportExcel}
              className="inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50">
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}<span className="hidden min-[1900px]:inline">{t.common.exportExcel}</span>
            </button>
            <button type="button" onClick={() => setColumnsOpen(true)} title={f.columns.tooltip} aria-label={t.common.columnsConfig}
              className="inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              <SlidersHorizontal className="w-3.5 h-3.5" /><span className="hidden min-[1900px]:inline">{t.common.columnsConfig}</span>
            </button>
            {view === 'trailers' && (
              <button type="button" onClick={() => setTrashOpen(true)} title={tf(f.trash.tooltip, { days: TRASH_KEEP_DAYS })} aria-label={trashBadge > 0 ? `${f.trash.button} ${trashBadge}` : f.trash.button}
                className="inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                <ArchiveRestore className="w-3.5 h-3.5" /><span className="hidden min-[1900px]:inline">{f.trash.button}</span>
                {trashBadge > 0 && (
                  <span className="min-w-[1.1rem] px-1 rounded-full bg-rose-500 text-white text-[10px] leading-4 text-center">
                    {trashBadge > 999 ? '999+' : trashBadge}
                  </span>
                )}
              </button>
            )}
            <button type="button" onClick={reload} disabled={loading} aria-label={f.refresh} title={f.refresh}
              className="inline-flex items-center justify-center w-8 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {view === 'trailers' && (
            <button type="button" onClick={() => setForm({ open: true, trailer: null })}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white shadow-sm whitespace-nowrap">
              <Plus className="w-4 h-4" />{R.actions.add}
            </button>
          )}
        </div>
      </div>

      {failed ? (
        <div role="alert" className="flex items-center justify-between gap-2 p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300">
          <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{f.loadFailed}</span>
          <button type="button" onClick={reload} className="font-bold underline">{f.retry}</button>
        </div>
      ) : !trailers ? (
        <div className="flex-1 flex justify-center items-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
          <div className="flex-1 min-h-0 flex flex-col overflow-auto">{view === 'trailers' ? listTable() : historyTable()}</div>
          {view === 'trailers' && rows.length > 0 && (
            <Pagination currentPage={paging.page} totalItems={sorted.length} pageSize={paging.pageSize}
              onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} pageSizeOptions={PAGE_SIZE_OPTIONS}
              className="border-t border-slate-200 dark:border-slate-800" />
          )}
          {view === 'history' && history && history.total > 0 && (
            <Pagination currentPage={historyPaging.page} totalItems={history.total} pageSize={historyPaging.pageSize}
              onPageChange={historyPaging.setPage} onPageSizeChange={historyPaging.setPageSize} pageSizeOptions={PAGE_SIZE_OPTIONS}
              className="border-t border-slate-200 dark:border-slate-800" />
          )}
        </div>
      )}

      <TrailerFormModal isOpen={form.open} trailer={form.trailer} vehicles={vehicles}
        onClose={() => setForm({ open: false, trailer: null })} onSaved={reload} />
      <TrailerHitchModal trailer={hitchFor} vehicles={vehicles} onClose={() => setHitchFor(null)} onSaved={reload} />
      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} data={exportRows} allColumns={exportColumns}
        tab={exportTab} filenamePrefix={view === 'trailers' ? 'ro_mooc' : 'lich_su_gan_mooc'} />
      <ColumnConfigModal isOpen={columnsOpen} onClose={() => setColumnsOpen(false)} columns={activeColumns.columns}
        onChange={activeColumns.setColumns} onReset={activeColumns.resetColumns} />
      <FleetTrashModal kind="trailer" isOpen={trashOpen} onClose={() => setTrashOpen(false)}
        onChanged={() => { reload(); loadTrashCount(); }} />
      {view === 'trailers' && (
        <BulkActionBar count={sel.count} onClear={sel.clear} actions={bulkActions} extra={
          !sel.isAllSelected ? (
            <button type="button" onClick={() => sel.selectAll(true)}
              className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">
              {tf(t.bulk.selectAllResults, { count: sorted.length })}
            </button>
          ) : undefined
        } />
      )}
      <StatusPickerModal open={statusPickerOpen} onClose={() => setStatusPickerOpen(false)} onPick={(s) => void bulkStatus(s)}
        title={tf(B.statusTitle, { count: sel.count })} hint={B.trailerHint}
        options={VEHICLE_STATUSES.map((s) => ({ value: s, label: R.status[s], dot: VEHICLE_TONE[s].dot }))} />
      <RowContextMenu position={menu.state && menuRow ? { x: menu.state.x, y: menu.state.y } : null}
        groups={menuRow ? menuFor(menuRow) : []} onClose={menu.close} />
      <PhotoLightbox photo={viewing?.photo || null} name={viewing?.name || ''} onClose={closeViewer} />
    </div>
  );
};
