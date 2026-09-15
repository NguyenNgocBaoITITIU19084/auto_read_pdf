/** Backend timestamps are Vietnam wall-clock strings without an offset. Never parse them with the machine timezone. */
export const VN_OFFSET = '+07:00';
export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const NAIVE_ISO = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const pad = (n: number | string) => String(n).padStart(2, '0');

const fromParts = (y: string, mo: string, d: string, h = '0', mi = '0', s = '0'): Date | null => {
  const date = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${VN_OFFSET}`);
  return isNaN(date.getTime()) ? null : date;
};

export function parseVnDateTime(value?: string | null): Date | null {
  if (!value || value === 'null') return null;
  const s = value.trim();
  let m = s.match(NAIVE_ISO);
  if (m) return fromParts(m[1], m[2], m[3], m[4], m[5], m[6] || '0');
  m = s.match(DATE_ONLY_ISO);
  if (m) return fromParts(m[1], m[2], m[3]);
  m = s.match(DMY);
  if (m) return fromParts(m[3], m[2], m[1], m[4] || '0', m[5] || '0', m[6] || '0');
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: VN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function vnParts(d: Date) {
  const get = (type: string) => Number(partsFormatter.formatToParts(d).find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}
