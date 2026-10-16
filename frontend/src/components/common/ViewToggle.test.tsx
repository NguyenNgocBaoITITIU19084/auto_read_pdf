import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { TableView, useTourView } from './ViewToggle';
import { emitTourAction, hasTabTour } from '../../services/tourEvents';

const actions = { table: 'showBookingTable', calendar: 'showBookingCalendar' } as const;

const useHarness = (initial: TableView) => {
  const [view, setView] = useState<TableView>(initial);
  useTourView(view, setView, actions);
  return view;
};

describe('useTourView', () => {
  it('switches for the tour and puts back the view the user had', () => {
    const { result } = renderHook(() => useHarness('calendar'));
    act(() => emitTourAction('showBookingTable'));
    expect(result.current).toBe('table');
    act(() => emitTourAction('showBookingCalendar'));
    act(() => emitTourAction('showBookingTable'));
    act(() => emitTourAction('restoreViews'));
    expect(result.current).toBe('calendar');
  });

  it('leaves the view alone when the tour never changed it', () => {
    const { result } = renderHook(() => useHarness('table'));
    act(() => emitTourAction('showVesselCalendar'));
    act(() => emitTourAction('restoreViews'));
    expect(result.current).toBe('table');
  });
});

describe('hasTabTour', () => {
  it('only offers the screen tour where there is something new', () => {
    expect(hasTabTour('booking')).toBe(true);
    expect(hasTabTour('logs')).toBe(false);
  });
});
