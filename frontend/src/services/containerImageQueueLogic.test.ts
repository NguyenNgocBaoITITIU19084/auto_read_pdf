import { describe, expect, it } from 'vitest';
import type { ContainerImageResult } from '../types';
import {
  classifyContainerResult, containerNoIssue, containerQueueReducer, containerQueueStats, dedupeContainerFiles,
  duplicateContainerIds, iso6346CheckDigit, makeContainerQueueItem,
} from './containerImageQueueLogic';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'image/jpeg', lastModified: 1 });
const result = (over: Partial<ContainerImageResult['data']> = {}, extra: Partial<ContainerImageResult> = {}): ContainerImageResult => ({
  data: { container_no: 'HPCU5330042', tare_kg: 3700, max_gross_kg: 32500, check_digit_ok: true, seal_no: '', seal_brand: '', ...over },
  engine_used: 'gemini', warnings: [], model_used: 'gemini-2.5-flash', gemini_error_kind: null, ...extra,
});

describe('ISO 6346', () => {
  it('computes the check digit of known numbers', () => {
    expect(iso6346CheckDigit('HPCU533004')).toBe(2);
    expect(iso6346CheckDigit('CSQU305438')).toBe(3);
    expect(iso6346CheckDigit('MSKU907032')).toBe(3);
    expect(iso6346CheckDigit('HPCU53300')).toBeNull();
  });
  it('reports what is wrong with a number', () => {
    expect(containerNoIssue('HPCU5330042')).toBeNull();
    expect(containerNoIssue('HPCU5330043')).toBe('check_digit');
    expect(containerNoIssue('HPCU53300')).toBe('format');
    expect(containerNoIssue('')).toBe('empty');
  });
});

describe('classifyContainerResult', () => {
  it('is success only for Gemini + valid number + both weights + no warning', () => {
    expect(classifyContainerResult(result())).toBe('success');
    expect(classifyContainerResult(result({ tare_kg: null }))).toBe('review');
    expect(classifyContainerResult(result({ container_no: 'HPCU5330043' }))).toBe('review');
    expect(classifyContainerResult(result({}, { engine_used: 'ocr' }))).toBe('review');
    expect(classifyContainerResult(result({}, { warnings: ['x'] }))).toBe('review');
    expect(classifyContainerResult(result({ container_no: '' }))).toBe('failed');
  });

  it('treats a seal-only photo as readable, and a photo with neither as failed', () => {
    const seal = { container_no: '', tare_kg: null, max_gross_kg: null, check_digit_ok: null, seal_no: 'WHA4453729', seal_brand: 'WAN HAI' };
    expect(classifyContainerResult(result(seal))).toBe('success');
    expect(classifyContainerResult(result(seal, { engine_used: 'ocr' }))).toBe('review');
    expect(classifyContainerResult(result({ ...seal, seal_no: '' }))).toBe('failed');
  });
});

describe('queue reducer', () => {
  it('reads an item and fills its fields from the result', () => {
    const it = makeContainerQueueItem(file('a.jpg'));
    let items = containerQueueReducer([], { type: 'add', items: [it] });
    items = containerQueueReducer(items, { type: 'start', id: it.id });
    items = containerQueueReducer(items, { type: 'done', id: it.id, run: 1, result: result() });
    expect(items[0]).toMatchObject({ status: 'success', fields: { container_no: 'HPCU5330042', tare: '3700', max_gross: '32500' }, model: 'gemini-2.5-flash' });
  });

  it('drops a stale result of an older run', () => {
    const it = makeContainerQueueItem(file('a.jpg'));
    let items = containerQueueReducer([it], { type: 'start', id: it.id });       // run 1
    items = containerQueueReducer(items, { type: 'requeue', id: it.id });
    items = containerQueueReducer(items, { type: 'start', id: it.id });          // run 2 is now in flight
    const after = containerQueueReducer(items, { type: 'done', id: it.id, run: 1, result: result() });
    expect(after[0].status).toBe('reading');
  });

  it("does not restart an item that is no longer queued", () => {
    const it = makeContainerQueueItem(file('a.jpg'));
    let items = containerQueueReducer([it], { type: 'start', id: it.id });
    items = containerQueueReducer(items, { type: 'done', id: it.id, run: 1, result: result() });
    expect(containerQueueReducer(items, { type: 'start', id: it.id })[0].status).toBe('success');
  });

  it('normalizes edits: number upper-cased without separators, weights digits only', () => {
    const it = makeContainerQueueItem(file('a.jpg'));
    let items = containerQueueReducer([it], { type: 'setField', id: it.id, field: 'container_no', value: 'hpcu 533004-2' });
    items = containerQueueReducer(items, { type: 'setField', id: it.id, field: 'tare', value: '3 700 kg' });
    expect(items[0].fields).toMatchObject({ container_no: 'HPCU5330042', tare: '3700' });
  });

  it('normalizes seal edits: letters and digits only, brand upper-cased', () => {
    const it = makeContainerQueueItem(file('a.jpg'));
    let items = containerQueueReducer([it], { type: 'setField', id: it.id, field: 'seal_no', value: 'wha 4453-729' });
    items = containerQueueReducer(items, { type: 'setField', id: it.id, field: 'seal_brand', value: 'wan hai' });
    expect(items[0].fields).toMatchObject({ seal_no: 'WHA4453729', seal_brand: 'WAN HAI' });
  });

  it('retryFailed only requeues failed items, used items can be cleared', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((n) => makeContainerQueueItem(file(`${n}.jpg`)));
    let items = containerQueueReducer([{ ...a, status: 'failed' }, { ...b, status: 'success' }, { ...c, status: 'used' }], { type: 'retryFailed' });
    expect(items.map((i) => i.status)).toEqual(['queued', 'success', 'used']);
    items = containerQueueReducer(items, { type: 'clearUsed' });
    expect(items).toHaveLength(2);
    expect(containerQueueStats(items)).toMatchObject({ total: 2, queued: 1, success: 1, done: 1 });
  });

  it('a photo added to the table leaves the queue; another photo of that container stays flagged', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((n) => makeContainerQueueItem(file(`${n}.jpg`)));
    const withNo = (it: typeof a, no: string) => ({ ...it, status: 'success' as const, fields: { ...it.fields, container_no: no } });
    const items = containerQueueReducer([withNo(a, 'HPCU5330042'), withNo(b, 'HPCU5330042'), withNo(c, 'TGHU1234567')], { type: 'used', ids: [a.id] });
    expect(items.map((i) => i.name)).toEqual(['b.jpg', 'c.jpg']);
    expect([...duplicateContainerIds(items)]).toEqual([b.id]); // still not added a second time by "look up all"
  });

  it('flags the same container number read from two photos', () => {
    const a = { ...makeContainerQueueItem(file('a.jpg')), status: 'success' as const, fields: { container_no: 'HPCU5330042', tare: '', max_gross: '', seal_no: '', seal_brand: '' } };
    const b = { ...makeContainerQueueItem(file('b.jpg')), status: 'review' as const, fields: { container_no: 'HPCU5330042', tare: '', max_gross: '', seal_no: '', seal_brand: '' } };
    expect(duplicateContainerIds([a, b])).toEqual(new Set([b.id]));
  });

  it('skips files already in the queue (same name, size, date)', () => {
    const it = makeContainerQueueItem(file('a.jpg', 10));
    const { fresh, skipped } = dedupeContainerFiles([file('a.jpg', 10), file('b.jpg', 10), file('b.jpg', 10)], [it]);
    expect(fresh.map((f) => f.name)).toEqual(['b.jpg']);
    expect(skipped).toBe(2);
  });
});
