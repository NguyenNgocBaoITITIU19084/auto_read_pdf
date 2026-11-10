import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { BookingTasks } from '../../types';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));
vi.mock('../../context/ToastContext', () => ({ useToastActions: () => ({ addToast }) }));
vi.mock('../booking/BookingDetailModal', () => ({
  BookingDetailModal: ({ isOpen, booking }: any) => (isOpen ? <div data-testid="detail">{booking['Booking No']}</div> : null),
}));
const load = vi.fn();
vi.mock('../../services/api', () => ({
  getBookingTasksApi: (...a: unknown[]) => load(...a),
  getCollections: async () => [{ id: 5, name: 'Kho A', created_at: '' }],
}));
const copied = vi.fn();
vi.mock('../../utils/formatters', () => ({ copyTextToClipboard: async (text: string) => { copied(text); return true; } }));

import { TasksTab } from './TasksTab';

const k = translations.vi.booking.tasks;
const data: BookingTasks = {
  date: '10/11/2026', tomorrow_date: '11/11/2026', generated_at: '10/11/2026 08:15',
  late: [{ id: 1, 'Booking No': 'SGN3527323', 'Hạn cut-off': '09/11/2026 21:00', 'Cut-off cả ngày': false,
    'Trạng thái': 'stuffed', 'Bộ sưu tập': 'Kho A', collection_id: 5 } as any],
  today: [], tomorrow: [],
};

beforeEach(() => {
  addToast.mockReset();
  copied.mockReset();
  load.mockReset();
  localStorage.clear();
});

describe('TasksTab', () => {
  it('shows the three columns, opens a booking and copies the list', async () => {
    load.mockResolvedValue(data);
    render(<TasksTab />);
    expect(load).toHaveBeenCalledWith(null);
    const row = await screen.findByText('SGN3527323');
    expect(screen.getByRole('region', { name: k.late })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Cut-off hôm nay 10\/11/ })).toHaveTextContent(k.columnEmpty);
    expect(screen.getByText('09/11 21:00')).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.getByTestId('detail')).toHaveTextContent('SGN3527323');

    fireEvent.click(screen.getByRole('button', { name: k.copy }));
    await waitFor(() => expect(copied).toHaveBeenCalled());
    expect(copied.mock.calls[0][0]).toContain('• 09/11 21:00 – SGN3527323 – Đã đóng hàng');
    expect(addToast).toHaveBeenCalledWith(k.copied, 'success');
  });

  it('reloads for the chosen collection, remembers it and names it in the message', async () => {
    load.mockResolvedValue(data);
    render(<TasksTab />);
    await screen.findByRole('option', { name: 'Kho A' });
    fireEvent.change(screen.getByLabelText(k.scopeLabel), { target: { value: '5' } });
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(5));
    expect(localStorage.getItem('tasks.collectionId')).toBe('5');
    await screen.findByText('SGN3527323');
    fireEvent.click(screen.getByRole('button', { name: k.copy }));
    await waitFor(() => expect(copied).toHaveBeenCalled());
    expect(copied.mock.calls[0][0]).toContain('Bộ sưu tập: Kho A');
  });

  it('shows an error with a retry, and copying stays off', async () => {
    load.mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce(data);
    render(<TasksTab />);
    expect(await screen.findByText(k.error)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: k.copy })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: k.retry }));
    expect(await screen.findByText('SGN3527323')).toBeInTheDocument();
  });

  it('has nothing to copy when there is no work', async () => {
    load.mockResolvedValue({ ...data, late: [] });
    render(<TasksTab />);
    expect(await screen.findByText(k.empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: k.copy })).toBeDisabled();
  });
});
