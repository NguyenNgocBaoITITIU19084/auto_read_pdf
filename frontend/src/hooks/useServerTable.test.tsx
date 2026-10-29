import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useServerTable } from './useServerTable';

type Row = { id: number; queried_at?: string };
const makeData = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

const fakeServer = (data: Row[]) =>
  vi.fn(async (limit: number, offset: number) => ({ items: data.slice(offset, offset + limit), total: data.length }));

beforeEach(() => localStorage.clear());

describe('useServerTable', () => {
  it('keeps the rows on screen while a new search loads, the skeleton only for a new resetKey', async () => {
    let release: (() => void) | null = null;
    const data = makeData(30);
    const fetchPage = vi.fn((limit: number, offset: number) => new Promise<{ items: Row[]; total: number }>((resolve) => {
      release = () => resolve({ items: data.slice(offset, offset + limit), total: data.length });
    }));
    const { result, rerender } = renderHook(({ q, col }) =>
      useServerTable<Row, { items: Row[]; total: number }>({
        enabled: true, queryKey: `${col}|${q}`, resetKey: col, pageSizeStorageKey: 't_size', fetchPage,
      }), { initialProps: { q: '', col: '1' } });

    expect(result.current.loading).toBe(true);            // first load: skeleton
    await act(async () => release!());
    expect(result.current.rows).toHaveLength(30);

    rerender({ q: 'sky', col: '1' });                       // typing: old rows stay, flagged as refreshing
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.rows).toHaveLength(30);
    await act(async () => release!());
    expect(result.current.refreshing).toBe(false);

    rerender({ q: 'sky', col: '2' });                       // another collection: skeleton again
    expect(result.current.loading).toBe(true);
    await act(async () => release!());
  });

  it('an answer that comes back late does not replace a newer one', async () => {
    const pending: Record<string, (rows: Row[]) => void> = {};
    let key = 'a';
    const fetchPage = vi.fn(() => new Promise<{ items: Row[]; total: number }>((resolve) => {
      const k = key;
      pending[k] = (rows) => resolve({ items: rows, total: rows.length });
    }));
    const { result, rerender } = renderHook(({ q }) =>
      useServerTable<Row, { items: Row[]; total: number }>({
        enabled: true, queryKey: q, resetKey: 'col', pageSizeStorageKey: 't_size', fetchPage,
      }), { initialProps: { q: 'a' } });
    await act(async () => pending.a(makeData(5)));
    key = 'ab';
    rerender({ q: 'ab' });
    key = 'abc';
    rerender({ q: 'abc' });
    await act(async () => pending.abc([{ id: 99 }]));
    await act(async () => pending.ab(makeData(3)));        // the older query answers last
    expect(result.current.rows.map((r) => r.id)).toEqual([99]);
    expect(result.current.refreshing).toBe(false);
  });

  it('loads the first page and pages through offsets', async () => {
    const fetchPage = fakeServer(makeData(120));
    localStorage.setItem('t_size', '50');
    const { result } = renderHook(() =>
      useServerTable<Row, { items: Row[]; total: number }>({ enabled: true, queryKey: 'a', pageSizeStorageKey: 't_size', fetchPage }));
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    expect(result.current.total).toBe(120);
    act(() => result.current.setCurrentPage(3));
    await waitFor(() => expect(result.current.rows[0].id).toBe(101));
    expect(fetchPage).toHaveBeenLastCalledWith(50, 100);
  });

  it('resets to page 1 when the query changes', async () => {
    const fetchPage = fakeServer(makeData(120));
    const { result, rerender } = renderHook(({ q }) =>
      useServerTable<Row, { items: Row[]; total: number }>({ enabled: true, queryKey: q, pageSizeStorageKey: 't_size', fetchPage }),
      { initialProps: { q: 'a' } });
    await waitFor(() => expect(result.current.total).toBe(120));
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(result.current.currentPage).toBe(2));
    rerender({ q: 'b' });
    await waitFor(() => expect(result.current.currentPage).toBe(1));
    expect(fetchPage).toHaveBeenLastCalledWith(50, 0);
  });

  it('silent reload keeps row identity when nothing changed', async () => {
    const fetchPage = fakeServer(makeData(10));
    const { result } = renderHook(() =>
      useServerTable<Row, { items: Row[]; total: number }>({ enabled: true, queryKey: 'a', pageSizeStorageKey: 't_size', fetchPage }));
    await waitFor(() => expect(result.current.rows).toHaveLength(10));
    const before = result.current.rows;
    await act(() => result.current.reload('silent'));
    expect(result.current.rows).toBe(before);
  });

  it('moves back to the last page when rows were deleted', async () => {
    let data = makeData(101);
    const fetchPage = vi.fn(async (limit: number, offset: number) => ({ items: data.slice(offset, offset + limit), total: data.length }));
    const { result } = renderHook(() =>
      useServerTable<Row, { items: Row[]; total: number }>({ enabled: true, queryKey: 'a', pageSizeStorageKey: 't_size', fetchPage }));
    await waitFor(() => expect(result.current.total).toBe(101));
    act(() => result.current.setCurrentPage(3));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    data = makeData(100);
    await act(() => result.current.reload('refresh'));
    await waitFor(() => expect(result.current.currentPage).toBe(2));
  });
});
