import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import { tf } from '../../services/i18nFormat';
import { VEHICLE_STATUSES as VEHICLE_ORDER } from '../../types';
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
  uploadFleetDriverDocumentApi: vi.fn(),
  deleteFleetDriverDocumentApi: vi.fn(),
  updateFleetDriverApi: vi.fn(),
  deleteFleetDriverApi: vi.fn(),
  uploadFleetVehicleDocumentApi: vi.fn(),
  createFleetVehicleApi: vi.fn(),
  updateFleetVehicleApi: vi.fn(),
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
  fleetTruckTrashApi: {
    list: (...a: unknown[]) => api.trashList('truck', ...a), ids: async () => [],
    restore: (ids: number[]) => api.trashRestore('truck', ids), deleteNow: async () => 0,
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
  deleteFleetDriverApi: (...a: unknown[]) => api.deleteFleetDriverApi(...a),
  createFleetVehicleApi: (...a: unknown[]) => api.createFleetVehicleApi(...a),
  updateFleetVehicleApi: (...a: unknown[]) => api.updateFleetVehicleApi(...a),
  createFleetDriverApi: vi.fn(),
  updateFleetDriverApi: (...a: unknown[]) => api.updateFleetDriverApi(...a),
  unassignDriverApi: vi.fn(),
  uploadFleetVehiclePhotoApi: vi.fn(),
  deleteFleetVehiclePhotoApi: vi.fn(),
  uploadFleetDriverPhotoApi: vi.fn(),
  deleteFleetDriverPhotoApi: vi.fn(),
  fleetPhotoUrl: (name: string) => (name ? `http://api/fleet/photos/${name}` : ''),
  getFleetTrailersApi: async () => [{ id: 7, plate: '51R-1', trailer_type: "Sàn 40'", payload: '32 tấn', photo: '',
    vehicle: { id: 1, plate: '51C-1', since: '2026-11-15 08:00:00' } }],
  uploadFleetDriverDocumentApi: (...a: unknown[]) => api.uploadFleetDriverDocumentApi(...a),
  uploadFleetVehicleDocumentApi: (...a: unknown[]) => api.uploadFleetVehicleDocumentApi(...a),
  deleteFleetVehicleDocumentApi: vi.fn(),
  deleteFleetDriverDocumentApi: (...a: unknown[]) => api.deleteFleetDriverDocumentApi(...a),
}));

import { FleetTab } from './FleetTab';

const f = translations.vi.fleet;

const vehicle = (id: number, plate: string, extra: Partial<FleetVehicle> = {}): FleetVehicle => ({
  id, plate, category: 'tractor', trailer_plate: '', vehicle_type: '', body_type: '', payload: '', ownership_expiry: '', status_forced: 0, registration_expiry: '', insurance_expiry: '', status: 'active', note: '', photo: '',
  created_at: '', updated_at: '', registration_front: '', registration_back: '', insurance_front: '', insurance_back: '', ownership_front: '', ownership_back: '', home_driver: null, current_driver: null, ...extra,
});
const driver = (id: number, name: string, extra: Partial<FleetDriver> = {}): FleetDriver => ({
  id, name, phone: '', id_number: '', license_no: '', license_class: '', license_expiry: '', status: 'active', status_forced: 0, note: '', photo: '',
  license_front: '', license_back: '', id_front: '', id_back: '',
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
      home_vehicle: { id: 1, plate: '51C-1', status: 'active', category: 'tractor' },
      current_vehicle: { id: 2, plate: '51C-2', trailer_plate: '', photo: '', category: 'tractor', kind: 'temporary', since: '', reason: '' },
    })]);
    api.returnDriverHomeApi.mockResolvedValue(driver(1, an.name, {
      current_vehicle: { id: 1, plate: '51C-1', trailer_plate: '', photo: '', category: 'tractor', kind: 'primary', since: '', reason: '' },
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
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual(['Đầu kéo1', f.views.history]);

    cleanup();
    render(<FleetTab screen="drivers" />);
    await screen.findByTestId('driver-1');
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
      [f.detail.open, f.quick.report, ...VEHICLE_ORDER.map((st) => f.vehicleStatus[st]), f.menu.edit, f.menu.history, f.menu.delete]);
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
      home_vehicle: { id: 1, plate: '51C-1', status: 'active', category: 'tractor' },
      current_vehicle: { id: 1, plate: '51C-1', trailer_plate: '51R-1', photo: '', category: 'tractor', kind: 'primary', since: '2026-11-15 08:00:00', reason: '' } })]);
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
    expect(within(screen.getByTestId('fleet-detail')).getByDisplayValue('FC')).toBeInTheDocument();
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
    expect(screen.getByRole('columnheader', { name: translations.vi.common.stt })).toBeInTheDocument();
    expect(within(screen.getByTestId('vehicle-1')).getByTestId('stt')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(plates()).toEqual(['51C-026', '51C-027', '51C-028', '51C-029', '51C-030']);
    // the STT counts on across pages
    expect(within(screen.getByTestId('vehicle-26')).getByTestId('stt')).toHaveTextContent('26');
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
      ['STT', 'plate', 'status', 'driver', 'docs', 'trailer', 'type', 'home', 'ownership', 'registration', 'insurance', 'note', 'created']);
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

