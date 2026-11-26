import type { BookingTask, ZaloTemplate } from '../../types';

/** Fields a template may use. `source` says who fills it when the template is applied. */
export const TEMPLATE_FIELDS: { key: string; label: string; source: 'chat' | 'booking'; sample: string }[] = [
  { key: 'driver_name', label: 'Tên tài xế', source: 'chat', sample: 'Nguyễn Văn A' },
  { key: 'vehicle_plate', label: 'Biển số xe', source: 'chat', sample: '51C-123.45' },
  { key: 'booking_no', label: 'Số booking', source: 'booking', sample: 'SGNM42330700' },
  { key: 'qty_type', label: 'SL × loại cont', source: 'booking', sample: "1x40'HC" },
  { key: 'empty_pickup_cy', label: 'Nơi lấy rỗng', source: 'booking', sample: 'Cát Lái' },
  { key: 'full_return_cy', label: 'Nơi hạ hàng', source: 'booking', sample: 'TCIT' },
  { key: 'cutoff_time', label: 'Hạn cut-off', source: 'booking', sample: '02/04/2026 07:00' },
  { key: 'vessel', label: 'Tàu', source: 'booking', sample: 'HMM OCEAN' },
];

const KNOWN_KEYS = new Set(TEMPLATE_FIELDS.map((f) => f.key));

export const TEMPLATE_CATEGORIES: { id: string; label: string; dot: string }[] = [
  { id: 'dispatch', label: 'Điều xe', dot: 'bg-blue-500' },
  { id: 'booking', label: 'Booking', dot: 'bg-amber-500' },
  { id: 'vessel', label: 'Lịch tàu', dot: 'bg-violet-500' },
  { id: 'general', label: 'Chung', dot: 'bg-slate-400' },
];

export const categoryOf = (id: string) =>
  TEMPLATE_CATEGORIES.find((c) => c.id === id) || TEMPLATE_CATEGORIES[TEMPLATE_CATEGORIES.length - 1];

/** `{foo}` names in the text that no booking or chat can fill. */
export function unknownFields(text: string): string[] {
  const names = [...text.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]);
  return [...new Set(names.filter((n) => !KNOWN_KEYS.has(n)))];
}

/** "Lấy Rỗng" → "/lay-rong": a slash, lowercase, no accents, words joined by "-". */
export function normalizeShortcut(raw: string): string {
  const body = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return body ? `/${body}` : '';
}

/** Templates whose name, shortcut or content contain the query (accents ignored). */
export function searchTemplates(list: ZaloTemplate[], query: string, category: string | null): ZaloTemplate[] {
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const q = fold(query.trim());
  return list.filter(
    (t) =>
      (!category || t.category === category) &&
      (!q || fold(t.name).includes(q) || fold(t.shortcut).includes(q) || fold(t.content).includes(q)),
  );
}

/** Templates offered while the composer holds only a "/shortcut" being typed. */
export function shortcutMatches(list: ZaloTemplate[], composerText: string): ZaloTemplate[] {
  const typed = composerText.trim().toLowerCase();
  if (!/^\/[a-z0-9-]*$/.test(typed) || composerText.includes('\n')) return [];
  return list.filter((t) => t.shortcut && t.shortcut.toLowerCase().startsWith(typed));
}

// Template fields a booking fills in. {driver_name}/{vehicle_plate} come from the conversation instead.
export const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;
export const BOOKING_FIELD_KEYS = new Set(TEMPLATE_FIELDS.filter((f) => f.source === 'booking').map((f) => f.key));

export function findPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[0]))];
}

export function taskPlaceholderValues(task: BookingTask): Record<string, string> {
  const qty = task["Q'ty"];
  const eq = task['Equipment Type'] || '';
  return {
    booking_no: task['Booking No'] || '',
    qty_type: qty && eq ? `${qty}x${eq}` : eq,
    empty_pickup_cy: task['Empty Pick Up CY'] || '',
    full_return_cy: task['Full return CY'] || '',
    cutoff_time: task['Hạn cut-off'] || '',
    vessel: task.Vessel || '',
  };
}

/** Fill the placeholders that have a value; ones without stay as {name} so the send check still catches them. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (whole, key: string) => (values[key] ? values[key] : whole));
}
