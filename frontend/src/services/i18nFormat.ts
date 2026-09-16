/**
 * Replace `{name}` placeholders in a translation string.
 * tf("Đã chọn {count}", { count: 3 }) -> "Đã chọn 3"
 */
export const tf = (template: string, vars: Record<string, string | number> = {}): string =>
  String(template ?? '').replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );

import { parseVnDateTime, vnParts } from '../utils/vnTime';

/** Formats backend VN-time strings ("YYYY-MM-DD HH:MM:SS" or ISO) as "HH:MM dd/MM/yyyy" in Vietnam time. */
export const formatDateTimeShort = (value?: string | null): string => {
  if (!value) return '';
  const d = parseVnDateTime(value);
  if (!d) return value;
  const p = vnParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.hour)}:${pad(p.minute)} ${pad(p.day)}/${pad(p.month)}/${p.year}`;
};
