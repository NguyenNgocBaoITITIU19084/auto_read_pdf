import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArchiveRestore, ArrowLeftRight, CheckCircle2, Copy, Eye, ListChecks, History, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Search,
  FileSpreadsheet, Info, SlidersHorizontal, Trash2, Truck, Undo2, Wrench, X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { tf } from '../../services/i18nFormat';
import {
  deleteFleetDriverApi, deleteFleetVehicleApi, getFleetDriversApi, getFleetHistoryPageApi, getFleetVehiclesApi, returnDriverHomeApi,
  setFleetVehicleStatusApi, getFleetTrashCountApi, updateFleetDriverApi, type FleetTrashCount,
} from '../../services/api';
import { useRowSelection } from '../../hooks/useRowSelection';
import { BulkActionBar, type BulkAction } from '../common/BulkActionBar';
import { copyTextToClipboard, formatRowsAsTsv } from '../../utils/formatters';
import { SelectCell, SelectHeader, StatusPickerModal, rowTone, runEach } from './FleetBulk';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { ColumnConfigModal, type ColumnDef } from '../common/ColumnConfigModal';
import { TRASH_KEEP_DAYS } from '../common/TrashModal';
import { FleetTrashModal } from './FleetTrashModal';
import { ExportModal } from '../common/ExportModal';
import type { ExportTab } from '../../types';
import { useTableSort } from '../../hooks/useTableSort';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ResizableTh } from '../common/ResizableTh';
import { ColumnValueFilter } from '../common/ColumnValueFilter';
import { Pagination } from '../common/Pagination';
import { PAGE_SIZE_OPTIONS, applyColumnFilters, sortRows, usePageRows, usePaging, valueCounts } from './fleetTable';
import { DRIVER_STATUSES, VEHICLE_STATUSES, type DriverStatus, type FleetAssignment, type FleetDocumentKind, type FleetDriver,
  type FleetHistoryPage,
  type FleetVehicle, type VehicleCategory, type VehicleStatus } from '../../types';
import { DriverFormModal, DriverMoveModal, VehicleFormModal, VehicleStatusModal } from './FleetModals';
import { FleetAvatar, PhotoLightbox } from './FleetPhoto';
import { RowContextMenu, useRowContextMenu, type MenuGroup } from '../common/RowContextMenu';
import { FleetDetailModal, type DetailAction, type FleetDetailTarget } from './FleetDetailModal';
import {
  Chip, DOC_STATES, DRIVER_TONE, DocsCell, DateCell, MUTED, NoteIcon, ROW, StatusBadge, TD, TEMP_CHIP, TH, TRUCK_CHIP, VEHICLE_TONE,
  docState, docWarnings, fromControl, soonestDays, type DocState,
} from './fleetCells';
import {
  apiError, awayHomeDrivers, canReturnHome, formatIsoDate, formatStampShort, matches, todayVnIso,
} from './fleetUtils';

type View = 'vehicles' | 'drivers' | 'history';
type HistoryFilter = { driver_id?: number; vehicle_id?: number; label: string } | null;
type VehicleFilter = 'all' | 'running' | 'down' | 'free' | 'expiring';
type DriverFilter = 'all' | 'idle' | 'temporary' | 'expiring';
type RowRef = { kind: 'vehicle' | 'driver'; id: number };

/** Which app tab this is: the tractor units (đầu kéo), the trucks (xe tải), or the drivers. Each also shows the
 *  assignment history (of its own kind of truck on the two vehicle tabs). */
export type FleetScreen = 'vehicles' | 'trucks' | 'drivers';
const VIEW_KEY: Record<FleetScreen, string> = { vehicles: 'fleet.view', trucks: 'fleet.trucks.view', drivers: 'fleet.drivers.view' };
// the vehicle table's own settings (columns, sort, page size) on each vehicle tab
const TABLE_KEYS = {
  vehicles: { sort: 'fleet_vehicles_sort', columns: 'fleet_vehicles_table', pageSize: 'fleet.vehicles.pageSize' },
  trucks: { sort: 'fleet_trucks_sort', columns: 'fleet_trucks_table', pageSize: 'fleet.trucks.pageSize' },
};

const readView = (screen: FleetScreen): View => {
  const list: View = screen === 'drivers' ? 'drivers' : 'vehicles';
  try {
    return localStorage.getItem(VIEW_KEY[screen]) === 'history' ? 'history' : list;
  } catch {
    return list;
  }
};

interface Props {
  initialSearchQuery?: string;
  /** 'vehicles': the "Đầu kéo" tab; 'trucks': the "Xe tải" tab; 'drivers': the "Tài xế" tab */
  screen?: FleetScreen;
}

/** Trucks, drivers and who drives what, as compact tables: one obvious action per row ("Báo hư" / "Đã sửa xong" /
 *  "Trả về xe gốc" / "Đổi xe") and the rest in a "⋯" menu. Fleet data is company-wide (no collection). */
