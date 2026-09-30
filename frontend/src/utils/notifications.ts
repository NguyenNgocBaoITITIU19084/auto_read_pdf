import type { AppNotification } from '../types';
import type { AppContextType } from '../context/AppContext';
import { tf } from '../services/i18nFormat';

type Translations = AppContextType['t'];

/** Vessel + voyage or container number, as the notification's subject. */
export function notificationSubject(n: AppNotification): string {
  const d = n.detail || {};
  if (n.kind.startsWith('container_')) return d.container || n.nav_query || '';
  return [d.vessel, d.voyage].filter(Boolean).join(' ') || n.nav_query || '';
}

/** Localized headline; falls back to the backend's Vietnamese text for an unknown kind. */
export function notificationTitle(n: AppNotification, t: Translations): string {
  if (n.kind === 'test') return t.notifications.testTitle;
  const template = (t.notifications.titles as Record<string, string>)[n.kind];
  const subject = notificationSubject(n);
  return template && subject ? tf(template, { name: subject }) : n.title;
}

/** "old → new" for a changed time, just the new value for an event. */
export function notificationChange(n: AppNotification): string {
  return n.old_value ? `${n.old_value} → ${n.new_value}` : n.new_value;
}
