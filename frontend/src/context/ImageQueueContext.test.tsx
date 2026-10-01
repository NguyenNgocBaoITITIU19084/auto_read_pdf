import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import type { ImageExtractResult } from '../types';

const addToast = vi.fn();
const confirm = vi.fn();
let activeCollection: { id: number; name: string } | null = { id: 1, name: 'Test' };
vi.mock('./AppContext', () => ({ useApp: () => ({ t: translations.vi, activeCollection }) }));
vi.mock('./ToastContext', () => ({ useToastActions: () => ({ addToast }) }));
vi.mock('../hooks/useConfirm', () => ({ useConfirm: () => confirm }));

const extract = vi.fn();
const checkDuplicates = vi.fn();
const saveManual = vi.fn();
vi.mock('../services/api', () => ({
  extractBookingImageDetailedApi: (...a: unknown[]) => extract(...a),
  checkBookingDuplicatesApi: (...a: unknown[]) => checkDuplicates(...a),
  saveManualBookingApi: (...a: unknown[]) => saveManual(...a),
}));

import { ImageQueueProvider, MAX_QUEUE_ITEMS, RETRY_DELAYS, useImageQueue } from './ImageQueueContext';

const wrapper = ({ children }: { children: React.ReactNode }) => <ImageQueueProvider>{children}</ImageQueueProvider>;
const png = (name: string, size = 5) => new File([new Uint8Array(size)], name, { type: 'image/png', lastModified: 1 });
const ok = (no: string, over: Partial<ImageExtractResult> = {}): ImageExtractResult => ({
  data: { 'Booking No': no, Vessel: 'HMM HOPE 062E' }, engine_used: 'gemini', warnings: [], model_used: 'gemini-2.5-flash', ...over,
});

