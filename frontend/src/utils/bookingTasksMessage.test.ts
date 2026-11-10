import { describe, expect, it } from 'vitest';
import { translations } from '../i18n/translations';
import type { BookingTask, BookingTasks } from '../types';
import { TASKS_MESSAGE_MAX_PER_SECTION, bookingTasksMessage, taskMessageLine, taskTime } from './bookingTasksMessage';

const vi = translations.vi;
const task = (over: Partial<BookingTask>): BookingTask => ({
  id: 1, 'Booking No': 'BK', 'Hạn cut-off': '10/11/2026 09:00', 'Cut-off cả ngày': false, 'Trạng thái': 'new',
  'Bộ sưu tập': 'Test', collection_id: 1, ...over,
} as BookingTask);

const tasks: BookingTasks = {
  date: '10/11/2026', tomorrow_date: '11/11/2026', generated_at: '10/11/2026 08:15',
  late: [task({
    id: 1, 'Booking No': 'SGN3527323', Carrier: 'CMA CGM', Vessel: 'ZHONG GU BEI JING TVI000W19', "Q'ty": '1',
    'Equipment Type': "40'HC", 'Full return CY': 'GEMALINK PORT', 'Hạn cut-off': '09/11/2026 21:00', 'Trạng thái': 'stuffed',
  })],
  today: [task({ id: 2, 'Booking No': 'SGNGDV165600', Carrier: 'ONE', Vessel: 'RACHA BHUM 215W', 'Trạng thái': 'dispatched' })],
  tomorrow: [task({ id: 3, 'Booking No': 'A59GX35819', Carrier: 'null', 'Hạn cut-off': '11/11/2026 23:59', 'Cut-off cả ngày': true })],
};

describe('bookingTasksMessage', () => {
  it('lists late, today and tomorrow with the stage each booking is at', () => {
    expect(bookingTasksMessage(tasks, vi)).toBe([
      '📋 VIỆC HÔM NAY 10/11 (cập nhật 08:15)',
      '',
      '‼ ĐÃ QUÁ CUT-OFF, CHƯA HẠ BÃI (1):',
      "• 09/11 21:00 – SGN3527323 – CMA CGM – ZHONG GU BEI JING TVI000W19 – 1x40'HC – hạ GEMALINK PORT – Đã đóng hàng",
      '',
      '⏰ CUT-OFF HÔM NAY 10/11 (1):',
      '• 09:00 – SGNGDV165600 – ONE – RACHA BHUM 215W – Đã điều xe lấy rỗng',
      '',
      '📅 CUT-OFF NGÀY MAI 11/11 (1):',
      '• cả ngày – A59GX35819 – Mới',
    ].join('\n'));
  });

  it('names the collection and leaves empty sections out', () => {
    const text = bookingTasksMessage({ ...tasks, late: [], tomorrow: [] }, vi, 'Kho Sóng Thần');
    expect(text.split('\n').slice(0, 2)).toEqual(['📋 VIỆC HÔM NAY 10/11 (cập nhật 08:15)', 'Bộ sưu tập: Kho Sóng Thần']);
    expect(text).not.toContain('QUÁ CUT-OFF');
    expect(text).not.toContain('NGÀY MAI');
  });

  it('says so when there is nothing to do', () => {
    expect(bookingTasksMessage({ ...tasks, late: [], today: [], tomorrow: [] }, vi)).toContain(vi.booking.tasks.msgEmpty);
  });

  it('counts the lines past the limit of a section', () => {
    const many = Array.from({ length: TASKS_MESSAGE_MAX_PER_SECTION + 2 }, (_, i) => task({ id: i, 'Booking No': `BK${i}` }));
    const text = bookingTasksMessage({ ...tasks, today: many }, vi);
    expect(text).toContain(`CUT-OFF HÔM NAY 10/11 (${TASKS_MESSAGE_MAX_PER_SECTION + 2}):`);
    expect(text).toContain('… và 2 booking khác');
  });

  it('keeps the parts in place when some are missing', () => {
    expect(taskMessageLine(task({ 'Booking No': 'BK1', Vessel: 'KOTA NEKAD 0272S' }), false, vi)).toBe('09:00 – BK1 – KOTA NEKAD 0272S – Mới');
    expect(taskTime(task({}), true, vi)).toBe('10/11 09:00');
  });

  it('is written in the chosen language', () => {
    expect(bookingTasksMessage(tasks, translations.en)).toContain('CUT-OFF PASSED, NOT GATED IN (1):');
  });
});
