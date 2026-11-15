import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { FleetTrailer, FleetVehicle } from '../../types';

const addToast = vi.fn();
const confirmMock = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));
vi.mock('../../context/ToastContext', () => ({ useToastActions: () => ({ addToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirmMock }));
vi.mock('../common/ExportModal', () => ({ ExportModal: () => null }));

const api = {
  getFleetTrailersApi: vi.fn(),
  getFleetVehiclesApi: vi.fn(),
  getFleetHitchPageApi: vi.fn(),
  hitchFleetTrailerApi: vi.fn(),
  createFleetTrailerApi: vi.fn(),
  deleteFleetTrailerApi: vi.fn(),
  updateFleetTrailerApi: vi.fn(),
};
vi.mock('../../services/api', () => ({
  getFleetTrailersApi: (...a: unknown[]) => api.getFleetTrailersApi(...a),
  getFleetVehiclesApi: (...a: unknown[]) => api.getFleetVehiclesApi(...a),
  getFleetHitchPageApi: (...a: unknown[]) => api.getFleetHitchPageApi(...a),
  hitchFleetTrailerApi: (...a: unknown[]) => api.hitchFleetTrailerApi(...a),
  createFleetTrailerApi: (...a: unknown[]) => api.createFleetTrailerApi(...a),
  deleteFleetTrailerApi: (...a: unknown[]) => api.deleteFleetTrailerApi(...a),
  updateFleetTrailerApi: (...a: unknown[]) => api.updateFleetTrailerApi(...a),
  uploadFleetTrailerPhotoApi: vi.fn(),
  deleteFleetTrailerPhotoApi: vi.fn(),
  getFleetTrashCountApi: async () => ({ vehicle: 0, driver: 0, trailer: 2 }),
  fleetVehicleTrashApi: {}, fleetDriverTrashApi: {}, fleetTrailerTrashApi: {},
  fleetPhotoUrl: (name: string) => (name ? `http://api/fleet/photos/${name}` : ''),
}));

import { TrailerTab } from './TrailerTab';

const R = translations.vi.fleet.trailer;
const trailer = (id: number, plate: string, extra: Partial<FleetTrailer> = {}): FleetTrailer => ({
  id, plate, trailer_type: '', chassis_no: '', payload: '', year: '', registration_expiry: '', insurance_expiry: '', status: 'active',
  note: '', photo: '', created_at: '', updated_at: '', vehicle: null, ...extra,
});
const truck = (id: number, plate: string, extra: Partial<FleetVehicle> = {}): FleetVehicle => ({
  id, plate, trailer_plate: '', vehicle_type: '', registration_expiry: '', insurance_expiry: '', status: 'active', note: '', photo: '',
  created_at: '', updated_at: '', registration_front: '', registration_back: '', insurance_front: '', insurance_back: '', ownership_front: '', ownership_back: '', home_driver: null, current_driver: null, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.getFleetVehiclesApi.mockResolvedValue([truck(1, '51C-1', { trailer_plate: '51R-1' }), truck(2, '51C-2', { trailer_plate: '51R-9' })]);
  api.getFleetHitchPageApi.mockResolvedValue({ items: [], total: 0 });
});

describe('TrailerTab', () => {
  it('lists trailers with the tractor pulling each, filters and searches', async () => {
    api.getFleetTrailersApi.mockResolvedValue([
      trailer(1, '51R-1', { trailer_type: "Sàn 40'", vehicle: { id: 1, plate: '51C-1', status: 'active', photo: '', driver_name: 'An', since: '', reason: '' } }),
      trailer(2, '51R-2', { trailer_type: "Xương 20'" }),
    ]);
    render(<TrailerTab />);
    const row = await screen.findByTestId('trailer-1');
    expect(within(row).getByText('51C-1')).toBeInTheDocument();
    expect(within(row).getByText('Tài xế: An')).toBeInTheDocument();
    expect(within(screen.getByTestId('trailer-2')).getByText(R.noVehicle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${R.filters.free}`) }));
    expect(screen.queryByTestId('trailer-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${R.filters.all}`) }));
    fireEvent.change(screen.getByLabelText(R.search), { target: { value: 'xuong' } });
    expect(screen.queryByTestId('trailer-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('trailer-2')).toBeInTheDocument();
  });

  it('hitches a free trailer and warns that the tractor\'s own trailer comes off', async () => {
    api.getFleetTrailersApi.mockResolvedValue([trailer(2, '51R-2')]);
    api.hitchFleetTrailerApi.mockResolvedValue({ ...trailer(2, '51R-2'), replaced: '51R-9', from_plate: '' });
    render(<TrailerTab />);
    const row = await screen.findByTestId('trailer-2');
    fireEvent.click(within(row).getByText(R.actions.hitch));
    const dialog = document.body;
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${R.hitchModal.vehicle}`)), { target: { value: '2' } });
    expect(within(dialog).getByText('Moóc 51R-9 đang gắn trên đầu kéo này sẽ được tháo ra.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText(translations.vi.common.save));
    await waitFor(() => expect(api.hitchFleetTrailerApi).toHaveBeenCalledWith(2, 2, ''));
    expect(addToast).toHaveBeenCalledWith('Đã gắn moóc 51R-2 vào đầu kéo 51C-2', 'success');
    expect(addToast).toHaveBeenCalledWith('Moóc 51R-9 đã được tháo khỏi đầu kéo 51C-2', 'info');
  });

  it('unhitches and shows one trailer\'s history from the row menu', async () => {
    api.getFleetTrailersApi.mockResolvedValue([
      trailer(1, '51R-1', { vehicle: { id: 1, plate: '51C-1', status: 'active', photo: '', driver_name: '', since: '', reason: '' } }),
    ]);
    api.hitchFleetTrailerApi.mockResolvedValue({ ...trailer(1, '51R-1'), replaced: '', from_plate: '51C-1' });
    api.getFleetHitchPageApi.mockResolvedValue({ total: 1, items: [{
      id: 3, trailer_id: 1, vehicle_id: 1, trailer_plate: '51R-1', vehicle_plate: '51C-1', reason: 'Gắn mới',
      started_at: '2026-11-15 08:00:00', ended_at: null, end_reason: '',
    }] });
    render(<TrailerTab />);
    const row = await screen.findByTestId('trailer-1');
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole('menuitem', { name: R.actions.unhitch }));
    await waitFor(() => expect(api.hitchFleetTrailerApi).toHaveBeenCalledWith(1, null));
    expect(addToast).toHaveBeenCalledWith('Đã tháo moóc 51R-1', 'success');

    fireEvent.click(within(row).getByLabelText(`${translations.vi.fleet.menu.more} · 51R-1`));
    fireEvent.click(screen.getByRole('menuitem', { name: translations.vi.fleet.menu.history }));
    expect(await screen.findByText('Gắn mới')).toBeInTheDocument();
    expect(api.getFleetHitchPageApi).toHaveBeenLastCalledWith(expect.objectContaining({ trailer_id: 1, limit: 25, offset: 0 }));
    expect(screen.getByText('Đang xem lịch sử của: 51R-1')).toBeInTheDocument();
  });

  it('adds a trailer hitched to a tractor straight away', async () => {
    api.getFleetTrailersApi.mockResolvedValue([]);
    api.createFleetTrailerApi.mockResolvedValue(trailer(5, '51R-5'));
    render(<TrailerTab />);
    expect(await screen.findByText(R.empty.list)).toBeInTheDocument();
    fireEvent.click(screen.getByText(R.actions.add));
    const dialog = document.body;
    fireEvent.change(within(dialog).getByLabelText(new RegExp(R.form.plate)), { target: { value: '51R-5' } });
    fireEvent.change(within(dialog).getByLabelText(R.form.vehicle), { target: { value: '1' } });
    fireEvent.click(within(dialog).getByText(translations.vi.common.save));
    await waitFor(() => expect(api.createFleetTrailerApi).toHaveBeenCalledWith(expect.objectContaining({ plate: '51R-5', trailer_type: "Sàn 40'", vehicle_id: 1 })));
  });
});

describe('TrailerTab multi-select', () => {
  it('unhitches the hitched ones of the selection and changes their status', async () => {
    const on = { id: 1, plate: '51C-1', status: 'active' as const, photo: '', driver_name: '', since: '', reason: '' };
    api.getFleetTrailersApi.mockResolvedValue([trailer(1, '51R-1', { vehicle: on }), trailer(2, '51R-2'), trailer(3, '51R-3', { vehicle: { ...on, id: 2, plate: '51C-2' } })]);
    api.hitchFleetTrailerApi.mockResolvedValue({});
    api.updateFleetTrailerApi.mockResolvedValue({});
    render(<TrailerTab />);
    await screen.findByTestId('trailer-1');
    fireEvent.click(screen.getByRole('checkbox', { name: translations.vi.bulk.selectPage }));
    const bar = screen.getByRole('toolbar', { name: 'Đã chọn 3' });
    fireEvent.click(within(bar).getByRole('button', { name: R.actions.unhitch }));
    await waitFor(() => expect(api.hitchFleetTrailerApi).toHaveBeenCalledTimes(2));   // only the hitched two
    expect(api.hitchFleetTrailerApi).toHaveBeenCalledWith(1, null);
    expect(api.hitchFleetTrailerApi).toHaveBeenCalledWith(3, null);
    expect(addToast).toHaveBeenCalledWith('Đã tháo 2 moóc', 'success');

    fireEvent.click(within(bar).getByRole('button', { name: translations.vi.fleet.bulk.status }));
    fireEvent.click(within(screen.getByTestId('fleet-status-picker')).getByText(R.status.broken));
    await waitFor(() => expect(api.updateFleetTrailerApi).toHaveBeenCalledTimes(3));
    expect(api.updateFleetTrailerApi).toHaveBeenCalledWith(2, { status: 'broken' });
  });
});

describe('TrailerTab quick status from the row menu', () => {
  it('right-click → a status changes that trailer', async () => {
    api.getFleetTrailersApi.mockResolvedValue([trailer(1, '51R-1')]);
    api.updateFleetTrailerApi.mockResolvedValue({});
    render(<TrailerTab />);
    fireEvent.contextMenu(await screen.findByTestId('trailer-1'), { clientX: 10, clientY: 10 });
    expect(screen.getByRole('menuitem', { name: R.status.active })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: R.status.broken }));
    await waitFor(() => expect(api.updateFleetTrailerApi).toHaveBeenCalledWith(1, { status: 'broken' }));
    expect(addToast).toHaveBeenCalledWith(`51R-1: ${R.status.broken}`, 'success');
  });
});
