import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import type { ContainerImageResult } from '../types';

vi.mock('./AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));
const addToast = vi.fn();
vi.mock('./ToastContext', () => ({ useToastActions: () => ({ addToast }) }));
const extract = vi.fn();
vi.mock('../services/api', () => ({ extractContainerImageApi: (...a: unknown[]) => extract(...a) }));

import { ContainerImageQueueProvider, MAX_CONTAINER_QUEUE_ITEMS, useContainerImageQueue } from './ContainerImageQueueContext';

const wrapper = ({ children }: { children: React.ReactNode }) => <ContainerImageQueueProvider>{children}</ContainerImageQueueProvider>;
const img = (name: string) => new File([name], name, { type: 'image/jpeg', lastModified: 1 });
const ok = (no = 'HPCU5330042'): ContainerImageResult => ({
  data: { container_no: no, tare_kg: 3700, max_gross_kg: 32500, check_digit_ok: true, seal_no: '', seal_brand: '' }, engine_used: 'gemini', warnings: [], model_used: 'm', gemini_error_kind: null,
});
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  extract.mockReset();
  addToast.mockReset();
});

describe('ContainerImageQueueProvider', () => {
  it('reads one photo at a time, in order', async () => {
    const first = deferred<ContainerImageResult>();
    extract.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok('CSQU3054383'));
    const { result } = renderHook(() => useContainerImageQueue(), { wrapper });
    act(() => { result.current.enqueue([img('a.jpg'), img('b.jpg')]); });
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    expect(result.current.items.map((i) => i.status)).toEqual(['reading', 'queued']);
    await act(async () => { first.resolve(ok()); });
    await waitFor(() => expect(result.current.items.map((i) => i.status)).toEqual(['success', 'success']));
    expect(extract).toHaveBeenCalledTimes(2);
    expect((extract.mock.calls[0][0] as File).name).toBe('a.jpg');
  });

  it('pauses on a Gemini quota error without losing the photo, and continues on resume', async () => {
    extract.mockResolvedValueOnce({ ...ok(), gemini_error_kind: 'quota', engine_used: 'ocr' }).mockResolvedValueOnce(ok());
    const { result } = renderHook(() => useContainerImageQueue(), { wrapper });
    act(() => { result.current.enqueue([img('a.jpg')]); });
    await waitFor(() => expect(result.current.paused).toBe('quota'));
    expect(result.current.items[0].status).toBe('queued');
    act(() => result.current.resume());
    await waitFor(() => expect(result.current.items[0].status).toBe('success'));
  });

  it('marks a photo failed when the request errors', async () => {
    extract.mockRejectedValueOnce({ response: { data: { detail: 'Ảnh rỗng' } } });
    const { result } = renderHook(() => useContainerImageQueue(), { wrapper });
    act(() => { result.current.enqueue([img('a.jpg')]); });
    await waitFor(() => expect(result.current.items[0].status).toBe('failed'));
    expect(result.current.items[0].error).toBe('Ảnh rỗng');
  });

  it('ignores non-images, skips repeats and caps the queue', async () => {
    extract.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useContainerImageQueue(), { wrapper });
    act(() => { expect(result.current.enqueue([new File(['x'], 'a.pdf', { type: 'application/pdf' })])).toBe(0); });
    act(() => { result.current.enqueue([img('a.jpg')]); });
    act(() => { result.current.enqueue([img('a.jpg')]); });
    expect(result.current.items).toHaveLength(1);
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('Bỏ qua 1 ảnh'), 'info');
    act(() => { result.current.enqueue(Array.from({ length: MAX_CONTAINER_QUEUE_ITEMS + 5 }, (_, i) => img(`m${i}.jpg`))); });
    expect(result.current.items).toHaveLength(MAX_CONTAINER_QUEUE_ITEMS);
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('tối đa'), 'error');
  });
});
