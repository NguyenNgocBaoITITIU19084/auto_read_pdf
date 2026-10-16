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
    expect(screen.getByText('10:00 · 30/09/2026')).toBeInTheDocument();
  });

  it('lists every changed time of a grouped vessel notification', () => {
    const grouped: AppNotification = {
      ...vessel, id: 3, kind: 'vessel_schedule', old_value: '', new_value: 'x',
      detail: {
        vessel: 'DONGJIN CONFIDENT', voyage: '0152S-0152S', changes: [
          { kind: 'vessel_etd', label: 'ETD', old: '06/10/2026 23:00', new: '07/10/2026 23:00' },
          { kind: 'vessel_closing_icd', label: 'Cut-off ICD', old: '05/10/2026 15:00', new: '06/10/2026 15:00' },
        ],
      },
    };
    state = { items: [grouped], detailId: 3 };
    render(<NotificationDetailModal onNavigateTab={vi.fn()} />);
    expect(screen.getByText('DONGJIN CONFIDENT 0152S-0152S đã đổi')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows).toEqual(['ETD06/10/2026 23:0007/10/2026 23:00+1 ngày', 'Cut-off ICD05/10/2026 15:0006/10/2026 15:00+1 ngày']);
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

  it('shows a cut-off reminder with its bookings and opens the booking tab', () => {
    const reminder: AppNotification = {
      id: 5, collection_id: 1, kind: 'booking_cutoff', title: 'x', old_value: '', new_value: 'Cut-off 16/10/2026 14:00 · còn 5 giờ',
      detail: { hours: 6, cutoff: '16/10/2026 14:00', booking_no: '2 booking', bookings: ['A1', 'A2'], vessel_name: 'WAN HAI 286', count: 2 },
      nav_tab: 'booking', nav_query: 'WAN HAI 286', source: 'auto_sync', created_at: '2026-10-16 08:00:00', read: false,
    };
    state = { items: [reminder], detailId: 5 };
    const onNavigateTab = vi.fn();
    render(<NotificationDetailModal onNavigateTab={onNavigateTab} />);
    expect(screen.getByText('Cut-off còn 6 giờ: 2 booking')).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('A2')).toBeInTheDocument();
    expect(screen.getByText('16/10/2026 14:00')).toBeInTheDocument();
    expect(screen.getByText('WAN HAI 286')).toBeInTheDocument();
    fireEvent.click(screen.getByText(translations.vi.notifications.detail.openBooking));
    expect(onNavigateTab).toHaveBeenCalledWith('booking', 'WAN HAI 286');
  });

  it('shows the morning brief counts and the bookings due today', () => {
    const brief: AppNotification = {
      id: 6, collection_id: null, kind: 'morning_brief', title: 'x', old_value: '', new_value: '2 cut-off hôm nay',
      detail: {
        date: '16/10/2026', today: 3, late: 1, tomorrow: 4, vessels_today: 2,
        items: [{ booking_no: 'BK1', time: '10:00', vessel: 'EVER OATH', collection: 'Test' },
                { booking_no: 'BK2', time: '14:00', vessel: 'WAN HAI', collection: 'Test' }],
        collections: [],
      },
      nav_tab: 'booking', nav_query: null, source: 'auto_sync', created_at: '2026-10-16 07:30:00', read: false,
    };
    state = { items: [brief], detailId: 6 };
    render(<NotificationDetailModal onNavigateTab={vi.fn()} />);
    const r = translations.vi.notifications.reminder;
    expect(screen.getByText('Bản tin sáng 16/10')).toBeInTheDocument();
    expect(screen.getByText(r.tileToday).previousSibling?.textContent).toBe('3');
    expect(screen.getByText(r.tileLate).previousSibling?.textContent).toBe('1');
    expect(screen.getByText('BK1')).toBeInTheDocument();
    expect(screen.getByText('và 1 booking khác')).toBeInTheDocument();
  });
});

import { groupBookingNumbers, remainingText, formatStamp } from './ReminderViews';

describe('reminder helpers', () => {
  const t = translations.vi;
  it('groups repeated booking numbers', () => {
    expect(groupBookingNumbers(['2339911210', '2339911210', 'A1'])).toBe('2339911210 ×2, A1');
  });
  it('says how long is left until a cut-off', () => {
    const now = new Date(2026, 9, 16, 10, 41);
    expect(remainingText('16/10/2026 14:00', t, now)).toBe('còn 3 giờ 19 phút');
    expect(remainingText('17/10/2026 08:00', t, now)).toBe('còn 21 giờ');
    expect(remainingText('16/10/2026 11:00', t, now)).toBe('còn 19 phút');
    expect(remainingText('16/10/2026 10:00', t, now)).toBe('đã qua cut-off');
  });
  it('formats the stored time for reading', () => {
    expect(formatStamp('2026-10-16 10:40:46')).toBe('10:40 · 16/10/2026');
  });
});
