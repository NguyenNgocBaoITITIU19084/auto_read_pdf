import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const addToast = vi.fn();
const confirmMock = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, addToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirmMock }));

const getStorageUsageApi = vi.fn();
const cleanStorageApi = vi.fn();
vi.mock('../../services/api', () => ({
  getStorageUsageApi: () => getStorageUsageApi(),
  cleanStorageApi: (target: string) => cleanStorageApi(target),
}));

import { StorageCard, diskLow, sizeText } from './StorageCard';

const s = translations.vi.dashboard.storage;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

const usage = (over: Partial<{ free: number; backupsCleanable: number }> = {}) => ({
  data_dir: '/data',
  disk: { total: 500 * GB, used: 500 * GB - (over.free ?? 200 * GB), free: over.free ?? 200 * GB },
  total_bytes: 10 * MB,
  backups_kept: 3,
  items: [
    { id: 'database', bytes: 2 * MB, files: null, cleanable: MB, groups: { zalo: 300 * 1024, gmail: 0, outlook: 0 } },
    { id: 'zalo_files', bytes: MB, files: 5, cleanable: 0 },
    { id: 'zalo_media_cache', bytes: 2 * MB, files: 40, cleanable: 2 * MB },
    { id: 'fleet_photos', bytes: MB, files: 20, cleanable: 0 },
    { id: 'backups', bytes: 4 * MB, files: 6, cleanable: over.backupsCleanable ?? 2 * MB },
  ],
});

describe('StorageCard', () => {
  beforeEach(() => {
    getStorageUsageApi.mockReset();
    cleanStorageApi.mockReset();
    confirmMock.mockReset();
    addToast.mockReset();
  });

  it('formats sizes and spots a low disk', () => {
    expect(sizeText(0)).toBe('0 B');
    expect(sizeText(820 * 1024)).toBe('820 KB');
    expect(sizeText(1.94 * MB)).toBe('1.9 MB');
    expect(sizeText(12 * GB)).toBe('12 GB');
    expect(diskLow({ total: 500 * GB, free: 200 * GB })).toBe(false);
    expect(diskLow({ total: 500 * GB, free: 4 * GB })).toBe(true);
  });

  it('shows every kind of data and cleans the Zalo image cache', async () => {
    getStorageUsageApi.mockResolvedValue(usage());
    cleanStorageApi.mockResolvedValue({ target: 'zalo_media_cache', freed_bytes: 2 * MB });
    render(<StorageCard />);
    expect(await screen.findByText(s.zalo_media_cache)).toBeInTheDocument();
    expect(screen.getByText('Zalo 300 KB · Gmail 0 B')).toBeInTheDocument();
    expect(screen.getByText('6 file · giữ 3 bản mới nhất')).toBeInTheDocument();
    expect(screen.queryByText(s.diskLow, { exact: false })).toBeNull();

    const row = screen.getByText(s.zalo_media_cache).parentElement!.parentElement!;
    await act(async () => { fireEvent.click(row.querySelector('button')!); });
    expect(cleanStorageApi).toHaveBeenCalledWith('zalo_media_cache');
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Đã giải phóng 2.0 MB', 'success'));
    expect(getStorageUsageApi).toHaveBeenCalledTimes(2);
  });

  it('asks before deleting old backups and does nothing when declined', async () => {
    getStorageUsageApi.mockResolvedValue(usage({ free: 3 * GB }));
    confirmMock.mockResolvedValue(false);
    render(<StorageCard />);
    expect(await screen.findByText(s.diskLow, { exact: false })).toBeInTheDocument();
    const row = screen.getByText(s.backups).parentElement!.parentElement!;
    await act(async () => { fireEvent.click(row.querySelector('button')!); });
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ danger: true, message: expect.stringContaining('Xoá 3 bản sao lưu cũ (2.0 MB)') }));
    expect(cleanStorageApi).not.toHaveBeenCalled();
  });
});
