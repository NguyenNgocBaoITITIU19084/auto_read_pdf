import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { AppNotification } from '../../types';

vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));

const closeDetail = vi.fn();
let state: { items: AppNotification[]; detailId: number | null } = { items: [], detailId: null };
vi.mock('../../context/NotificationsContext', () => ({
  useNotifications: () => ({ ...state, closeDetail }),
}));

import { NotificationDetailModal } from './NotificationDetailModal';

const vessel: AppNotification = {
  id: 2, collection_id: 1, kind: 'vessel_closing', title: 'x', old_value: '23/09/2026 11:00', new_value: '24/09/2026 09:30',
  detail: { vessel: 'HMM HOPE', voyage: '062E-062E', bookings: ['SGNGX2311600', 'SGNGX2311601'] },
  nav_tab: 'vessel', nav_query: 'HMM HOPE', source: 'auto_sync', created_at: '2026-09-30 10:00:00', read: true,
};
const container: AppNotification = {
  id: 1, collection_id: 1, kind: 'container_outgate', title: 'x', old_value: '', new_value: '26/09/2026 09:46',
  detail: { container: 'EMCU1234567' }, nav_tab: 'container', nav_query: 'EMCU1234567', source: 'manual', created_at: '2026-09-29 08:00:00', read: true,
};

beforeEach(() => {
  closeDetail.mockReset();
  state = { items: [vessel, container], detailId: 2 };
});

describe('NotificationDetailModal', () => {
  it('renders nothing while no notification is selected or it is no longer listed', () => {
    state = { items: [vessel], detailId: null };
    const { container: root, rerender } = render(<NotificationDetailModal onNavigateTab={vi.fn()} />);
    expect(root).toBeEmptyDOMElement();
    state = { items: [vessel], detailId: 99 };
    rerender(<NotificationDetailModal onNavigateTab={vi.fn()} />);
    expect(root).toBeEmptyDOMElement();
  });

  it('shows the full content: before / after, vessel, voyage, bookings, source and time', () => {
    render(<NotificationDetailModal onNavigateTab={vi.fn()} />);
    expect(screen.getByText('Tàu HMM HOPE 062E-062E: đổi hạn đóng máng')).toBeInTheDocument();
    expect(screen.getByText('23/09/2026 11:00')).toBeInTheDocument();
    expect(screen.getByText('24/09/2026 09:30')).toBeInTheDocument();
    expect(screen.getByText('SGNGX2311600, SGNGX2311601')).toBeInTheDocument();
    expect(screen.getByText('Tự động đồng bộ')).toBeInTheDocument();
    expect(screen.getByText('2026-09-30 10:00:00')).toBeInTheDocument();
  });

  it('shows a single value for an event (no before / after)', () => {
    state = { items: [container], detailId: 1 };
    render(<NotificationDetailModal onNavigateTab={vi.fn()} />);
    expect(screen.getByText('26/09/2026 09:46')).toBeInTheDocument();
    expect(screen.queryByText(translations.vi.notifications.detail.before)).toBeNull();
  });

  it('the action button closes the dialog and opens the right tab with its keyword', () => {
    const onNavigateTab = vi.fn();
    render(<NotificationDetailModal onNavigateTab={onNavigateTab} />);
    fireEvent.click(screen.getByRole('button', { name: translations.vi.notifications.detail.openVessel }));
    expect(closeDetail).toHaveBeenCalled();
    expect(onNavigateTab).toHaveBeenCalledWith('vessel', 'HMM HOPE');
  });
});