describe('FleetTab driver details', () => {
  const D = f.detail;
  const F = f.driverForm;
  const open = async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, 'An', {
      phone: '0909', license_class: 'FC', license_no: '790123', id_number: '079091006789',
      license_front: 'driver_1_license_front_0a1b2c3d.jpg',
      home_vehicle: { id: 1, plate: '51C-1', status: 'active', category: 'tractor' },
      current_vehicle: { id: 1, plate: '51C-1', trailer_plate: '', photo: '', category: 'tractor', kind: 'primary', since: '2026-11-15 08:00:00', reason: '' },
    })]);
    api.getFleetHistoryApi.mockResolvedValue([]);
    render(<FleetTab screen="drivers" />);
    fireEvent.keyDown(await screen.findByTestId('driver-1'), { key: 'Enter' });
    return screen.getByTestId('fleet-detail');
  };

  it('edits in place and saves only what changed, with no own-truck box', async () => {
    const detail = await open();
    expect(within(detail).queryByText(D.homeVehicle)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('driver-current-vehicle')).getByText('51C-1')).toBeInTheDocument();
    const save = within(detail).getByText(D.save).closest('button')!;
    expect(save).toBeDisabled();

    fireEvent.change(within(detail).getByLabelText(F.licenseNo), { target: { value: '790999' } });
    fireEvent.change(within(detail).getByLabelText(F.idNumber), { target: { value: '079000000001' } });
    expect(within(detail).getByText(D.unsaved)).toBeInTheDocument();
    expect(within(detail).getByText(f.actions.move).closest('button')).toBeDisabled();   // save first
    api.updateFleetDriverApi.mockResolvedValue({});
    fireEvent.click(save);
    await waitFor(() => expect(api.updateFleetDriverApi).toHaveBeenCalledWith(1, { license_no: '790999', id_number: '079000000001' }));
    expect(addToast).toHaveBeenCalledWith(f.toast.saved, 'success');
  });

  it('asks before closing with unsaved changes, and "Hủy thay đổi" puts the values back', async () => {
    const detail = await open();
    fireEvent.change(within(detail).getByLabelText(F.phone), { target: { value: '0911' } });
    confirmMock.mockResolvedValue(false);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') === translations.vi.common.close
      || b.querySelector('svg.lucide-x'))!);
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ message: tf(D.discardConfirm, { name: 'An' }) })));
    expect(screen.getByTestId('fleet-detail')).toBeInTheDocument();
    fireEvent.click(within(detail).getByText(D.discard));
    expect(within(detail).getByLabelText(F.phone)).toHaveValue('0909');
  });

  it('picks boxes and copies them together like the booking details, or one at once', async () => {
    const detail = await open();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByTestId('driver-field-name'));            // a click on the box picks it, like a booking card
    fireEvent.click(screen.getByTestId('driver-field-id_number'));
    fireEvent.click(screen.getByTestId('driver-current-vehicle'));
    expect(screen.getByTestId('driver-field-name')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('driver-field-name')).toHaveAttribute('data-selected', 'true');
    expect(within(screen.getByTestId('driver-field-name')).queryByRole('checkbox')).toBeNull();   // no separate tick
    fireEvent.click(within(detail).getByText(translations.vi.common.fieldCopy.copyLabeled));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${F.name}: An\n${D.currentVehicle}: 51C-1\n${F.idNumber}: 079091006789`));
    // one more click unpicks it; Space on the box picks it, as on a booking card
    fireEvent.click(screen.getByTestId('driver-field-name'));
    expect(screen.getByTestId('driver-field-name')).toHaveAttribute('aria-checked', 'false');
    fireEvent.keyDown(screen.getByTestId('driver-field-name'), { key: ' ' });
    expect(screen.getByTestId('driver-field-name')).toHaveAttribute('aria-checked', 'true');
    // a click in the text edits it, it does not pick the box
    fireEvent.click(within(detail).getByLabelText(F.licenseClass));
    expect(screen.getByTestId('driver-field-license_class')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(within(screen.getByTestId('driver-field-license_no')).getByLabelText(`${translations.vi.common.copy} ${F.licenseNo}`));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('790123'));
  });

  it('shows, uploads and removes the licence / CCCD scans', async () => {
    await open();
    api.uploadFleetDriverDocumentApi.mockResolvedValue({});
    api.deleteFleetDriverDocumentApi.mockResolvedValue({});
    confirmMock.mockResolvedValue(true);
    expect(within(screen.getByTestId('doc-license_front')).getByRole('img')).toHaveAttribute(
      'src', 'http://api/fleet/photos/driver_1_license_front_0a1b2c3d.jpg');
    const file = new File(['x'], 'cccd.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('doc-id_front-input'), { target: { files: [file] } });
    await waitFor(() => expect(api.uploadFleetDriverDocumentApi).toHaveBeenCalledWith(1, 'id_front', file));
    expect(addToast).toHaveBeenCalledWith(`Đã lưu ảnh ${D.idCard} – ${D.front}`, 'success');
    fireEvent.click(within(screen.getByTestId('doc-license_front')).getByLabelText(`${D.removeImage} · ${D.license} – ${D.front}`));
    await waitFor(() => expect(api.deleteFleetDriverDocumentApi).toHaveBeenCalledWith(1, 'license_front'));
  });
});

describe('FleetTab truck details', () => {
  it('has đăng kiểm, bảo hiểm and đăng ký xe (if any) with front and back scans, saved at once', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1', { registration_expiry: '2027-03-01',
      insurance_front: 'vehicle_1_insurance_front_0a1b2c3d.jpg' })]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.getFleetHistoryApi.mockResolvedValue([]);
    api.uploadFleetVehicleDocumentApi.mockResolvedValue({});
    render(<FleetTab />);
    fireEvent.keyDown(await screen.findByTestId('vehicle-1'), { key: 'Enter' });
    const D = f.detail;
    expect(within(screen.getByTestId('paper-registration')).getByText('01/03/2027')).toBeInTheDocument();
    expect(within(screen.getByTestId('paper-ownership')).getByText(D.ifAny)).toBeInTheDocument();
    expect(within(screen.getByTestId('doc-insurance_front')).getByRole('img')).toHaveAttribute(
      'src', 'http://api/fleet/photos/vehicle_1_insurance_front_0a1b2c3d.jpg');
    const file = new File(['x'], 'dk.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('doc-registration_front-input'), { target: { files: [file] } });
    await waitFor(() => expect(api.uploadFleetVehicleDocumentApi).toHaveBeenCalledWith(1, 'registration_front', file));
    expect(addToast).toHaveBeenCalledWith(`Đã lưu ảnh ${D.inspection} – ${D.front}`, 'success');
  });

  it('picks boxes with one click each and copies them together, or one at once', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1', { trailer_plate: '51R-1', vehicle_type: 'Hino',
      current_driver: { id: 2, name: 'An', phone: '0909', photo: '', kind: 'primary', since: '', reason: '' } })]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.getFleetHistoryApi.mockResolvedValue([]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<FleetTab />);
    fireEvent.keyDown(await screen.findByTestId('vehicle-1'), { key: 'Enter' });
    const detail = screen.getByTestId('fleet-detail');
    expect(await within(screen.getByTestId('field-trailer')).findByText("Sàn 40' · 32 tấn")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('field-trailer'));
    fireEvent.click(screen.getByTestId('field-plate'));                   // a click on the box picks it, like a booking
    fireEvent.click(screen.getByTestId('field-driver'));
    expect(screen.getByTestId('field-plate')).toHaveAttribute('data-selected', 'true');
    fireEvent.click(within(detail).getByText(translations.vi.common.fieldCopy.copyLabeled));
    const VF = f.vehicleForm;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${VF.plate}: 51C-1\n${f.detail.driving}: An – 0909\n${translations.vi.tabs.trailers}: 51R-1 – Sàn 40' · 32 tấn`));
    fireEvent.click(screen.getByTestId('field-plate'));                    // one more click unpicks it
    expect(screen.getByTestId('field-plate')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(within(screen.getByTestId('field-type')).getByLabelText(`${translations.vi.common.copy} ${VF.type}`));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('Hino'));
    expect(screen.queryByTestId('field-home')).not.toBeInTheDocument();    // the home driver box gave way to the trailer
    expect(within(screen.getByTestId('field-trailer')).getByText('51R-1')).toBeInTheDocument();
  });

  it('"Sửa thông tin" opens the edit form over the details, not hidden under them', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.getFleetHistoryApi.mockResolvedValue([]);
    render(<FleetTab />);
    fireEvent.keyDown(await screen.findByTestId('vehicle-1'), { key: 'Enter' });
    const detail = screen.getByTestId('fleet-detail');
    fireEvent.click(within(detail).getByText(f.menu.edit));
    const form = screen.getByText('Sửa xe 51C-1');
    expect(detail.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('FleetTab multi-select', () => {
  const B = f.bulk;
  const tick = (testId: string, shiftKey = false) =>
    fireEvent.click(within(screen.getByTestId(testId)).getByRole('checkbox'), { shiftKey });

  it('picks trucks (shift for a range), then changes their status from the bottom bar', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1'), vehicle(2, '51C-2'), vehicle(3, '51C-3', { status: 'broken' })]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.setFleetVehicleStatusApi.mockResolvedValue({});
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    tick('vehicle-1');
    expect(screen.queryByRole('toolbar', { name: 'Đã chọn 1' })).not.toBeInTheDocument();   // one row: its own menu does
    tick('vehicle-3', true);
    const bar = screen.getByRole('toolbar', { name: 'Đã chọn 3' });
    fireEvent.click(within(bar).getByRole('button', { name: B.status }));
    fireEvent.click(within(screen.getByTestId('fleet-status-picker')).getByText(f.vehicleStatus.maintenance));
    await waitFor(() => expect(api.setFleetVehicleStatusApi).toHaveBeenCalledTimes(3));
    expect(api.setFleetVehicleStatusApi).toHaveBeenCalledWith(1, 'maintenance', '', null, false);
    expect(addToast).toHaveBeenCalledWith('Đã đổi trạng thái 3 mục', 'success');
  });

  it('selects a whole page from the header, copies the rows for Excel and deletes them after one question', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, 'An', { phone: '0909' }), driver(2, 'Bình')]);
    api.deleteFleetDriverApi.mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<FleetTab screen="drivers" />);
    await screen.findByTestId('driver-1');
    fireEvent.click(screen.getByRole('checkbox', { name: translations.vi.bulk.selectPage }));
    const bar = screen.getByRole('toolbar', { name: 'Đã chọn 2' });
    fireEvent.click(within(bar).getByRole('button', { name: translations.vi.bulk.copySelected }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text: string = writeText.mock.calls[0][0];
    expect(text.split('\n')).toHaveLength(3);                       // header + 2 rows, tab-separated
    expect(text.split('\n')[1].startsWith('An\t')).toBe(true);
    fireEvent.click(within(bar).getByRole('button', { name: translations.vi.bulk.deleteSelected }));
    await waitFor(() => expect(api.deleteFleetDriverApi).toHaveBeenCalledTimes(2));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('Đã chuyển 2 mục vào thùng rác', 'success');
  });

  it('a click on a checkbox neither opens the details nor the row menu', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab />);
    const row = await screen.findByTestId('vehicle-1');
    const box = within(row).getByRole('checkbox');
    fireEvent.doubleClick(box);
    expect(screen.queryByTestId('fleet-detail')).not.toBeInTheDocument();
  });
});

