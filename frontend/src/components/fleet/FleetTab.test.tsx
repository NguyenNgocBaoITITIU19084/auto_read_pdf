import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { FleetDriver, FleetVehicle } from '../../types';

const addToast = vi.fn();
const confirmMock = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, addToast }) }));
vi.mock('../../context/ToastContext', () => ({ useToastActions: () => ({ addToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirmMock }));
const exportProps = vi.fn();
vi.mock('../common/ExportModal', () => ({
  ExportModal: (props: any) => { exportProps(props); return props.isOpen ? <div data-testid="export-modal" /> : null; },
}));

const api = {
  getFleetVehiclesApi: vi.fn(),
  getFleetDriversApi: vi.fn(),
  getFleetHistoryApi: vi.fn(),
  getFleetHistoryPageApi: vi.fn(),
  getFleetTrashCountApi: vi.fn(),
  trashList: vi.fn(),
  trashRestore: vi.fn(),
  setFleetVehicleStatusApi: vi.fn(),
  returnDriverHomeApi: vi.fn(),
  setDriverHomeVehicleApi: vi.fn(),
  moveDriverTemporaryApi: vi.fn(),
  deleteFleetVehicleApi: vi.fn(),
};
vi.mock('../../services/api', () => ({
  getFleetVehiclesApi: (...a: unknown[]) => api.getFleetVehiclesApi(...a),
  getFleetDriversApi: (...a: unknown[]) => api.getFleetDriversApi(...a),
  getFleetHistoryApi: (...a: unknown[]) => api.getFleetHistoryApi(...a),
  getFleetHistoryPageApi: (...a: unknown[]) => api.getFleetHistoryPageApi(...a),
  getFleetTrashCountApi: (...a: unknown[]) => api.getFleetTrashCountApi(...a),
  fleetVehicleTrashApi: {
    list: (...a: unknown[]) => api.trashList('vehicle', ...a), ids: async () => [],
    restore: (ids: number[]) => api.trashRestore('vehicle', ids), deleteNow: async () => 0,
  },
  fleetDriverTrashApi: {
    list: (...a: unknown[]) => api.trashList('driver', ...a), ids: async () => [],
    restore: (ids: number[]) => api.trashRestore('driver', ids), deleteNow: async () => 0,
  },
  setFleetVehicleStatusApi: (...a: unknown[]) => api.setFleetVehicleStatusApi(...a),
  returnDriverHomeApi: (...a: unknown[]) => api.returnDriverHomeApi(...a),
  setDriverHomeVehicleApi: (...a: unknown[]) => api.setDriverHomeVehicleApi(...a),
  moveDriverTemporaryApi: (...a: unknown[]) => api.moveDriverTemporaryApi(...a),
  deleteFleetVehicleApi: (...a: unknown[]) => api.deleteFleetVehicleApi(...a),
  deleteFleetDriverApi: vi.fn(),
  createFleetVehicleApi: vi.fn(),
  updateFleetVehicleApi: vi.fn(),
  createFleetDriverApi: vi.fn(),
  updateFleetDriverApi: vi.fn(),
  unassignDriverApi: vi.fn(),
  uploadFleetVehiclePhotoApi: vi.fn(),
  deleteFleetVehiclePhotoApi: vi.fn(),
  uploadFleetDriverPhotoApi: vi.fn(),
  deleteFleetDriverPhotoApi: vi.fn(),
  fleetPhotoUrl: (name: string) => (name ? `http://api/fleet/photos/${name}` : ''),
  getFleetTrailersApi: async () => [],
}));

import { FleetTab } from './FleetTab';

const f = translations.vi.fleet;

const vehicle = (id: number, plate: string, extra: Partial<FleetVehicle> = {}): FleetVehicle => ({
  id, plate, trailer_plate: '', vehicle_type: '', registration_expiry: '', insurance_expiry: '', status: 'active', note: '', photo: '',
  created_at: '', updated_at: '', home_driver: null, current_driver: null, ...extra,
});
const driver = (id: number, name: string, extra: Partial<FleetDriver> = {}): FleetDriver => ({
  id, name, phone: '', id_number: '', license_no: '', license_class: '', license_expiry: '', status: 'active', note: '', photo: '',
  created_at: '', updated_at: '', home_vehicle: null, current_vehicle: null, ...extra,
});

const an = { id: 1, name: 'Nguyễn Văn An', phone: '0909', photo: '', kind: 'primary' as const, since: '', reason: '' };

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  addToast.mockReset();
  confirmMock.mockReset();
  localStorage.clear();
  api.getFleetHistoryApi.mockResolvedValue([]);
  api.getFleetHistoryPageApi.mockResolvedValue({ items: [], total: 0 });
  api.getFleetTrashCountApi.mockResolvedValue({ vehicle: 0, driver: 0 });
  api.trashList.mockResolvedValue({ items: [], total: 0, keep_days: 30 });
  Object.keys(localStorage).forEach((k) => localStorage.removeItem(k));
});

