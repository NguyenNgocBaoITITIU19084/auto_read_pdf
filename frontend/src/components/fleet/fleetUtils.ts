import type { FleetDriver, FleetVehicle } from '../../types';
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

/** Trucks a driver can take now: running and nobody on them (`except`: leave this one out). */
export function freeVehicles(vehicles: FleetVehicle[], except?: number | null): FleetVehicle[] {
  return vehicles.filter((v) => v.status === 'active' && !v.current_driver && v.id !== except);
}

/** Home trucks running again while their driver is still away on a temporary truck: they can go back. */
export function awayHomeDrivers(vehicles: FleetVehicle[]): FleetVehicle[] {
  return vehicles.filter((v) => v.status === 'active' && !v.current_driver && v.home_driver?.status === 'active'
    && v.home_driver.driving_vehicle_id !== null && v.home_driver.driving_vehicle_id !== v.id);
}

/** A driver who can be put back on their home truck right now. */
export function canReturnHome(d: FleetDriver, vehicles: FleetVehicle[]): boolean {
  if (d.status !== 'active' || !d.home_vehicle || d.current_vehicle?.id === d.home_vehicle.id) return false;
  const home = vehicles.find((v) => v.id === d.home_vehicle!.id);
  return !!home && home.status === 'active' && !home.current_driver;
}

/** Expiring or expired documents of running trucks and working drivers. */
export function expiringCount(vehicles: FleetVehicle[], drivers: FleetDriver[], today: string = todayVnIso()): number {
  const soon = (iso: string) => {
    const n = daysUntil(iso, today);
    return n !== null && n <= EXPIRY_WARN_DAYS;
  };
  return vehicles.filter((v) => v.status !== 'inactive').reduce(
    (n, v) => n + (soon(v.registration_expiry) ? 1 : 0) + (soon(v.insurance_expiry) ? 1 : 0), 0)
    + drivers.filter((d) => d.status !== 'left' && soon(d.license_expiry)).length;
}