describe('FleetTab quick status from the row menu', () => {
  it('right-click → a status changes that truck at once (its current one greyed out), and names the driver who got off', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.setFleetVehicleStatusApi.mockResolvedValue({ moved_driver: { id: 4, name: 'An', to_vehicle_id: null, to_plate: '' } });
    render(<FleetTab />);
    fireEvent.contextMenu(await screen.findByTestId('vehicle-1'), { clientX: 10, clientY: 10 });
    expect(screen.getByRole('menuitem', { name: f.vehicleStatus.active })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: f.vehicleStatus.maintenance }));
    await waitFor(() => expect(api.setFleetVehicleStatusApi).toHaveBeenCalledWith(1, 'maintenance', '', null, false));
    expect(addToast).toHaveBeenCalledWith(`51C-1: ${f.vehicleStatus.maintenance}`, 'success');
    expect(addToast).toHaveBeenCalledWith('An đã xuống xe', 'info');
  });

  it('on a row of a selection it changes every selected driver', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, 'An'), driver(2, 'Bình'), driver(3, 'Cường')]);
    api.updateFleetDriverApi.mockResolvedValue({});
    render(<FleetTab screen="drivers" />);
    await screen.findByTestId('driver-1');
    fireEvent.click(within(screen.getByTestId('driver-1')).getByRole('checkbox'));
    fireEvent.click(within(screen.getByTestId('driver-2')).getByRole('checkbox'));
    fireEvent.contextMenu(screen.getByTestId('driver-2'), { clientX: 10, clientY: 10 });
    expect(screen.getByText('Đổi trạng thái 2 mục đã chọn')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: f.driverStatus.leave }));
    await waitFor(() => expect(api.updateFleetDriverApi).toHaveBeenCalledTimes(2));
    expect(api.updateFleetDriverApi).toHaveBeenCalledWith(1, { status: 'leave' });
    expect(api.updateFleetDriverApi).toHaveBeenCalledWith(2, { status: 'leave' });
  });
});

