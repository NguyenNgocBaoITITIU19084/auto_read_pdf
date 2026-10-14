import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const addToastMock = vi.fn();
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ t: translations.vi, language: 'vi', addToast: addToastMock }),
}));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => vi.fn() }));

const api = vi.hoisted(() => ({ list: vi.fn(), ids: vi.fn(), count: vi.fn(), restore: vi.fn(), deleteNow: vi.fn() }));
vi.mock('../../services/api', () => ({ vesselTrashApi: api }));

import { VesselTrashModal } from './VesselTrashModal';

const tt = translations.vi.vessel.trash;

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({
    items: [{ id: 5, vessel_name: 'EVER MEMO', in_out_voyage: '001N', site_id: 'CTL', closing_time: '2026-10-20 10:00:00',
              deleted_at: '2026-10-14 09:00:00', purge_at: '', days_left: 30 }],
    total: 1, keep_days: 30,
  });
});

describe('VesselTrashModal', () => {
  it('lists trashed schedules with their vessel, voyage and closing time', async () => {
    render(<VesselTrashModal isOpen onClose={() => {}} collectionId={3} />);
    expect(await screen.findByText('EVER MEMO')).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith(3, 50, 0);
    expect(screen.getByText('001N')).toBeTruthy();
    expect(screen.getByText('20/10/2026 10:00')).toBeTruthy();
  });

  it('says when a restored row was kept as the newer lookup', async () => {
    api.restore.mockResolvedValue({ restored: 0, superseded: 1 });
    render(<VesselTrashModal isOpen onClose={() => {}} collectionId={3} />);
    await screen.findByText('EVER MEMO');
    fireEvent.click(screen.getByRole('button', { name: tt.restore }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith([5]));
    expect(addToastMock).toHaveBeenCalledWith(
      'Đã khôi phục 0 dòng lịch tàu. 1 dòng đã được tra lại sau khi xoá nên giữ bản mới hơn', 'success');
  });
});
