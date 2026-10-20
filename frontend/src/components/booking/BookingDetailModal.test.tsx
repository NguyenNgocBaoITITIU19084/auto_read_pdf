import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, language: 'vi', addToast }) }));
vi.mock('./QuickVesselSearch', () => ({ QuickVesselSearch: () => null }));
vi.mock('./BookingLinksPanel', () => ({ BookingLinksPanel: () => null }));
vi.mock('./useCarrierBadge', () => ({ useCarrierBadge: () => ({ style: {}, className: '' }) }));

import { BookingDetailModal } from './BookingDetailModal';

const writeText = vi.fn().mockResolvedValue(undefined);
const cutoffLabel = translations.vi.booking.columns['Port Cargo Cut-off'];
/** The field card under the cut-off label. */
const cutoffCard = () => screen.getByText(cutoffLabel).closest('div.rounded-xl') as HTMLElement;

describe('BookingDetailModal – cut-off copy', () => {
  beforeEach(() => {
    addToast.mockReset();
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it("copies ePort's time when the booking has no cut-off of its own", async () => {
    const booking: any = {
      id: 1, 'Booking No': 'YMJAW490520569', Vessel: 'ONE FORWARD 011E',
      'Port Cargo Cut-off': 'null', 'Cut-off ePort': '22/10/2026 07:59', 'Cut-off ePort cập nhật': '2026-10-19 11:13:53',
    };
    render(<BookingDetailModal isOpen onClose={() => undefined} booking={booking} />);
    const card = cutoffCard();
    expect(card).toHaveAttribute('role', 'checkbox'); // selectable for the multi-field copy too
    expect(within(card).getByText('null')).toBeInTheDocument();

    fireEvent.click(within(card).getByTitle(translations.vi.common.copy));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('22/10/2026 07:59'));
  });

  it('offers no copy when neither the booking nor ePort has a cut-off', () => {
    const booking: any = { id: 2, 'Booking No': 'SGN1', 'Port Cargo Cut-off': 'null' };
    render(<BookingDetailModal isOpen onClose={() => undefined} booking={booking} />);
    const card = cutoffCard();
    expect(card).not.toHaveAttribute('role', 'checkbox');
    expect(within(card).queryByTitle(translations.vi.common.copy)).toBeNull();
  });
});