describe('FleetTab trucks (xe tải)', () => {
  const tractor = vehicle(1, '51C-1', { trailer_plate: '51R-1' });
  const lorry = vehicle(2, '51D-2', { category: 'truck', vehicle_type: 'Hino', body_type: 'Thùng kín', payload: '8 tấn' });
  const T = f.truckForm;

  it('lists only the trucks, with their body and payload, and its own history', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([tractor, lorry]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab screen="trucks" />);
    const row = await screen.findByTestId('vehicle-2');
    expect(within(row).getByText('Hino · Thùng kín · 8 tấn')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-1')).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual(['Xe tải1', f.views.history]);
    expect(screen.getByText(f.actions.addTruck)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: new RegExp(f.columns.body) })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: f.views.history }));
    await waitFor(() => expect(api.getFleetHistoryPageApi).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'truck' })));

    cleanup();
    localStorage.clear();
    render(<FleetTab />);
    await screen.findByTestId('vehicle-1');
    expect(screen.queryByTestId('vehicle-2')).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual(['Đầu kéo1', f.views.history]);
  });

  it('adds a truck with its body and payload, never a trailer', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.createFleetVehicleApi.mockResolvedValue({ ...lorry, id: 3 });
    render(<FleetTab screen="trucks" />);
    fireEvent.click(await screen.findByText(f.actions.addTruck));
    expect(await screen.findByPlaceholderText(T.bodyPh)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: T.addTitle })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(f.vehicleForm.trailerPh)).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(T.platePh), { target: { value: '51D-3' } });
    fireEvent.change(screen.getByPlaceholderText(T.bodyPh), { target: { value: 'Thùng bạt' } });
    fireEvent.change(screen.getByPlaceholderText(T.payloadPh), { target: { value: '5 tấn' } });
    fireEvent.submit(screen.getByPlaceholderText(T.platePh).closest('form')!);
    await waitFor(() => expect(api.createFleetVehicleApi).toHaveBeenCalled());
    const sent = api.createFleetVehicleApi.mock.calls[0][0];
    expect(sent).toMatchObject({ plate: '51D-3', category: 'truck', body_type: 'Thùng bạt', payload: '5 tấn' });
    expect(sent).not.toHaveProperty('trailer_plate');
  });

  it('opens the trucks\' own trash, with their own count', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([lorry]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.getFleetTrashCountApi.mockResolvedValue({ vehicle: 5, truck: 1, driver: 0, trailer: 0 });
    render(<FleetTab screen="trucks" />);
    await screen.findByTestId('vehicle-2');
    fireEvent.click(await screen.findByRole('button', { name: /Thùng rác\s*1/ }));
    expect(await screen.findByText(f.trash.truck.title)).toBeInTheDocument();
    expect(api.trashList).toHaveBeenCalledWith('truck', 0, expect.any(Number), 0);
  });

  it('shows the truck details with its body and payload instead of a trailer', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([lorry]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab screen="trucks" />);
    fireEvent.doubleClick(await screen.findByTestId('vehicle-2'));
    const detail = await screen.findByTestId('fleet-detail');
    expect(screen.getByText(tf(f.detail.truckTitle, { plate: '51D-2' }))).toBeInTheDocument();
    expect(within(detail).getByText(f.detail.crewTruck)).toBeInTheDocument();
    expect(within(detail).getByText('Thùng kín')).toBeInTheDocument();
    expect(within(detail).getByText('8 tấn')).toBeInTheDocument();
    expect(within(detail).queryByText(f.detail.noTrailer)).not.toBeInTheDocument();
  });

  it('marks a driver on a truck in the drivers tab', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([tractor, lorry]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name, {
      current_vehicle: { id: 2, plate: '51D-2', trailer_plate: '', photo: '', category: 'truck', kind: 'primary', since: '', reason: '' },
    })]);
    render(<FleetTab screen="drivers" />);
    const row = await screen.findByTestId('driver-1');
    expect(within(row).getByText(f.truckChip)).toBeInTheDocument();
  });
});

