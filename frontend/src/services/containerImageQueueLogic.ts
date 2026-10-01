/**
 * Pure logic of the container photo reading queue (no React): statuses, ISO 6346 check, reducer.
 * Same shape as the booking queue (imageQueueLogic.ts), but the fields are container number / tare / max gross.
 */
import type { ContainerImageResult, ImageExtractEngine } from '../types';

export type ContainerQueueStatus = 'queued' | 'reading' | 'success' | 'review' | 'failed' | 'used';

export interface ContainerFields {
  container_no: string;
  tare: string;
  max_gross: string;
}

export const EMPTY_CONTAINER_FIELDS: ContainerFields = { container_no: '', tare: '', max_gross: '' };

export interface ContainerQueueItem {
  id: number;
  file: File;
  name: string;
  status: ContainerQueueStatus;
  /** Editable by the user */
  fields: ContainerFields;
  /** What the reader returned, to highlight edits */
  original: ContainerFields;
  engine: ImageExtractEngine | null;
  model: string | null;
  warnings: string[];
  error: string;
  errorKind: string | null;
  /** A lookup + add to the table is in flight for this item */
  saving: boolean;
  attempts: number;
  /** Incremented by every (re)start so a stale result of an older run is dropped */
  run: number;
}

const LETTER_VALUES: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let n = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (n % 11 === 0) n += 1; // 11, 22, 33 are skipped
    out[ch] = n;
    n += 1;
  }
  return out;
})();

/** ISO 6346 check digit of the first 10 characters; null when they are not 4 letters + 6 digits. */
export function iso6346CheckDigit(first10: string): number | null {
  const s = (first10 || '').toUpperCase();
  if (!/^[A-Z]{4}\d{6}$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i];
    total += (/[A-Z]/.test(c) ? LETTER_VALUES[c] : Number(c)) * 2 ** i;
  }
  return (total % 11) % 10;
}

export const normalizeContainerNo = (raw: string): string => (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export type ContainerNoIssue = 'empty' | 'format' | 'check_digit';

/** null when the number looks valid (shape + check digit). */
export function containerNoIssue(no: string): ContainerNoIssue | null {
  if (!no) return 'empty';
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(no)) return 'format';
  return iso6346CheckDigit(no.slice(0, 10)) === Number(no[10]) ? null : 'check_digit';
}

export const fieldsFromResult = (res: ContainerImageResult): ContainerFields => ({
  container_no: res.data.container_no || '',
  tare: res.data.tare_kg != null ? String(res.data.tare_kg) : '',
  max_gross: res.data.max_gross_kg != null ? String(res.data.max_gross_kg) : '',
});

/** failed: no container number; success: read by Gemini, valid number, both weights and no warning; otherwise review. */
export function classifyContainerResult(res: ContainerImageResult): 'success' | 'review' | 'failed' {
  const f = fieldsFromResult(res);
  if (!f.container_no) return 'failed';
  const complete = !containerNoIssue(f.container_no) && f.tare !== '' && f.max_gross !== '';
  return res.engine_used === 'gemini' && complete && res.warnings.length === 0 ? 'success' : 'review';
}

