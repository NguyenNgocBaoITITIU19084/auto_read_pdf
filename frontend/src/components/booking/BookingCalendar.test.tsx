import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  addDays, BookingCalendar, BookingCalendarLabels, dayKey, groupByDay, isoWeek, relativeWeekLabel, startOfWeek, weeksFromNow,
} from './BookingCalendar';
import type { BookingStatusLabels } from './BookingStatus';

const getBookingsCalendar = vi.fn();
vi.mock('../../services/api', () => ({ getBookingsCalendar: (...a: unknown[]) => getBookingsCalendar(...a) }));
vi.mock('../common/ValueBadge', () => ({ ValueBadge: ({ value }: { value: string }) => <span>{value}</span> }));

const labels: BookingCalendarLabels = {
  prevWeek: 'Tuần trước', nextWeek: 'Tuần sau', weekNumber: 'Tuần {n}', pickDate: 'Chọn ngày',
  thisWeek: 'Tuần này', lastWeek: 'Tuần trước', followingWeek: 'Tuần sau', weeksAgo: '{n} tuần trước',
  weeksAhead: '{n} tuần tới', backToThisWeek: 'Về tuần này',
  weekdays: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'],
  summary: '{count} booking', lateSummary: '{count} trễ', undated: '{count} chưa có cut-off',
  empty: 'Không có cut-off', allDay: 'Cả ngày', error: 'Lỗi',
};
const statusLabels: BookingStatusLabels = {
  labels: { new: 'Mới', dispatched: 'Đã điều xe', stuffed: 'Đã đóng hàng', gated_in: 'Đã hạ bãi', done: 'Hoàn tất', cancelled: 'Huỷ' },
  overdue: 'Trễ', overdueTooltip: 'quá giờ',
};

describe('calendar dates', () => {
  it('starts weeks on Monday', () => {
    expect(dayKey(startOfWeek(new Date(2026, 9, 18)))).toBe('2026-10-12'); // Sunday -> previous Monday
    expect(dayKey(startOfWeek(new Date(2026, 9, 12)))).toBe('2026-10-12');
    expect(dayKey(addDays(new Date(2026, 9, 31), 1))).toBe('2026-11-01');
  });

  it('numbers ISO weeks and says where a week sits from today', () => {
    expect(isoWeek(new Date(2026, 9, 12))).toBe(42);
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);   // Thursday 1/1/2026
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);  // Friday, still in 2026's last week
    const now = new Date(2026, 9, 16);
    expect(weeksFromNow(new Date(2026, 9, 12), now)).toBe(0);
    expect(weeksFromNow(new Date(2026, 9, 26), now)).toBe(2);
    expect(weeksFromNow(new Date(2026, 9, 5), now)).toBe(-1);
    expect([0, -1, 1, -3, 2].map((o) => relativeWeekLabel(o, labels)))
      .toEqual(['Tuần này', 'Tuần trước', 'Tuần sau', '3 tuần trước', '2 tuần tới']);
  });

  it('groups bookings by the day of their cut-off', () => {
    const map = groupByDay([
      { id: 1, 'Hạn cut-off': '2026-10-19 08:00' },
      { id: 2, 'Hạn cut-off': '2026-10-19 23:59' },
      { id: 3, 'Hạn cut-off': '2026-10-21 10:00' },
    ]);
    expect(map.get('2026-10-19')?.map((b) => b.id)).toEqual([1, 2]);
    expect(map.get('2026-10-21')?.map((b) => b.id)).toEqual([3]);
  });
});

describe('BookingCalendar', () => {
  beforeEach(() => getBookingsCalendar.mockReset());

  it('loads the current week and shows each booking on its day', async () => {
    const monday = startOfWeek(new Date());
    const wed = dayKey(addDays(monday, 2));
    getBookingsCalendar.mockResolvedValue({
      items: [
        { id: 7, 'Booking No': 'BK7', Carrier: 'ONE', 'Hạn cut-off': `${wed} 14:00`, 'Cut-off cả ngày': false, 'Trễ cut-off': true },
        { id: 8, 'Booking No': 'BK8', 'Hạn cut-off': `${wed} 23:59`, 'Cut-off cả ngày': true },
      ],
      undated: 2,
    });
    const onOpen = vi.fn();
    render(
      <BookingCalendar collectionId={1} query={{}} reloadKey={0} labels={labels} statusLabels={statusLabels}
        onOpen={onOpen} onContextMenu={() => {}} onChangeStatus={() => {}} onError={() => {}} />,
    );
    await screen.findByText('BK7');
    expect(getBookingsCalendar).toHaveBeenCalledWith(1, dayKey(monday), dayKey(addDays(monday, 6)), {});
    expect(screen.getByText('14:00')).toBeTruthy();
    expect(screen.getByText('Cả ngày')).toBeTruthy();
    expect(screen.getByText('1 trễ')).toBeTruthy();
    expect(screen.getByText(/2 chưa có cut-off/)).toBeTruthy();
    fireEvent.click(screen.getByText('BK8'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }));
  });

  it('moves to the next week', async () => {
    getBookingsCalendar.mockResolvedValue({ items: [], undated: 0 });
    render(
      <BookingCalendar collectionId={1} query={{}} reloadKey={0} labels={labels} statusLabels={statusLabels}
        onOpen={() => {}} onContextMenu={() => {}} onChangeStatus={() => {}} onError={() => {}} />,
    );
    await waitFor(() => expect(getBookingsCalendar).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Về tuần này')).toBeNull();
    fireEvent.click(screen.getByLabelText('Tuần sau'));
    const next = startOfWeek(addDays(new Date(), 7));
    await waitFor(() => expect(getBookingsCalendar).toHaveBeenLastCalledWith(1, dayKey(next), dayKey(addDays(next, 6)), {}));
    fireEvent.click(screen.getByText('Về tuần này'));
    const now = startOfWeek(new Date());
    await waitFor(() => expect(getBookingsCalendar).toHaveBeenLastCalledWith(1, dayKey(now), dayKey(addDays(now, 6)), {}));
  });
});
