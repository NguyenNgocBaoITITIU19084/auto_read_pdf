import type { Booking, ImageExtractEngine, ImageExtractResult } from '../types';

/**
 * Pure logic of the batch image-reading queue (no React): item model, how a result is classified,
 * duplicate detection and the reducer. The provider (ImageQueueContext) only runs the worker.
 */

export type QueueStatus = 'queued' | 'reading' | 'success' | 'review' | 'failed' | 'saved';
export type QueueSource = 'upload' | 'paste' | 'drop' | 'phone';
export type Outcome = 'success' | 'review' | 'failed';

export interface QueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  source: QueueSource;
  /** Collection chosen when the image was added — never the one active when it is saved. */
  collectionId: number;
  collectionName: string;
  status: QueueStatus;
  /** Editable copy of the extracted fields */
  fields: Partial<Booking>;
  /** Exactly what the AI / OCR read, kept to compare with the user's edits */
  original: Partial<Booking>;
  engine?: ImageExtractEngine;
  model?: string | null;
  warnings: string[];
  /** Request failure message (status 'failed' without a result) */
  error?: string;
  errorKind?: string | null;
  attempts: number;
  /** Bumped by every re-read: a result only applies to the run that produced it */
  run: number;
  readMs?: number;
  /** Booking No already exists in the target collection */
  dbDuplicate?: boolean;
  saving?: boolean;
  savedId?: number;
}

/** Fields that indicate a real extraction (Carrier alone is not enough — it can be guessed from noise). */
export const KEY_FIELDS = [
  'Booking No', 'Vessel', 'Pre Carrier', 'Trunk Vessel', 'ETD', 'Port of Discharging',
  'Place of Delivery', 'Equipment Type', "Q'ty", 'Empty Pick Up CY', 'Full return CY', 'Port Cargo Cut-off',
];

export const EMPTY_FIELDS: Partial<Booking> = {
  'Tên file PDF': '', 'Booking No': '', 'Carrier': '', 'Port of Discharging': '', 'Place of Delivery': '',
  'Block': '', 'T/S Port': '', 'Equipment Type': '', "Q'ty": '', 'Empty Pick Up CY': '', 'Full return CY': '',
  'Port Cargo Cut-off': '', 'Pre Carrier': '', 'ETD_Pre': '', 'Trunk Vessel': '', 'ETD_Trunk': '', 'Vessel': '', 'ETD': '',
};

export const hasValue = (v: unknown): boolean =>
  v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'null';

/** A PDF read counts as complete only with these: anything less is worth a look before saving. */
export const PDF_REQUIRED_FIELDS = ['Booking No', 'Vessel', 'ETD'];

/**
 * - failed:  none of the key fields were found
 * - success: read by Gemini with a Booking No, or from a PDF text layer with Booking No + Vessel + ETD; no warnings
 * - review:  something was read, but by offline OCR, with warnings, or with fields missing
 */
export function classifyResult(result: Pick<ImageExtractResult, 'data' | 'engine_used' | 'warnings'>): Outcome {
  const data = (result.data || {}) as Record<string, unknown>;
  if (!KEY_FIELDS.some((k) => hasValue(data[k]))) return 'failed';
  const warnings = (result.warnings || []).filter((w) => typeof w === 'string' && w.trim());
  if (warnings.length > 0) return 'review';
  if (result.engine_used === 'gemini' && hasValue(data['Booking No'])) return 'success';
  if (result.engine_used === 'pdf' && PDF_REQUIRED_FIELDS.every((k) => hasValue(data[k]))) return 'success';
  return 'review';
}

const PDF_NAME = /\.pdf$/i;
/** Queue items are booking images or booking PDFs */
export const isPdfItem = (item: Pick<QueueItem, 'file' | 'name'>): boolean =>
  (item.file?.type || '').toLowerCase() === 'application/pdf' || PDF_NAME.test(item.name || '');

export const bookingKey = (fields: Partial<Booking>): string =>
  hasValue(fields['Booking No']) ? String(fields['Booking No']).trim().toUpperCase().replace(/\s+/g, '') : '';

/**
 * Items whose Booking No repeats an earlier item of the batch (a failed item never counts as the
 * original). Saved items count, so a later copy of an already saved booking is flagged too.
 */
export function batchDuplicateIds(items: QueueItem[]): Set<string> {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const it of items) {
    if (it.status === 'queued' || it.status === 'reading' || it.status === 'failed') continue;
    const key = bookingKey(it.fields);
    if (!key) continue;
    const scoped = `${it.collectionId}|${key}`;
    if (seen.has(scoped)) dups.add(it.id);
    else seen.add(scoped);
  }
  return dups;
}

/** Same rule as the edit form: a Pre Carrier / Trunk Vessel change drives Vessel and ETD. */
export function applyFieldChange(fields: Partial<Booking>, key: string, value: string): Partial<Booking> {
  const updated: Partial<Booking> = { ...fields, [key]: value };
  if (key === 'Pre Carrier' && value && value !== 'null') {
    updated['Vessel'] = value;
    if (updated['ETD_Pre'] && updated['ETD_Pre'] !== 'null') updated['ETD'] = updated['ETD_Pre'];
  } else if (key === 'Trunk Vessel' && (!updated['Pre Carrier'] || updated['Pre Carrier'] === 'null')) {
    updated['Vessel'] = value;
    if (updated['ETD_Trunk'] && updated['ETD_Trunk'] !== 'null') updated['ETD'] = updated['ETD_Trunk'];
  }
  return updated;
}

export const fileKey = (f: File): string => `${f.name}|${f.size}|${f.lastModified}`;

