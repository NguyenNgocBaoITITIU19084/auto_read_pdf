import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { FleetTrailer, FleetVehicle } from '../../types';

const addToast = vi.fn();
const confirmMock = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, addToast }) }));
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
  uploadFleetTrailerDocumentApi: vi.fn(),
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
  uploadFleetTrailerDocumentApi: (...a: unknown[]) => api.uploadFleetTrailerDocumentApi(...a),
  deleteFleetTrailerDocumentApi: vi.fn(),
  deleteFleetTrailerPhotoApi: vi.fn(),
  getFleetTrashCountApi: async () => ({ vehicle: 0, driver: 0, trailer: 2 }),
  fleetVehicleTrashApi: {}, fleetDriverTrashApi: {}, fleetTrailerTrashApi: {},
  fleetPhotoUrl: (name: string) => (name ? `http://api/fleet/photos/${name}` : ''),
}));

import { TrailerTab } from './TrailerTab';

const R = translations.vi.fleet.trailer;
const trailer = (id: number, plate: string, extra: Partial<FleetTrailer> = {}): FleetTrailer => ({
  id, plate, trailer_type: '', chassis_no: '', payload: '', year: '', ownership_expiry: '', status_forced: 0, registration_expiry: '', insurance_expiry: '', status: 'active',
  note: '', photo: '', registration_front: '', registration_back: '', insurance_front: '', insurance_back: '', ownership_front: '',
  ownership_back: '', created_at: '', updated_at: '', vehicle: null, ...extra,
});
const truck = (id: number, plate: string, extra: Partial<FleetVehicle> = {}): FleetVehicle => ({
  id, plate, category: 'tractor', trailer_plate: '', vehicle_type: '', body_type: '', payload: '', gross_weight: 0, ownership_expiry: '', status_forced: 0, registration_expiry: '', insurance_expiry: '', status: 'active', note: '', photo: '',
  created_at: '', updated_at: '', registration_front: '', registration_back: '', insurance_front: '', insurance_back: '', ownership_front: '', ownership_back: '', trailer: null, trailer_hold_status: '', current_driver: null, ...extra,
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
    expect(screen.getAllByTestId('stt').map((c) => c.textContent)).toEqual(['1', '2']);
    expect(within(row).getByText('Tài xế: An')).toBeInTheDocument();
    expect(within(screen.getByTestId('trailer-2')).getByText(R.noVehicle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${R.filters.free}`) }));
    expect(screen.queryByTestId('trailer-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${R.filters.all}`) }));
    fireEvent.change(screen.getByLabelText(R.search), { target: { value: 'xuong' } });
    expect(screen.queryByTestId('trailer-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('trailer-2')).toBeInTheDocument();
  });

  it('keeps "Không sẵn sàng" out of "Hư / bảo dưỡng", in a chip of its own', async () => {
    api.getFleetTrailersApi.mockResolvedValue([
      trailer(1, '51R-1', { status: 'broken' }), trailer(2, '51R-2', { status: 'maintenance' }), trailer(3, '51R-3', { status: 'not_ready' }),
    ]);
    render(<TrailerTab />);
    await screen.findByTestId('trailer-1');
    const shown = () => screen.getAllByTestId(/^trailer-\d+$/).map((r) => r.dataset.testid);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${R.filters.down}`) }));
    expect(shown()).toEqual(['trailer-1', 'trailer-2']);
    fireEvent.click(screen.getByRole('button', { name: /^Không sẵn sàng/ }));
    expect(shown()).toEqual(['trailer-3']);
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

describe('TrailerTab form', () => {
  const pulling = { id: 1, plate: '51C-1', status: 'active' as const, photo: '', driver_name: 'An', since: '2026-11-15 08:00:00', reason: '' };

  it('saves the papers\' scans with a new trailer', async () => {
    const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn(() => 'blob:scan');
    URL.revokeObjectURL = vi.fn();
    api.getFleetTrailersApi.mockResolvedValue([]);
    api.createFleetTrailerApi.mockResolvedValue(trailer(5, '51R-5'));
    api.uploadFleetTrailerDocumentApi.mockResolvedValue({});
    render(<TrailerTab />);
    fireEvent.click(await screen.findByText(R.actions.add));
    const D = translations.vi.fleet.detail;
    expect(screen.getByTestId('paper-ownership')).toBeInTheDocument();
    expect(screen.getByTestId('paper-registration')).toBeInTheDocument();
    expect(screen.getByText(R.form.notConnected)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(new RegExp(R.form.plate)), { target: { value: '51R-5' } });
    fireEvent.change(screen.getByLabelText(R.form.chassis), { target: { value: 'RL4-123' } });
    fireEvent.change(screen.getByLabelText(R.form.registration), { target: { value: '2027-05-01' } });
    const scan = new File(['x'], 'dk.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('paper-picker-registration_front-input'), { target: { files: [scan] } });
    expect(screen.getByRole('img', { name: `${D.inspection} – ${D.front}` })).toBeInTheDocument();
    fireEvent.click(screen.getByText(translations.vi.common.save));
    await waitFor(() => expect(api.uploadFleetTrailerDocumentApi).toHaveBeenCalledWith(5, 'registration_front', scan));
    expect(api.createFleetTrailerApi).toHaveBeenCalledWith(expect.objectContaining({
      plate: '51R-5', chassis_no: 'RL4-123', registration_expiry: '2027-05-01', vehicle_id: null }));
    expect(api.uploadFleetTrailerDocumentApi).toHaveBeenCalledTimes(1);
    URL.createObjectURL = urls.create;
    URL.revokeObjectURL = urls.revoke;
  });

  it('shows the tractor pulling it, lists tractors only, and moves it to another one', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([truck(1, '51C-1', { trailer_plate: '51R-1' }), truck(2, '51C-2', { trailer_plate: '51R-9' }),
      truck(3, '51D-3', { category: 'truck' })]);
    api.getFleetTrailersApi.mockResolvedValue([trailer(1, '51R-1', { vehicle: pulling })]);
    api.updateFleetTrailerApi.mockResolvedValue(trailer(1, '51R-1'));
    api.hitchFleetTrailerApi.mockResolvedValue({});
    render(<TrailerTab />);
    fireEvent.contextMenu(await screen.findByTestId('trailer-1'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: translations.vi.fleet.menu.edit }));
    const box = await screen.findByTestId('trailer-connection');
    expect(within(box).getByText('Đang gắn với đầu kéo 51C-1')).toBeInTheDocument();
    expect(within(box).getByText('Tài xế: An')).toBeInTheDocument();
    const select = screen.getByLabelText(R.form.vehicle) as HTMLSelectElement;
    expect(select.value).toBe('1');
    expect([...select.options].map((o) => o.value)).toEqual(['', '1', '2']);     // the truck (xe tải) is not there
    fireEvent.change(select, { target: { value: '2' } });
    expect(screen.getByText(/Moóc 51R-9 đang gắn trên đầu kéo này sẽ được tháo ra/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(translations.vi.common.save));
    await waitFor(() => expect(api.hitchFleetTrailerApi).toHaveBeenCalledWith(1, 2));
  });

  it('saving without touching the tractor does not move the trailer', async () => {
    api.getFleetTrailersApi.mockResolvedValue([trailer(1, '51R-1', { vehicle: pulling })]);
    api.updateFleetTrailerApi.mockResolvedValue(trailer(1, '51R-1'));
    render(<TrailerTab />);
    fireEvent.contextMenu(await screen.findByTestId('trailer-1'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: translations.vi.fleet.menu.edit }));
    fireEvent.click(await screen.findByText(translations.vi.common.save));
    await waitFor(() => expect(api.updateFleetTrailerApi).toHaveBeenCalled());
    expect(api.hitchFleetTrailerApi).not.toHaveBeenCalled();
  });
});

describe('TrailerTab paper lock', () => {
  it('a locked trailer cannot be hitched, and renewing it in the form says it goes back to ready', async () => {
    api.getFleetTrailersApi.mockResolvedValue([trailer(1, '51R-1', { status: 'not_ready', status_forced: 1, insurance_expiry: '2001-01-01' })]);
    api.updateFleetTrailerApi.mockResolvedValue(trailer(1, '51R-1'));
    render(<TrailerTab />);
    const row = await screen.findByTestId('trailer-1');
    expect(within(row).queryByText(R.actions.hitch)).not.toBeInTheDocument();
    expect(within(row).getByTestId('status-forced')).toBeInTheDocument();
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(screen.queryByRole('menuitem', { name: R.actions.hitch })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: R.status.ready })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: translations.vi.fleet.menu.edit }));

    expect(await screen.findByTestId('paper-lock-hint')).toHaveTextContent('Bảo hiểm đã hết hạn');
    expect((screen.getByLabelText(R.form.vehicle) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(R.form.insurance), { target: { value: '2099-01-01' } });
    expect(screen.queryByTestId('paper-lock-hint')).not.toBeInTheDocument();
    expect(screen.getByText(translations.vi.fleet.lock.renewed)).toBeInTheDocument();
    fireEvent.click(screen.getByText(translations.vi.common.save));
    await waitFor(() => expect(api.updateFleetTrailerApi).toHaveBeenCalledWith(1, expect.objectContaining({
      status: 'not_ready', insurance_expiry: '2099-01-01' })));
  });
});

describe('TrailerTab form copy', () => {
  it('editing a trailer: picks boxes and copies them together, the tractor included', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const on = { id: 1, plate: '51C-1', status: 'active' as const, photo: '', driver_name: 'An', since: '', reason: '' };
    api.getFleetTrailersApi.mockResolvedValue([trailer(1, '51R-1', { chassis_no: 'RL4-1', vehicle: on })]);
    render(<TrailerTab />);
    fireEvent.contextMenu(await screen.findByTestId('trailer-1'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: translations.vi.fleet.menu.edit }));
    fireEvent.click(await screen.findByTestId('field-plate'));
    fireEvent.click(screen.getByTestId('field-chassis_no'));
    fireEvent.click(screen.getByTestId('field-vehicle'));
    fireEvent.click(screen.getByText(translations.vi.common.fieldCopy.copyLabeled));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `${R.form.plate}: 51R-1\n${R.form.vehicle}: 51C-1\n${R.form.chassis}: RL4-1`));
  });
});

describe('TrailerTab notes', () => {
  it('hovering the note mark shows the note', async () => {
    api.getFleetTrailersApi.mockResolvedValue([trailer(1, '51R-1', { note: 'Sàn hơi cong' })]);
    render(<TrailerTab />);
    const row = await screen.findByTestId('trailer-1');
    fireEvent.mouseEnter(within(row).getByTestId('note-icon').parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sàn hơi cong');
  });
});

describe('TrailerTab quick notes', () => {
  it('a trailer with no note: the faint mark opens a form that saves the note', async () => {
    api.getFleetTrailersApi.mockResolvedValue([trailer(1, '51R-1')]);
    api.updateFleetTrailerApi.mockResolvedValue(trailer(1, '51R-1', { note: 'Thay lốp' }));
    render(<TrailerTab />);
    const row = await screen.findByTestId('trailer-1');
    fireEvent.mouseEnter(within(row).getByTestId('note-add').parentElement!);
    const form = await screen.findByRole('dialog');
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Thay lốp' } });
    fireEvent.click(within(form).getByText(translations.vi.booking.form.save));
    await waitFor(() => expect(api.updateFleetTrailerApi).toHaveBeenCalledWith(1, { note: 'Thay lốp' }));
    expect(addToast).toHaveBeenCalledWith('Đã lưu ghi chú cho 51R-1', 'success');
  });
});
