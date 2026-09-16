import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useServerTable } from './useServerTable';

type Row = { id: number; queried_at?: string };
const makeData = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

const fakeServer = (data: Row[]) =>
  vi.fn(async (limit: number, offset: number) => ({ items: data.slice(offset, offset + limit), total: data.length }));

beforeEach(() => localStorage.clear());

describe('useServerTable', () => {
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
