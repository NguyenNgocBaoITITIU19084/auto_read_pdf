import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRowSelection } from './useRowSelection';

type Row = { id: number };
const getId = (r: Row) => r.id;

describe('useRowSelection pruneMissing=false', () => {
  it('keeps selections from other pages', () => {
    const page1 = [{ id: 1 }, { id: 2 }];
    const page2 = [{ id: 3 }, { id: 4 }];
    const { result, rerender } = renderHook(({ rows }) => useRowSelection<Row>(rows, getId, ['k'], { pruneMissing: false }),
      { initialProps: { rows: page1 } });
    act(() => result.current.selectPage(page1, true));
    rerender({ rows: page2 });
    act(() => result.current.toggle(3));
    expect(result.current.count).toBe(3);
    expect(result.current.selectedRows.map(getId)).toEqual([3]);
    act(() => result.current.selectIds([10, 11], true));
    expect(result.current.count).toBe(5);
  });

  it('default mode still prunes', () => {
    const { result, rerender } = renderHook(({ rows }) => useRowSelection<Row>(rows, getId, ['k']),
      { initialProps: { rows: [{ id: 1 }] } });
    act(() => result.current.toggle(1));
    rerender({ rows: [{ id: 2 }] });
    expect(result.current.count).toBe(0);
  });
});