export const FleetTab: React.FC<Props> = ({ initialSearchQuery, screen = 'vehicles' }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const f = t.fleet;
  const L = f.list;
  // the vehicle tabs list one category; the drivers tab (and every picker) sees all trucks
  const category: VehicleCategory = screen === 'trucks' ? 'truck' : 'tractor';
  const isTrucks = screen === 'trucks';
  const tableKeys = TABLE_KEYS[isTrucks ? 'trucks' : 'vehicles'];
  const [view, setView] = useState<View>(() => readView(screen));
  const [vehicles, setVehicles] = useState<FleetVehicle[] | null>(null);
  const [drivers, setDrivers] = useState<FleetDriver[] | null>(null);
  const [history, setHistory] = useState<FleetHistoryPage | null>(null);
  const [vehicleCols, setVehicleCols] = useState<Record<string, string[]>>({});
  const [driverCols, setDriverCols] = useState<Record<string, string[]>>({});
  const [historyCols, setHistoryCols] = useState<Record<string, string[]>>({});
  const vehicleSort = useTableSort(tableKeys.sort);
  const driverSort = useTableSort('fleet_drivers_sort');
  const historySort = useTableSort('fleet_history_sort');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>(null);
  const [vehicleFilter, setVehicleFilter] = useState<VehicleFilter>('all');
  const [driverFilter, setDriverFilter] = useState<DriverFilter>('all');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState(initialSearchQuery || '');
  const [vehicleForm, setVehicleForm] = useState<{ open: boolean; vehicle: FleetVehicle | null }>({ open: false, vehicle: null });
  const [driverForm, setDriverForm] = useState<{ open: boolean; driver: FleetDriver | null }>({ open: false, driver: null });
  const [statusFor, setStatusFor] = useState<FleetVehicle | null>(null);
  const [moveFor, setMoveFor] = useState<FleetDriver | null>(null);
  const [viewing, setViewing] = useState<{ photo: string; name: string } | null>(null);
  const [detail, setDetail] = useState<RowRef | null>(null);
  const menu = useRowContextMenu<RowRef>();
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
      const [v, d] = await Promise.all([getFleetVehiclesApi(), getFleetDriversApi()]);
      setVehicles(v);
      setDrivers(d);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const historyQuery = useDebouncedValue(query, 300);
  // a vehicle tab's history is its own kind of truck's (a picked truck / driver shows all of theirs)
  const historyCategory = screen === 'drivers' || historyFilter ? undefined : category;
  const historyPaging = usePaging('fleet.history.pageSize', JSON.stringify([historyFilter, historyCols, historySort.sort, historyQuery]));
  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getFleetHistoryPageApi({
        driver_id: historyFilter?.driver_id, vehicle_id: historyFilter?.vehicle_id, category: historyCategory,
        kinds: historyCols.vehicle_plate, states: historyCols.ended_at, q: historyQuery.trim() || undefined,
        sort_by: historySort.sort?.key, sort_dir: historySort.sort?.dir,
        limit: historyPaging.pageSize, offset: (historyPaging.page - 1) * historyPaging.pageSize,
      }));
    } catch {
      setHistory({ items: [], total: 0 });
    }
  }, [historyFilter, historyCols, historyQuery, historySort.sort, historyPaging.page, historyPaging.pageSize, historyCategory]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (view === 'history') void loadHistory();
  }, [view, loadHistory]);

  const reload = useCallback(() => {
    void load();
    if (view === 'history') void loadHistory();
  }, [load, loadHistory, view]);

  const changeView = (next: View) => {
    setView(next);
    if (next !== 'history') setHistoryFilter(null);
    try {
      localStorage.setItem(VIEW_KEY[screen], next);
    } catch {
      /* only a convenience */
    }
  };

  const showHistory = (filter: HistoryFilter) => {
    setHistoryFilter(filter);
    setView('history');
  };

  const allVs = useMemo(() => vehicles || [], [vehicles]);
  const vs = useMemo(() => (screen === 'drivers' ? allVs : allVs.filter((v) => (v.category || 'tractor') === category)),
    [allVs, screen, category]);
  const ds = drivers || [];
  const away = useMemo(() => awayHomeDrivers(vs), [vs]);

  const vehicleDocs = (v: FleetVehicle): [FleetDocumentKind, string][] =>
    [['registration', v.registration_expiry], ['insurance', v.insurance_expiry]];
  const driverDocs = (d: FleetDriver): [FleetDocumentKind, string][] => [['license', d.license_expiry]];

  const vehicleTest: Record<VehicleFilter, (v: FleetVehicle) => boolean> = useMemo(() => ({
    all: () => true,
    running: (v) => v.status === 'active',
    down: (v) => v.status === 'broken' || v.status === 'maintenance',
    free: (v) => v.status === 'active' && !v.current_driver,
    expiring: (v) => v.status !== 'inactive' && docWarnings(vehicleDocs(v), today).length > 0,
  }), [today]);
  const driverTest: Record<DriverFilter, (d: FleetDriver) => boolean> = useMemo(() => ({
    all: () => true,
    idle: (d) => d.status === 'active' && !d.current_vehicle,
    temporary: (d) => d.current_vehicle?.kind === 'temporary',
    expiring: (d) => d.status !== 'left' && docWarnings(driverDocs(d), today).length > 0,
  }), [today]);

  const shownVehicles = useMemo(() => vs.filter((v) => vehicleTest[vehicleFilter](v) && matches(query, v.plate, v.trailer_plate,
    v.vehicle_type, v.body_type, v.payload, v.note, v.current_driver?.name, v.home_driver?.name)), [vs, query, vehicleFilter, vehicleTest]);
  const shownDrivers = useMemo(() => ds.filter((d) => driverTest[driverFilter](d) && matches(query, d.name, d.phone, d.id_number,
    d.license_no, d.note, d.home_vehicle?.plate, d.current_vehicle?.plate)), [ds, query, driverFilter, driverTest]);

  // column values: what each column filters on, and what it sorts by
  const vehicleValue: Record<string, (v: FleetVehicle) => string> = useMemo(() => ({
    plate: (v) => v.vehicle_type,
    status: (v) => v.status,
    driver: (v) => (v.current_driver ? v.current_driver.kind : 'none'),
    docs: (v) => docState(vehicleDocs(v), today),
  }), [today]);
  const vehicleSortValue = useMemo(() => ({
    plate: (v: FleetVehicle) => v.plate,
    status: (v: FleetVehicle) => VEHICLE_STATUSES.indexOf(v.status),
    driver: (v: FleetVehicle) => v.current_driver?.name ?? null,
    docs: (v: FleetVehicle) => soonestDays(vehicleDocs(v), today),
    trailer: (v: FleetVehicle) => v.trailer_plate,
    type: (v: FleetVehicle) => v.vehicle_type,
    body: (v: FleetVehicle) => v.body_type,
    payload: (v: FleetVehicle) => v.payload,
    home: (v: FleetVehicle) => v.home_driver?.name ?? null,
    registration: (v: FleetVehicle) => v.registration_expiry,
    insurance: (v: FleetVehicle) => v.insurance_expiry,
    note: (v: FleetVehicle) => v.note,
    created: (v: FleetVehicle) => v.created_at,
  }), [today]);
  const driverValue: Record<string, (d: FleetDriver) => string> = useMemo(() => ({
    status: (d) => d.status,
    truck: (d) => (d.current_vehicle ? d.current_vehicle.kind : 'none'),
    license: (d) => docState(driverDocs(d), today),
    license_class: (d) => d.license_class,
  }), [today]);
  const driverSortValue = useMemo(() => ({
    name: (d: FleetDriver) => d.name,
    status: (d: FleetDriver) => DRIVER_STATUSES.indexOf(d.status),
    truck: (d: FleetDriver) => d.current_vehicle?.plate ?? null,
    license: (d: FleetDriver) => soonestDays(driverDocs(d), today),
    phone: (d: FleetDriver) => d.phone,
    id_number: (d: FleetDriver) => d.id_number,
    license_no: (d: FleetDriver) => d.license_no,
    license_class: (d: FleetDriver) => d.license_class,
    license_expiry: (d: FleetDriver) => d.license_expiry,
    home: (d: FleetDriver) => d.home_vehicle?.plate ?? null,
    note: (d: FleetDriver) => d.note,
    created: (d: FleetDriver) => d.created_at,
  }), [today]);

  const sortedVehicles = useMemo(() => sortRows(applyColumnFilters(shownVehicles, vehicleCols, vehicleValue), vehicleSort.sort,
    vehicleSortValue), [shownVehicles, vehicleCols, vehicleValue, vehicleSort.sort, vehicleSortValue]);
  const sortedDrivers = useMemo(() => sortRows(applyColumnFilters(shownDrivers, driverCols, driverValue), driverSort.sort,
    driverSortValue), [shownDrivers, driverCols, driverValue, driverSort.sort, driverSortValue]);
  const vehiclePaging = usePaging(tableKeys.pageSize, JSON.stringify([query, vehicleFilter, vehicleCols, vehicleSort.sort]));
  const driverPaging = usePaging('fleet.drivers.pageSize', JSON.stringify([query, driverFilter, driverCols, driverSort.sort]));
  const pageVehicles = usePageRows(sortedVehicles, vehiclePaging.page, vehiclePaging.pageSize);
  const pageDrivers = usePageRows(sortedDrivers, driverPaging.page, driverPaging.pageSize);
  // ---- multi-select, like the booking table: rows that drop out of the search / filters drop out of the selection ----
  const vehicleSel = useRowSelection(sortedVehicles, (v: FleetVehicle) => v.id, [view]);
  const driverSel = useRowSelection(sortedDrivers, (d: FleetDriver) => d.id, [view]);
  const colFilterCount = view === 'vehicles' ? Object.values(vehicleCols).filter((v) => v.length).length
    : view === 'drivers' ? Object.values(driverCols).filter((v) => v.length).length
      : Object.values(historyCols).filter((v) => v.length).length;
  const clearColFilters = () => (view === 'vehicles' ? setVehicleCols({}) : view === 'drivers' ? setDriverCols({}) : setHistoryCols({}));

  /** A header cell that sorts, and filters when `options` is given. */
  const header = (
    key: string, label: string, sorter: ReturnType<typeof useTableSort>,
    filter?: { options: () => { carrier: string; count: number }[]; value: string[]; onChange: (v: string[]) => void;
      format: (v: string) => string; column?: string },
    size?: { width?: number; onResize?: (key: string, e: React.MouseEvent) => void },
  ) => (
    <ResizableTh key={key} colKey={key} label={label} className="px-4 py-2.5" sortDir={sorter.sortDirOf(key)} onSort={sorter.toggleSort}
      width={size?.width} onResize={size?.onResize}
      sortLabels={t.common.sort}
      extra={filter && (
        <ColumnValueFilter column={filter.column || label} loadOptions={async () => filter.options()} value={filter.value}
          onChange={filter.onChange} labels={t.common.columnFilter} formatOption={filter.format} />
      )} />
  );
  const setCol = (setter: React.Dispatch<React.SetStateAction<Record<string, string[]>>>, key: string) =>
    (values: string[]) => setter((prev) => ({ ...prev, [key]: values }));
  const T = f.table;

  // ---- column settings (Cấu hình cột): order, visibility, labels, widths — one per table ----
  const C = f.columns;
  const defaults = (keys: [string, string, boolean][]): ColumnDef[] => keys.map(([key, label, visible]) => ({ key, label, visible }));
  const vehicleDefaults = useMemo(() => defaults([
    ['plate', L.vehicle, true], ['status', L.status, true], ['driver', L.driver, true], ['docs', L.docs, true],
    // a tractor's trailer, a truck's body and payload
    ...(isTrucks
      ? [['body', C.body, true], ['payload', C.payload, false]] as [string, string, boolean][]
      : [['trailer', C.trailer, false]] as [string, string, boolean][]),
    ['type', C.type, false], ['home', C.home, false], ['registration', C.registration, false],
    ['insurance', C.insurance, false], ['note', C.note, false], ['created', C.created, false],
  ]), [L, C, isTrucks]);
  const driverDefaults = useMemo(() => defaults([
    ['name', L.driver, true], ['status', L.status, true], ['truck', L.truck, true], ['license', L.license, true],
    ['phone', C.phone, false], ['id_number', C.idNumber, false], ['license_no', C.licenseNo, false],
    ['license_class', C.licenseClass, false], ['license_expiry', C.licenseExpiry, false], ['home', C.homeVehicle, false],
    ['note', C.note, false], ['created', C.created, false],
  ]), [L, C]);
  const historyDefaults = useMemo(() => defaults([
    ['started_at', f.cols.started, true], ['ended_at', f.cols.ended, true], ['driver_name', f.cols.name, true],
    ['vehicle_plate', f.cols.vehicle, true], ['reason', f.cols.reason, true], ['end_reason', f.cols.endReason, true],
  ]), [f.cols]);
  const vehicleColumns = useColumnSettings({ storageKey: tableKeys.columns, defaultColumns: vehicleDefaults });
  const driverColumns = useColumnSettings({ storageKey: 'fleet_drivers_table', defaultColumns: driverDefaults });
  const historyColumns = useColumnSettings({ storageKey: 'fleet_history_table', defaultColumns: historyDefaults });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const activeColumns = view === 'vehicles' ? vehicleColumns : view === 'drivers' ? driverColumns : historyColumns;

  // ---- trash ----
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashCount, setTrashCount] = useState<FleetTrashCount>({ vehicle: 0, truck: 0, driver: 0, trailer: 0 });
  const loadTrashCount = useCallback(() => {
    getFleetTrashCountApi().then(setTrashCount).catch(() => {});
  }, []);
  useEffect(() => {
    loadTrashCount();
  }, [loadTrashCount]);
  const trashKind: 'vehicle' | 'truck' | 'driver' = view === 'drivers' ? 'driver' : isTrucks ? 'truck' : 'vehicle';
  const trashBadge = trashCount[trashKind];

  // ---- Excel export: every row that matches the search / filters / sort (not just this page), every column ----
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRows, setExportRows] = useState<Record<string, string | number>[]>([]);
  const [exporting, setExporting] = useState(false);
  const exportTab: ExportTab = view === 'vehicles' ? (isTrucks ? 'fleet_truck' : 'fleet_vehicle')
    : view === 'drivers' ? 'fleet_driver' : 'fleet_history';
  const exportPrefix = view === 'vehicles' ? (isTrucks ? 'xe_tai' : 'doi_xe') : view === 'drivers' ? 'tai_xe' : 'lich_su_phan_cong';
  const exportColumns = useMemo(() => [
    { key: 'STT', label: t.common.stt },
    ...activeColumns.columns.map((c) => ({ key: c.key, label: c.label })),
  ], [activeColumns.columns, t.common.stt]);

  const tempNote = (kind: 'primary' | 'temporary' | undefined) => (kind === 'temporary' ? ` (${f.kind.temporary.toLowerCase()})` : '');
  const vehicleText = (v: FleetVehicle): Record<string, string> => ({
    plate: v.plate,
    status: f.vehicleStatus[v.status],
    driver: v.current_driver ? v.current_driver.name + tempNote(v.current_driver.kind) : '',
    docs: T.docState[docState(vehicleDocs(v), today)],
    trailer: v.trailer_plate,
    body: v.body_type,
    payload: v.payload,
    type: v.vehicle_type,
    home: v.home_driver?.name || '',
    registration: formatIsoDate(v.registration_expiry),
    insurance: formatIsoDate(v.insurance_expiry),
    note: v.note,
    created: formatStampShort(v.created_at),
  });
  const driverText = (d: FleetDriver): Record<string, string> => ({
    name: d.name,
    status: f.driverStatus[d.status],
    truck: d.current_vehicle ? d.current_vehicle.plate + tempNote(d.current_vehicle.kind) : '',
    license: [[d.license_class, d.license_no].filter(Boolean).join(' · '), T.docState[docState(driverDocs(d), today)]]
      .filter(Boolean).join(' — '),
    phone: d.phone,
    id_number: d.id_number,
    license_no: d.license_no,
    license_class: d.license_class,
    license_expiry: formatIsoDate(d.license_expiry),
    home: d.home_vehicle?.plate || '',
    note: d.note,
    created: formatStampShort(d.created_at),
  });
  const historyText = (h: FleetAssignment): Record<string, string> => ({
    started_at: formatStampShort(h.started_at),
    ended_at: h.ended_at ? formatStampShort(h.ended_at) : f.stillOpen,
    driver_name: h.driver_name,
    vehicle_plate: h.vehicle_plate + tempNote(h.kind)
      + (h.kind === 'temporary' && h.home_vehicle_plate ? ` — ${tf(f.tempOf, { plate: h.home_vehicle_plate })}` : ''),
    reason: h.reason,
    end_reason: h.end_reason,
  });

  /** The whole filtered history, a server page at a time. */
  const allHistory = async (): Promise<FleetAssignment[]> => {
    const out: FleetAssignment[] = [];
    const size = 1000;
    for (let offset = 0; ; offset += size) {
      const res = await getFleetHistoryPageApi({
        driver_id: historyFilter?.driver_id, vehicle_id: historyFilter?.vehicle_id, category: historyCategory, kinds: historyCols.vehicle_plate,
        states: historyCols.ended_at, q: historyQuery.trim() || undefined, sort_by: historySort.sort?.key,
        sort_dir: historySort.sort?.dir, limit: size, offset,
      });
      out.push(...res.items);
      if (res.items.length < size || out.length >= res.total) return out;
    }
  };

  /** `selected`: only the picked rows (the bottom bar's "Xuất Excel đã chọn"). */
  const openExport = async (selected = false) => {
    setExporting(true);
    try {
      const rows: Record<string, string>[] = view === 'vehicles' ? (selected ? vehicleSel.selectedRows : sortedVehicles).map(vehicleText)
        : view === 'drivers' ? (selected ? driverSel.selectedRows : sortedDrivers).map(driverText) : (await allHistory()).map(historyText);
      // empty cells as the fleet tables show them ("—"), not the export's generic "null"
      const filled = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v || f.none])));
      setExportRows(filled.map((r, i) => ({ STT: i + 1, ...r })));
      setExportOpen(true);
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    } finally {
      setExporting(false);
    }
  };

  const returnHome = async (driverId: number, name: string) => {
    setBusyId(`d${driverId}`);
    try {
      const res = await returnDriverHomeApi(driverId);
      addToast(tf(f.toast.returned, { name, plate: res.current_vehicle?.plate || '' }), 'success');
      reload();
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    } finally {
      setBusyId(null);
    }
  };

  /** "Đã sửa xong": running again, and its own driver back on it from a temporary truck, in one step. */
  const markRepaired = async (v: FleetVehicle) => {
    setBusyId(`v${v.id}`);
    try {
      const res = await setFleetVehicleStatusApi(v.id, 'active', '', null, true);
      addToast(res.returned_driver ? tf(f.toast.repairedReturned, { plate: v.plate, name: res.returned_driver.name })
        : tf(f.toast.repaired, { plate: v.plate }), 'success');
      if (res.home_driver_away) {
        addToast(tf(f.toast.homeAway, { name: res.home_driver_away.name, plate: res.home_driver_away.plate }), 'info');
      }
      reload();
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const removeVehicle = async (v: FleetVehicle) => {
    if (!(await confirm({ message: tf(f.confirmDeleteVehicle, { plate: v.plate, days: TRASH_KEEP_DAYS }), confirmText: f.actions.delete, danger: true }))) return;
    try {
      await deleteFleetVehicleApi(v.id);
      addToast(f.toast.deleted, 'success');
      reload();
      loadTrashCount();
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    }
  };

  const removeDriver = async (d: FleetDriver) => {
    if (!(await confirm({ message: tf(f.confirmDeleteDriver, { name: d.name, days: TRASH_KEEP_DAYS }), confirmText: f.actions.delete, danger: true }))) return;
    try {
      await deleteFleetDriverApi(d.id);
      addToast(f.toast.deleted, 'success');
      reload();
      loadTrashCount();
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    }
  };

  // ---- the bottom bar: what to do with the picked rows ----
  const B = f.bulk;
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<'status' | 'delete' | null>(null);
  const report = (total: number, res: { ok: number; errors: string[] }, done: string) => {
    if (res.ok) addToast(tf(done, { count: res.ok }), 'success');
    if (res.errors.length) addToast(tf(B.failed, { count: total - res.ok, error: res.errors.join('; ') }), 'error');
  };
  const bulkCopy = async () => {
    const rows = view === 'vehicles' ? vehicleSel.selectedRows.map(vehicleText) : driverSel.selectedRows.map(driverText);
    const ok = await copyTextToClipboard(formatRowsAsTsv(rows, activeColumns.columns, true));
    addToast(ok ? tf(B.copied, { count: rows.length }) : f.toast.error, ok ? 'success' : 'error');
  };
  /** New status for some trucks / drivers: the bottom bar's selection, or the right-clicked row (with the selection it
   *  is part of). Rows already in it need nothing. A truck running again gets its own driver back ("Đã sửa xong"); one
   *  that stops drops the driver on it, who is named. */
  const applyStatus = async (kind: 'vehicle' | 'driver', ids: number[], status: string) => {
    setStatusPickerOpen(false);
    setBulkBusy('status');
    const rows: (FleetVehicle | FleetDriver)[] = kind === 'vehicle' ? allVs.filter((v) => ids.includes(v.id)) : ds.filter((d) => ids.includes(d.id));
    const todo = rows.filter((r) => r.status !== status);
    const off: string[] = [];
    const res = await runEach(todo, async (r) => {
      if (kind === 'driver') return updateFleetDriverApi(r.id, { status: status as DriverStatus });
      const out = await setFleetVehicleStatusApi(r.id, status as VehicleStatus, '', null, status === 'active');
      if (out.moved_driver && !out.moved_driver.to_vehicle_id) off.push(out.moved_driver.name);
      return out;
    }, f.toast.error);
    const label = kind === 'vehicle' ? f.vehicleStatus[status as VehicleStatus] : f.driverStatus[status as DriverStatus];
    const only = rows.length === 1 ? rows[0] : null;
    report(rows.length, { ok: res.ok + (rows.length - todo.length), errors: res.errors },
      only ? tf(B.statusOne, { name: 'plate' in only ? only.plate : only.name, status: label }) : B.statusDone);
    if (off.length) addToast(tf(B.driversOff, { names: off.join(', ') }), 'info');
    setBulkBusy(null);
    reload();
  };
  const bulkStatus = (status: string) =>
    applyStatus(view === 'vehicles' ? 'vehicle' : 'driver', [...(view === 'vehicles' ? vehicleSel : driverSel).selectedIds], status);
  const bulkDelete = async () => {
    const isVehicles = view === 'vehicles';
    const total = isVehicles ? vehicleSel.count : driverSel.count;
    if (!(await confirm({ message: tf(B.deleteConfirm, { count: total, days: TRASH_KEEP_DAYS }), confirmText: f.actions.delete, danger: true }))) return;
    setBulkBusy('delete');
    const res = isVehicles ? await runEach(vehicleSel.selectedRows, (v) => deleteFleetVehicleApi(v.id), f.toast.error)
      : await runEach(driverSel.selectedRows, (d) => deleteFleetDriverApi(d.id), f.toast.error);
    report(total, res, B.deleted);
    setBulkBusy(null);
    (isVehicles ? vehicleSel : driverSel).clear();
    reload();
    loadTrashCount();
  };
  const bulkActions: BulkAction[] = [
    { key: 'status', label: B.status, icon: ListChecks, onClick: () => setStatusPickerOpen(true), loading: bulkBusy === 'status' },
    { key: 'export', label: t.bulk.exportSelected, icon: FileSpreadsheet, onClick: () => void openExport(true), loading: exporting },
    { key: 'copy', label: t.bulk.copySelected, icon: Copy, onClick: () => void bulkCopy() },
    { key: 'delete', label: t.bulk.deleteSelected, icon: Trash2, onClick: () => void bulkDelete(), danger: true, loading: bulkBusy === 'delete' },
  ];
  const activeSel = view === 'vehicles' ? vehicleSel : view === 'drivers' ? driverSel : null;
  const selectHeader = <R extends { id: number },>(sel: ReturnType<typeof useRowSelection<R>>, page: R[]) => (
    <SelectHeader checked={sel.isPageAllSelected(page)} partial={sel.isPagePartiallySelected(page)} disabled={page.length === 0}
      onChange={() => sel.selectPage(page, !sel.isPageAllSelected(page))} />
  );

  /** The rows a right-click acts on: the selection when the row is part of one, else the row alone. */
  const menuTargets = (kind: 'vehicle' | 'driver', id: number) => {
    const sel = kind === 'vehicle' ? vehicleSel : driverSel;
    return sel.count > 1 && sel.isSelected(id) ? [...sel.selectedIds] : [id];
  };
  /** "Đổi trạng thái" in the row menu, like the booking table: one click, the current status greyed out. */
  const statusGroup = (kind: 'vehicle' | 'driver', row: FleetVehicle | FleetDriver): MenuGroup => {
    const ids = menuTargets(kind, row.id);
    const options = kind === 'vehicle'
      ? VEHICLE_STATUSES.map((s) => [s, f.vehicleStatus[s]] as const) : DRIVER_STATUSES.map((s) => [s, f.driverStatus[s]] as const);
    return {
      label: ids.length > 1 ? tf(B.statusTitle, { count: ids.length }) : B.status,
      items: options.map(([s, label]) => ({
        key: `status-${s}`, label, icon: ListChecks, disabled: ids.length === 1 && row.status === s,
        onClick: () => void applyStatus(kind, ids, s),
      })),
    };
  };

  // ---- one place for each row's actions: the right-click / "⋯" menu and the detail window use them alike ----
  const vehicleMain = (v: FleetVehicle): DetailAction | null =>
    v.status === 'active' ? { label: f.quick.report, icon: <Wrench className="w-4 h-4" />, onClick: () => setStatusFor(v), primary: true }
      : v.status === 'broken' || v.status === 'maintenance'
        ? { label: f.quick.repaired, icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => void markRepaired(v), primary: true }
        : null;
  const driverMain = (d: FleetDriver): DetailAction[] => {
    const move = { label: f.actions.move, icon: <ArrowLeftRight className="w-4 h-4" />, onClick: () => setMoveFor(d) };
    if (canReturnHome(d, allVs)) {
      return [move, { label: f.actions.returnHome, icon: <Undo2 className="w-4 h-4" />, onClick: () => void returnHome(d.id, d.name), primary: true }];
    }
    return d.status === 'left' ? [] : [{ ...move, primary: true }];
  };

  const vehicleMenu = (v: FleetVehicle): MenuGroup[] => {
    const main = vehicleMain(v);
    return [
      { label: v.plate, items: [
        { key: 'detail', label: f.detail.open, icon: Eye, onClick: () => setDetail({ kind: 'vehicle', id: v.id }) },
        ...(main ? [{ key: 'main', label: main.label, icon: v.status === 'active' ? Wrench : CheckCircle2, onClick: main.onClick }] : []),
      ] },
      statusGroup('vehicle', v),
      { items: [
        { key: 'edit', label: f.menu.edit, icon: Pencil, onClick: () => setVehicleForm({ open: true, vehicle: v }) },
        { key: 'history', label: f.menu.history, icon: History, onClick: () => showHistory({ vehicle_id: v.id, label: v.plate }) },
      ] },
      { items: [{ key: 'delete', label: f.menu.delete, icon: Trash2, danger: true, onClick: () => void removeVehicle(v) }] },
    ];
  };
  const driverMenu = (d: FleetDriver): MenuGroup[] => [
    { label: d.name, items: [
      { key: 'detail', label: f.detail.open, icon: Eye, onClick: () => setDetail({ kind: 'driver', id: d.id }) },
      ...(canReturnHome(d, allVs)
        ? [{ key: 'home', label: f.actions.returnHome, icon: Undo2, onClick: () => void returnHome(d.id, d.name) }] : []),
      ...(d.status !== 'left' ? [{ key: 'move', label: f.actions.move, icon: ArrowLeftRight, onClick: () => setMoveFor(d) }] : []),
    ] },
    statusGroup('driver', d),
    { items: [
      { key: 'edit', label: f.menu.edit, icon: Pencil, onClick: () => setDriverForm({ open: true, driver: d }) },
      { key: 'history', label: f.menu.history, icon: History, onClick: () => showHistory({ driver_id: d.id, label: d.name }) },
    ] },
    { items: [{ key: 'delete', label: f.menu.delete, icon: Trash2, danger: true, onClick: () => void removeDriver(d) }] },
  ];

  const menuVehicle = menu.state?.row.kind === 'vehicle' ? allVs.find((v) => v.id === menu.state!.row.id) : undefined;
  const menuDriver = menu.state?.row.kind === 'driver' ? ds.find((d) => d.id === menu.state!.row.id) : undefined;
  const menuGroups = menuVehicle ? vehicleMenu(menuVehicle) : menuDriver ? driverMenu(menuDriver) : [];

  const detailVehicle = detail?.kind === 'vehicle' ? allVs.find((v) => v.id === detail.id) : undefined;
  const detailDriver = detail?.kind === 'driver' ? ds.find((d) => d.id === detail.id) : undefined;
  const detailTarget: FleetDetailTarget | null = detailVehicle ? { kind: 'vehicle', item: detailVehicle }
    : detailDriver ? { kind: 'driver', item: detailDriver } : null;
  /** A truck's detail window: its main action, plus "Đổi trạng thái" for a stopped truck (or alone for one out of service). */
  const vehicleDetailActions = (v: FleetVehicle): DetailAction[] => {
    const status = { label: f.menu.status, icon: <Wrench className="w-4 h-4" />, onClick: () => setStatusFor(v) };
    const main = vehicleMain(v);
    if (!main) return [status];
    return v.status === 'active' ? [main] : [status, main];
  };
  const detailActions: DetailAction[] = detailVehicle ? vehicleDetailActions(detailVehicle)
    : detailDriver ? driverMain(detailDriver) : [];

  /** Right-click, the context-menu key or Shift+F10 open the row's menu; double-click or Enter its details. */
  const rowEvents = (row: RowRef) => ({
    tabIndex: 0,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      menu.open(row, e.clientX, e.clientY);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      if (!fromControl(e)) setDetail(row);
    },
    onMouseDown: (e: React.MouseEvent) => {
      if (e.detail > 1 && !fromControl(e)) e.preventDefault(); // no word selected by the double-click
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        setDetail(row);
      } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        menu.open(row, r.left + 24, r.top + r.height / 2);
      }
    },
  });

  const moreButton = (row: RowRef, label: string) => (
    <button type="button" aria-label={`${f.menu.more} · ${label}`} title={f.menu.more} aria-haspopup="menu"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu.open(row, r.left - 160, r.bottom + 4);
      }}
      className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800">
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );

  const tabs: { id: View; label: string; count?: number }[] = [
    screen !== 'drivers'
      ? { id: 'vehicles', label: isTrucks ? f.views.trucks : f.views.vehicles, count: vehicles ? vs.length : undefined }
      : { id: 'drivers', label: f.views.drivers, count: drivers?.length },
    { id: 'history', label: f.views.history },
  ];
  const head = f.screens[screen];

  const filterTone = {
    neutral: 'text-slate-600 dark:text-slate-300',
    green: 'text-emerald-700 dark:text-emerald-300',
    red: 'text-rose-700 dark:text-rose-300',
    amber: 'text-amber-800 dark:text-amber-300',
    sky: 'text-sky-700 dark:text-sky-300',
  };
  const filterChips: { id: string; label: string; count: number; tone: string; active: boolean; select: () => void }[] =
    view === 'vehicles'
      ? ([
        ['all', f.filters.all, filterTone.neutral], ['running', f.filters.running, filterTone.green], ['down', f.filters.down, filterTone.red],
        ['free', f.filters.free, filterTone.sky], ['expiring', f.filters.expiring, filterTone.amber],
      ] as [VehicleFilter, string, string][]).map(([id, label, tone]) => ({
        id, label, tone, count: vs.filter(vehicleTest[id]).length, active: vehicleFilter === id, select: () => setVehicleFilter(id),
      }))
      : view === 'drivers'
        ? ([
          ['all', f.filters.all, filterTone.neutral], ['idle', f.filters.idle, filterTone.neutral],
          ['temporary', f.filters.temporary, filterTone.sky], ['expiring', f.filters.expiring, filterTone.amber],
        ] as [DriverFilter, string, string][]).map(([id, label, tone]) => ({
          id, label, tone, count: ds.filter(driverTest[id]).length, active: driverFilter === id, select: () => setDriverFilter(id),
        }))
        : [];

  const empty = (text: string) => (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400">
      <Truck className="w-9 h-9 text-slate-300 dark:text-slate-600" />
      {text}
    </div>
  );

  // ---- tables: each column is a spec (header + cell); which ones show, in what order, under what label and how wide
  //      is the user's (Cấu hình cột, remembered per table) ----
  type Spec<R> = {
    render: (row: R) => React.ReactNode;
    td?: string;
    filter?: Parameters<typeof header>[3];
    sortable?: boolean;
  };
  const dateCell = (iso: string, muted: boolean) => (
    <DateCell iso={iso} today={today} muted={muted} />
  );
  const plainCell = (text: string) => text ? <span className="text-slate-700 dark:text-slate-200">{text}</span>
    : <span className="text-slate-300 dark:text-slate-600">{f.none}</span>;

  const vehicleSpecs: Record<string, Spec<FleetVehicle>> = {
    plate: {
      filter: { column: T.type, options: () => valueCounts(shownVehicles, vehicleValue.plate), value: vehicleCols.plate || [],
        onChange: setCol(setVehicleCols, 'plate'), format: (v) => v || t.common.columnFilter.empty },
      render: (v) => {
        const sub = (v.category === 'truck' ? [v.vehicle_type, v.body_type, v.payload]
          : [v.vehicle_type, v.trailer_plate ? tf(L.trailer, { plate: v.trailer_plate }) : '']).filter(Boolean).join(' · ');
        return (
          <div className="flex items-center gap-3">
            <FleetAvatar photo={v.photo} kind="vehicle" name={v.plate} size="wide" onClick={openPhoto(v.photo, v.plate)} />
            <div className="min-w-0">
              <div className="font-bold text-[15px] text-slate-900 dark:text-slate-100 whitespace-nowrap">{v.plate}<NoteIcon note={v.note} /></div>
              {sub && <div className={`${MUTED} truncate max-w-[16rem]`}>{sub}</div>}
            </div>
          </div>
        );
      },
    },
    status: {
      filter: { options: () => valueCounts(shownVehicles, vehicleValue.status, [...VEHICLE_STATUSES]), value: vehicleCols.status || [],
        onChange: setCol(setVehicleCols, 'status'), format: (v) => f.vehicleStatus[v as VehicleStatus] ?? v },
      render: (v) => <StatusBadge tone={VEHICLE_TONE[v.status]}>{f.vehicleStatus[v.status]}</StatusBadge>,
    },
    driver: {
      filter: { options: () => valueCounts(shownVehicles, vehicleValue.driver, ['primary', 'temporary', 'none']), value: vehicleCols.driver || [],
        onChange: setCol(setVehicleCols, 'driver'), format: (v) => T.driverState[v as keyof typeof T.driverState] ?? v },
      render: (v) => {
        const c = v.current_driver;
        const h = v.home_driver;
        if (c) {
          return (
            <div className="flex items-center gap-2.5">
              <FleetAvatar photo={c.photo} kind="driver" name={c.name} size="sm" onClick={openPhoto(c.photo, c.name)} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{c.name}</span>
                  {c.kind === 'temporary' && <Chip tone={TEMP_CHIP}>{f.kind.temporary}</Chip>}
                </div>
                {c.phone && <div className={MUTED}>{c.phone}</div>}
              </div>
            </div>
          );
        }
        if (!h) return <span className="text-sm text-slate-400 dark:text-slate-500">{f.noDriver}</span>;
        return (
          <div className={MUTED}>
            <div className="text-sm text-slate-400 dark:text-slate-500">{f.noDriver}</div>
            {h.driving_vehicle_id && h.driving_vehicle_id !== v.id
              ? <span className="text-sky-700 dark:text-sky-300">{tf(L.ownerAway, { name: h.name, plate: h.driving_plate })}</span>
              : h.status !== 'active' ? tf(L.ownerStatus, { name: h.name, status: f.driverStatus[h.status].toLowerCase() })
                : tf(L.owner, { name: h.name })}
          </div>
        );
      },
    },
    docs: {
      filter: { options: () => valueCounts(shownVehicles, vehicleValue.docs, DOC_STATES), value: vehicleCols.docs || [],
        onChange: setCol(setVehicleCols, 'docs'), format: (v) => T.docState[v as DocState] ?? v },
      render: (v) => <DocsCell entries={vehicleDocs(v)} today={today} muted={v.status === 'inactive'} />,
    },
    trailer: { td: 'whitespace-nowrap font-mono text-xs', render: (v) => plainCell(v.trailer_plate) },
    body: { td: 'whitespace-nowrap', render: (v) => plainCell(v.body_type) },
    payload: { td: 'whitespace-nowrap', render: (v) => plainCell(v.payload) },
    type: { render: (v) => plainCell(v.vehicle_type) },
    home: { render: (v) => plainCell(v.home_driver?.name || '') },
    registration: { render: (v) => dateCell(v.registration_expiry, v.status === 'inactive') },
    insurance: { render: (v) => dateCell(v.insurance_expiry, v.status === 'inactive') },
    note: { td: 'max-w-[18rem]', render: (v) => <span className="line-clamp-2 text-slate-600 dark:text-slate-300">{v.note || f.none}</span> },
    created: { td: 'whitespace-nowrap tabular-nums', render: (v) => plainCell(formatStampShort(v.created_at)) },
  };

  const driverSpecs: Record<string, Spec<FleetDriver>> = {
    name: {
      render: (d) => (
        <div className="flex items-center gap-3">
          <FleetAvatar photo={d.photo} kind="driver" name={d.name} size="md" onClick={openPhoto(d.photo, d.name)} />
          <div className="min-w-0">
            <div className="font-bold text-[15px] text-slate-900 dark:text-slate-100 whitespace-nowrap">{d.name}<NoteIcon note={d.note} /></div>
            {d.phone && <div className={MUTED}>{d.phone}</div>}
          </div>
        </div>
      ),
    },
    status: {
      filter: { options: () => valueCounts(shownDrivers, driverValue.status, [...DRIVER_STATUSES]), value: driverCols.status || [],
        onChange: setCol(setDriverCols, 'status'), format: (v) => f.driverStatus[v as DriverStatus] ?? v },
      render: (d) => <StatusBadge tone={DRIVER_TONE[d.status]}>{f.driverStatus[d.status]}</StatusBadge>,
    },
    truck: {
      filter: { options: () => valueCounts(shownDrivers, driverValue.truck, ['primary', 'temporary', 'none']), value: driverCols.truck || [],
        onChange: setCol(setDriverCols, 'truck'), format: (v) => T.truckState[v as keyof typeof T.truckState] ?? v },
      render: (d) => {
        const c = d.current_vehicle;
        const home = d.home_vehicle;
        const homeLine = home ? (home.status !== 'active'
          ? tf(L.homeWithStatus, { plate: home.plate, status: f.vehicleStatus[home.status].toLowerCase() })
          : tf(L.tempHome, { plate: home.plate })) : '';
        if (!c) {
          return (
            <div className={MUTED}>
              <div className="text-sm text-slate-400 dark:text-slate-500">{f.noVehicle}</div>
              {homeLine}
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2.5">
            <FleetAvatar photo={c.photo} kind="vehicle" name={c.plate} size="wideSm" onClick={openPhoto(c.photo, c.plate)} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{c.plate}</span>
                {c.category === 'truck' && <Chip tone={TRUCK_CHIP}>{f.truckChip}</Chip>}
                {c.kind === 'temporary' && <Chip tone={TEMP_CHIP}>{f.kind.temporary}</Chip>}
              </div>
              <div className={MUTED}>{c.kind === 'temporary' ? homeLine : c.trailer_plate ? tf(L.trailer, { plate: c.trailer_plate }) : ''}</div>
            </div>
          </div>
        );
      },
    },
    license: {
      filter: { options: () => valueCounts(shownDrivers, driverValue.license, DOC_STATES), value: driverCols.license || [],
        onChange: setCol(setDriverCols, 'license'), format: (v) => T.docState[v as DocState] ?? v },
      render: (d) => {
        const licence = [d.license_class, d.license_no].filter(Boolean).join(' · ');
        return (
          <div className="space-y-1">
            {licence && <div className="text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">{licence}</div>}
            <DocsCell entries={driverDocs(d)} today={today} muted={d.status === 'left'} />
          </div>
        );
      },
    },
    phone: { td: 'whitespace-nowrap', render: (d) => plainCell(d.phone) },
    id_number: { td: 'whitespace-nowrap tabular-nums', render: (d) => plainCell(d.id_number) },
    license_no: { td: 'whitespace-nowrap tabular-nums', render: (d) => plainCell(d.license_no) },
    license_class: {
      filter: { options: () => valueCounts(shownDrivers, driverValue.license_class), value: driverCols.license_class || [],
        onChange: setCol(setDriverCols, 'license_class'), format: (v) => v || t.common.columnFilter.empty },
      render: (d) => plainCell(d.license_class),
    },
    license_expiry: { render: (d) => dateCell(d.license_expiry, d.status === 'left') },
    home: { td: 'whitespace-nowrap', render: (d) => plainCell(d.home_vehicle?.plate || '') },
    note: { td: 'max-w-[18rem]', render: (d) => <span className="line-clamp-2 text-slate-600 dark:text-slate-300">{d.note || f.none}</span> },
    created: { td: 'whitespace-nowrap tabular-nums', render: (d) => plainCell(formatStampShort(d.created_at)) },
  };

  // filtered on the server: the choices are fixed and their counts unknown (-1: not shown)
  const fixed = (values: string[]) => () => values.map((v) => ({ carrier: v, count: -1 }));
  const historySpecs: Record<string, Spec<FleetAssignment>> = {
    started_at: { td: 'whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-200', render: (h) => formatStampShort(h.started_at) },
    ended_at: {
      td: 'whitespace-nowrap tabular-nums',
      filter: { options: fixed(['open', 'closed']), value: historyCols.ended_at || [], onChange: setCol(setHistoryCols, 'ended_at'),
        format: (v) => T.historyState[v as 'open' | 'closed'] ?? v },
      render: (h) => (h.ended_at ? <span className="text-slate-700 dark:text-slate-200">{formatStampShort(h.ended_at)}</span>
        : <StatusBadge tone={VEHICLE_TONE.active}>{f.stillOpen}</StatusBadge>),
    },
    driver_name: { td: 'font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap', render: (h) => h.driver_name },
    vehicle_plate: {
      td: 'whitespace-nowrap',
      filter: { options: fixed(['primary', 'temporary']), value: historyCols.vehicle_plate || [],
        onChange: setCol(setHistoryCols, 'vehicle_plate'), format: (v) => f.kind[v as 'primary' | 'temporary'] ?? v },
      render: (h) => (
        <>
          <span className="font-semibold text-slate-800 dark:text-slate-100">{h.vehicle_plate}</span>
          {h.kind === 'temporary' && <span className="ml-1.5"><Chip tone={TEMP_CHIP}>{f.kind.temporary}</Chip></span>}
          {h.kind === 'temporary' && h.home_vehicle_plate && <div className={MUTED}>{tf(f.tempOf, { plate: h.home_vehicle_plate })}</div>}
        </>
      ),
    },
    reason: { td: 'text-slate-600 dark:text-slate-300', render: (h) => h.reason || f.none },
    end_reason: { td: 'text-slate-600 dark:text-slate-300', render: (h) => h.end_reason || (h.ended_at ? f.none : '') },
  };

  type Settings = ReturnType<typeof useColumnSettings>;
  /** The header row of a table, from its column settings (visible columns, their order, labels and widths). */
  const headerRow = <R,>(settings: Settings, specs: Record<string, Spec<R>>, sorter: ReturnType<typeof useTableSort>, actions: boolean,
    select?: React.ReactNode) => (
    <tr>
      {select}
      {settings.columns.filter((c) => c.visible && specs[c.key]).map((c) =>
        header(c.key, c.label, sorter, specs[c.key].filter, { width: settings.columnWidths[c.key], onResize: settings.startResize }))}
      {actions && <th className={TH}><span className="sr-only">{f.cols.actions}</span></th>}
    </tr>
  );
  const cells = <R,>(settings: Settings, specs: Record<string, Spec<R>>, row: R) =>
    settings.columns.filter((c) => c.visible && specs[c.key]).map((c) => (
      <td key={c.key} className={`${TD} ${specs[c.key].td || ''}`}
        style={settings.columnWidths[c.key] ? { maxWidth: settings.columnWidths[c.key] } : undefined}>
        {specs[c.key].render(row)}
      </td>
    ));
  const visibleCount = (settings: Settings, specs: Record<string, unknown>) =>
    settings.columns.filter((c) => c.visible && specs[c.key]).length;
  const THEAD = 'sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800';
  const emptyRow = (span: number, text: string) => (
    <tbody><tr><td colSpan={span} className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">{text}</td></tr></tbody>
  );

  const vehicleTable = () => {
    if (vs.length === 0) return empty(isTrucks ? f.empty.trucks : f.empty.vehicles);
    return (
      <table className="min-w-full text-sm">
        <thead className={THEAD}>{headerRow(vehicleColumns, vehicleSpecs, vehicleSort, true, selectHeader(vehicleSel, pageVehicles))}</thead>
        {pageVehicles.length === 0 && emptyRow(visibleCount(vehicleColumns, vehicleSpecs) + 2,
          vehicleFilter !== 'all' || colFilterCount ? f.filters.empty : f.empty.search)}
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {pageVehicles.map((v) => {
            const down = v.status === 'broken' || v.status === 'maintenance';
            return (
              <tr key={v.id} data-testid={`vehicle-${v.id}`} {...rowEvents({ kind: 'vehicle', id: v.id })}
                className={`${ROW} ${rowTone(vehicleSel.isSelected(v.id), menu.state?.row.kind === 'vehicle' && menu.state.row.id === v.id)} ${v.status === 'inactive' ? 'opacity-60' : ''}`}>
                <SelectCell checked={vehicleSel.isSelected(v.id)} label={tf(B.rowLabel, { name: v.plate })}
                  onToggle={(shift) => vehicleSel.toggle(v.id, shift)} />
                {cells(vehicleColumns, vehicleSpecs, v)}
                <td className={`${TD} text-right whitespace-nowrap w-0`}>
                  <div className="inline-flex items-center gap-1">
                    {v.status === 'active' && (
                      <button type="button" onClick={() => setStatusFor(v)}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50/60 dark:hover:bg-amber-950/20">
                        <Wrench className="w-3.5 h-3.5" />{f.quick.report}
                      </button>
                    )}
                    {down && (
                      <button type="button" onClick={() => void markRepaired(v)} disabled={busyId === `v${v.id}`}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
                        {busyId === `v${v.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        {f.quick.repaired}
                      </button>
                    )}
                    {moreButton({ kind: 'vehicle', id: v.id }, v.plate)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const driverTable = () => {
    if (ds.length === 0) return empty(f.empty.drivers);
    return (
      <table className="min-w-full text-sm">
        <thead className={THEAD}>{headerRow(driverColumns, driverSpecs, driverSort, true, selectHeader(driverSel, pageDrivers))}</thead>
        {pageDrivers.length === 0 && emptyRow(visibleCount(driverColumns, driverSpecs) + 2,
          driverFilter !== 'all' || colFilterCount ? f.filters.empty : f.empty.search)}
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {pageDrivers.map((d) => {
            const back = canReturnHome(d, allVs);
            return (
              <tr key={d.id} data-testid={`driver-${d.id}`} {...rowEvents({ kind: 'driver', id: d.id })}
                className={`${ROW} ${rowTone(driverSel.isSelected(d.id), menu.state?.row.kind === 'driver' && menu.state.row.id === d.id)} ${d.status === 'left' ? 'opacity-60' : ''}`}>
                <SelectCell checked={driverSel.isSelected(d.id)} label={tf(B.rowLabel, { name: d.name })}
                  onToggle={(shift) => driverSel.toggle(d.id, shift)} />
                {cells(driverColumns, driverSpecs, d)}
                <td className={`${TD} text-right whitespace-nowrap w-0`}>
                  <div className="inline-flex items-center gap-1">
                    {back ? (
                      <button type="button" onClick={() => void returnHome(d.id, d.name)} disabled={busyId === `d${d.id}`}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-60">
                        <Undo2 className="w-3.5 h-3.5" />{f.actions.returnHome}
                      </button>
                    ) : d.status !== 'left' && (
                      <button type="button" onClick={() => setMoveFor(d)}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                        <ArrowLeftRight className="w-3.5 h-3.5" />{f.actions.move}
                      </button>
                    )}
                    {moreButton({ kind: 'driver', id: d.id }, d.name)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const historyTable = () => {
    if (!history) return <div className="flex-1 flex justify-center items-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>;
    return (
      <table className="min-w-full text-sm">
        <thead className={THEAD}>{headerRow(historyColumns, historySpecs, historySort, false)}</thead>
        {history.items.length === 0 && emptyRow(visibleCount(historyColumns, historySpecs),
          historyQuery || colFilterCount ? f.filters.empty : f.empty.history)}
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {history.items.map((h) => (
            <tr key={h.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">{cells(historyColumns, historySpecs, h)}</tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-4 gap-2.5 bg-slate-50/50 dark:bg-slate-950/50" data-testid="fleet-tab">
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
        {view !== 'history' ? (
          <div role="group" aria-label={f.filters.label} className="flex flex-wrap items-center gap-1.5">
            {vehicles && filterChips.filter((c) => c.id === 'all' || c.count > 0 || c.active).map((c) => (
              <button key={c.id} type="button" aria-pressed={c.active} onClick={c.select}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold border transition-colors ${c.active
                  ? 'border-primary-500 bg-primary-600 text-white'
                  : `border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600 ${c.tone}`}`}>
                {c.label}
                <span className={`min-w-[1.25rem] px-1 rounded-full text-[11px] ${c.active ? 'bg-white/25' : 'bg-slate-100 dark:bg-slate-800'}`}>{c.count}</span>
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
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={head.search} aria-label={head.search}
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
            <button type="button" onClick={() => void openExport(false)} disabled={exporting || (view === 'vehicles' ? !vs.length : view === 'drivers' ? !ds.length : !history?.total)}
              title={f.exportHint} aria-label={t.common.exportExcel}
              className="inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50">
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}<span className="hidden min-[1900px]:inline">{t.common.exportExcel}</span>
            </button>
            <button type="button" onClick={() => setColumnsOpen(true)} title={f.columns.tooltip} aria-label={t.common.columnsConfig}
              className="inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              <SlidersHorizontal className="w-3.5 h-3.5" /><span className="hidden min-[1900px]:inline">{t.common.columnsConfig}</span>
            </button>
            {view !== 'history' && (
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
          {view !== 'history' && (
            <button type="button"
              onClick={() => (view === 'vehicles' ? setVehicleForm({ open: true, vehicle: null }) : setDriverForm({ open: true, driver: null }))}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white shadow-sm whitespace-nowrap">
              <Plus className="w-4 h-4" />
              {view === 'vehicles' ? (isTrucks ? f.actions.addTruck : f.actions.addVehicle) : f.actions.addDriver}
            </button>
          )}
        </div>
      </div>

      {/* Needs a hand: home drivers who can go back to their truck */}
      {away.map((v) => (
        <div key={v.id} role="status"
          className="flex flex-wrap items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30 text-sm text-sky-800 dark:text-sky-200 shrink-0">
          <Undo2 className="w-4 h-4 shrink-0" />
          <span className="mr-auto">{tf(f.awayBanner, { plate: v.plate, name: v.home_driver!.name, temp: v.home_driver!.driving_plate })}</span>
          <button type="button" onClick={() => void returnHome(v.home_driver!.id, v.home_driver!.name)}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white">
            {f.actions.returnHome}
          </button>
        </div>
      ))}

      {failed ? (
        <div role="alert" className="flex items-center justify-between gap-2 p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300">
          <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{f.loadFailed}</span>
          <button type="button" onClick={reload} className="font-bold underline">{f.retry}</button>
        </div>
      ) : !vehicles || !drivers ? (
        <div className="flex-1 flex justify-center items-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
          <div className="flex-1 min-h-0 flex flex-col overflow-auto">
            {view === 'vehicles' ? vehicleTable() : view === 'drivers' ? driverTable() : historyTable()}
          </div>
          {view === 'vehicles' && vs.length > 0 && (
            <Pagination currentPage={vehiclePaging.page} totalItems={sortedVehicles.length} pageSize={vehiclePaging.pageSize}
              onPageChange={vehiclePaging.setPage} onPageSizeChange={vehiclePaging.setPageSize} pageSizeOptions={PAGE_SIZE_OPTIONS}
              className="border-t border-slate-200 dark:border-slate-800" />
          )}
          {view === 'drivers' && ds.length > 0 && (
            <Pagination currentPage={driverPaging.page} totalItems={sortedDrivers.length} pageSize={driverPaging.pageSize}
              onPageChange={driverPaging.setPage} onPageSizeChange={driverPaging.setPageSize} pageSizeOptions={PAGE_SIZE_OPTIONS}
              className="border-t border-slate-200 dark:border-slate-800" />
          )}
          {view === 'history' && history && history.total > 0 && (
            <Pagination currentPage={historyPaging.page} totalItems={history.total} pageSize={historyPaging.pageSize}
              onPageChange={historyPaging.setPage} onPageSizeChange={historyPaging.setPageSize} pageSizeOptions={PAGE_SIZE_OPTIONS}
              className="border-t border-slate-200 dark:border-slate-800" />
          )}
        </div>
      )}

      {/* first: whatever it opens (edit, status, move) stacks on top of it */}
      <FleetDetailModal target={detailTarget} onClose={() => setDetail(null)} actions={detailActions} onChanged={reload}
        onOpenPhoto={(photo, name) => setViewing({ photo, name })}
        onShowHistory={() => {
          const row = detailTarget;
          setDetail(null);
          if (row) showHistory(row.kind === 'vehicle' ? { vehicle_id: row.item.id, label: row.item.plate } : { driver_id: row.item.id, label: row.item.name });
        }}
        onEdit={() => {
          if (detailVehicle) setVehicleForm({ open: true, vehicle: detailVehicle });
          if (detailDriver) setDriverForm({ open: true, driver: detailDriver });
        }} />
      <VehicleFormModal isOpen={vehicleForm.open} vehicle={vehicleForm.vehicle} category={category}
        onClose={() => setVehicleForm({ open: false, vehicle: null })} onSaved={reload} />
      <DriverFormModal isOpen={driverForm.open} driver={driverForm.driver} vehicles={allVs}
        onClose={() => setDriverForm({ open: false, driver: null })} onSaved={reload} />
      <VehicleStatusModal vehicle={statusFor} vehicles={allVs} onClose={() => setStatusFor(null)} onSaved={reload} />
      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} data={exportRows} allColumns={exportColumns}
        tab={exportTab} filenamePrefix={exportPrefix} />
      <ColumnConfigModal isOpen={columnsOpen} onClose={() => setColumnsOpen(false)} columns={activeColumns.columns}
        onChange={activeColumns.setColumns} onReset={activeColumns.resetColumns} />
      <FleetTrashModal kind={trashKind} isOpen={trashOpen} onClose={() => setTrashOpen(false)}
        onChanged={() => { reload(); loadTrashCount(); }} />
      {activeSel && (
        <BulkActionBar count={activeSel.count} onClear={activeSel.clear} actions={bulkActions} extra={
          !activeSel.isAllSelected ? (
            <button type="button" onClick={() => activeSel.selectAll(true)}
              className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">
              {tf(t.bulk.selectAllResults, { count: view === 'vehicles' ? sortedVehicles.length : sortedDrivers.length })}
            </button>
          ) : undefined
        } />
      )}
      <StatusPickerModal open={statusPickerOpen} onClose={() => setStatusPickerOpen(false)} onPick={(s) => void bulkStatus(s)}
        title={tf(B.statusTitle, { count: activeSel?.count || 0 })} hint={view === 'vehicles' ? B.vehicleHint : B.driverHint}
        options={view === 'vehicles'
          ? VEHICLE_STATUSES.map((s) => ({ value: s, label: f.vehicleStatus[s], dot: VEHICLE_TONE[s].dot }))
          : DRIVER_STATUSES.map((s) => ({ value: s, label: f.driverStatus[s], dot: DRIVER_TONE[s].dot }))} />
      <RowContextMenu position={menu.state && menuGroups.length ? { x: menu.state.x, y: menu.state.y } : null}
        groups={menuGroups} onClose={menu.close} />
      <PhotoLightbox photo={viewing?.photo || null} name={viewing?.name || ''} onClose={closeViewer} />
      <DriverMoveModal driver={moveFor} vehicles={allVs} onClose={() => setMoveFor(null)} onSaved={reload} />
    </div>
  );
};
