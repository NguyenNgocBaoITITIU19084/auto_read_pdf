import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const addToastMock = vi.fn();
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ t: translations.vi, language: 'vi', addToast: addToastMock }),
}));

const confirmMock = vi.fn();
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirmMock }));

const getTrashMock = vi.fn();
const getIdsMock = vi.fn();
const restoreMock = vi.fn();
const deleteNowMock = vi.fn();
vi.mock('../../services/api', () => ({
  getBookingTrash: (...args: unknown[]) => getTrashMock(...args),
  getBookingTrashIds: (...args: unknown[]) => getIdsMock(...args),
  restoreBookingsApi: (...args: unknown[]) => restoreMock(...args),
  deleteTrashedBookingsApi: (...args: unknown[]) => deleteNowMock(...args),
}));

import { BookingTrashModal, formatTrashTime } from './BookingTrashModal';

const tt = translations.vi.booking.trash;
const row = (id: number, days_left = 30) => ({
  id, 'Booking No': `BK${id}`, Carrier: 'ONE', Vessel: 'EVER MEMO', deleted_at: '2026-10-03 14:05:09', purge_at: '', days_left,
});

/** A fake server trash of `ids` (newest first), paged like the real endpoint. */
let trash: number[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  trash = [2, 1];
  getTrashMock.mockImplementation(async (_col: number, limit: number, offset: number) => ({
    items: trash.slice(offset, offset + limit).map((id) => row(id, id === 2 ? 2 : 30)), total: trash.length, keep_days: 30,
  }));
  getIdsMock.mockImplementation(async () => [...trash]);
  restoreMock.mockImplementation(async (ids: number[]) => { trash = trash.filter((id) => !ids.includes(id)); return ids.length; });
  deleteNowMock.mockImplementation(async (ids: number[]) => { trash = trash.filter((id) => !ids.includes(id)); return ids.length; });
  confirmMock.mockResolvedValue(true);
});

describe('BookingTrashModal', () => {
  it('lists the first page of the collection trash', async () => {
    render(<BookingTrashModal isOpen onClose={() => {}} collectionId={7} />);
    expect(await screen.findByText('BK1')).toBeTruthy();
    expect(getTrashMock).toHaveBeenCalledWith(7, 50, 0);
    expect(screen.getByText('2 ngày')).toBeTruthy();
    expect(screen.getAllByText('14:05 03/10/2026')).toHaveLength(2);
  });

  it('restores one booking with its row button', async () => {
    const onChanged = vi.fn();
    render(<BookingTrashModal isOpen onClose={() => {}} collectionId={7} onChanged={onChanged} />);
    await screen.findByText('BK1');
    fireEvent.click(screen.getAllByRole('button', { name: tt.restore })[0]);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(restoreMock).toHaveBeenCalledWith([2]);
    await waitFor(() => expect(screen.queryByText('BK2')).toBeNull());
    expect(screen.getByText('BK1')).toBeTruthy();
  });

  it('restores every selected booking at once', async () => {
    render(<BookingTrashModal isOpen onClose={() => {}} collectionId={7} />);
    await screen.findByText('BK1');
    fireEvent.click(screen.getByLabelText(tt.selectAll));
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục 2 booking' }));
    await waitFor(() => expect(screen.getByText(tt.empty)).toBeTruthy());
    expect(restoreMock).toHaveBeenCalledWith([2, 1]);
    expect(addToastMock).toHaveBeenCalledWith('Đã khôi phục 2 booking', 'success');
  });

  it('deletes a booking for good after confirming', async () => {
    const onChanged = vi.fn();
    render(<BookingTrashModal isOpen onClose={() => {}} collectionId={7} onChanged={onChanged} />);
    await screen.findByText('BK1');
    fireEvent.click(screen.getAllByRole('button', { name: tt.deleteNow })[1]);
    await waitFor(() => expect(deleteNowMock).toHaveBeenCalledWith([1]));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    await waitFor(() => expect(screen.queryByText('BK1')).toBeNull());
    expect(onChanged).toHaveBeenCalled();
    expect(addToastMock).toHaveBeenCalledWith('Đã xoá vĩnh viễn 1 booking', 'success');
  });

  it('keeps the bookings when the permanent delete is cancelled', async () => {
    confirmMock.mockResolvedValue(false);
    render(<BookingTrashModal isOpen onClose={() => {}} collectionId={7} />);
    await screen.findByText('BK1');
    fireEvent.click(screen.getAllByRole('button', { name: tt.deleteNow })[0]);
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deleteNowMock).not.toHaveBeenCalled();
  });

  it('pages through a large trash and selects across pages', async () => {
    trash = Array.from({ length: 120 }, (_, i) => 120 - i);
    render(<BookingTrashModal isOpen onClose={() => {}} collectionId={7} />);
    await screen.findByText('BK120');
    expect(screen.queryByText('BK70')).toBeNull();
    fireEvent.click(screen.getByLabelText(tt.selectAll));
    fireEvent.click(screen.getByRole('button', { name: 'Chọn tất cả 120 booking' }));
    await screen.findByRole('button', { name: 'Xoá vĩnh viễn 120 booking' });
    fireEvent.click(screen.getByRole('button', { name: 'Xoá vĩnh viễn 120 booking' }));
    await waitFor(() => expect(deleteNowMock).toHaveBeenCalled());
    expect(deleteNowMock.mock.calls[0][0]).toHaveLength(120);
    await waitFor(() => expect(screen.getByText(tt.empty)).toBeTruthy());
  });

  it('falls back to the last page when the current one empties out', async () => {
    trash = Array.from({ length: 51 }, (_, i) => 51 - i);
    render(<BookingTrashModal isOpen onClose={() => {}} collectionId={7} />);
    await screen.findByText('BK51');
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === '2')!); // page 2
    await screen.findByText('BK1');
    fireEvent.click(screen.getByRole('button', { name: tt.restore }));
    await screen.findByText('BK51');
    expect(getTrashMock).toHaveBeenLastCalledWith(7, 50, 0);
  });

  it('formats server timestamps', () => {
    expect(formatTrashTime('2026-01-02 03:04:05')).toBe('03:04 02/01/2026');
    expect(formatTrashTime('')).toBe('');
  });
});
