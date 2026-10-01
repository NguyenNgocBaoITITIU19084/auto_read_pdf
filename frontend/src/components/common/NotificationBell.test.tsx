import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { AppNotification } from '../../types';

let language: 'vi' | 'en' = 'vi';
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations[language] }) }));

const markRead = vi.fn();
const openDetail = vi.fn();
const markAllRead = vi.fn();
const clearRead = vi.fn();
let state: { items: AppNotification[]; unread: number } = { items: [], unread: 0 };
vi.mock('../../context/NotificationsContext', () => ({
  useNotifications: () => ({ ...state, markRead, markAllRead, clearRead, openDetail, refresh: vi.fn() }),
}));

import { NotificationBell } from './NotificationBell';

const vessel: AppNotification = {
  id: 2, collection_id: 1, kind: 'vessel_closing', title: 'Tàu HMM HOPE: đổi hạn đóng máng', old_value: '23/09/2026 11:00',
  new_value: '24/09/2026 09:30', detail: { vessel: 'HMM HOPE', voyage: '062E-062E', bookings: ['SGNGX2311600'] },
  nav_tab: 'vessel', nav_query: 'HMM HOPE', source: 'auto_sync', created_at: '2026-09-30 10:00:00', read: false,
};
const container: AppNotification = {
  id: 1, collection_id: 1, kind: 'container_outgate', title: 'Cont EMCU1234567 đã OUTGATE', old_value: '', new_value: '26/09/2026 09:46',
  detail: { container: 'EMCU1234567' }, nav_tab: 'container', nav_query: 'EMCU1234567', source: 'manual', created_at: '2026-09-29 08:00:00', read: true,
};

beforeEach(() => {
  language = 'vi';
  markRead.mockReset().mockResolvedValue(undefined);
  openDetail.mockReset();
  markAllRead.mockReset().mockResolvedValue(undefined);
  clearRead.mockReset().mockResolvedValue(undefined);
  state = { items: [vessel, container], unread: 1 };
});

const open = () => fireEvent.click(screen.getByRole('button', { name: translations.vi.notifications.bell }));

describe('NotificationBell', () => {
  it('shows the unread count on the bell and caps it at 99+', () => {
    const { rerender } = render(<NotificationBell />);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1');
    state = { items: [], unread: 150 };
    rerender(<NotificationBell />);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('99+');
    state = { items: [], unread: 0 };
    rerender(<NotificationBell />);
    expect(screen.queryByTestId('notification-badge')).toBeNull();
  });

  it('shakes the bell icon only while there are unread notifications', () => {
    const { rerender } = render(<NotificationBell />);
    expect(screen.getByTestId('notification-bell-icon').getAttribute('class')).toContain('animate-bell-ring');
    state = { items: [], unread: 0 };
    rerender(<NotificationBell />);
    expect(screen.getByTestId('notification-bell-icon').getAttribute('class')).not.toContain('animate-bell-ring');
  });

  it('lists the changes with old → new, affected bookings and where they came from', () => {
    render(<NotificationBell />);
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(screen.getByText('Tàu HMM HOPE 062E-062E: đổi hạn đóng máng')).toBeInTheDocument();
    expect(screen.getByText('23/09/2026 11:00 → 24/09/2026 09:30')).toBeInTheDocument();
    expect(screen.getByText('Booking: SGNGX2311600')).toBeInTheDocument();
    expect(screen.getByText('Cont EMCU1234567 đã OUTGATE')).toBeInTheDocument();
    expect(screen.getByText(/Tự động đồng bộ/)).toBeInTheDocument();
    expect(screen.getByText(/Tra cứu/)).toBeInTheDocument();
  });

  it('clicking a change closes the panel and opens its detail dialog', () => {
    render(<NotificationBell />);
    open();
    fireEvent.click(screen.getByText('Tàu HMM HOPE 062E-062E: đổi hạn đóng máng'));
    expect(openDetail).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marks all read / clears read ones, disabled when there is nothing to do', () => {
    const { rerender } = render(<NotificationBell />);
    open();
    fireEvent.click(screen.getByRole('button', { name: translations.vi.notifications.markAllRead }));
    fireEvent.click(screen.getByRole('button', { name: translations.vi.notifications.clearRead }));
    expect(markAllRead).toHaveBeenCalledTimes(1);
    expect(clearRead).toHaveBeenCalledTimes(1);

    state = { items: [{ ...vessel, read: true }], unread: 0 };
    rerender(<NotificationBell />);
    expect(screen.getByRole('button', { name: translations.vi.notifications.markAllRead })).toBeDisabled();
  });

  it('shows an empty state, closes on Escape / outside click and follows the language', () => {
    state = { items: [], unread: 0 };
    render(<div><span>outside</span><NotificationBell /></div>);
    open();
    expect(screen.getByText(translations.vi.notifications.empty)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();

    language = 'en';
    state = { items: [vessel], unread: 1 };
    const { unmount } = render(<NotificationBell />);
    fireEvent.click(screen.getAllByRole('button', { name: translations.en.notifications.bell }).pop()!);
    expect(screen.getByText('Vessel HMM HOPE 062E-062E: closing time changed')).toBeInTheDocument();
    unmount();
  });
});
