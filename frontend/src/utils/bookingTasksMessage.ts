import type { BookingStatus, BookingTask, BookingTasks } from '../types';
import type { AppContextType } from '../context/AppContext';
import { tf } from '../services/i18nFormat';

type Translations = AppContextType['t'];

/** Lines listed per section of the copied message before the rest is counted (the window lists them all) */
export const TASKS_MESSAGE_MAX_PER_SECTION = 25;

const DMY_HM = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;

/** "09:30" for today / tomorrow (the section names the day), "09/12 07:00" for a passed one; "cả ngày" when only a
 *  date was given. */
export function taskTime(b: BookingTask, withDay: boolean, t: Translations): string {
  const m = DMY_HM.exec(b['Hạn cut-off'] || '');
  if (!m) return b['Hạn cut-off'] || '';
  const time = b['Cut-off cả ngày'] ? t.booking.tasks.allDay : `${m[4]}:${m[5]}`;
  return withDay ? `${m[1]}/${m[2]} ${time}` : time;
}

const clean = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return s && s.toLowerCase() !== 'null' ? s : '';
};

/** "09:30 – SGN601175800 – PIL – KOTA NEKAD 0272S – 1x40'HC – hạ CAT LAI – Đã điều xe lấy rỗng": the parts a
 *  booking has; the status shows where each one is stuck. */
export function taskMessageLine(b: BookingTask, withDay: boolean, t: Translations): string {
  const qty = clean(b["Q'ty"]);
  const type = clean(b['Equipment Type']);
  const cy = clean(b['Full return CY']);
  return [
    taskTime(b, withDay, t),
    clean(b['Booking No']),
    clean(b.Carrier),
    clean(b.Vessel),
    qty && type ? `${qty}x${type}` : type || qty,
    cy ? tf(t.notifications.message.returnCy, { cy }) : '',
    t.booking.status.labels[b['Trạng thái'] as BookingStatus] || '',
  ].filter(Boolean).join(' – ');
}

/**
 * Plain-text work list for a chat app (Zalo renders no Markdown), empty sections left out:
 *
 *   📋 VIỆC HÔM NAY 10/11 (cập nhật 08:15)
 *
 *   ‼ ĐÃ QUÁ CUT-OFF, CHƯA HẠ BÃI (1):
 *   • 09/11 21:00 – SGN3527323 – CMA CGM – ZHONG GU BEI JING TVI000W19 – 1x40'HC – hạ GEMALINK PORT – Đã đóng hàng
 *
 *   ⏰ CUT-OFF HÔM NAY 10/11 (1):
 *   • 09:00 – ...
 *
 * `scope` names the collection when the list is one collection's.
 */
export function bookingTasksMessage(tasks: BookingTasks, t: Translations, scope?: string): string {
  const k = t.booking.tasks;
  const short = (dmy: string) => dmy.slice(0, 5);
  const time = (tasks.generated_at || '').slice(11, 16);
  const lines = [`📋 ${tf(k.msgHeader, { date: short(tasks.date), time })}`];
  if (scope) lines.push(tf(k.msgScope, { name: scope }));

  const sections: [string, string, BookingTask[], boolean][] = [
    ['‼', tf(k.msgLate, { count: tasks.late.length }), tasks.late, true],
    ['⏰', tf(k.msgToday, { date: short(tasks.date), count: tasks.today.length }), tasks.today, false],
    ['📅', tf(k.msgTomorrow, { date: short(tasks.tomorrow_date), count: tasks.tomorrow.length }), tasks.tomorrow, false],
  ];
  let any = false;
  for (const [icon, heading, items, withDay] of sections) {
    if (!items.length) continue;
    any = true;
    lines.push('', `${icon} ${heading}`);
    lines.push(...items.slice(0, TASKS_MESSAGE_MAX_PER_SECTION).map((b) => `• ${taskMessageLine(b, withDay, t)}`));
    if (items.length > TASKS_MESSAGE_MAX_PER_SECTION) {
      lines.push(tf(k.msgMore, { count: items.length - TASKS_MESSAGE_MAX_PER_SECTION }));
    }
  }
  if (!any) lines.push('', k.msgEmpty);
  return lines.join('\n');
}
