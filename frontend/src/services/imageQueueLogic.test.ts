import { describe, expect, it } from 'vitest';
import type { ImageExtractResult } from '../types';
import {
  QueueItem, batchDuplicateIds, classifyResult, dedupeIncoming, isPdfItem, makeQueueItem, queueReducer, queueStats,
} from './imageQueueLogic';

const file = (name: string, size = 10, lastModified = 1) => new File([new Uint8Array(size)], name, { type: 'image/png', lastModified });
const col = { id: 1, name: 'Test' };
const item = (name: string, patch: Partial<QueueItem> = {}): QueueItem => ({ ...makeQueueItem(file(name), 'upload', col), ...patch });
const result = (over: Partial<ImageExtractResult> = {}): ImageExtractResult => ({
  data: { 'Booking No': 'SGN1', Vessel: 'HMM HOPE 062E' }, engine_used: 'gemini', warnings: [], ...over,
});

describe('classifyResult', () => {
  it('is success only for Gemini + Booking No + no warnings', () => {
    expect(classifyResult(result())).toBe('success');
  });
  it('needs review when read by OCR, with warnings, or without a Booking No', () => {
    expect(classifyResult(result({ engine_used: 'ocr' }))).toBe('review');
    expect(classifyResult(result({ warnings: ['Model đã bị thay'] }))).toBe('review');
    expect(classifyResult(result({ data: { Vessel: 'HMM HOPE 062E' } }))).toBe('review');
  });
  it('a PDF read is success with Booking No + Vessel + ETD and no warnings, otherwise review', () => {
    const full = { 'Booking No': '2338872150', Vessel: 'YM CELEBRITY 107A', ETD: '02/10/2026' };
    expect(classifyResult(result({ engine_used: 'pdf', data: full }))).toBe('success');
    expect(classifyResult(result({ engine_used: 'pdf', data: { ...full, ETD: 'null' } }))).toBe('review');
    expect(classifyResult(result({ engine_used: 'pdf', data: full, warnings: ['x'] }))).toBe('review');
  });
  it('tells PDF items from images', () => {
    expect(isPdfItem(makeQueueItem(new File(['x'], 'bk.PDF'), 'upload', col))).toBe(true);
    expect(isPdfItem(item('a.png'))).toBe(false);
  });
  it('fails when no key field was found (a guessed Carrier alone does not count)', () => {
    expect(classifyResult(result({ data: {}, engine_used: 'none' }))).toBe('failed');
    expect(classifyResult(result({ data: { Carrier: 'ONE', 'Booking No': 'null' } }))).toBe('failed');
  });
});

