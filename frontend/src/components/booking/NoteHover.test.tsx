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

  const labels = { title: 'Thêm ghi chú', placeholder: 'Nhập ghi chú', save: 'Lưu', saving: 'Đang lưu', hint: '' };

  it('offers a quick-add form for a booking without a note and saves it', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NoteHover note="" title="Thêm ghi chú" onSave={onSave} addLabels={labels}><span>SGN3</span></NoteHover>);
    fireEvent.mouseEnter(screen.getByText('SGN3').parentElement!);
    act(() => { vi.advanceTimersByTime(300); });
    const box = screen.getByPlaceholderText('Nhập ghi chú');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    fireEvent.change(box, { target: { value: '  Gọi khách  ' } });
    // typing pins the form open even when the pointer leaves
    fireEvent.mouseLeave(screen.getByText('SGN3').parentElement!);
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await act(async () => {});
    expect(onSave).toHaveBeenCalledWith('Gọi khách');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the draft and shows the error when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Lỗi mạng'));
    render(<NoteHover note="" title="Thêm ghi chú" onSave={onSave} addLabels={labels}><span>SGN4</span></NoteHover>);
    fireEvent.mouseEnter(screen.getByText('SGN4').parentElement!);
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.change(screen.getByPlaceholderText('Nhập ghi chú'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await act(async () => {});
    expect(screen.getByText('Lỗi mạng')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nhập ghi chú')).toHaveValue('abc');
  });

  it('closes an untouched quick-add form when the pointer leaves', () => {
    render(<NoteHover note="" title="Thêm ghi chú" onSave={vi.fn()} addLabels={labels}><span>SGN5</span></NoteHover>);
    const anchor = screen.getByText('SGN5').parentElement!;
    fireEvent.mouseEnter(anchor);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseLeave(anchor);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('NoteHover editing an existing note', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const labels = { title: 'Thêm ghi chú', placeholder: 'Nhập ghi chú', save: 'Lưu', saving: 'Đang lưu', hint: '', edit: 'Sửa',
    editTitle: 'Sửa ghi chú' };

  it('without allowEdit: the note card has no edit button and lets the pointer through', () => {
    render(<NoteHover note="Gọi khách" title="Ghi chú" onSave={vi.fn()} addLabels={labels}><span>B1</span></NoteHover>);
    fireEvent.mouseEnter(screen.getByText('B1').parentElement!);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip')).toHaveClass('pointer-events-none');
    expect(screen.queryByRole('button', { name: /Sửa/ })).toBeNull();
  });

  it('with allowEdit: "Sửa" opens the note filled in, saves the change, and an empty save clears it', async () => {
    vi.useRealTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<NoteHover note="Chở sắt thép, cọc" title="Ghi chú" onSave={onSave} addLabels={labels} allowEdit delay={0}>
      <span>T1</span></NoteHover>);
    fireEvent.mouseEnter(screen.getByText('T1').parentElement!);
    const card = await screen.findByRole('tooltip');
    expect(card).not.toHaveClass('pointer-events-none');
    fireEvent.click(screen.getByRole('button', { name: /Sửa/ }));
    const form = screen.getByRole('dialog', { name: 'Sửa ghi chú' });
    const box = form.querySelector('textarea')!;
    expect(box).toHaveValue('Chở sắt thép, cọc');
    // leaving the card while editing keeps it open
    fireEvent.mouseLeave(screen.getByText('T1').parentElement!);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'Chở sắt thép, cọc · xong 18/11' } });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    await act(async () => {});
    expect(onSave).toHaveBeenLastCalledWith('Chở sắt thép, cọc · xong 18/11');
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<NoteHover note="Chở sắt thép, cọc · xong 18/11" title="Ghi chú" onSave={onSave} addLabels={labels} allowEdit delay={0}>
      <span>T1</span></NoteHover>);
    fireEvent.mouseEnter(screen.getByText('T1').parentElement!);
    await screen.findByRole('tooltip');
    fireEvent.click(screen.getByRole('button', { name: /Sửa/ }));
    fireEvent.change(screen.getByRole('dialog').querySelector('textarea')!, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Lưu'));
    await act(async () => {});
    expect(onSave).toHaveBeenLastCalledWith('');
  });
});
