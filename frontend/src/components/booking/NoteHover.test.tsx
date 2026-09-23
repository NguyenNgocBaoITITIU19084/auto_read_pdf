import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NoteHover, getBookingNote } from './NoteHover';

describe('getBookingNote', () => {
  it('treats missing, blank and "null" as no note', () => {
    expect(getBookingNote({})).toBe('');
    expect(getBookingNote({ 'Ghi chú': '  ' })).toBe('');
    expect(getBookingNote({ 'Ghi chú': 'null' })).toBe('');
    expect(getBookingNote({ 'Ghi chú': ' Gọi khách ' })).toBe('Gọi khách');
  });
});

describe('NoteHover', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the note after hovering and hides it on leave', () => {
    render(<NoteHover note={'Dòng 1\nDòng 2'} title="Ghi chú"><span>SGN1</span></NoteHover>);
    const anchor = screen.getByText('SGN1');
    fireEvent.mouseEnter(anchor.parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Dòng 1');
    expect(document.body).toContainElement(screen.getByRole('tooltip'));
    fireEvent.mouseLeave(anchor.parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does nothing without a note', () => {
    render(<NoteHover note="" title="Ghi chú"><span>SGN2</span></NoteHover>);
    fireEvent.mouseEnter(screen.getByText('SGN2').parentElement!);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
