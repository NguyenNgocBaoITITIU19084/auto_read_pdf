/**
 * Date/time formatting utilities for update indicators
 */

export function parseCustomDate(dateStr?: string | null): Date | null {
  if (!dateStr || dateStr === 'null' || dateStr === '') return null;

  // Format: 'YYYY-MM-DD HH:mm:ss' or standard ISO
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;

  // Try parsing 'DD/MM/YYYY HH:mm'
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const [, day, month, year, h, m, s] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(h || 0), Number(m || 0), Number(s || 0));
  }

  return null;
}

export function formatTimeAgo(dateStr?: string | null): string {
  const d = parseCustomDate(dateStr);
  if (!d) return dateStr || 'Chưa cập nhật';

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) {
    return 'Vừa xong';
  }
  if (diffMin < 60) {
    return `${diffMin} phút trước`;
  }
  if (diffHour < 24 && now.getDate() === d.getDate()) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `Hôm nay ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isRecentUpdate(dateStr?: string | null, thresholdMinutes: number = 30): boolean {
  const d = parseCustomDate(dateStr);
  if (!d) return false;

  const now = new Date();
  const diffMinutes = (now.getTime() - d.getTime()) / (1000 * 60);
  return diffMinutes >= 0 && diffMinutes <= thresholdMinutes;
}