/** A request the test resolves by hand, to observe what runs while another is in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const q = translations.vi.booking.imageQueue;
const statuses = (r: { current: ReturnType<typeof useImageQueue> }) => r.current.items.map((i) => i.status);

describe('ImageQueueProvider', () => {
  beforeEach(() => {
    RETRY_DELAYS.transientMs = 10;
    addToast.mockReset();
    confirm.mockReset().mockResolvedValue(true);
    extract.mockReset();
    checkDuplicates.mockReset().mockResolvedValue([]);
    saveManual.mockReset().mockImplementation(async (_col: number, b: any) => ({ item: { id: 100 + Math.random(), ...b }, warnings: [] }));
    activeCollection = { id: 1, name: 'Test' };
  });

  it('reads one image at a time, in order', async () => {
    const first = deferred<ImageExtractResult>();
    const second = deferred<ImageExtractResult>();
    extract.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useImageQueue(), { wrapper });

    act(() => { result.current.enqueue([png('a.png'), png('b.png')], 'upload'); });
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    expect(statuses(result)).toEqual(['reading', 'queued']);

    await act(async () => { first.resolve(ok('SGN1')); });
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(2));
    expect(statuses(result)).toEqual(['success', 'reading']);
    expect((extract.mock.calls[0][0] as File).name).toBe('a.png');

    await act(async () => { second.resolve(ok('SGN2')); });
    await waitFor(() => expect(statuses(result)).toEqual(['success', 'success']));
    expect(extract).toHaveBeenCalledTimes(2);
    expect(result.current.items[0]).toMatchObject({ engine: 'gemini', model: 'gemini-2.5-flash' });
  });

  it('marks a failed request, and re-reads it on retry', async () => {
    extract.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(ok('SGN1'));
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png')], 'upload'); });
    await waitFor(() => expect(statuses(result)).toEqual(['failed']));
    expect(result.current.items[0].error).toBe('Network Error');

    act(() => { result.current.retry(result.current.items[0].id); });
    await waitFor(() => expect(statuses(result)).toEqual(['success']));
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('pauses on a Gemini quota answer instead of accepting the OCR fallback, and re-reads that image on resume', async () => {
    extract
      .mockResolvedValueOnce(ok('SGN1'))
      .mockResolvedValueOnce(ok('SGN2', { engine_used: 'ocr', gemini_error_kind: 'quota', warnings: ['quota'] }))
      .mockResolvedValueOnce(ok('SGN2'));
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png'), png('b.png'), png('c.png')], 'upload'); });

    await waitFor(() => expect(result.current.paused).toBe('quota'));
    expect(statuses(result)).toEqual(['success', 'queued', 'queued']); // b is waiting again, c untouched
    expect(extract).toHaveBeenCalledTimes(2);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(extract).toHaveBeenCalledTimes(2);                          // nothing more while paused

    act(() => { result.current.resume(); });
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(3));
    expect((extract.mock.calls[2][0] as File).name).toBe('b.png');
  });

  it('accepts PDFs and keeps reading them while Gemini has paused the images', async () => {
    const pdf = (name: string) => new File([new Uint8Array(4)], name, { type: 'application/pdf', lastModified: 1 });
    extract
      .mockResolvedValueOnce(ok('SGN1', { engine_used: 'ocr', gemini_error_kind: 'quota', warnings: ['quota'] }))
      .mockResolvedValueOnce(ok('PDF1', { engine_used: 'pdf', data: { 'Booking No': 'PDF1', Vessel: 'YM CELEBRITY 107A', ETD: '02/10/2026' } }));
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png'), png('b.png'), pdf('c.pdf')], 'upload'); });

    await waitFor(() => expect(statuses(result)).toEqual(['queued', 'queued', 'success']));
    expect(result.current.paused).toBe('quota');
    expect((extract.mock.calls[1][0] as File).name).toBe('c.pdf');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(extract).toHaveBeenCalledTimes(2); // the images wait for Resume
    expect(addToast).not.toHaveBeenCalledWith(q.onlyImages, 'info');
  });

  it('can be paused by the user; the image already being read still finishes', async () => {
    const first = deferred<ImageExtractResult>();
    extract.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png'), png('b.png')], 'upload'); });
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    act(() => { result.current.pause(); });
    await act(async () => { first.resolve(ok('SGN1')); });
    await waitFor(() => expect(statuses(result)).toEqual(['success', 'queued']));
    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.current.paused).toBe('user');
  });

  it('aborts the request of a removed image and carries on with the next', async () => {
    const first = deferred<ImageExtractResult>();
    extract.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok('SGN2'));
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png'), png('b.png')], 'upload'); });
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    const signal = extract.mock.calls[0][2] as AbortSignal;

    act(() => { result.current.remove(result.current.items[0].id); });
    expect(signal.aborted).toBe(true);
    await act(async () => { first.reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })); });
    await waitFor(() => expect(statuses(result)).toEqual(['success']));
    expect(result.current.items[0].name).toBe('b.png');
    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining('canceled'), 'error');
  });

  it('refuses to queue without a collection, drops repeated files and caps the queue', () => {
    extract.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderHook(() => useImageQueue(), { wrapper });

    activeCollection = null;
    rerender(); // the app re-renders the provider when the active collection changes
    act(() => { result.current.enqueue([png('a.png')], 'upload'); });
    expect(result.current.items).toHaveLength(0);
    expect(addToast).toHaveBeenCalledWith(translations.vi.booking.paste.noCollection, 'error');

    activeCollection = { id: 1, name: 'Test' };
    rerender();
    let res!: ReturnType<typeof result.current.enqueue>;
    act(() => { res = result.current.enqueue([png('a.png'), png('a.png'), png('b.png')], 'drop'); });
    expect(res).toMatchObject({ added: 2, duplicates: 1 });

    const many = Array.from({ length: MAX_QUEUE_ITEMS + 5 }, (_, i) => png(`x${i}.png`, i + 1));
    act(() => { res = result.current.enqueue(many, 'upload'); });
    expect(result.current.items).toHaveLength(MAX_QUEUE_ITEMS);
    expect(res.rejected).toBe(7);
  });

  it('keeps the collection that was active when the image was added', async () => {
    extract.mockResolvedValue(ok('SGN1'));
    const { result, rerender } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png')], 'upload'); });
    await waitFor(() => expect(statuses(result)).toEqual(['success']));

    activeCollection = { id: 2, name: 'Other' };
    rerender();
    await act(async () => { await result.current.save(result.current.items[0].id); });
    expect(saveManual).toHaveBeenCalledWith(1, expect.objectContaining({ 'Booking No': 'SGN1' }));
    expect(statuses(result)).toEqual(['saved']);
    expect(result.current.lastSaved?.collectionId).toBe(1);
    expect(result.current.savedVersion).toBe(1);
  });

  it('save-all saves only successful images and skips repeated Booking Nos', async () => {
    extract
      .mockResolvedValueOnce(ok('SGN1'))
      .mockResolvedValueOnce(ok('sgn1'))                                   // repeated in the batch
      .mockResolvedValueOnce(ok('SGN3', { engine_used: 'ocr' }))            // needs review: not auto-saved
      .mockResolvedValueOnce(ok('SGN4'));                                   // already in the database
    checkDuplicates.mockImplementation(async (_c: number, nos: string[]) => (nos[0] === 'SGN4' ? ['SGN4'] : []));
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png'), png('b.png'), png('c.png'), png('d.png')], 'upload'); });
    await waitFor(() => expect(result.current.stats.finished).toBe(4));
    await waitFor(() => expect(result.current.items[3].dbDuplicate).toBe(true));

    await act(async () => { await result.current.saveAllSuccessful(); });
    expect(saveManual).toHaveBeenCalledTimes(1);
    expect(statuses(result)).toEqual(['saved', 'success', 'review', 'success']);
    expect(addToast).toHaveBeenCalledWith(translations.vi.booking.imageQueue.savedAllSkipped.replace('{saved}', '1').replace('{skipped}', '2'), 'success');
  });

  it('asks before saving a repeated Booking No by hand, and does nothing when declined', async () => {
    extract.mockResolvedValue(ok('SGN1'));
    checkDuplicates.mockResolvedValue(['SGN1']);
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png')], 'upload'); });
    await waitFor(() => expect(result.current.items[0]?.dbDuplicate).toBe(true));

    confirm.mockResolvedValueOnce(false);
    await act(async () => { expect(await result.current.save(result.current.items[0].id)).toBe(false); });
    expect(saveManual).not.toHaveBeenCalled();

    await act(async () => { expect(await result.current.save(result.current.items[0].id)).toBe(true); });
    expect(saveManual).toHaveBeenCalledTimes(1);
  });

  it('flags a batch that is read without a Gemini key', async () => {
    extract.mockResolvedValue(ok('SGN1', { engine_used: 'ocr', gemini_error_kind: 'no_key', warnings: ['no key'], model_used: null }));
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png')], 'upload'); });
    await waitFor(() => expect(result.current.geminiIssue).toBe('no_key'));
    expect(statuses(result)).toEqual(['review']);
  });

  it('treats a Google overload like a pause: one more try after a short wait, then the queue stops', async () => {
    const overloaded = ok('SGN1', { engine_used: 'ocr', gemini_error_kind: 'unavailable', warnings: ['high demand'] });
    extract.mockResolvedValueOnce(overloaded).mockResolvedValueOnce(ok('SGN1')).mockResolvedValueOnce(overloaded).mockResolvedValueOnce(overloaded);
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    act(() => { result.current.enqueue([png('a.png'), png('b.png')], 'upload'); });

    // a: overloaded once -> retried -> read by Gemini. b: overloaded twice in a row -> the queue pauses and b
    // waits (a weaker offline-OCR reading is not accepted)
    await waitFor(() => expect(result.current.paused).toBe('unavailable'));
    expect(statuses(result)).toEqual(['success', 'queued']);
    expect(extract.mock.calls.map((c) => (c[0] as File).name)).toEqual(['a.png', 'a.png', 'b.png', 'b.png']);
    expect(result.current.items[0]).toMatchObject({ engine: 'gemini' });
  });

  it('exposes how many more images fit', () => {
    extract.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useImageQueue(), { wrapper });
    expect(result.current.room).toBe(MAX_QUEUE_ITEMS);
    act(() => { result.current.enqueue([png('a.png'), png('b.png')], 'upload'); });
    expect(result.current.room).toBe(MAX_QUEUE_ITEMS - 2);
  });
});
