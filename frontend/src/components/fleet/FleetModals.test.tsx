import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { FleetVehicle } from '../../types';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));
vi.mock('../../context/ToastContext', () => ({ useToastActions: () => ({ addToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => vi.fn() }));

const updateVehicle = vi.fn();
const uploadVehiclePhoto = vi.fn();
vi.mock('../../services/api', () => ({
  updateFleetVehicleApi: (...a: unknown[]) => updateVehicle(...a),
  uploadFleetVehiclePhotoApi: (...a: unknown[]) => uploadVehiclePhoto(...a),
  createFleetVehicleApi: vi.fn(), deleteFleetVehiclePhotoApi: vi.fn(), createFleetDriverApi: vi.fn(),
  updateFleetDriverApi: vi.fn(), uploadFleetDriverPhotoApi: vi.fn(), deleteFleetDriverPhotoApi: vi.fn(),
  moveDriverTemporaryApi: vi.fn(), setDriverHomeVehicleApi: vi.fn(), setFleetVehicleStatusApi: vi.fn(), unassignDriverApi: vi.fn(),
  fleetPhotoUrl: (n: string) => (n ? `http://api/fleet/photos/${n}` : ''),
  getFleetTrailersApi: async () => [],
}));

import { VehicleFormModal } from './FleetModals';

const p = translations.vi.fleet.photo;
const truck: FleetVehicle = {
  id: 9, plate: '51C-1', trailer_plate: '', vehicle_type: '', registration_expiry: '', insurance_expiry: '', status: 'active',
  note: '', photo: '', created_at: '', updated_at: '', home_driver: null, current_driver: null,
};

const pickAndSave = async () => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
  render(<VehicleFormModal isOpen vehicle={truck} onClose={() => {}} onSaved={() => {}} />);
  const file = new File([new Uint8Array(10)], 'x.png', { type: 'image/png' });
  fireEvent.change(screen.getByTestId('vehicle-photo-input'), { target: { files: [file] } });
  fireEvent.click(screen.getByText(translations.vi.common.save));
  await waitFor(() => expect(uploadVehiclePhoto).toHaveBeenCalledWith(9, file));
};

beforeEach(() => {
  addToast.mockReset();
  updateVehicle.mockReset().mockResolvedValue(truck);
  uploadVehiclePhoto.mockReset();
});

describe('VehicleFormModal photo', () => {
  it('uploads the picked photo after saving the details', async () => {
    uploadVehiclePhoto.mockResolvedValue({ ...truck, photo: 'vehicle_9_0a1b2c3d.jpg' });
    await pickAndSave();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(translations.vi.fleet.toast.saved, 'success'));
  });

  it('says to restart when the running backend has no photo route yet', async () => {
    uploadVehiclePhoto.mockRejectedValue({ response: { status: 404, data: { detail: 'Not Found' } } });
    await pickAndSave();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      `Đã lưu thông tin nhưng chưa tải được ảnh: ${p.outdatedBackend}`, 'error'));
  });

  it('shows the backend\'s own reason otherwise', async () => {
    uploadVehiclePhoto.mockRejectedValue({ response: { status: 400, data: { detail: 'Ảnh HEIC chưa hỗ trợ' } } });
    await pickAndSave();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Đã lưu thông tin nhưng chưa tải được ảnh: Ảnh HEIC chưa hỗ trợ', 'error'));
  });
});