describe('FleetTab', () => {
  it('lists trucks with their driver, flags documents about to expire and searches without accents', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-123.45', { trailer_plate: '51R-001.11', current_driver: an,
        home_driver: { id: 1, name: an.name, status: 'active', photo: '', driving_vehicle_id: 1, driving_plate: '51C-123.45' },
        registration_expiry: '2000-01-01' }),
      vehicle(2, '51C-999.99', { status: 'broken' }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name)]);
    render(<FleetTab />);

    const row = await screen.findByTestId('vehicle-1');
    expect(within(row).getAllByText(an.name).length).toBeGreaterThan(0);
    expect(within(row).getByText(/Đăng kiểm · quá hạn \d+ ngày/)).toBeInTheDocument();
    expect(within(row).getByText('Moóc 51R-001.11')).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: f.filters.label });
    expect(within(filters).getByRole('button', { name: /Đang chạy\s*1/ })).toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: /Hư \/ bảo dưỡng\s*1/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(f.screens.vehicles.search), { target: { value: 'nguyen van an' } });
    expect(screen.queryByTestId('vehicle-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('vehicle-1')).toBeInTheDocument();
  });

  it('reports a breakdown and moves the driver to a free spare in one step', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { current_driver: an }),
      vehicle(2, '51C-2'),
      vehicle(3, '51C-3', { current_driver: { ...an, id: 9, name: 'Bình' } }),
      vehicle(4, '51C-4', { status: 'maintenance' }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.setFleetVehicleStatusApi.mockResolvedValue({
      vehicle_id: 1, status: 'broken', moved_driver: { id: 1, name: an.name, to_vehicle_id: 2, to_plate: '51C-2' }, home_driver_away: null,
    });
    render(<FleetTab />);
    const row = await screen.findByTestId('vehicle-1');
    fireEvent.click(within(row).getByText(f.quick.report));

    const spare = screen.getByRole('combobox', { name: f.statusModal.moveTo }) as HTMLSelectElement;
    // only running trucks nobody drives are offered
    expect(Array.from(spare.options).map((o) => o.textContent)).toEqual([f.statusModal.pickSpare, '51C-2']);
    fireEvent.click(screen.getByText(translations.vi.common.save));
    expect(await screen.findByText(f.statusModal.pickRequired)).toBeInTheDocument();

    fireEvent.change(spare, { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText(f.statusModal.reasonPh), { target: { value: 'Hư hộp số' } });
    fireEvent.click(screen.getByText(translations.vi.common.save));
    await waitFor(() => expect(api.setFleetVehicleStatusApi).toHaveBeenCalledWith(1, 'broken', 'Hư hộp số', 2));
    expect(addToast).toHaveBeenCalledWith(`${an.name} chuyển sang lái tạm xe 51C-2`, 'success');
  });

  it('offers to bring a driver back once their own truck runs again', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { home_driver: { id: 1, name: an.name, status: 'active', photo: '', driving_vehicle_id: 2, driving_plate: '51C-2' } }),
      vehicle(2, '51C-2', { current_driver: { ...an, kind: 'temporary' } }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name, {
      home_vehicle: { id: 1, plate: '51C-1', status: 'active' },
      current_vehicle: { id: 2, plate: '51C-2', trailer_plate: '', photo: '', kind: 'temporary', since: '', reason: '' },
    })]);
    api.returnDriverHomeApi.mockResolvedValue(driver(1, an.name, {
      current_vehicle: { id: 1, plate: '51C-1', trailer_plate: '', photo: '', kind: 'primary', since: '', reason: '' },
    }));
    render(<FleetTab />);
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Xe 51C-1 đã chạy lại');
    fireEvent.click(within(banner).getByText(f.actions.returnHome));
    await waitFor(() => expect(api.returnDriverHomeApi).toHaveBeenCalledWith(1));
    expect(addToast).toHaveBeenCalledWith(`${an.name} đã trở về xe 51C-1`, 'success');
  });

  it('asks before taking a truck that is someone else\'s own truck', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { home_driver: { id: 2, name: 'Bình', status: 'active', photo: '', driving_vehicle_id: 1, driving_plate: '51C-1' } }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name)]);
    api.setDriverHomeVehicleApi
      .mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Xe 51C-1 đang là xe cố định của Bình' } } })
      .mockResolvedValueOnce(driver(1, an.name));
    confirmMock.mockResolvedValue(true);
    render(<FleetTab screen="drivers" />);
    const row = await screen.findByTestId('driver-1');
    fireEvent.click(within(row).getByText(f.actions.move));
    fireEvent.change(screen.getByLabelText(f.cols.vehicle), { target: { value: '1' } });
    fireEvent.click(screen.getByText(translations.vi.common.save));
    await waitFor(() => expect(api.setDriverHomeVehicleApi).toHaveBeenLastCalledWith(1, 1, true));
    expect(confirmMock.mock.calls[0][0].message).toContain('xe cố định của Bình');
  });

  it('shows the assignment history of one truck', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.getFleetHistoryPageApi.mockResolvedValue({ total: 1, items: [{
      id: 5, driver_id: 1, vehicle_id: 1, driver_name: an.name, vehicle_plate: '51C-1', kind: 'temporary',
      home_vehicle_plate: '51C-9', reason: 'Xe gốc hư', started_at: '2026-11-15 08:00:00', ended_at: null, end_reason: '',
    }] });
    render(<FleetTab />);
    const row = await screen.findByTestId('vehicle-1');
    fireEvent.click(within(row).getByLabelText(`${f.menu.more} · 51C-1`));
    fireEvent.click(screen.getByRole('menuitem', { name: f.menu.history }));
    expect(await screen.findByText('15/11/2026 08:00')).toBeInTheDocument();
    expect(api.getFleetHistoryPageApi).toHaveBeenLastCalledWith(expect.objectContaining({ vehicle_id: 1, limit: 25, offset: 0 }));
    expect(screen.getByText('Xe gốc: 51C-9')).toBeInTheDocument();
    expect(screen.getByText('Đang xem lịch sử của: 51C-1')).toBeInTheDocument();
  });
});

