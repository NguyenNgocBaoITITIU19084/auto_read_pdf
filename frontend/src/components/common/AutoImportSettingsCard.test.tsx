import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const addToast = vi.fn();
const collections = [{ id: 1, name: 'Default' }, { id: 2, name: 'Tháng 10' }];
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ collections, activeCollection: collections[1], addToast }),
}));
const getSettings = vi.fn();
const saveSettings = vi.fn();
const runNow = vi.fn();
const getHistory = vi.fn();
const forget = vi.fn();
vi.mock('../../services/api', () => ({
  getAutoImportSettingsApi: () => getSettings(),
  saveAutoImportSettingsApi: (...a: unknown[]) => saveSettings(...a),
  runAutoImportNowApi: () => runNow(),
  getAutoImportHistoryApi: () => getHistory(),
  forgetAutoImportFileApi: (sha: string) => forget(sha),
}));

import { AutoImportSettingsCard } from './AutoImportSettingsCard';

const OFF = {
  enabled: false, folder: '', folder_ok: false, collection_id: null, collection_ok: false, last_scan_at: null, last_result: null,
  mode: 'interval', interval_minutes: 5, times: [], next_scan_at: null,
};
const SCHEDULE = { mode: 'interval', interval_minutes: 5, times: [] };
const ON = { ...OFF, enabled: true, folder: '/Users/me/Booking', folder_ok: true, collection_id: 2, collection_ok: true };

beforeEach(() => {
  delete (window as any).electronAPI;
  addToast.mockReset();
  getSettings.mockReset().mockResolvedValue(OFF);
  saveSettings.mockReset().mockImplementation(async (enabled: boolean, folder: string, col: number) => (
    { ...ON, enabled, folder, collection_id: col }));
  runNow.mockReset();
  getHistory.mockReset().mockResolvedValue([]);
  forget.mockReset().mockResolvedValue(undefined);
});

describe('AutoImportSettingsCard', () => {
  it('turns on for the typed folder and the active collection, leaving existing PDFs alone by default', async () => {
    render(<AutoImportSettingsCard />);
    const toggle = await screen.findByRole('switch');
    expect(toggle).toBeDisabled();  // no folder yet
    fireEvent.change(screen.getByPlaceholderText(/Đường dẫn thư mục/), { target: { value: '/Users/me/Booking' } });
    fireEvent.click(toggle);
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(true, '/Users/me/Booking', 2, false, SCHEDULE));
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
  });

  it('can import the PDFs already in the folder', async () => {
    render(<AutoImportSettingsCard />);
    fireEvent.change(await screen.findByPlaceholderText(/Đường dẫn thư mục/), { target: { value: '/x' } });
    fireEvent.click(screen.getByLabelText(/Nhập luôn các PDF/));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(true, '/x', 2, true, SCHEDULE));
  });

  it('uses the desktop folder picker', async () => {
    (window as any).electronAPI = { platform: 'darwin', selectFolder: vi.fn().mockResolvedValue('/picked') };
    render(<AutoImportSettingsCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Chọn/ }));
    await waitFor(() => expect(screen.getByDisplayValue('/picked')).toBeInTheDocument());
  });

  it('scans now and reports the result', async () => {
    getSettings.mockResolvedValue(ON);
    runNow.mockResolvedValue({ status: 'ok', imported: [{ file: 'a.pdf', booking_no: 'A1' }], skipped: [{ file: 'b.pdf', booking_no: '' }],
      waiting: 0, message: '', settings: ON });
    render(<AutoImportSettingsCard />);
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByRole('button', { name: /Quét ngay/ }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Đã thêm 1 booking, 1 file cần xem lại', 'info'));
  });

  it('lists recent files and reads a skipped one again', async () => {
    getSettings.mockResolvedValue(ON);
    getHistory.mockResolvedValue([
      { sha256: 'h1', file_name: 'dup.pdf', status: 'duplicate', collection_id: 2, booking_id: null, booking_no: 'D1', message: '', processed_at: '' },
      { sha256: 'h2', file_name: 'ok.pdf', status: 'imported', collection_id: 2, booking_id: 5, booking_no: 'K1', message: '', processed_at: '' },
    ]);
    render(<AutoImportSettingsCard />);
    expect(await screen.findByText('dup.pdf')).toBeInTheDocument();
    expect(screen.queryByLabelText('Đọc lại ok.pdf')).toBeNull();
    fireEvent.click(screen.getByLabelText('Đọc lại dup.pdf'));
    await waitFor(() => expect(forget).toHaveBeenCalledWith('h1'));
  });

  it('warns when the watched folder is gone', async () => {
    getSettings.mockResolvedValue({ ...ON, folder_ok: false });
    render(<AutoImportSettingsCard />);
    expect(await screen.findByText(/Không tìm thấy thư mục theo dõi/)).toBeInTheDocument();
  });

  it('saves a fixed-times schedule', async () => {
    getSettings.mockResolvedValue(ON);
    render(<AutoImportSettingsCard />);
    fireEvent.click(await screen.findByRole('tab', { name: /Giờ cố định/ }));
    fireEvent.change(screen.getByLabelText('Giờ quét 2'), { target: { value: '17:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(true, ON.folder, 2, false,
      { mode: 'times', interval_minutes: 5, times: ['08:00', '17:45'] }));
  });

  it('changes the interval and blocks an invalid one', async () => {
    getSettings.mockResolvedValue(ON);
    render(<AutoImportSettingsCard />);
    const input = await screen.findByLabelText('Chu kỳ quét (phút)');
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByText(/Chu kỳ phải từ 1 đến 1440 phút/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '30p' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(true, ON.folder, 2, false,
      { mode: 'interval', interval_minutes: 30, times: [] }));
  });

  it('says why it cannot be switched on yet', async () => {
    render(<AutoImportSettingsCard />);
    expect(await screen.findByText(/Chọn thư mục theo dõi bên dưới để bật/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Đường dẫn thư mục/), { target: { value: '/x' } });
    expect(screen.getByText(/Bật công tắc để bắt đầu theo dõi/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Tự nhập PDF từ thư mục' })).toBeEnabled();
  });

  it('shows what is watched while on, and undoes unsaved edits', async () => {
    getSettings.mockResolvedValue(ON);
    render(<AutoImportSettingsCard />);
    const status = await screen.findByTestId('auto-import-status');
    await waitFor(() => expect(status).toHaveTextContent('Đang theo dõi Booking → Tháng 10'));
    expect(screen.queryByTestId('auto-import-unsaved')).toBeNull();

    fireEvent.change(screen.getByDisplayValue(ON.folder), { target: { value: '/Users/me/Other' } });
    expect(screen.getByTestId('auto-import-unsaved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(screen.getByDisplayValue(ON.folder)).toBeInTheDocument();
    expect(screen.queryByTestId('auto-import-unsaved')).toBeNull();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('shows when the next scan is', async () => {
    getSettings.mockResolvedValue({ ...ON, next_scan_at: '29/10/2026 16:05:00' });
    render(<AutoImportSettingsCard />);
    expect(await screen.findByText(/quét tới lúc/)).toBeInTheDocument();
  });
});
