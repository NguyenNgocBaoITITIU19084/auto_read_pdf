import type { SpItcCaptchaResponse } from '../../services/api';

/**
 * The SP-ITC manual captcha outlives the Cont tab: App unmounts a tab when another one is opened, and fetching a
 * new captcha on every return cost two SP-ITC requests and lost the code being typed and the containers still
 * to search. Kept in memory only (a page reload starts over, like the backend's captcha sessions do).
 */
export interface SpItcCaptchaMemory {
  captcha: SpItcCaptchaResponse | null;
  /** Date.now() ms when `captcha` expires, null when unknown */
  expiresAt: number | null;
  /** The code typed for `captcha` */
  code: string;
  /** Manual mode searches one container per code: the ones still to search */
  pendingContainers: string;
}

const empty = (): SpItcCaptchaMemory => ({ captcha: null, expiresAt: null, code: '', pendingContainers: '' });

let memory: SpItcCaptchaMemory = empty();

/** What the Cont tab starts with: an expired captcha (and the code typed for it) is dropped. */
export const recallSpItcCaptcha = (now: number = Date.now()): SpItcCaptchaMemory => {
  if (memory.captcha && memory.expiresAt !== null && now >= memory.expiresAt) {
    memory = { ...memory, captcha: null, expiresAt: null, code: '' };
  }
  return { ...memory };
};

export const rememberSpItcCaptcha = (patch: Partial<SpItcCaptchaMemory>): void => {
  memory = { ...memory, ...patch };
};

/** Tests only */
export const resetSpItcCaptchaMemory = (): void => {
  memory = empty();
};
