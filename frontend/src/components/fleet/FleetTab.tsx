import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, Eye, History, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Search, StickyNote,
  Trash2, Truck, Undo2, Wrench, X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { tf } from '../../services/i18nFormat';
import {
  deleteFleetDriverApi, deleteFleetVehicleApi, getFleetDriversApi, getFleetHistoryApi, getFleetVehiclesApi, returnDriverHomeApi,
  setFleetVehicleStatusApi,
} from '../../services/api';
import type { DriverStatus, FleetAssignment, FleetDocumentKind, FleetDriver, FleetVehicle, VehicleStatus } from '../../types';
import { daysLeftText } from '../common/ReminderViews';
import { DriverFormModal, DriverMoveModal, VehicleFormModal, VehicleStatusModal } from './FleetModals';
import { FleetAvatar, PhotoLightbox } from './FleetPhoto';
import { RowContextMenu, useRowContextMenu, type MenuGroup } from '../common/RowContextMenu';
import { FleetDetailModal, type DetailAction, type FleetDetailTarget } from './FleetDetailModal';
import {
  EXPIRY_WARN_DAYS, apiError, awayHomeDrivers, canReturnHome, daysUntil, formatIsoDate, formatStampShort, matches, todayVnIso,
} from './fleetUtils';

type View = 'vehicles' | 'drivers' | 'history';
type HistoryFilter = { driver_id?: number; vehicle_id?: number; label: string } | null;
type VehicleFilter = 'all' | 'running' | 'down' | 'free' | 'expiring';
type DriverFilter = 'all' | 'idle' | 'temporary' | 'expiring';
type RowRef = { kind: 'vehicle' | 'driver'; id: number };

const VIEW_KEY = 'fleet.view';

