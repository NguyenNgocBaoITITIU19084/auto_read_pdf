import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { FleetDriver, FleetVehicle } from '../../types';

const addToast = vi.fn();
const confirmMock = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));
vi.mock('../../context/ToastContext', () => ({ useToastActions: () => ({ addToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirmMock }));

const api = {
  getFleetVehiclesApi: vi.fn(),
  getFleetDriversApi: vi.fn(),
  getFleetHistoryApi: vi.fn(),
  getFleetHistoryPageApi: vi.fn(),
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

    fireEvent.change(screen.getByLabelText(f.search), { target: { value: 'nguyen van an' } });
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
    localStorage.setItem('fleet.view', 'drivers');
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { home_driver: { id: 2, name: 'Bình', status: 'active', photo: '', driving_vehicle_id: 1, driving_plate: '51C-1' } }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name)]);
    api.setDriverHomeVehicleApi
      .mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Xe 51C-1 đang là xe cố định của Bình' } } })
      .mockResolvedValueOnce(driver(1, an.name));
    confirmMock.mockResolvedValue(true);
    render(<FleetTab />);
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

describe('FleetTab photos', () => {
  it('shows photos and initials, and opens a photo large', async () => {
    localStorage.setItem('fleet.view', 'drivers');
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([
      driver(1, an.name, { photo: 'driver_1_0a1b2c3d.jpg' }),
      driver(2, 'Trần Minh Bảo'),
    ]);
    render(<FleetTab />);
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

    fireEvent.click(screen.getByRole('tab', { name: /Tài xế/ }));
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
    fireEvent.change(screen.getByLabelText(f.search), { target: { value: '51C-00' } });
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