describe('FleetTab screens', () => {
  it('the tractor screen lists trucks only, the driver screen drivers only; both have the history', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name)]);
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    expect(screen.getByRole('heading', { name: 'Đầu kéo' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual(['Đầu kéo1', f.views.history]);

    cleanup();
    render(<FleetTab screen="drivers" />);
    await screen.findByTestId('driver-1');
    expect(screen.getByRole('heading', { name: 'Tài xế' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual(['Tài xế1', f.views.history]);
    expect(screen.getByText(f.actions.addDriver)).toBeInTheDocument();
    expect(screen.queryByText(f.actions.addVehicle)).not.toBeInTheDocument();
  });
});

describe('FleetTab photos', () => {
  it('shows photos and initials, and opens a photo large', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([
      driver(1, an.name, { photo: 'driver_1_0a1b2c3d.jpg' }),
      driver(2, 'Trần Minh Bảo'),
    ]);
    render(<FleetTab screen="drivers" />);
    const withPhoto = await screen.findByTestId('driver-1');
    const img = within(withPhoto).getByRole('img', { name: an.name }) as HTMLImageElement;
    expect(img.src).toContain('/fleet/photos/driver_1_0a1b2c3d.jpg');
    expect(within(screen.getByTestId('driver-2')).getByText('MB')).toBeInTheDocument();

    fireEvent.click(within(withPhoto).getByLabelText(`Xem ảnh ${an.name}`));
    const box = screen.getByRole('dialog', { name: an.name });
    expect(within(box).getByRole('img')).toHaveAttribute('src', img.src);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: an.name })).not.toBeInTheDocument();
  });
});

