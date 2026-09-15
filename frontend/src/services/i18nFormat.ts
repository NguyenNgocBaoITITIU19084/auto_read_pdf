/**
 * Replace `{name}` placeholders in a translation string.
 * tf("Đã chọn {count}", { count: 3 }) -> "Đã chọn 3"
 */
export const tf = (template: string, vars: Record<string, string | number> = {}): string =>
  String(template ?? '').replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );

/** Formats backend local-time strings ("YYYY-MM-DD HH:MM:SS" or ISO) as "HH:MM dd/MM/yyyy". */
export const formatDateTimeShort = (value?: string | null): string => {
  if (!value) return '';
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(' ', 'T') : value;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