describe('FleetTab paper lock', () => {
  it('marks a truck the lock made not ready, and only lets not ready / out of service be picked', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { status: 'not_ready', status_forced: 1, registration_expiry: '2000-01-01' }),
      vehicle(2, '51C-2', { status: 'ready' }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab />);
    const row = await screen.findByTestId('vehicle-1');
    expect(within(row).getByText(f.vehicleStatus.not_ready)).toBeInTheDocument();
    expect(within(row).getByTestId('status-forced')).toHaveAttribute('title', f.lock.forced);
    expect(within(row).queryByText(f.quick.repaired)).not.toBeInTheDocument();
    // "Sẵn sàng" runs: it gets the "Báo hư" button and counts as running
    expect(within(screen.getByTestId('vehicle-2')).getByText(f.quick.report)).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: f.filters.label });
    expect(within(filters).getByRole('button', { name: /Đang chạy\s*1/ })).toBeInTheDocument();

    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(screen.getByRole('menuitem', { name: f.vehicleStatus.ready })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: f.vehicleStatus.active })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: f.vehicleStatus.inactive })).not.toBeDisabled();
  });

  it('the new-truck form warns that expired papers save it as not ready', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([]);
    render(<FleetTab />);
    fireEvent.click(await screen.findByText(f.actions.addVehicle));
    fireEvent.change(await screen.findByLabelText(f.vehicleForm.ownership), { target: { value: '2001-02-03' } });
    expect(screen.getByTestId('paper-lock-hint')).toHaveTextContent('Đăng ký đã hết hạn');
    const status = screen.getByLabelText(f.vehicleForm.status) as HTMLSelectElement;
    expect(status.value).toBe('not_ready');
    expect([...status.options].filter((o) => !o.disabled).map((o) => o.value)).toEqual(['not_ready', 'inactive']);
  });
});