describe('FleetTab quick actions', () => {
  it('marks a broken truck repaired in one tap and brings its driver back', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { status: 'broken',
        home_driver: { id: 1, name: an.name, status: 'active', photo: '', driving_vehicle_id: 2, driving_plate: '51C-2' } }),
      vehicle(2, '51C-2', { current_driver: { ...an, kind: 'temporary' } }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.setFleetVehicleStatusApi.mockResolvedValue({
      vehicle_id: 1, status: 'active', moved_driver: null, home_driver_away: null,
      returned_driver: { id: 1, name: an.name, from_plate: '51C-2', plate: '51C-1' },
    });
    render(<FleetTab />);
    const row = await screen.findByTestId('vehicle-1');
    expect(within(row).getByText(`Xe của ${an.name} · đang lái tạm 51C-2`)).toBeInTheDocument();
    expect(within(row).queryByText(f.quick.report)).not.toBeInTheDocument();
    fireEvent.click(within(row).getByText(f.quick.repaired));
    await waitFor(() => expect(api.setFleetVehicleStatusApi).toHaveBeenCalledWith(1, 'active', '', null, true));
    expect(addToast).toHaveBeenCalledWith(`Xe 51C-1 đã chạy lại — ${an.name} đã về lại xe của mình`, 'success');
  });

  it('filters trucks with the quick filter chips', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { current_driver: an }),
      vehicle(2, '51C-2'),
      vehicle(3, '51C-3', { status: 'maintenance' }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    const filters = screen.getByRole('group', { name: f.filters.label });
    fireEvent.click(within(filters).getByRole('button', { name: /Xe trống/ }));
    expect(screen.queryByTestId('vehicle-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('vehicle-2')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-3')).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: /Hư \/ bảo dưỡng/ }));
    expect(screen.getByTestId('vehicle-3')).toBeInTheDocument();
    expect(screen.getByTestId('vehicle-3')).toHaveTextContent(f.quick.repaired);
    // a filter with nothing in it is hidden, "Tất cả" always shows
    expect(within(filters).queryByRole('button', { name: /Giấy tờ sắp hết hạn/ })).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: /Tất cả/ }));
    expect(screen.getAllByTestId(/^vehicle-/)).toHaveLength(3);
  });

  it('keeps edit and delete in the row menu', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.deleteFleetVehicleApi.mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(true);
    render(<FleetTab />);
    const row = await screen.findByTestId('vehicle-1');
    fireEvent.click(within(row).getByLabelText(`${f.menu.more} · 51C-1`));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(
      [f.detail.open, f.quick.report, f.menu.edit, f.menu.status, f.menu.history, f.menu.delete]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(within(row).getByLabelText(`${f.menu.more} · 51C-1`));
    fireEvent.click(screen.getByRole('menuitem', { name: f.menu.delete }));
    await waitFor(() => expect(api.deleteFleetVehicleApi).toHaveBeenCalledWith(1));
  });
});

