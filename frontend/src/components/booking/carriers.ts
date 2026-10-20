/**
 * Shared carrier (shipping line) detection for booking views.
 * Carrier colours are colour rules in the database (seeded defaults, editable in "Cấu hình màu sắc").
 * Backend carrier names are passed through unchanged; this only normalizes for display.
 */

export interface CarrierDef {
  key: string;
  /** Word-boundary patterns matched against the upper-cased carrier / booking text */
  patterns: RegExp[];
}

export const CARRIERS: CarrierDef[] = [
  {
    key: 'DJ SHIPPING',
    patterns: [/\bDJ\s+SHIPPING\b/],
  },
  {
    key: 'DONGJIN',
    patterns: [/\bDONG\s?JIN\b/, /\bDJSC\b/],
  },
  {
    key: 'CULINES',
    patterns: [/\bCU\s?LINES?\b/, /\bCHINA UNITED LINES\b/, /\bCUL\b/],
  },
  {
    key: 'PIL',
    patterns: [/\bPIL\b/, /\bPACIFIC INTERNATIONAL LINES?\b/],
  },
  {
    key: 'ONE',
    patterns: [/\bONE\b/, /\bOCEAN NETWORK EXPRESS\b/],
  },
  {
    key: 'SITC',
    patterns: [/\bSITC\b/],
  },
  {
    key: 'COSCO',
    patterns: [/\bCOSCO\b/],
  },
  {
    key: 'MAERSK',
    patterns: [/\bMAERSK\b/, /\bSEALAND\b/],
  },
  {
    key: 'CMA CGM',
    patterns: [/\bCMA\b/, /\bCNC\b/],
  },
  {
    key: 'EVERGREEN',
    patterns: [/\bEVERGREEN\b/, /\bEVER\b/],
  },
  {
    key: 'INTERASIA',
    patterns: [/\bINTER\s?ASIA\b/],
  },
  {
    key: 'LEGEND SHIPPING',
    patterns: [/\bLEGEND\s+SHIPPING\b/],
  },
  {
    key: 'MATSON',
    patterns: [/\bMATSON\b/],
  },
  {
    key: 'SWIRE SHIPPING',
    patterns: [/\bSWIRE\b/],
  },
  {
    key: 'WAN HAI',
    patterns: [/\bWAN\s?HAI\b/, /\bWHL\b/],
  },
  {
    key: 'HMM',
    patterns: [/\bHMM\b/, /\bHYUNDAI MERCHANT MARINE\b/],
  },
  {
    key: 'MSC',
    patterns: [/\bMSC\b/, /\bMEDITERRANEAN SHIPPING\b/],
  },
  {
    key: 'HAPAG-LLOYD',
    patterns: [/\bHAPAG\b/, /\bHLCU\b/],
  },
  {
    key: 'YANG MING',
    patterns: [/\bYANG\s?MING\b/, /\bYML\b/],
  },
  {
    key: 'OOCL',
    patterns: [/\bOOCL\b/, /\bORIENT OVERSEAS\b/],
  },
  {
    key: 'KMTC',
    patterns: [/\bKMTC\b/, /\bKOREA MARINE TRANSPORT\b/],
  },
  {
    key: 'SINOKOR LINE',
    patterns: [/\bSINOKOR\b/],
  },
  {
    key: 'HEUNG A LINE',
    patterns: [/\bHEUNG[-\s]?A\b/],
  },
  {
    key: 'NAMSUNG LINE',
    patterns: [/\bNAM\s?SUNG\b/],
  },
  {
    key: 'TS LINE',
    patterns: [/\bTS\s?LINES?\b/, /\bT\.S\. LINES?\b/],
  },
  {
    key: 'SAMUDERA',
    patterns: [/\bSAMUDERA\b/],
  },
  {
    key: 'RCL',
    patterns: [/\bRCL\b/, /\bREGIONAL CONTAINER LINES?\b/],
  },
  {
    key: 'ZIM',
    patterns: [/\bZIM\b/],
  },
  {
    key: 'JINJIANG',
    patterns: [/\bJINJIANG\b/, /\bJJ\s+SHIPP?ING\b/],
  },
];

const isBlank = (v?: string | null) => !v || v.trim() === '' || v.trim().toLowerCase() === 'null';

/** Canonical carrier key for a carrier string, or null. */
export function matchCarrier(text?: string | null): CarrierDef | null {
  if (isBlank(text)) return null;
  const upper = String(text).toUpperCase();
  return CARRIERS.find((c) => c.patterns.some((p) => p.test(upper))) || null;
}

/** Booking number prefixes used when the Carrier field is empty. */
const BOOKING_PREFIXES: [RegExp, string][] = [
  [/^DJL/, 'DJ SHIPPING'],
  [/^LGVN/, 'LEGEND SHIPPING'],
  [/^ZIMU/, 'ZIM'],
  [/^JJMS/, 'JINJIANG'],
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
