import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { virtualPadding, useVirtualRows } from './useVirtualRows';

describe('virtualPadding', () => {
  it('computes spacer heights around the rendered window', () => {
    expect(virtualPadding([{ start: 330, end: 363 }, { start: 363, end: 396 }], 3300)).toEqual({ top: 330, bottom: 2904 });
  });
  it('is zero when nothing is rendered', () => {
    expect(virtualPadding([], 0)).toEqual({ top: 0, bottom: 0 });
  });
});

describe('useVirtualRows', () => {
  it('renders every row below the threshold', () => {
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useVirtualRows(5, ref));
    expect(result.current).toEqual({ enabled: false, indexes: [0, 1, 2, 3, 4], paddingTop: 0, paddingBottom: 0 });
  });
});
