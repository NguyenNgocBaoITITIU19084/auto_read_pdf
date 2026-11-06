import { beforeEach, describe, expect, it } from 'vitest';
import { recallSpItcCaptcha, rememberSpItcCaptcha, resetSpItcCaptchaMemory } from './spItcCaptchaMemory';

const captcha = { session_id: 's1', image_data: 'data:image/png;base64,AA==', expires_in: 600 };

describe('spItcCaptchaMemory', () => {
  beforeEach(() => resetSpItcCaptchaMemory());

  it('gives back the captcha, the typed code and the containers left while the captcha is valid', () => {
    rememberSpItcCaptcha({ captcha, expiresAt: 1_000_000, code: '4821', pendingContainers: 'OOLU7654321' });
    expect(recallSpItcCaptcha(999_999)).toEqual({ captcha, expiresAt: 1_000_000, code: '4821', pendingContainers: 'OOLU7654321' });
  });

  it('drops an expired captcha and its code, but keeps the containers still to search', () => {
    rememberSpItcCaptcha({ captcha, expiresAt: 1_000_000, code: '4821', pendingContainers: 'OOLU7654321' });
    expect(recallSpItcCaptcha(1_000_000)).toEqual({ captcha: null, expiresAt: null, code: '', pendingContainers: 'OOLU7654321' });
    expect(recallSpItcCaptcha(0).captcha).toBeNull(); // stays dropped
  });

  it('starts empty', () => {
    expect(recallSpItcCaptcha()).toEqual({ captcha: null, expiresAt: null, code: '', pendingContainers: '' });
  });
});
