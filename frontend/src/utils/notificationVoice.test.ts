import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNotificationVoiceOn, playNotificationVoice, setNotificationVoiceOn } from './notificationVoice';

describe('notification voice', () => {
  const play = vi.fn(() => Promise.resolve());
  beforeEach(() => {
    localStorage.clear();
    play.mockClear();
    vi.useFakeTimers();
    vi.stubGlobal('Audio', vi.fn(() => ({ play })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is on until switched off, and remembers the choice', () => {
    expect(isNotificationVoiceOn()).toBe(true);
    setNotificationVoiceOn(false);
    expect(isNotificationVoiceOn()).toBe(false);
    setNotificationVoiceOn(true);
    expect(isNotificationVoiceOn()).toBe(true);
  });

  it('plays the clip after the popup chime', () => {
    playNotificationVoice();
    expect(play).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stays silent when switched off', () => {
    setNotificationVoiceOn(false);
    playNotificationVoice();
    vi.runAllTimers();
    expect(play).not.toHaveBeenCalled();
  });
});
