import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BookingLinksPanel, BookingLinksLabels } from './BookingLinksPanel';
import { getBookingLinks } from '../../services/api';

vi.mock('../../services/api', () => ({ getBookingLinks: vi.fn() }));
vi.mock('../common/ValueBadge', () => ({ ValueBadge: ({ value }: { value: string }) => <span>{value}</span> }));

const labels: BookingLinksLabels = {
  vesselTitle: 'Lịch tàu', vesselEmpty: 'Chưa có lịch.', vesselEmptyHint: 'Tra tàu.', noVessel: 'Chưa có tàu.',
  estimated: 'DK', estimatedTooltip: 'dự kiến', berth: 'Cập', departure: 'Rời', closing: 'Cắt máng', openTs: 'Mở cổng',
  updated: 'Cập nhật {time}', containerTitle: 'Container', gatedIn: '{gated}/{qty} đã hạ bãi',
  gatedInNoQty: '{gated} đã hạ bãi', containerEmpty: 'Chưa có container.', noBookingNo: 'Chưa có số booking.',
  gatedBadge: 'Đã hạ bãi', openVesselTab: 'Mở tab Tàu', openContainerTab: 'Mở tab Container', loadError: 'Lỗi tải',
};

const mocked = vi.mocked(getBookingLinks);

describe('BookingLinksPanel', () => {

  it('fetches the links again when vessel schedules were saved, keeping the old ones on screen meanwhile', async () => {
    const empty = { vessels: [], containers: [], gated_in: 0, qty: 1 };
    const linked = { ...empty, vessels: [{ id: 2, site_id: 'GNL', vessel_name: 'EVER MILD', in_out_voyage: '1463-011E',
      closing_time: '05:00 09/07/2026' } as any] };
    mocked.mockReset().mockResolvedValueOnce(empty as any);
    const props = { bookingId: 9, bookingNo: 'BK9', vessel: 'EVER MILD 1463-011E', labels };
    const { rerender } = render(<BookingLinksPanel {...props} reloadKey={1} />);
    expect(await screen.findByText(/Chưa có lịch\./)).toBeTruthy();

    let answer: (v: any) => void = () => {};
    mocked.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    rerender(<BookingLinksPanel {...props} reloadKey={2} />);
    expect(screen.getByText(/Chưa có lịch\./)).toBeTruthy();    // no blank flash while it reloads
    answer(linked);
    expect(await screen.findByText('EVER MILD')).toBeTruthy();
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("shows the booking's vessel schedule and containers with the gate-in count", async () => {
    mocked.mockResolvedValue({
      vessels: [{ id: 1, site_id: 'CTL', vessel_name: 'SHANGHAI VOYAGER', in_out_voyage: '2608N-2608N',
        closing_time: 'EST (dự kiến): 14:00 16/10/2026', closing_estimated: true } as any],
      containers: [
        { id: 5, containerno: 'ABCU1111111', iso: '45G1', event_type: 'INGATE', gated_in: true } as any,
        { id: 6, containerno: 'ABCU2222222', iso: '45G1', event_type: 'OUTGATE', gated_in: false } as any,
      ],
      gated_in: 1,
      qty: 2,
    });
    const nav = vi.fn();
    render(<BookingLinksPanel bookingId={7} bookingNo="BK1" vessel="SHANGHAI VOYAGER 2608N" labels={labels} onNavigateTab={nav} />);
    expect(await screen.findByText('SHANGHAI VOYAGER')).toBeTruthy();
    expect(screen.getByText('DK')).toBeTruthy();
    expect(screen.getByText('1/2 đã hạ bãi')).toBeTruthy();
    expect(screen.getByText('ABCU2222222')).toBeTruthy();
    expect(screen.getAllByText('Đã hạ bãi')).toHaveLength(1);
    fireEvent.click(screen.getByText('Mở tab Container'));
    expect(nav).toHaveBeenCalledWith('container', 'BK1');
    fireEvent.click(screen.getByText('Mở tab Tàu'));
    expect(nav).toHaveBeenCalledWith('vessel', 'SHANGHAI VOYAGER');
    expect(mocked).toHaveBeenCalledWith(7);
  });

  it('says why nothing is linked', async () => {
    mocked.mockResolvedValue({ vessels: [], containers: [], gated_in: 0, qty: null });
    render(<BookingLinksPanel bookingId={8} bookingNo="" vessel="null" labels={labels} />);
    expect(await screen.findByText('Chưa có tàu.')).toBeTruthy();
    expect(screen.getByText('Chưa có số booking.')).toBeTruthy();
  });

  it('shows an error without breaking the detail', async () => {
    mocked.mockRejectedValue(new Error('down'));
    render(<BookingLinksPanel bookingId={9} bookingNo="BK9" vessel="X 1N" labels={labels} />);
    expect(await screen.findByText('Lỗi tải')).toBeTruthy();
  });
});
