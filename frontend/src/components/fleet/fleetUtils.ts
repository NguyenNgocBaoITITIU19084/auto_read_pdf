import type { DriverStatus, FleetDriver, FleetVehicle, VehicleStatus } from '../../types';
import { VN_TIME_ZONE } from '../../utils/vnTime';

/** Documents expiring within this many days are flagged (same as the backend reminder). */
export const EXPIRY_WARN_DAYS = 30;

/** Today in Vietnam as 'YYYY-MM-DD', whatever the computer's timezone. */
export function todayVnIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: VN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now);
}

/** Whole days from today (VN) to an 'YYYY-MM-DD' date; null when there is no date. Negative: already passed. */
export function daysUntil(iso: string, today: string = todayVnIso()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** 'YYYY-MM-DD' → 'dd/mm/yyyy' ('' stays ''). */
export function formatIsoDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || '';
}

/** 'YYYY-MM-DD HH:MM:SS' → 'dd/mm/yyyy HH:MM'. */
export function formatStampShort(stamp: string | null | undefined): string {
  if (!stamp) return '';
  return `${formatIsoDate(stamp.slice(0, 10))} ${stamp.slice(11, 16)}`.trim();
}

/** The backend's message (Vietnamese, names the conflict) or the fallback. */
export function apiError(e: any, fallback: string): string {
  const detail = e?.response?.data?.detail;
  return typeof detail === 'string' && detail ? detail : fallback;
}

export const isConflict = (e: any): boolean => e?.response?.status === 409;

/** Case- and accent-insensitive "contains" (Vietnamese names: "an" finds "Ân"). */
export function fold(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

const squash = (s: string) => s.replace(/[\s.\-_/]+/g, '');

/** Every value is searched as typed and with spaces / dots / dashes dropped, so '51c12345' finds '51C-123.45'. */
export function matches(query: string, ...values: unknown[]): boolean {
  const q = fold(query).trim();
  if (!q) return true;
  const qs = squash(q);
  return values.some((v) => {
    const s = fold(v);
    return s.includes(q) || (!!qs && squash(s).includes(qs));
  });
}

/** Days left of a document in a notification, counted from today rather than from when it was sent. */
export function liveDaysLeft(doc: { expiry: string; days_left: number }, today: string = todayVnIso()): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(doc.expiry || '');
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : doc.expiry;
  return daysUntil(iso, today) ?? doc.days_left;
}

/** Statuses a truck / trailer runs in ("Sẵn sàng", "Đang chạy"); the others stop it. */
export const RUNNING_STATUSES: readonly VehicleStatus[] = ['ready', 'active'];
export const isRunning = (status: VehicleStatus) => RUNNING_STATUSES.includes(status);
/** While a paper is expired only these can be picked (the backend refuses the rest) */
export const LOCK_FREE_STATUSES: readonly VehicleStatus[] = ['not_ready', 'inactive'];
export const PAPER_EXPIRIES = ['ownership_expiry', 'registration_expiry', 'insurance_expiry'] as const;
export type PaperExpiry = typeof PAPER_EXPIRIES[number];

/** The papers whose expiry date is before today (the day itself still counts as valid, as on the server). */
export function expiredPapers(row: Record<PaperExpiry, string>, today: string = todayVnIso()): PaperExpiry[] {
  return PAPER_EXPIRIES.filter((k) => {
    const n = daysUntil(row[k], today);
    return n !== null && n < 0;
  });
}

/** While a driver's licence is expired only these can be picked (the backend refuses the rest) */
export const DRIVER_LOCK_FREE_STATUSES: readonly DriverStatus[] = ['not_ready', 'leave', 'left'];
/** The licence date is before today (its last day still counts, as on the server). */
export function licenseExpired(row: { license_expiry: string }, today: string = todayVnIso()): boolean {
  const n = daysUntil(row.license_expiry, today);
  return n !== null && n < 0;
}

/** Trucks a driver can take now: running and nobody on them (`except`: leave this one out). */
export function freeVehicles(vehicles: FleetVehicle[], except?: number | null): FleetVehicle[] {
  return vehicles.filter((v) => isRunning(v.status) && !v.current_driver && v.id !== except);
}

/** A working driver on no truck now ("Chưa có xe"): "Giao xe". Only a working driver can be given a truck. */
export function needsTruck(d: FleetDriver): boolean {
  return d.status === 'active' && !d.current_vehicle;
}

/** A working driver on a truck: "Đổi xe" (move to another free truck). */
export function canChangeTruck(d: FleetDriver): boolean {
  return d.status === 'active' && !!d.current_vehicle;
}

/** Expiring or expired documents of running trucks and working drivers. */
export function expiringCount(vehicles: FleetVehicle[], drivers: FleetDriver[], today: string = todayVnIso()): number {
  const soon = (iso: string) => {
    const n = daysUntil(iso, today);
    return n !== null && n <= EXPIRY_WARN_DAYS;
  };
  return vehicles.filter((v) => v.status !== 'inactive').reduce(
    (n, v) => n + (soon(v.ownership_expiry) ? 1 : 0) + (soon(v.registration_expiry) ? 1 : 0) + (soon(v.insurance_expiry) ? 1 : 0), 0)
    + drivers.filter((d) => d.status !== 'left' && soon(d.license_expiry)).length;
}
