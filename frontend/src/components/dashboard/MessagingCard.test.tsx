import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';

vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));

import { MessagingCard } from './MessagingCard';

const m = translations.vi.dashboard.messaging;

describe('MessagingCard', () => {
  it('shows what waits in Zalo and Gmail and opens the tab', () => {
    const onNavigateTab = vi.fn();
    render(
      <MessagingCard
        onNavigateTab={onNavigateTab}
        messaging={{
          zalo: { connected: true, account_name: 'TRASAS', unread_messages: 12, unread_conversations: 4, pending_conversations: 2, bookings_to_review: 1 },
          gmail: {
            accounts: [
              { id: 1, email: 'ops@example.com', status: 'connected', unread_count: 5 },
              { id: 2, email: 'cs@example.com', status: 'error', unread_count: 3 },
            ],
            unread_total: 8,
            accounts_with_error: 1,
          },
        }}
      />,
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('4 hội thoại chưa đọc')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText(m.gmailRelogin)).toBeInTheDocument();
    fireEvent.click(screen.getByText(m.bookingsToReview));
    expect(onNavigateTab).toHaveBeenLastCalledWith('zalo');
    fireEvent.click(screen.getByText('cs@example.com'));
    expect(onNavigateTab).toHaveBeenLastCalledWith('gmail');
  });

  it('says when nothing is connected or a side could not be read', () => {
    render(<MessagingCard onNavigateTab={vi.fn()} messaging={{ zalo: { connected: false, account_name: '', unread_messages: 0, unread_conversations: 0, pending_conversations: 0, bookings_to_review: 0 }, gmail: null }} />);
    expect(screen.getByText(m.zaloOff)).toBeInTheDocument();
    expect(screen.getByText(m.unavailable)).toBeInTheDocument();
  });
});
