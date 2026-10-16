import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VesselCalendar, VesselCalendarLabels, formatVoyage, shortTime, timeLeft } from './VesselCalendar';
import { addDays, dayKey, startOfWeek } from '../common/WeekCalendar';

const getVesselsCalendar = vi.fn();
vi.mock('../../services/api', () => ({ getVesselsCalendar: (...a: unknown[]) => getVesselsCalendar(...a) }));

const labels: VesselCalendarLabels = {
  prevWeek: 'Tuần trước', nextWeek: 'Tuần sau', weekNumber: 'Tuần {n}', pickDate: 'Chọn ngày',
  thisWeek: 'Tuần này', lastWeek: 'Tuần trước', followingWeek: 'Tuần sau', weeksAgo: '{n} tuần trước',
  weeksAhead: '{n} tuần tới', backToThisWeek: 'Về tuần này',
  weekdays: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'], empty: 'Không có tàu',
  summary: '{count} tàu', soonSummary: '{count} sắp cắt máng', undated: '{count} chưa có giờ',
  estimated: 'DK', estimatedTooltip: 'dự kiến', closed: 'Đã cắt máng', soon: 'Sắp cắt máng', etd: 'ETD', hoursLeft: 'còn {h} giờ', minutesLeft: 'còn {m} phút',
  bookings: '{count} booking', bookingsOpen: '{count} chưa hạ bãi', bookingsTooltip: 'xem booking', error: 'Lỗi',
};

const schedule = (over: Record<string, unknown>) => ({
  id: 1, site_id: 'CTL', agent: 'SNK', vessel_name: 'SHANGHAI VOYAGER', in_out_voyage: '2608N-2608N',
  actual_berth_time: '', actual_departure_time: 'EST (dự kiến): 05:00 17/10/2026', closing_time: '',
  closing_time_icd: '', in_gate: '', open_ts: '', reefer_open_ts: '', oog_open_ts: '', haz_open_ts: '',
  remarks: '', queried_at: '', closing_state: 'open', booking_count: 0, booking_open_count: 0, ...over,
});

describe('shortTime', () => {
  it('keeps the time and day of an ePort time', () => {
    expect(shortTime('EST (dự kiến): 05:00 17/10/2026')).toBe('05:00 17/10');
    expect(shortTime('')).toBe('');
  });
});

describe('formatVoyage', () => {
  it('shows a voyage once when in and out are the same', () => {
    expect(formatVoyage('0579-061N-0579-061N')).toBe('0579-061N');
    expect(formatVoyage('2608N-2608N')).toBe('2608N');
    expect(formatVoyage('15/26S-15/26S')).toBe('15/26S');
    expect(formatVoyage('0580-107N-0583-108S')).toBe('0580-107N / 0583-108S');
    expect(formatVoyage('062B-063A')).toBe('062B / 063A');
    expect(formatVoyage('A-B-C')).toBe('A-B-C');
  });
});

describe('timeLeft', () => {
  const l = { hoursLeft: 'còn {h} giờ', minutesLeft: 'còn {m} phút' };
  const now = new Date(2026, 9, 16, 9, 0);
  it('counts hours, then minutes, and nothing once passed', () => {
    expect(timeLeft('2026-10-16 14:30', l, now)).toBe('còn 5 giờ');
    expect(timeLeft('2026-10-16 09:40', l, now)).toBe('còn 40 phút');
    expect(timeLeft('2026-10-16 08:00', l, now)).toBe('');
  });
});

describe('VesselCalendar', () => {
  beforeEach(() => getVesselsCalendar.mockReset());

  it('puts each vessel on its closing day with its state and bookings', async () => {
    const wed = dayKey(addDays(startOfWeek(new Date()), 2));
    getVesselsCalendar.mockResolvedValue({
      items: [
        schedule({ id: 1, calendar_deadline: `${wed} 14:00`, closing_state: 'soon', closing_estimated: true,
          booking_count: 3, booking_open_count: 1 }),
        schedule({ id: 2, vessel_name: 'PAST SHIP', calendar_deadline: `${wed} 08:00`, closing_state: 'closed' }),
      ],
      undated: 1,
    });
    const onOpen = vi.fn();
    const onOpenBookings = vi.fn();
    render(
      <VesselCalendar collectionId={5} query={{ search_query: 'S' }} reloadKey={0} labels={labels}
        onOpen={onOpen} onContextMenu={() => {}} onOpenBookings={onOpenBookings} onError={() => {}} />,
    );
    await screen.findByText('SHANGHAI VOYAGER');
    expect(screen.getByText(/^Sắp cắt máng/)).toBeTruthy();
    expect(screen.getByText('Đã cắt máng')).toBeTruthy();
    expect(screen.getByText('DK')).toBeTruthy();
    expect(screen.getByText('1 sắp cắt máng')).toBeTruthy();
    expect(screen.getByText(/1 chưa có giờ/)).toBeTruthy();

    expect(screen.getByText('1 chưa hạ bãi')).toBeTruthy();
    fireEvent.click(screen.getByText('3 booking'));
    expect(onOpenBookings).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('PAST SHIP'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });
});
