import type { AppNotification, Booking } from '../types';
import type { AppContextType } from '../context/AppContext';
import { tf } from '../services/i18nFormat';
import { notificationChanges, notificationSubject, shortDateTime, timeShift } from './notifications';

type Translations = AppContextType['t'];

/** Kinds of the one-row-per-change vessel notifications written before changes were grouped. */
const LEGACY_VESSEL_KINDS = ['vessel_closing', 'vessel_closing_icd', 'vessel_open_gate', 'vessel_eta', 'vessel_etd'];
/** Bookings listed one per line before the rest is counted */
export const MESSAGE_MAX_BOOKINGS = 20;

const clean = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return s && s.toLowerCase() !== 'null' ? s : '';
};

/** A notification a schedule-change message can be written for: a vessel whose times changed. */
export function isVesselChangeNotification(n: AppNotification): boolean {
  return n.kind === 'vessel_schedule' || LEGACY_VESSEL_KINDS.includes(n.kind);
}

/** Changed times of a grouped notification, or the one time of an older one-row-per-change notification. */
function changesOf(n: AppNotification, t: Translations): { kind: string; label: string; old: string; new: string }[] {
  const grouped = notificationChanges(n, t);
  if (grouped.length || !LEGACY_VESSEL_KINDS.includes(n.kind) || !n.old_value) return grouped;
  const labels = t.notifications.changeLabels as Record<string, string>;
  return [{ kind: n.kind, label: labels[n.kind] || n.kind, old: n.old_value, new: n.new_value }];
}

/** "SGN3527323 – CMA CGM – 1x40'HC – hạ GEMALINK PORT": the parts a booking has, never its PDF cut-off
 *  (the message is about the new time; the PDF's would contradict it). */
export function bookingMessageLine(b: Partial<Booking>, t: Translations): string {
  const m = t.notifications.message;
  const qty = clean(b["Q'ty"]);
  const type = clean(b['Equipment Type']);
  const cy = clean(b['Full return CY']);
  return [
    clean(b['Booking No']),
    clean(b.Carrier),
    qty && type ? `${qty}x${type}` : type || qty,
    cy ? tf(m.returnCy, { cy }) : '',
  ].filter(Boolean).join(' – ');
}

/**
 * Plain-text message about a vessel's schedule change, for a chat app (Zalo renders no Markdown):
 *
 *   ‼ TÀU ĐỔI LỊCH: ZHONG GU BEI JING TVI000W19
 *   Cảng: Cát Lái (CTL)
 *   • Cut-off: 10/11 09:00 → 09/11 21:00 (SỚM HƠN 12 giờ)
 *   • ETD: 11/11 23:00 → 12/11 05:00 (trễ hơn 6 giờ)
 *
 *   Booking trên chuyến này (1):
 *   • SGN3527323 – CMA CGM – 1x40'HC – hạ GEMALINK PORT
 *   (Theo ePort lúc 08:15 09/11)
 *
 * A time moved earlier leaves less time to get the cargo in, so it is shouted and the header gets ‼ instead of ⚠.
 * `bookings` are the open bookings on the voyage; null when they could not be loaded, then the numbers kept in
 * the notification are listed instead.
 */
export function vesselChangeMessage(n: AppNotification, bookings: Partial<Booking>[] | null, t: Translations): string {
  const m = t.notifications.message;
  const changes = changesOf(n, t);
  const lines: string[] = [];
  let earlier = false;
  const changeLines = changes.map((c) => {
    const shift = timeShift(c.old, c.new, t);
    let note = '';
    if (shift) {
      const amount = shift.text.replace(/^[+−-]/, '');
      if (shift.minutes < 0) earlier = true;
      note = ` (${tf(shift.minutes < 0 ? m.earlier : m.later, { shift: amount })})`;
    }
    return `• ${c.label}: ${shortDateTime(c.old)} → ${shortDateTime(c.new)}${note}`;
  });

  lines.push(`${earlier ? '‼' : '⚠'} ${tf(m.header, { vessel: notificationSubject(n) })}`);
  const site = clean(n.detail?.site_id).toUpperCase();
  if (site) {
    const name = (t.vessel as unknown as Record<string, unknown>)[`site${site}`];
    lines.push(tf(m.port, { site: typeof name === 'string' ? name : site }));
  }
  lines.push(...changeLines);

  const list = bookings ? bookings.map((b) => bookingMessageLine(b, t)).filter(Boolean)
    : (n.detail?.bookings || []).map(clean).filter(Boolean);
  if (list.length) {
    lines.push('', tf(m.bookings, { count: list.length }));
    lines.push(...list.slice(0, MESSAGE_MAX_BOOKINGS).map((l) => `• ${l}`));
    if (list.length > MESSAGE_MAX_BOOKINGS) lines.push(tf(m.more, { count: list.length - MESSAGE_MAX_BOOKINGS }));
  }

  const stamp = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(n.created_at || '');
  if (stamp) lines.push(tf(m.source, { time: `${stamp[4]}:${stamp[5]} ${stamp[3]}/${stamp[2]}` }));
  return lines.join('\n');
}
