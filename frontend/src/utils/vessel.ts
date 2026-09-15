import type { Booking } from '../types';

export interface VesselVoyage {
  name: string;
  voyage: string;
}

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'null';

/** Strips a leading "V." / "VOY." / "VOYAGE" marker from a voyage code. */
const cleanVoyage = (v: string): string =>
  v.replace(/^(?:VOYAGE|VOY|V)\s*[.:]?\s*(?=\S*\d)/i, '').trim();

/** A token looks like a voyage code when it contains a digit and is at least 3 chars (so "PHUOC THANH 27" keeps "27"). */
const looksLikeVoyage = (token: string): boolean => /\d/.test(token) && token.replace(/[^A-Za-z0-9]/g, '').length >= 3;

/**
 * Split a combined "vessel voyage" string.
 *   "KOTA NEKAD 0272S"          -> { name: "KOTA NEKAD", voyage: "0272S" }
 *   "PHUOC THANH 27 - S080926N" -> { name: "PHUOC THANH 27", voyage: "S080926N" }
 *   "WAN HAI 175 / 045S"        -> { name: "WAN HAI 175", voyage: "045S" }
 */
export function splitVesselVoyage(input?: string | null): VesselVoyage {
  if (isBlank(input)) return { name: '', voyage: '' };
  let s = String(input)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:tàu|tau|vessel|ship)\s*[:.]\s*/i, '')
    .trim();

  // "KOTA NEKAD/0272S" (unspaced slash after a non-numeric word) -> "KOTA NEKAD / 0272S"
  s = s.replace(/([A-Za-z]{2,})\/(?=\S*\d)/g, '$1 / ');

  // Explicit separators: " - ", " – ", " / ", "|", "\" (an unspaced "0272S/0273N" stays one voyage)
  const parts = s
    .split(/\s+[-–—/]\s+|\s*[\\|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/\d/.test(last)) {
      return { name: parts.slice(0, -1).join(' ').trim(), voyage: cleanVoyage(last) };
    }
    s = parts.join(' ');
  }

  // Parenthesised voyage: "KOTA NEKAD (0272S)"
  const paren = s.match(/^(.*?)\s*\(([^)]*\d[^)]*)\)\s*$/);
  if (paren && paren[1].trim()) {
    return { name: paren[1].trim(), voyage: cleanVoyage(paren[2].trim()) };
  }

  const tokens = s.split(' ');
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (looksLikeVoyage(last)) {
      let nameTokens = tokens.slice(0, -1);
      // "KOTA NEKAD V. 0272S" -> drop a dangling voyage marker
      if (nameTokens.length > 1 && /^(?:V|VOY|VOYAGE)\.?:?$/i.test(nameTokens[nameTokens.length - 1])) {
        nameTokens = nameTokens.slice(0, -1);
      }
      return { name: nameTokens.join(' ').replace(/[-–—]+$/, '').trim(), voyage: cleanVoyage(last) };
    }
  }
  return { name: s, voyage: '' };
}

/** Accent-insensitive, upper-case, punctuation collapsed to single spaces. */
export function normalizeVi(text?: string | null): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Best-effort mapping of a depot / terminal text (e.g. "Full return CY") to an ePort site id
 * (see utils/ports.ts). Returns null when nothing matches.
 */
export function guessSiteFromDepot(text?: string | null): string | null {
  if (isBlank(text)) return null;
  const normalized = normalizeVi(text);
  const n = ` ${normalized} `;
  const compact = normalized.replace(/ /g, '');
  // Multi-word names also match without spaces ("CATLAI TERMINAL"); short codes need word boundaries.
  const has = (...needles: string[]) =>
    needles.some((x) => n.includes(` ${x} `) || (x.includes(' ') && compact.includes(x.replace(/ /g, ''))));

  if (has('GNL', 'GIANG NAM')) return 'GNL';
  if (has('THP', 'TCHP', 'HIEP PHUOC')) return 'THP';
  if (has('IST', 'SONG THAN')) return 'IST';
  if (has('TNT', 'TCNT')) return 'TNT';
  if (has('CMS')) return 'CMS';
  if (has('NHON TRACH')) return has('TAN CANG') ? 'TNT' : 'CMS';
  if (has('CTL', 'TCCL', 'CAT LAI')) return 'CTL';
  // Cai Mep terminals are not ePort sites
  if (has('CAI MEP', 'TCIT', 'TCTT', 'CMIT', 'TCCT')) return null;
  if (has('TAN CANG', 'SNP', 'SAIGON NEWPORT', 'SAI GON NEWPORT')) return 'CTL';
  return null;
}

export type VesselSourceField = 'Vessel' | 'Pre Carrier' | 'Trunk Vessel';

export interface VesselCandidate {
  /** First field holding this value */
  source: VesselSourceField;
  /** Every field holding this (normalized) value, e.g. ["Vessel", "Pre Carrier"] */
  sources: VesselSourceField[];
  value: string;
}

/** Distinct vessel strings of a booking, in priority order Vessel → Pre Carrier → Trunk Vessel. */
export function getBookingVesselCandidates(b?: Partial<Booking> | null): VesselCandidate[] {
  if (!b) return [];
  const out: VesselCandidate[] = [];
  const seen = new Map<string, VesselCandidate>();
  (['Vessel', 'Pre Carrier', 'Trunk Vessel'] as VesselSourceField[]).forEach((source) => {
    const raw = b[source];
    if (isBlank(raw)) return;
    const value = String(raw).trim();
    const key = normalizeVi(value);
    if (!key) return;
    const existing = seen.get(key);
    if (existing) {
      existing.sources.push(source);
      return;
    }
    const candidate: VesselCandidate = { source, sources: [source], value };
    seen.set(key, candidate);
    out.push(candidate);
  });
  return out;
}

export const vesselLookupKey = (site: string, name: string, voyage: string): string =>
  `${(site || '').toUpperCase()}|${normalizeVi(name)}|${normalizeVi(voyage)}`;

/** Formats ePort dates ("/Date(ms)/" or "YYYY-MM-DD HH:MM[:SS]") as "dd/MM/yyyy HH:mm". */
export function formatEportDate(value?: string | null): string {
  if (isBlank(value)) return '';
  const s = String(value).trim();
  const pad = (x: number) => String(x).padStart(2, '0');
  const fmt = (d: Date) =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ms = s.match(/Date\((-?\d+)\)/);
  if (ms) {
    const d = new Date(Number(ms[1]));
    return isNaN(d.getTime()) ? s : fmt(d);
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]} ${iso[4]}:${iso[5]}`;
  }
  return s;
}