const VEHICLE_TONE: Record<VehicleStatus, { badge: string; dot: string }> = {
  active: { badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  broken: { badge: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300', dot: 'bg-rose-500' },
  maintenance: { badge: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300', dot: 'bg-amber-500' },
  inactive: { badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' },
};
const DRIVER_TONE: Record<DriverStatus, { badge: string; dot: string }> = {
  active: { badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  leave: { badge: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300', dot: 'bg-amber-500' },
  left: { badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' },
};
const TEMP_CHIP = 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300';

const StatusBadge: React.FC<{ tone: { badge: string; dot: string }; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full pl-2 pr-2.5 py-1 text-xs font-semibold ${tone.badge}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
    {children}
  </span>
);

const Chip: React.FC<{ tone: string; children: React.ReactNode; title?: string }> = ({ tone, children, title }) => (
  <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
    {children}
  </span>
);

const readView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'drivers' || v === 'history' ? v : 'vehicles';
  } catch {
    return 'vehicles';
  }
};

const TH = 'px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap';
const TD = 'px-4 py-3 align-middle';
const MUTED = 'text-xs text-slate-500 dark:text-slate-400';
const ROW = 'cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500';

/** A double-click on a button / link inside a row is that control's, not the row's. */
const fromControl = (e: React.SyntheticEvent) => !!(e.target as HTMLElement).closest('button, a, input, select, textarea');

interface DocWarning { kind: FleetDocumentKind; days: number; date: string }

/** Documents of a truck / driver that are expired or expire within the reminder window, soonest first. */
function docWarnings(entries: [FleetDocumentKind, string][], today: string): DocWarning[] {
  return entries
    .map(([kind, iso]) => ({ kind, days: daysUntil(iso, today), date: iso }))
    .filter((d): d is DocWarning => d.days !== null && d.days <= EXPIRY_WARN_DAYS)
    .sort((a, b) => a.days - b.days);
}

/** One cell for all of a row's documents: a green "Còn hạn", or the ones needing attention. Dates in the tooltip. */
const DocsCell: React.FC<{ entries: [FleetDocumentKind, string][]; today: string; muted?: boolean }> = ({ entries, today, muted }) => {
  const { t } = useApp();
  const names = t.notifications.reminder.fleetDocs;
  const title = entries.map(([kind, iso]) => `${names[kind]}: ${iso ? formatIsoDate(iso) : t.fleet.none}`).join('\n');
  if (!entries.some(([, iso]) => iso)) return <span className={MUTED} title={title}>{t.fleet.list.noDates}</span>;
  const warnings = muted ? [] : docWarnings(entries, today);
  if (warnings.length === 0) {
    return (
      <span title={title} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />{t.fleet.list.docsOk}
      </span>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1" title={title}>
      {warnings.map((w) => (
        <Chip key={w.kind} tone={w.days < 0 ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
          : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}>
          {names[w.kind]} · {daysLeftText(w.days, t).toLowerCase()}
        </Chip>
      ))}
    </div>
  );
};

const NoteIcon: React.FC<{ note: string }> = ({ note }) => {
  const { t } = useApp();
  if (!note.trim()) return null;
  const label = tf(t.fleet.list.noteTitle, { note });
  return <StickyNote aria-label={label} className="inline w-3.5 h-3.5 ml-1.5 text-slate-400"><title>{label}</title></StickyNote>;
};

interface Props {
  initialSearchQuery?: string;
}

/** Trucks, drivers and who drives what, as compact tables: one obvious action per row ("Báo hư" / "Đã sửa xong" /
 *  "Trả về xe gốc" / "Đổi xe") and the rest in a "⋯" menu. Fleet data is company-wide (no collection). */
export const FleetTab: React.FC<Props> = ({ initialSearchQuery }) => {
  const { t } = useApp();
  const { addToast } = useToastActions();
  const confirm = useConfirm();
  const f = t.fleet;
  const L = f.list;
  const [view, setView] = useState<View>(readView);
  const [vehicles, setVehicles] = useState<FleetVehicle[] | null>(null);
  const [drivers, setDrivers] = useState<FleetDriver[] | null>(null);
  const [history, setHistory] = useState<FleetAssignment[] | null>(null);
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

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getFleetHistoryApi({
        driver_id: historyFilter?.driver_id, vehicle_id: historyFilter?.vehicle_id, limit: 500,
      }));
    } catch {
      setHistory([]);
    }
  }, [historyFilter]);

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
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* only a convenience */
    }
  };

  const showHistory = (filter: HistoryFilter) => {
    setHistoryFilter(filter);
    setView('history');
  };

  const vs = vehicles || [];
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
    v.vehicle_type, v.note, v.current_driver?.name, v.home_driver?.name)), [vs, query, vehicleFilter, vehicleTest]);
  const shownDrivers = useMemo(() => ds.filter((d) => driverTest[driverFilter](d) && matches(query, d.name, d.phone, d.id_number,
    d.license_no, d.note, d.home_vehicle?.plate, d.current_vehicle?.plate)), [ds, query, driverFilter, driverTest]);
  const shownHistory = useMemo(() => (history || []).filter((h) => matches(query, h.driver_name, h.vehicle_plate,
    h.home_vehicle_plate, h.reason, h.end_reason)), [history, query]);

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
    if (!(await confirm({ message: tf(f.confirmDeleteVehicle, { plate: v.plate }), confirmText: f.actions.delete, danger: true }))) return;
    try {
      await deleteFleetVehicleApi(v.id);
      addToast(f.toast.deleted, 'success');
      reload();
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    }
  };

  const removeDriver = async (d: FleetDriver) => {
    if (!(await confirm({ message: tf(f.confirmDeleteDriver, { name: d.name }), confirmText: f.actions.delete, danger: true }))) return;
    try {
      await deleteFleetDriverApi(d.id);
      addToast(f.toast.deleted, 'success');
      reload();
    } catch (err) {
      addToast(apiError(err, f.toast.error), 'error');
    }
  };

  // ---- one place for each row's actions: the right-click / "⋯" menu and the detail window use them alike ----
  const vehicleMain = (v: FleetVehicle): DetailAction | null =>
    v.status === 'active' ? { label: f.quick.report, icon: <Wrench className="w-4 h-4" />, onClick: () => setStatusFor(v), primary: true }
      : v.status === 'broken' || v.status === 'maintenance'
        ? { label: f.quick.repaired, icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => void markRepaired(v), primary: true }
        : null;
  const driverMain = (d: FleetDriver): DetailAction[] => {
    const move = { label: f.actions.move, icon: <ArrowLeftRight className="w-4 h-4" />, onClick: () => setMoveFor(d) };
    if (canReturnHome(d, vs)) {
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
      { items: [
        { key: 'edit', label: f.menu.edit, icon: Pencil, onClick: () => setVehicleForm({ open: true, vehicle: v }) },
        { key: 'status', label: f.menu.status, icon: Wrench, onClick: () => setStatusFor(v) },
        { key: 'history', label: f.menu.history, icon: History, onClick: () => showHistory({ vehicle_id: v.id, label: v.plate }) },
      ] },
      { items: [{ key: 'delete', label: f.menu.delete, icon: Trash2, danger: true, onClick: () => void removeVehicle(v) }] },
    ];
  };
  const driverMenu = (d: FleetDriver): MenuGroup[] => [
    { label: d.name, items: [
      { key: 'detail', label: f.detail.open, icon: Eye, onClick: () => setDetail({ kind: 'driver', id: d.id }) },
      ...(canReturnHome(d, vs)
        ? [{ key: 'home', label: f.actions.returnHome, icon: Undo2, onClick: () => void returnHome(d.id, d.name) }] : []),
      ...(d.status !== 'left' ? [{ key: 'move', label: f.actions.move, icon: ArrowLeftRight, onClick: () => setMoveFor(d) }] : []),
    ] },
    { items: [
      { key: 'edit', label: f.menu.edit, icon: Pencil, onClick: () => setDriverForm({ open: true, driver: d }) },
      { key: 'history', label: f.menu.history, icon: History, onClick: () => showHistory({ driver_id: d.id, label: d.name }) },
    ] },
    { items: [{ key: 'delete', label: f.menu.delete, icon: Trash2, danger: true, onClick: () => void removeDriver(d) }] },
  ];

  const menuVehicle = menu.state?.row.kind === 'vehicle' ? vs.find((v) => v.id === menu.state!.row.id) : undefined;
  const menuDriver = menu.state?.row.kind === 'driver' ? ds.find((d) => d.id === menu.state!.row.id) : undefined;
  const menuGroups = menuVehicle ? vehicleMenu(menuVehicle) : menuDriver ? driverMenu(menuDriver) : [];

  const detailVehicle = detail?.kind === 'vehicle' ? vs.find((v) => v.id === detail.id) : undefined;
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
    { id: 'vehicles', label: f.views.vehicles, count: vehicles?.length },
    { id: 'drivers', label: f.views.drivers, count: drivers?.length },
    { id: 'history', label: f.views.history },
  ];

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
  const emptyText = (total: number, filtered: boolean, none: string) =>
    !total ? none : filtered ? f.filters.empty : f.empty.search;

  const vehicleTable = () => {
    if (shownVehicles.length === 0) return empty(emptyText(vs.length, vehicleFilter !== 'all', f.empty.vehicles));
    return (
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
          <tr>
            <th className={TH}>{L.vehicle}</th>
            <th className={TH}>{L.status}</th>
            <th className={TH}>{L.driver}</th>
            <th className={TH}>{L.docs}</th>
            <th className={TH}><span className="sr-only">{f.cols.actions}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {shownVehicles.map((v) => {
            const c = v.current_driver;
            const h = v.home_driver;
            const down = v.status === 'broken' || v.status === 'maintenance';
            const sub = [v.vehicle_type, v.trailer_plate ? tf(L.trailer, { plate: v.trailer_plate }) : ''].filter(Boolean).join(' · ');
            return (
              <tr key={v.id} data-testid={`vehicle-${v.id}`} {...rowEvents({ kind: 'vehicle', id: v.id })}
                className={`${ROW} ${menu.state?.row.kind === 'vehicle' && menu.state.row.id === v.id ? 'bg-primary-50/60 dark:bg-primary-950/30' : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'} ${v.status === 'inactive' ? 'opacity-60' : ''}`}>
                <td className={TD}>
                  <div className="flex items-center gap-3">
                    <FleetAvatar photo={v.photo} kind="vehicle" name={v.plate} size="wide" onClick={openPhoto(v.photo, v.plate)} />
                    <div className="min-w-0">
                      <div className="font-bold text-[15px] text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {v.plate}<NoteIcon note={v.note} />
                      </div>
                      {sub && <div className={`${MUTED} truncate max-w-[16rem]`}>{sub}</div>}
                    </div>
                  </div>
                </td>
                <td className={TD}><StatusBadge tone={VEHICLE_TONE[v.status]}>{f.vehicleStatus[v.status]}</StatusBadge></td>
                <td className={TD}>
                  {c ? (
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
                  ) : h ? (
                    <div className={MUTED}>
                      <div className="text-sm text-slate-400 dark:text-slate-500">{f.noDriver}</div>
                      {h.driving_vehicle_id && h.driving_vehicle_id !== v.id
                        ? <span className="text-sky-700 dark:text-sky-300">{tf(L.ownerAway, { name: h.name, plate: h.driving_plate })}</span>
                        : h.status !== 'active' ? tf(L.ownerStatus, { name: h.name, status: f.driverStatus[h.status].toLowerCase() })
                          : tf(L.owner, { name: h.name })}
                    </div>
                  ) : <span className="text-sm text-slate-400 dark:text-slate-500">{f.noDriver}</span>}
                </td>
                <td className={TD}><DocsCell entries={vehicleDocs(v)} today={today} muted={v.status === 'inactive'} /></td>
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
    if (shownDrivers.length === 0) return empty(emptyText(ds.length, driverFilter !== 'all', f.empty.drivers));
    return (
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
          <tr>
            <th className={TH}>{L.driver}</th>
            <th className={TH}>{L.status}</th>
            <th className={TH}>{L.truck}</th>
            <th className={TH}>{L.license}</th>
            <th className={TH}><span className="sr-only">{f.cols.actions}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {shownDrivers.map((d) => {
            const c = d.current_vehicle;
            const home = d.home_vehicle;
            const back = canReturnHome(d, vs);
            const homeLine = home ? (home.status !== 'active'
              ? tf(L.homeWithStatus, { plate: home.plate, status: f.vehicleStatus[home.status].toLowerCase() })
              : tf(L.tempHome, { plate: home.plate })) : '';
            const licence = [d.license_class, d.license_no].filter(Boolean).join(' · ');
            return (
              <tr key={d.id} data-testid={`driver-${d.id}`} {...rowEvents({ kind: 'driver', id: d.id })}
                className={`${ROW} ${menu.state?.row.kind === 'driver' && menu.state.row.id === d.id ? 'bg-primary-50/60 dark:bg-primary-950/30' : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'} ${d.status === 'left' ? 'opacity-60' : ''}`}>
                <td className={TD}>
                  <div className="flex items-center gap-3">
                    <FleetAvatar photo={d.photo} kind="driver" name={d.name} size="md" onClick={openPhoto(d.photo, d.name)} />
                    <div className="min-w-0">
                      <div className="font-bold text-[15px] text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {d.name}<NoteIcon note={d.note} />
                      </div>
                      {d.phone && <div className={MUTED}>{d.phone}</div>}
                    </div>
                  </div>
                </td>
                <td className={TD}><StatusBadge tone={DRIVER_TONE[d.status]}>{f.driverStatus[d.status]}</StatusBadge></td>
                <td className={TD}>
                  {c ? (
                    <div className="flex items-center gap-2.5">
                      <FleetAvatar photo={c.photo} kind="vehicle" name={c.plate} size="wideSm" onClick={openPhoto(c.photo, c.plate)} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{c.plate}</span>
                          {c.kind === 'temporary' && <Chip tone={TEMP_CHIP}>{f.kind.temporary}</Chip>}
                        </div>
                        <div className={MUTED}>
                          {c.kind === 'temporary' ? homeLine : c.trailer_plate ? tf(L.trailer, { plate: c.trailer_plate }) : ''}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={MUTED}>
                      <div className="text-sm text-slate-400 dark:text-slate-500">{f.noVehicle}</div>
                      {homeLine}
                    </div>
                  )}
                </td>
                <td className={TD}>
                  <div className="space-y-1">
                    {licence && <div className="text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">{licence}</div>}
                    <DocsCell entries={driverDocs(d)} today={today} muted={d.status === 'left'} />
                  </div>
                </td>
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
    if (shownHistory.length === 0) return empty(history.length ? f.empty.search : f.empty.history);
    return (
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
          <tr>
            <th className={TH}>{f.cols.started}</th>
            <th className={TH}>{f.cols.ended}</th>
            <th className={TH}>{f.cols.name}</th>
            <th className={TH}>{f.cols.vehicle}</th>
            <th className={TH}>{f.cols.reason}</th>
            <th className={TH}>{f.cols.endReason}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {shownHistory.map((h) => (
            <tr key={h.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
              <td className={`${TD} whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-200`}>{formatStampShort(h.started_at)}</td>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>
                {h.ended_at ? <span className="text-slate-700 dark:text-slate-200">{formatStampShort(h.ended_at)}</span>
                  : <StatusBadge tone={VEHICLE_TONE.active}>{f.stillOpen}</StatusBadge>}
              </td>
              <td className={`${TD} font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap`}>{h.driver_name}</td>
              <td className={`${TD} whitespace-nowrap`}>
                <span className="font-semibold text-slate-800 dark:text-slate-100">{h.vehicle_plate}</span>
                {h.kind === 'temporary' && <span className="ml-1.5"><Chip tone={TEMP_CHIP}>{f.kind.temporary}</Chip></span>}
                {h.kind === 'temporary' && h.home_vehicle_plate && (
                  <div className={MUTED}>{tf(f.tempOf, { plate: h.home_vehicle_plate })}</div>
                )}
              </td>
              <td className={`${TD} text-slate-600 dark:text-slate-300`}>{h.reason || f.none}</td>
              <td className={`${TD} text-slate-600 dark:text-slate-300`}>{h.end_reason || (h.ended_at ? f.none : '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-4 gap-3 bg-slate-50/50 dark:bg-slate-950/50" data-testid="fleet-tab">
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <div className="p-2 bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 rounded-xl">
          <Truck className="w-5 h-5" />
        </div>
        <div className="mr-auto min-w-0">
          <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">{f.title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{f.subtitle}</p>
        </div>
        <button type="button" onClick={reload} disabled={loading} aria-label={f.refresh} title={f.refresh}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {view !== 'history' && (
          <button type="button"
            onClick={() => (view === 'vehicles' ? setVehicleForm({ open: true, vehicle: null }) : setDriverForm({ open: true, driver: null }))}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white shadow-sm">
            <Plus className="w-4 h-4" />
            {view === 'vehicles' ? f.actions.addVehicle : f.actions.addDriver}
          </button>
        )}
      </div>

      {away.map((v) => (
        <div key={v.id} role="status"
          className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30 text-sm text-sky-800 dark:text-sky-200 shrink-0">
          <Undo2 className="w-4 h-4 shrink-0" />
          <span className="mr-auto">{tf(f.awayBanner, { plate: v.plate, name: v.home_driver!.name, temp: v.home_driver!.driving_plate })}</span>
          <button type="button" onClick={() => void returnHome(v.home_driver!.id, v.home_driver!.name)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white">
            {f.actions.returnHome}
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div role="tablist" className="inline-flex p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} onClick={() => changeView(tab.id)}
              className={`h-8 px-3.5 rounded-lg text-sm font-semibold transition-colors ${view === tab.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}>
              {tab.label}{tab.count !== undefined && <span className="ml-1.5 text-xs font-medium text-slate-400">{tab.count}</span>}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[12rem] max-w-sm ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={f.search} aria-label={f.search}
            className="w-full h-9 pl-9 pr-8 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
          {query && (
            <button type="button" aria-label={f.clearFilter} onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          )}
        </div>
      </div>

      {filterChips.length > 0 && vehicles && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 shrink-0">
        <div role="group" aria-label={f.filters.label} className="flex flex-wrap gap-1.5">
          {filterChips.filter((c) => c.id === 'all' || c.count > 0 || c.active).map((c) => (
            <button key={c.id} type="button" aria-pressed={c.active} onClick={c.select}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold border transition-colors ${c.active
                ? 'border-primary-500 bg-primary-600 text-white'
                : `border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600 ${c.tone}`}`}>
              {c.label}
              <span className={`min-w-[1.25rem] px-1 rounded-full text-[11px] ${c.active ? 'bg-white/25' : 'bg-slate-100 dark:bg-slate-800'}`}>{c.count}</span>
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500">{f.detail.hint}</span>
        </div>
      )}

      {view === 'history' && historyFilter && (
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 shrink-0">
          <span>{tf(f.historyFor, { name: historyFilter.label })}</span>
          <button type="button" onClick={() => setHistoryFilter(null)} className="font-semibold text-primary-600 hover:underline">{f.clearFilter}</button>
        </div>
      )}

      {failed ? (
        <div role="alert" className="flex items-center justify-between gap-2 p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300">
          <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{f.loadFailed}</span>
          <button type="button" onClick={reload} className="font-bold underline">{f.retry}</button>
        </div>
      ) : !vehicles || !drivers ? (
        <div className="flex-1 flex justify-center items-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
          {view === 'vehicles' ? vehicleTable() : view === 'drivers' ? driverTable() : historyTable()}
        </div>
      )}

      <VehicleFormModal isOpen={vehicleForm.open} vehicle={vehicleForm.vehicle}
        onClose={() => setVehicleForm({ open: false, vehicle: null })} onSaved={reload} />
      <DriverFormModal isOpen={driverForm.open} driver={driverForm.driver} vehicles={vs}
        onClose={() => setDriverForm({ open: false, driver: null })} onSaved={reload} />
      <VehicleStatusModal vehicle={statusFor} vehicles={vs} onClose={() => setStatusFor(null)} onSaved={reload} />
      <RowContextMenu position={menu.state && menuGroups.length ? { x: menu.state.x, y: menu.state.y } : null}
        groups={menuGroups} onClose={menu.close} />
      <FleetDetailModal target={detailTarget} onClose={() => setDetail(null)} actions={detailActions}
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
      <PhotoLightbox photo={viewing?.photo || null} name={viewing?.name || ''} onClose={closeViewer} />
      <DriverMoveModal driver={moveFor} vehicles={vs} onClose={() => setMoveFor(null)} onSaved={reload} />
    </div>
  );
};