export function containerFileKey(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

export function dedupeContainerFiles(incoming: File[], existing: ContainerQueueItem[]): { fresh: File[]; skipped: number } {
  const seen = new Set(existing.map((i) => containerFileKey(i.file)));
  const fresh: File[] = [];
  for (const f of incoming) {
    const key = containerFileKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(f);
  }
  return { fresh, skipped: incoming.length - fresh.length };
}

/** The same container read from two photos: ids of the later items. */
export function duplicateContainerIds(items: ContainerQueueItem[]): Set<number> {
  const seen = new Set<string>();
  const dup = new Set<number>();
  for (const it of items) {
    const no = it.fields.container_no;
    if (!no || it.status === 'queued' || it.status === 'reading') continue;
    if (seen.has(no)) dup.add(it.id);
    else seen.add(no);
  }
  return dup;
}

export function containerQueueStats(items: ContainerQueueItem[]) {
  const stats = { total: items.length, queued: 0, reading: 0, success: 0, review: 0, failed: 0, used: 0, done: 0 };
  for (const it of items) stats[it.status] += 1;
  stats.done = stats.total - stats.queued - stats.reading;
  return stats;
}

export type ContainerQueueAction =
  | { type: 'add'; items: ContainerQueueItem[] }
  | { type: 'start'; id: number }
  | { type: 'requeue'; id: number }
  | { type: 'done'; id: number; run: number; result: ContainerImageResult }
  | { type: 'fail'; id: number; run: number; error: string }
  | { type: 'retry'; id: number }
  | { type: 'retryFailed' }
  | { type: 'remove'; id: number }
  | { type: 'clearUsed' }
  | { type: 'setField'; id: number; field: keyof ContainerFields; value: string }
  | { type: 'saving'; id: number; saving: boolean }
  | { type: 'used'; ids: number[] };

export function containerQueueReducer(items: ContainerQueueItem[], action: ContainerQueueAction): ContainerQueueItem[] {
  const patch = (id: number, fn: (it: ContainerQueueItem) => ContainerQueueItem) => items.map((it) => (it.id === id ? fn(it) : it));
  const accepts = (id: number, run: number) => items.some((it) => it.id === id && it.status === 'reading' && it.run === run);
  switch (action.type) {
    case 'add':
      return [...items, ...action.items];
    case 'start':
      return patch(action.id, (it) => (it.status === 'queued'
        ? { ...it, status: 'reading', run: it.run + 1, attempts: it.attempts + 1, error: '', errorKind: null }
        : it));
    case 'requeue':
      return patch(action.id, (it) => (it.status === 'reading' ? { ...it, status: 'queued' } : it));
    case 'done': {
      if (!accepts(action.id, action.run)) return items;
      const fields = fieldsFromResult(action.result);
      return patch(action.id, (it) => ({
        ...it,
        status: classifyContainerResult(action.result),
        fields,
        original: fields,
        engine: action.result.engine_used,
        model: action.result.model_used ?? null,
        warnings: action.result.warnings,
        errorKind: action.result.gemini_error_kind ?? null,
      }));
    }
    case 'fail':
      if (!accepts(action.id, action.run)) return items;
      return patch(action.id, (it) => ({ ...it, status: 'failed', error: action.error }));
    case 'retry':
      return patch(action.id, (it) => (it.status === 'reading' ? it : { ...it, status: 'queued', error: '', warnings: [], engine: null, model: null }));
    case 'retryFailed':
      return items.map((it) => (it.status === 'failed' ? { ...it, status: 'queued', error: '', warnings: [], engine: null, model: null } : it));
    case 'remove':
      return items.filter((it) => it.id !== action.id);
    case 'clearUsed':
      return items.filter((it) => it.status !== 'used');
    case 'setField':
      return patch(action.id, (it) => ({
        ...it,
        fields: { ...it.fields, [action.field]: action.field === 'container_no' ? normalizeContainerNo(action.value) : action.value.replace(/[^\d]/g, '') },
      }));
    case 'saving':
      return patch(action.id, (it) => ({ ...it, saving: action.saving }));
    case 'used': {
      const ids = new Set(action.ids);
      return items.map((it) => (ids.has(it.id) ? { ...it, status: 'used', saving: false } : it));
    }
    default:
      return items;
  }
}

let nextId = 1;
export function makeContainerQueueItem(file: File): ContainerQueueItem {
  return {
    id: nextId++, file, name: file.name, status: 'queued',
    fields: { ...EMPTY_CONTAINER_FIELDS }, original: { ...EMPTY_CONTAINER_FIELDS },
    engine: null, model: null, warnings: [], error: '', errorKind: null, saving: false, attempts: 0, run: 0,
  };
}