describe('FleetTab row interactions', () => {
  const setup = async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { trailer_plate: '51R-1', registration_expiry: '2031-01-15', note: 'Xe mới',
        current_driver: an, home_driver: { id: 1, name: an.name, status: 'active', photo: '', driving_vehicle_id: 1, driving_plate: '51C-1' } }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name, { phone: '0909', license_class: 'FC',
      home_vehicle: { id: 1, plate: '51C-1', status: 'active' },
      current_vehicle: { id: 1, plate: '51C-1', trailer_plate: '51R-1', photo: '', kind: 'primary', since: '2026-11-15 08:00:00', reason: '' } })]);
    api.getFleetHistoryApi.mockResolvedValue([{
      id: 3, driver_id: 1, vehicle_id: 1, driver_name: an.name, vehicle_plate: '51C-1', kind: 'primary', home_vehicle_plate: '',
      reason: 'Gán xe cố định', started_at: '2026-11-15 08:00:00', ended_at: null, end_reason: '',
    }]);
    render(<FleetTab />);
    return screen.findByTestId('vehicle-1');
  };

  it('right-click opens the row menu at the pointer', async () => {
    const row = await setup();
    fireEvent.contextMenu(row, { clientX: 300, clientY: 200 });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('51C-1')).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: f.quick.report }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByText('Trạng thái xe 51C-1')).toBeInTheDocument();
  });

  it('double-click opens the details with the documents and recent history', async () => {
    const row = await setup();
    fireEvent.doubleClick(within(row).getByText('51C-1'));
    const detail = screen.getByTestId('fleet-detail');
    expect(screen.getByText('Chi tiết xe 51C-1')).toBeInTheDocument();
    expect(within(detail).getByText('51R-1')).toBeInTheDocument();
    expect(within(detail).getByText('15/01/2031')).toBeInTheDocument();
    expect(within(detail).getByText('Xe mới')).toBeInTheDocument();
    expect(await within(detail).findByText(/15\/11\/2026 08:00 → Đang lái/)).toBeInTheDocument();
    expect(api.getFleetHistoryApi).toHaveBeenLastCalledWith({ vehicle_id: 1, limit: 5 });

    fireEvent.click(within(detail).getByText(f.detail.allHistory));
    expect(screen.queryByTestId('fleet-detail')).not.toBeInTheDocument();
    expect(screen.getByText('Đang xem lịch sử của: 51C-1')).toBeInTheDocument();
  });

  it('a double-click on a button in the row is that button\'s, and Enter opens the details too', async () => {
    const row = await setup();
    fireEvent.doubleClick(within(row).getByText(f.quick.report));
    expect(screen.queryByTestId('fleet-detail')).not.toBeInTheDocument();

    cleanup();
    render(<FleetTab screen="drivers" />);
    const driverRow = await screen.findByTestId('driver-1');
    fireEvent.keyDown(driverRow, { key: 'Enter' });
    expect(screen.getByText(`Chi tiết tài xế ${an.name}`)).toBeInTheDocument();
    expect(within(screen.getByTestId('fleet-detail')).getByText('FC')).toBeInTheDocument();
    expect(api.getFleetHistoryApi).toHaveBeenLastCalledWith({ driver_id: 1, limit: 5 });
  });
});