describe('FleetTab licence lock', () => {
  it('marks a driver an expired licence made not ready, and only lets not ready / leave / left be picked', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name, { status: 'not_ready', status_forced: 1, license_expiry: '2000-01-01' })]);
    render(<FleetTab screen="drivers" />);
    const row = await screen.findByTestId('driver-1');
    expect(within(row).getByText(f.driverStatus.not_ready)).toBeInTheDocument();
    expect(within(row).getByTestId('status-forced')).toHaveAttribute('title', f.licenseLock.forced);
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(screen.getByRole('menuitem', { name: f.driverStatus.active })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: f.driverStatus.leave })).not.toBeDisabled();
    expect(screen.getByRole('menuitem', { name: f.driverStatus.left })).not.toBeDisabled();
  });

  it('the driver details lock "Đang làm" while the licence typed is expired, and free it once renewed', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name, { status: 'not_ready', status_forced: 1, license_expiry: '2000-01-01' })]);
    render(<FleetTab screen="drivers" />);
    fireEvent.doubleClick(await screen.findByTestId('driver-1'));
    const detail = await screen.findByTestId('fleet-detail');
    expect(within(detail).getByTestId('licence-lock-hint')).toBeInTheDocument();
    const status = within(detail).getByLabelText(translations.vi.fleet.driverForm.status) as HTMLSelectElement;
    expect([...status.options].find((o) => o.value === 'active')!.disabled).toBe(true);
    fireEvent.change(within(detail).getByLabelText(translations.vi.fleet.driverForm.licenseExpiry), { target: { value: '2099-01-01' } });
    expect(within(detail).queryByTestId('licence-lock-hint')).not.toBeInTheDocument();
    expect([...status.options].find((o) => o.value === 'active')!.disabled).toBe(false);
  });
});