describe('queueReducer', () => {
  it('walks an item through reading -> success and keeps the AI original for comparison', () => {
    let items = queueReducer([], { type: 'add', items: [item('a.png')] });
    const id = items[0].id;
    items = queueReducer(items, { type: 'start', id });
    expect(items[0]).toMatchObject({ status: 'reading', attempts: 1 });
    items = queueReducer(items, { type: 'done', id, run: 0, result: result({ model_used: 'gemini-2.5-flash' }), readMs: 900 });
    expect(items[0]).toMatchObject({ status: 'success', engine: 'gemini', model: 'gemini-2.5-flash', readMs: 900 });
    items = queueReducer(items, { type: 'setField', id, key: 'Booking No', value: 'SGN2' });
    expect(items[0].fields['Booking No']).toBe('SGN2');
    expect(items[0].original['Booking No']).toBe('SGN1');
  });

  it('still accepts a fast result whose "start" update has not been applied yet (no endless re-read)', () => {
    const a = item('a.png');
    expect(queueReducer([a], { type: 'done', id: a.id, run: 0, result: result(), readMs: 1 })[0].status).toBe('success');
    expect(queueReducer([a], { type: 'fail', id: a.id, run: 0, error: 'x' })[0].status).toBe('failed');
    // a late 'start' must not undo it
    const done = queueReducer([a], { type: 'done', id: a.id, run: 0, result: result(), readMs: 1 });
    expect(queueReducer(done, { type: 'start', id: a.id })[0].status).toBe('success');
  });

  it('ignores results for removed, saved or re-read items', () => {
    const a = item('a.png');
    expect(queueReducer([a], { type: 'done', id: 'gone', run: 0, result: result(), readMs: 1 })).toHaveLength(1);
    const saved = { ...a, status: 'saved' as const };
    expect(queueReducer([saved], { type: 'done', id: a.id, run: 0, result: result(), readMs: 1 })[0].status).toBe('saved');
    // re-read while the first request is still in flight: its late answer belongs to run 0, the item is on run 1
    const reread = queueReducer([{ ...a, status: 'failed' as const }], { type: 'retry', id: a.id });
    expect(reread[0].run).toBe(1);
    expect(queueReducer(reread, { type: 'done', id: a.id, run: 0, result: result(), readMs: 1 })[0].status).toBe('queued');
    expect(queueReducer(reread, { type: 'done', id: a.id, run: 1, result: result(), readMs: 1 })[0].status).toBe('success');
  });

  it('marks request errors as failed, and retry puts them back in line without the old result', () => {
    let items = [item('a.png')];
    const id = items[0].id;
    items = queueReducer(items, { type: 'start', id });
    items = queueReducer(items, { type: 'fail', id, run: 0, error: 'Network Error' });
    expect(items[0]).toMatchObject({ status: 'failed', error: 'Network Error' });
    items = queueReducer(items, { type: 'retry', id });
    expect(items[0]).toMatchObject({ status: 'queued', error: undefined, warnings: [] });
  });

  it('requeue undoes a start (quota pause) without counting an attempt', () => {
    let items = [item('a.png')];
    items = queueReducer(items, { type: 'start', id: items[0].id });
    items = queueReducer(items, { type: 'requeue', id: items[0].id });
    expect(items[0]).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('retryFailed only touches failed items; clearSaved only removes saved ones', () => {
    const ok = item('ok.png', { status: 'success' });
    const bad = item('bad.png', { status: 'failed', error: 'x' });
    const done = item('done.png', { status: 'saved' });
    const items = queueReducer([ok, bad, done], { type: 'retryFailed' });
    expect(items.map((i) => i.status)).toEqual(['success', 'queued', 'saved']);
    expect(queueReducer(items, { type: 'clearSaved' }).map((i) => i.name)).toEqual(['ok.png', 'bad.png']);
  });

  it('never re-reads a saved item', () => {
    const done = item('done.png', { status: 'saved' });
    expect(queueReducer([done], { type: 'retry', id: done.id })[0].status).toBe('saved');
  });
});

describe('batchDuplicateIds', () => {
  const read = (name: string, no: string, status: QueueItem['status'] = 'success') =>
    item(name, { status, fields: { 'Booking No': no } });

  it('flags later items repeating a Booking No (case/space-insensitive), not the first', () => {
    const a = read('a.png', 'SGN 1'); const b = read('b.png', 'sgn1'); const c = read('c.png', 'SGN2');
    expect([...batchDuplicateIds([a, b, c])]).toEqual([b.id]);
  });
  it('ignores failed / unread items and counts saved ones as the original', () => {
    const failed = read('f.png', 'SGN1', 'failed'); const queued = read('q.png', 'SGN1', 'queued');
    const later = read('l.png', 'SGN1');
    expect(batchDuplicateIds([failed, queued, later]).size).toBe(0);
    const saved = read('s.png', 'SGN1', 'saved');
    expect([...batchDuplicateIds([saved, later])]).toEqual([later.id]);
  });
  it('does not mix collections', () => {
    const a = read('a.png', 'SGN1'); const b = { ...read('b.png', 'SGN1'), collectionId: 2 };
    expect(batchDuplicateIds([a, b]).size).toBe(0);
  });
});

describe('dedupeIncoming / queueStats', () => {
  it('drops files already queued or repeated in the same selection', () => {
    const existing = [item('a.png')];
    const { fresh, duplicates } = dedupeIncoming(existing, [file('a.png'), file('b.png'), file('b.png'), file('a.png', 20)]);
    expect(fresh.map((f) => f.name)).toEqual(['b.png', 'a.png']); // same name but different size is a different file
    expect(duplicates).toBe(2);
  });
  it('counts by status', () => {
    const stats = queueStats([item('a', { status: 'success' }), item('b', { status: 'failed' }), item('c'), item('d', { status: 'saved' })]);
    expect(stats).toMatchObject({ total: 4, success: 1, failed: 1, queued: 1, saved: 1, finished: 3 });
  });
});