describe('FleetTab sort, column filters and pages', () => {
  const plates = (testId = /^vehicle-/) => screen.getAllByTestId(testId).map((r) => r.querySelector('div.font-bold')!.textContent);

  it('sorts a column ascending, then descending, then back', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-200', { current_driver: { ...an, name: 'Bảo' } }),
      vehicle(2, '51C-100', { current_driver: { ...an, id: 2, name: 'An' } }),
      vehicle(3, '51C-300'),
    ]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    expect(plates()).toEqual(['51C-200', '51C-100', '51C-300']);
    const sortDriver = screen.getByLabelText(`${translations.vi.common.sort.none} ${f.list.driver}`);
    fireEvent.click(sortDriver);
    expect(plates()).toEqual(['51C-100', '51C-200', '51C-300']);   // An, Bảo, then the truck without a driver
    fireEvent.click(sortDriver);
    expect(plates()).toEqual(['51C-200', '51C-100', '51C-300']);   // Bảo, An — still no driver last
    fireEvent.click(sortDriver);
    expect(plates()).toEqual(['51C-200', '51C-100', '51C-300']);
    expect(JSON.parse(localStorage.getItem('fleet_vehicles_sort') || 'null')).toBeNull();
  });

  it('filters a column by its values', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { registration_expiry: '2000-01-01' }),
      vehicle(2, '51C-2', { registration_expiry: '2099-01-01' }),
      vehicle(3, '51C-3'),
    ]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    fireEvent.click(screen.getByTitle(`Lọc theo ${f.list.docs}`));
    fireEvent.click(await screen.findByLabelText(new RegExp(f.table.docState.expired)));
    expect(plates()).toEqual(['51C-1']);
    fireEvent.click(screen.getByText('Bỏ lọc cột (1)'));
    expect(plates()).toHaveLength(3);
  });

  it('pages long lists and goes back to page 1 on a new search', async () => {
    api.getFleetVehiclesApi.mockResolvedValue(Array.from({ length: 30 }, (_, i) => vehicle(i + 1, `51C-${String(i + 1).padStart(3, '0')}`)));
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    expect(screen.getAllByTestId(/^vehicle-/)).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(plates()).toEqual(['51C-026', '51C-027', '51C-028', '51C-029', '51C-030']);
    fireEvent.change(screen.getByLabelText(f.screens.vehicles.search), { target: { value: '51C-00' } });
    expect(plates()).toEqual(['51C-001', '51C-002', '51C-003', '51C-004', '51C-005', '51C-006', '51C-007', '51C-008', '51C-009']);
  });

  it('asks the server for the sorted, filtered page of the history', async () => {
    localStorage.setItem('fleet.view', 'history');
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.getFleetHistoryPageApi.mockResolvedValue({ total: 60, items: [{
      id: 1, driver_id: 1, vehicle_id: 1, driver_name: an.name, vehicle_plate: '51C-1', kind: 'primary', home_vehicle_plate: '',
      reason: '', started_at: '2026-11-15 08:00:00', ended_at: null, end_reason: '' }] });
    render(<FleetTab />);
    await screen.findByText(an.name);
    fireEvent.click(screen.getByLabelText(`${translations.vi.common.sort.none} ${f.cols.name}`));
    await waitFor(() => expect(api.getFleetHistoryPageApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort_by: 'driver_name', sort_dir: 'asc', offset: 0 })));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(api.getFleetHistoryPageApi).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25, limit: 25 })));
    fireEvent.click(screen.getByTitle(`Lọc theo ${f.cols.vehicle}`));
    fireEvent.click(await screen.findByLabelText(f.kind.temporary));
    await waitFor(() => expect(api.getFleetHistoryPageApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: ['temporary'], offset: 0 })));
  });
});

describe('FleetTab trash and columns', () => {
  it('opens the trash of the current table, with its count, and restores from it', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.getFleetTrashCountApi.mockResolvedValue({ vehicle: 2, driver: 0 });
    api.trashList.mockResolvedValue({ total: 1, keep_days: 30, items: [{
      id: 7, plate: '51C-777', trailer_plate: '51R-7', vehicle_type: 'Hino', status: 'active', photo: '', note: '',
      deleted_at: '2026-11-15 10:00:00', purge_at: '2026-12-15 10:00:00', days_left: 29 }] });
    api.trashRestore.mockResolvedValue({ restored: 1 });
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    const button = await screen.findByRole('button', { name: /Thùng rác\s*2/ });
    fireEvent.click(button);
    expect(await screen.findByText('51C-777')).toBeInTheDocument();
    expect(api.trashList).toHaveBeenCalledWith('vehicle', 0, expect.any(Number), 0);
    fireEvent.click(screen.getAllByText(f.trash.vehicle.restore)[0]);
    await waitFor(() => expect(api.trashRestore).toHaveBeenCalledWith('vehicle', [7]));
  });

  it('a delete says it goes to the trash', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.deleteFleetVehicleApi.mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(true);
    render(<FleetTab />);
    const row = await screen.findByTestId('vehicle-1');
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: f.menu.delete }));
    await waitFor(() => expect(api.deleteFleetVehicleApi).toHaveBeenCalledWith(1));
    expect(confirmMock.mock.calls[0][0].message).toContain('thùng rác');
    expect(confirmMock.mock.calls[0][0].message).toContain('30 ngày');
    expect(api.getFleetTrashCountApi).toHaveBeenCalledTimes(2);
  });

  it('shows extra columns turned on in the column settings', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1', { trailer_plate: '51R-9', registration_expiry: '2031-05-01' })]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    expect(screen.queryByRole('columnheader', { name: /Hạn đăng kiểm/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(translations.vi.common.columnsConfig));
    const toggle = (label: string) =>
      fireEvent.click(screen.getByDisplayValue(label).closest('.justify-between')!.querySelector('button')!);
    toggle(f.columns.registration);
    toggle(f.columns.trailer);
    expect(screen.getByRole('columnheader', { name: /Hạn đăng kiểm/ })).toBeInTheDocument();
    expect(within(screen.getByTestId('vehicle-1')).getByText('01/05/2031')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('fleet_vehicles_table_columns') || '[]')
      .filter((c: { visible: boolean }) => c.visible).map((c: { key: string }) => c.key))
      .toEqual(['plate', 'status', 'driver', 'docs', 'trailer', 'registration']);
  });
});

