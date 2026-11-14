import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const api = vi.hoisted(() => ({ saveManualBookingApi: vi.fn(), updateBookingApi: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => api);
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ t: translations.vi, activeCollection: { id: 7, name: 'A', created_at: '' }, addToast: toast }),
}));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => async () => true }));

import { BookingFormModal } from './BookingFormModal';
const f = translations.vi.booking.form;
const cols = translations.vi.booking.columns;

beforeEach(() => {
  api.saveManualBookingApi.mockReset();
  api.updateBookingApi.mockReset();
  toast.mockReset();
});

describe('BookingFormModal', () => {
  it('creates a booking and reports duplicate warnings', async () => {
    api.saveManualBookingApi.mockResolvedValue({ item: { id: 5, 'Booking No': 'SGN1' }, warnings: ['dup!'] });
    const onSaved = vi.fn();
    render(<BookingFormModal isOpen mode="create" onClose={() => {}} onSaved={onSaved} />);
    const save = screen.getByRole('button', { name: f.save });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(cols['Booking No']), { target: { value: 'SGN1' } });
    fireEvent.change(screen.getByLabelText(cols.ETD), { target: { value: '31/04/2026' } });
    fireEvent.blur(screen.getByLabelText(cols.ETD));
    expect(screen.getByText(f.dateTimeInvalid)).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(cols.ETD), { target: { value: '30/04/2026' } });
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 5, 'Booking No': 'SGN1' }, 'create'));
    expect(api.saveManualBookingApi.mock.calls[0][0]).toBe(7);
    expect(api.saveManualBookingApi.mock.calls[0][1]).toMatchObject({ 'Booking No': 'SGN1', ETD: '30/04/2026' });
    expect(toast).toHaveBeenCalledWith('dup!', 'info');
  });

  it('edits only changed fields', async () => {
    api.updateBookingApi.mockResolvedValue({ item: { id: 9, 'Booking No': 'A1', Vessel: 'NEW' }, warnings: [] });
    const onSaved = vi.fn();
    render(<BookingFormModal isOpen mode="edit" booking={{ id: 9, 'Booking No': 'A1', Vessel: 'OLD' } as any} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(cols.Vessel), { target: { value: 'NEW' } });
    fireEvent.keyDown(screen.getByLabelText(cols.Vessel), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(api.updateBookingApi).toHaveBeenCalledWith(9, { Vessel: 'NEW' }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ Vessel: 'NEW' }), 'edit');
  });

  it('saves an edit when ETD carries a time, and shows a prefilled invalid value at once', () => {
    const { unmount } = render(<BookingFormModal isOpen mode="edit" booking={{ id: 3, 'Booking No': '339IVN0139237', ETD: '21/11/2026 14:30' } as any} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(cols.Carrier), { target: { value: 'MSC' } });
    expect(screen.getByRole('button', { name: f.save })).toBeEnabled();
    unmount();
    render(<BookingFormModal isOpen mode="edit" booking={{ id: 4, 'Booking No': 'B', ETD: '31/04/2026' } as any} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText(f.dateTimeInvalid)).toBeInTheDocument();
  });

  it('shows each error as soon as it is typed, with a correct example and a count by the save button', () => {
    render(<BookingFormModal isOpen mode="edit" booking={{ id: 6, 'Booking No': 'B' } as any} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(cols["Q'ty"]), { target: { value: 'ba' } });
    fireEvent.change(screen.getByLabelText(cols['Port Cargo Cut-off']), { target: { value: '2026-11-19' } });
    expect(screen.getByText(f.qtyInvalid)).toHaveTextContent('Ví dụ đúng: 3');
    expect(screen.getByText(f.dateTimeInvalid)).toHaveTextContent('21/11/2026 14:30');
    expect(screen.getByRole('status')).toHaveTextContent('Còn 2 ô bị lỗi');
    expect(screen.getByRole('button', { name: f.save })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(cols['Booking No']), { target: { value: '' } });
    expect(screen.getByText(f.identityRequired)).toBeInTheDocument();
  });

  it('shows the server error message', async () => {
    api.saveManualBookingApi.mockRejectedValue({ response: { status: 400, data: { detail: 'ETD: ngày không hợp lệ' } } });
    render(<BookingFormModal isOpen mode="create" onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(cols['Booking No']), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: f.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ETD: ngày không hợp lệ');
  });
});