/** Files not already in the queue (and not repeated among themselves). */
export function dedupeIncoming(existing: QueueItem[], files: File[]): { fresh: File[]; duplicates: number } {
  const seen = new Set(existing.map((i) => fileKey(i.file)));
  const fresh: File[] = [];
  for (const f of files) {
    const k = fileKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(f);
  }
  return { fresh, duplicates: files.length - fresh.length };
}

export interface QueueStats {
  total: number;
  queued: number;
  reading: number;
  success: number;
  review: number;
  failed: number;
  saved: number;
  /** read (any outcome) or saved */
  finished: number;
}

export function queueStats(items: QueueItem[]): QueueStats {
  const s: QueueStats = { total: items.length, queued: 0, reading: 0, success: 0, review: 0, failed: 0, saved: 0, finished: 0 };
  for (const it of items) s[it.status] += 1;
  s.finished = s.success + s.review + s.failed + s.saved;
  return s;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------
export type QueueAction =
  | { type: 'add'; items: QueueItem[] }
  | { type: 'start'; id: string }
  /** back to the waiting line, e.g. after a quota pause */
  | { type: 'requeue'; id: string }
  | { type: 'done'; id: string; run: number; result: ImageExtractResult; readMs: number }
  | { type: 'fail'; id: string; run: number; error: string; readMs?: number }
  /** read again: keeps the file, drops the previous result */
  | { type: 'retry'; id: string }
  | { type: 'retryFailed' }
  | { type: 'remove'; id: string }
  | { type: 'clearSaved' }
  | { type: 'setField'; id: string; key: string; value: string }
  | { type: 'setDbDuplicate'; id: string; value: boolean }
  | { type: 'saving'; id: string; value: boolean }
  /** saved to the collection: leaves the queue (nothing left to do with it) */
  | { type: 'saved'; id: string; bookingId: number };

const patch = (items: QueueItem[], id: string, fn: (it: QueueItem) => QueueItem): QueueItem[] =>
  items.map((it) => (it.id === id ? fn(it) : it));

/** A result belongs to the current read of a still-open item (not removed, saved or re-read since). */
const accepts = (it: QueueItem, run: number) => (it.status === 'reading' || it.status === 'queued') && it.run === run;

const RESET: Partial<QueueItem> = {
  status: 'queued', error: undefined, errorKind: undefined, engine: undefined, model: undefined, warnings: [],
  readMs: undefined, dbDuplicate: undefined, saving: false,
};

export function queueReducer(items: QueueItem[], action: QueueAction): QueueItem[] {
  switch (action.type) {
    case 'add':
      return [...items, ...action.items];
    case 'start':
      return patch(items, action.id, (it) => (it.status === 'queued' ? { ...it, status: 'reading', attempts: it.attempts + 1 } : it));
    case 'requeue':
      return patch(items, action.id, (it) => (it.status === 'reading' ? { ...it, status: 'queued', attempts: Math.max(0, it.attempts - 1) } : it));
    case 'done':
      return patch(items, action.id, (it) => {
        // Accepted even if the 'start' update has not been applied yet: React may order a fast result
        // ahead of it, and refusing it would leave the item queued and read it again forever.
        if (!accepts(it, action.run)) return it;
        const data = { ...EMPTY_FIELDS, ...(action.result.data || {}), 'Tên file PDF': it.name } as Partial<Booking>;
        return {
          ...it,
          status: classifyResult(action.result),
          fields: data,
          original: data,
          engine: action.result.engine_used,
          model: action.result.model_used ?? null,
          errorKind: action.result.gemini_error_kind ?? null,
          warnings: (action.result.warnings || []).filter((w) => typeof w === 'string' && w.trim()),
          error: undefined,
          readMs: action.readMs,
        };
      });
    case 'fail':
      return patch(items, action.id, (it) =>
        !accepts(it, action.run) ? it : { ...it, status: 'failed', error: action.error, engine: 'none', readMs: action.readMs });
    case 'retry':
      return patch(items, action.id, (it) => (it.status === 'reading' || it.status === 'saved' ? it : { ...it, ...RESET, run: it.run + 1 }));
    case 'retryFailed':
      return items.map((it) => (it.status === 'failed' ? { ...it, ...RESET, run: it.run + 1 } : it));
    case 'remove':
      return items.filter((it) => it.id !== action.id);
    case 'clearSaved':
      return items.filter((it) => it.status !== 'saved');
    case 'setField':
      return patch(items, action.id, (it) => ({ ...it, fields: applyFieldChange(it.fields, action.key, action.value) }));
    case 'setDbDuplicate':
      return patch(items, action.id, (it) => ({ ...it, dbDuplicate: action.value }));
    case 'saving':
      return patch(items, action.id, (it) => ({ ...it, saving: action.value }));
    case 'saved': {
      const saved = items.find((it) => it.id === action.id);
      if (!saved) return items;
      // Other copies of this Booking No can no longer be told apart within the batch: they are now in the list
      const key = bookingKey(saved.fields);
      return items
        .filter((it) => it.id !== action.id)
        .map((it) => (key && it.collectionId === saved.collectionId && bookingKey(it.fields) === key ? { ...it, dbDuplicate: true } : it));
    }
    default:
      return items;
  }
}

let idCounter = 0;
export function makeQueueItem(file: File, source: QueueSource, collection: { id: number; name: string }): QueueItem {
  idCounter += 1;
  return {
    id: `iq-${Date.now().toString(36)}-${idCounter}`,
    file,
    name: file.name || 'booking_image',
    size: file.size,
    source,
    collectionId: collection.id,
    collectionName: collection.name,
    status: 'queued',
    fields: { ...EMPTY_FIELDS, 'Tên file PDF': file.name || 'booking_image' },
    original: {},
    warnings: [],
    attempts: 0,
    run: 0,
  };
}
