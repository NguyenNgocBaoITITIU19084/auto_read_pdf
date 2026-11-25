import { describe, expect, it } from 'vitest';
import type { ZaloTemplate } from '../../types';
import { normalizeShortcut, searchTemplates, shortcutMatches, unknownFields } from './zaloTemplates';

const tpl = (id: number, name: string, shortcut: string, category = 'general', content = 'x'): ZaloTemplate => ({
  id, name, shortcut, category, content, created_at: '', updated_at: '',
});
const LIST = [
  tpl(1, 'Nhắc hạn Cut-off', '/cutoff', 'booking', 'Booking {booking_no} cut-off {cutoff_time}'),
  tpl(2, 'Báo đổi lịch tàu', '/doi-lich', 'vessel'),
  tpl(3, 'Hỏi tiến độ', '/tien-do'),
];

describe('zaloTemplates', () => {
  it('normalizes shortcuts to /slug', () => {
    expect(normalizeShortcut('Lấy Rỗng')).toBe('/lay-rong');
    expect(normalizeShortcut('/Đổi  lịch!')).toBe('/doi-lich');
    expect(normalizeShortcut('  ')).toBe('');
  });

  it('flags fields nothing can fill', () => {
    expect(unknownFields('Chào {driver_name}, cont {container_no} {booking_no}')).toEqual(['container_no']);
  });

  it('searches without accents and by category', () => {
    expect(searchTemplates(LIST, 'doi lich', null).map((t) => t.id)).toEqual([2]);
    expect(searchTemplates(LIST, '', 'booking').map((t) => t.id)).toEqual([1]);
    expect(searchTemplates(LIST, 'cutoff_time', null).map((t) => t.id)).toEqual([1]);
  });

  it('offers shortcuts only while the composer holds a bare /word', () => {
    expect(shortcutMatches(LIST, '/').length).toBe(3);
    expect(shortcutMatches(LIST, '/d').map((t) => t.id)).toEqual([2]);
    expect(shortcutMatches(LIST, 'anh /d')).toEqual([]);
    expect(shortcutMatches(LIST, '/cutoff xong')).toEqual([]);
  });
});