describe('FleetTab Excel export', () => {
  it('exports every filtered row of the table, with all its columns and labels', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      ...Array.from({ length: 30 }, (_, i) => vehicle(i + 1, `51C-${String(i + 1).padStart(3, '0')}`)),
      vehicle(99, '51D-999', { status: 'broken', trailer_plate: '51R-9', registration_expiry: '2031-05-01',
        current_driver: { ...an, kind: 'temporary' } }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    fireEvent.change(screen.getByLabelText(f.screens.vehicles.search), { target: { value: '51D' } });
    fireEvent.click(screen.getByText(translations.vi.common.exportExcel));
    await screen.findByTestId('export-modal');
    const props = exportProps.mock.lastCall![0];
    expect(props.tab).toBe('fleet_vehicle');
    expect(props.filenamePrefix).toBe('doi_xe');
    expect(props.allColumns.map((c: { key: string }) => c.key)).toEqual(
      ['STT', 'plate', 'status', 'driver', 'docs', 'trailer', 'type', 'home', 'registration', 'insurance', 'note', 'created']);
    expect(props.data).toEqual([expect.objectContaining({
      STT: 1, plate: '51D-999', status: 'Hư hỏng', driver: `${an.name} (lái tạm)`, trailer: '51R-9',
      registration: '01/05/2031', docs: 'Còn hạn', type: '—', note: '—' })]);
  });

  it('exports the whole filtered history, fetched page by page from the server', async () => {
    localStorage.setItem('fleet.view', 'history');
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([]);
    const row = (id: number) => ({ id, driver_id: 1, vehicle_id: 1, driver_name: an.name, vehicle_plate: '51C-1', kind: 'primary',
      home_vehicle_plate: '', reason: '', started_at: '2026-11-15 08:00:00', ended_at: null, end_reason: '' });
    api.getFleetHistoryPageApi.mockImplementation(async (p: { limit: number; offset: number }) => (
      p.limit === 1000
        ? { total: 1200, items: Array.from({ length: Math.min(1000, 1200 - p.offset) }, (_, i) => row(p.offset + i)) }
        : { total: 1200, items: [row(1)] }));
    render(<FleetTab />);
    await screen.findByText(an.name);
    fireEvent.click(screen.getByText(translations.vi.common.exportExcel));
    await screen.findByTestId('export-modal');
    const props = exportProps.mock.lastCall![0];
    expect(props.tab).toBe('fleet_history');
    expect(props.data).toHaveLength(1200);
    expect(props.data[0]).toEqual(expect.objectContaining({ STT: 1, ended_at: f.stillOpen, started_at: '15/11/2026 08:00' }));
    expect(api.getFleetHistoryPageApi).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000, offset: 1000 }));
  });
});
