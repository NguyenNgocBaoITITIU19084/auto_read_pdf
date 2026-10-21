import voiceUrl from '../assets/new-notification.m4a';

const STORAGE_KEY = 'notification_voice';
const REPEAT_KEY = 'notification_voice_repeat_min';
/** Minutes between reminders while something is unread (0 = say it only when a notification arrives). */
export const REPEAT_CHOICES = [0, 2, 5, 10] as const;
const DEFAULT_REPEAT_MIN = 5;
/** Let the popup's own chime finish before the voice starts. */
const DELAY_MS = 800;

/** Whether to say "Có thông báo mới" for new notifications (on unless the user switched it off on this machine). */
export function isNotificationVoiceOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setNotificationVoiceOn(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: the setting just isn't remembered */
  }
}

export function getNotificationVoiceRepeatMin(): number {
  try {
    const v = localStorage.getItem(REPEAT_KEY);
    const n = v === null ? DEFAULT_REPEAT_MIN : Number(v);
    return (REPEAT_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_REPEAT_MIN;
  } catch {
    return DEFAULT_REPEAT_MIN;
  }
}

export function setNotificationVoiceRepeatMin(minutes: number): void {
  try {
    localStorage.setItem(REPEAT_KEY, String(minutes));
  } catch {
    /* storage unavailable: the setting just isn't remembered */
  }
}

/** Says "Có thông báo mới" once, if switched on. */
export function playNotificationVoice(): void {
  if (!isNotificationVoiceOn()) return;
  setTimeout(() => {
    new Audio(voiceUrl).play().catch(() => { /* no audio device or playback refused: the popup and bell are enough */ });
  }, DELAY_MS);
}