describe('FleetTab notes', () => {
  it.each([
    ['vehicles', 'Đầu kéo'], ['trucks', 'Xe tải'], ['drivers', 'Tài xế'],
  ] as const)('hovering the note mark on the %s tab shows the note', async (screenName, _tab) => {
    api.getFleetVehiclesApi.mockResolvedValue([
      vehicle(1, '51C-1', { note: 'Dữ liệu mẫu\nđổi lốp 12/2026' }),
      vehicle(2, '51D-2', { category: 'truck', note: 'Thùng mới sơn' }),
    ]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name, { note: 'Chỉ chạy nội thành' })]);
    render(<FleetTab screen={screenName} />);
    const row = await screen.findByTestId(screenName === 'drivers' ? 'driver-1' : screenName === 'trucks' ? 'vehicle-2' : 'vehicle-1');
    fireEvent.mouseEnter(within(row).getByTestId('note-icon').parentElement!);
    const card = await screen.findByRole('tooltip');
    expect(card).toHaveTextContent(f.cols.note);
    expect(card).toHaveTextContent(screenName === 'drivers' ? 'Chỉ chạy nội thành'
      : screenName === 'trucks' ? 'Thùng mới sơn' : 'đổi lốp 12/2026');
    fireEvent.mouseLeave(within(row).getByTestId('note-icon').parentElement!);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });
});

