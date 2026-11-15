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
const createDriver = vi.fn();
const uploadDocument = vi.fn();
const deleteDocument = vi.fn();
const uploadVehiclePhoto = vi.fn();
vi.mock('../../services/api', () => ({
  updateFleetVehicleApi: (...a: unknown[]) => updateVehicle(...a),
  uploadFleetVehiclePhotoApi: (...a: unknown[]) => uploadVehiclePhoto(...a),
  createFleetVehicleApi: vi.fn(), deleteFleetVehiclePhotoApi: vi.fn(), createFleetDriverApi: (...a: unknown[]) => createDriver(...a),
  uploadFleetDriverDocumentApi: (...a: unknown[]) => uploadDocument(...a),
  deleteFleetDriverDocumentApi: (...a: unknown[]) => deleteDocument(...a),
  updateFleetDriverApi: vi.fn(), uploadFleetDriverPhotoApi: vi.fn(), deleteFleetDriverPhotoApi: vi.fn(),
  moveDriverTemporaryApi: vi.fn(), setDriverHomeVehicleApi: vi.fn(), setFleetVehicleStatusApi: vi.fn(), unassignDriverApi: vi.fn(),
  fleetPhotoUrl: (n: string) => (n ? `http://api/fleet/photos/${n}` : ''),
  getFleetTrailersApi: async () => [],
}));

import { DriverFormModal, VehicleFormModal } from './FleetModals';

const p = translations.vi.fleet.photo;
const truck: FleetVehicle = {
  id: 9, plate: '51C-1', trailer_plate: '', vehicle_type: '', registration_expiry: '', insurance_expiry: '', status: 'active',
  note: '', photo: '', created_at: '', updated_at: '', registration_front: '', registration_back: '', insurance_front: '', insurance_back: '', ownership_front: '', ownership_back: '', home_driver: null, current_driver: null,
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

describe('DriverFormModal papers', () => {
  it('uploads the licence / CCCD images picked in the add form once the driver exists', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    createDriver.mockReset().mockResolvedValue({ id: 42 });
    uploadDocument.mockReset().mockResolvedValue({});
    render(<DriverFormModal isOpen driver={null} vehicles={[]} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: 'An' } });
    const front = new File([new Uint8Array(10)], 'gplx.jpg', { type: 'image/jpeg' });
    const back = new File([new Uint8Array(10)], 'cccd-sau.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('paper-picker-license_front-input'), { target: { files: [front] } });
    fireEvent.change(screen.getByTestId('paper-picker-id_back-input'), { target: { files: [back] } });
    expect(screen.getByAltText(`${translations.vi.fleet.detail.license} – ${translations.vi.fleet.detail.front}`)).toBeInTheDocument();
    fireEvent.click(screen.getByText(translations.vi.common.save));
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(2));
    expect(uploadDocument).toHaveBeenCalledWith(42, 'license_front', front);
    expect(uploadDocument).toHaveBeenCalledWith(42, 'id_back', back);
    expect(deleteDocument).not.toHaveBeenCalled();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(translations.vi.fleet.toast.saved, 'success'));
  });
});
