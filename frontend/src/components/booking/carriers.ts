/**
 * Shared carrier (shipping line) detection + badge colours for booking views.
 * Backend carrier names are passed through unchanged; this only normalizes for display.
 */

export interface CarrierDef {
  key: string;
  /** Word-boundary patterns matched against the upper-cased carrier / booking text */
  patterns: RegExp[];
  badge: string;
}

export const CARRIERS: CarrierDef[] = [
  {
    key: 'DONGJIN',
    patterns: [/\bDONG\s?JIN\b/, /\bDJSC\b/],
    badge: 'bg-cyan-100 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-800',
  },
  {
    key: 'CULINES',
    patterns: [/\bCU\s?LINES?\b/, /\bCHINA UNITED LINES\b/, /\bCUL\b/],
    badge: 'bg-teal-100 dark:bg-teal-950/80 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-800',
  },
  {
    key: 'PIL',
    patterns: [/\bPIL\b/, /\bPACIFIC INTERNATIONAL LINES?\b/],
    badge: 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800',
  },
  {
    key: 'ONE',
    patterns: [/\bONE\b/, /\bOCEAN NETWORK EXPRESS\b/],
    badge: 'bg-fuchsia-100 dark:bg-fuchsia-950/80 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-300 dark:border-fuchsia-800',
  },
  {
    key: 'SITC',
    patterns: [/\bSITC\b/],
    badge: 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800',
  },
  {
    key: 'COSCO',
    patterns: [/\bCOSCO\b/],
    badge: 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800',
  },
  {
    key: 'MAERSK',
    patterns: [/\bMAERSK\b/, /\bSEALAND\b/],
    badge: 'bg-sky-100 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-800',
  },
  {
    key: 'CMA CGM',
    patterns: [/\bCMA\b/, /\bCNC\b/],
    badge: 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800',
  },
  {
    key: 'EVERGREEN',
    patterns: [/\bEVERGREEN\b/, /\bEVER\b/],
    badge: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
  },
  {
    key: 'WAN HAI',
    patterns: [/\bWAN\s?HAI\b/, /\bWHL\b/],
    badge: 'bg-orange-100 dark:bg-orange-950/80 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-800',
  },
];

const DEFAULT_BADGE =
  'bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800';

const isBlank = (v?: string | null) => !v || v.trim() === '' || v.trim().toLowerCase() === 'null';

/** Canonical carrier key for a carrier string, or null. */
export function matchCarrier(text?: string | null): CarrierDef | null {
  if (isBlank(text)) return null;
  const upper = String(text).toUpperCase();
  return CARRIERS.find((c) => c.patterns.some((p) => p.test(upper))) || null;
}

export function getCarrierBadgeClass(carrier?: string | null): string {
  return matchCarrier(carrier)?.badge || DEFAULT_BADGE;
}

/** Booking number prefixes used when the Carrier field is empty. */
const BOOKING_PREFIXES: [RegExp, string][] = [
  [/^DJ/, 'DONGJIN'],
  [/^CUL/, 'CULINES'],
  [/^SGN6/, 'PIL'],
  [/^ONEY/, 'ONE'],
];

/** Carrier to display: the stored Carrier when present, else a best-effort guess. */
export function detectBookingCarrier(b: Record<string, any>, fallback: string): string {
  const stored = b['Carrier'];
  if (!isBlank(stored)) return String(stored);
  const bookingNo = String(b['Booking No'] || '').toUpperCase().trim();
  for (const [re, key] of BOOKING_PREFIXES) {
    if (re.test(bookingNo)) return key;
  }
  const text = `${b['Booking No'] || ''} ${b['Vessel'] || ''} ${b['Tên file PDF'] || ''}`;
  const found = matchCarrier(text.replace(/[_.-]+/g, ' '));
  if (found) return found.key;
  if (/\bKOTA\b/i.test(text)) return 'PIL';
  return fallback;
}