describe('FleetTab quick notes', () => {
  it('a truck with no note: hovering the faint mark opens a form that saves the note', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(1, '51C-1')]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.updateFleetVehicleApi.mockResolvedValue(vehicle(1, '51C-1', { note: 'Thay nhớt 20/11' }));
    render(<FleetTab />);
    const row = await screen.findByTestId('vehicle-1');
    fireEvent.mouseEnter(within(row).getByTestId('note-add').parentElement!);
    const form = await screen.findByRole('dialog', { name: f.list.noteAdd });
    const box = within(form).getByPlaceholderText('Nhập ghi chú cho 51C-1...');
    fireEvent.change(box, { target: { value: 'Thay nhớt 20/11' } });
    expect(within(form).getByText('15/1000')).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(api.updateFleetVehicleApi).toHaveBeenCalledWith(1, { note: 'Thay nhớt 20/11' }));
    expect(addToast).toHaveBeenCalledWith('Đã lưu ghi chú cho 51C-1', 'success');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: f.list.noteAdd })).not.toBeInTheDocument());
    expect(api.getFleetVehiclesApi).toHaveBeenCalledTimes(2);                 // reloaded
  });

  it('a driver: the error stays in the form when saving fails', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([]);
    api.getFleetDriversApi.mockResolvedValue([driver(1, an.name)]);
    api.updateFleetDriverApi.mockRejectedValue({ response: { status: 404, data: { detail: 'Không tìm thấy tài xế' } } });
    render(<FleetTab screen="drivers" />);
    const row = await screen.findByTestId('driver-1');
    fireEvent.mouseEnter(within(row).getByTestId('note-add').parentElement!);
    const form = await screen.findByRole('dialog', { name: f.list.noteAdd });
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Nghỉ thứ 7' } });
    fireEvent.click(within(form).getByText(translations.vi.booking.form.save));
    expect(await within(form).findByText('Không tìm thấy tài xế')).toBeInTheDocument();
    expect(api.updateFleetDriverApi).toHaveBeenCalledWith(1, { note: 'Nghỉ thứ 7' });
  });
});

describe('FleetTab editing a note', () => {
  it('the note card of a truck has "Sửa": it saves the changed note from the table', async () => {
    api.getFleetVehiclesApi.mockResolvedValue([vehicle(3, '51D-333.44', { category: 'truck', note: 'Chở sắt thép, cọc' })]);
    api.getFleetDriversApi.mockResolvedValue([]);
    api.updateFleetVehicleApi.mockResolvedValue({});
    render(<FleetTab screen="trucks" />);
    const row = await screen.findByTestId('vehicle-3');
    fireEvent.mouseEnter(within(row).getByTestId('note-icon').parentElement!);
    await screen.findByRole('tooltip');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(f.list.noteEdit) }));
    const form = screen.getByRole('dialog', { name: f.list.noteEditTitle });
    const box = within(form).getByRole('textbox');
    expect(box).toHaveValue('Chở sắt thép, cọc');
    fireEvent.change(box, { target: { value: 'Chở sắt thép' } });
    fireEvent.click(within(form).getByText(translations.vi.booking.form.save));
    await waitFor(() => expect(api.updateFleetVehicleApi).toHaveBeenCalledWith(3, { note: 'Chở sắt thép' }));
    expect(addToast).toHaveBeenCalledWith('Đã lưu ghi chú cho 51D-333.44', 'success');
  });
});
