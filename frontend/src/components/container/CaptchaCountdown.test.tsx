import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CaptchaCountdown, formatCountdown } from './CaptchaCountdown';

const props = { tooltip: 'Thời gian sử dụng còn lại của captcha', expiredText: 'Hết hạn', expiredTooltip: 'Mã đã hết hạn' };

describe('CaptchaCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('formats minutes and seconds', () => {
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(61.2)).toBe('1:02');
    expect(formatCountdown(-5)).toBe('0:00');
  });

  it('counts down, warns in the last minute, then says it expired and stops ticking', () => {
    render(<CaptchaCountdown expiresAt={Date.now() + 62_000} {...props} />);
    const timer = screen.getByRole('timer');
    expect(timer.textContent).toBe('1:02');
    expect(timer.getAttribute('aria-label')).toBe('Thời gian sử dụng còn lại của captcha');
    expect(timer.dataset.tone).toBe('ok');
    expect(timer.className).toContain('bg-sky-50');

    act(() => { vi.advanceTimersByTime(3_000); });
    expect(timer.textContent).toBe('0:59');
    expect(timer.dataset.tone).toBe('warn');
    expect(timer.className).toContain('bg-amber-50');

    act(() => { vi.advanceTimersByTime(59_000); });
    expect(timer.textContent).toBe('Hết hạn');
    expect(timer.getAttribute('aria-label')).toBe('Mã đã hết hạn');
    expect(timer.dataset.tone).toBe('expired');
    expect(timer.className).toContain('bg-rose-50');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says what it is on hover', () => {
    render(<CaptchaCountdown expiresAt={Date.now() + 600_000} {...props} />);
    expect(screen.queryByText('Thời gian sử dụng còn lại của captcha')).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('timer'));
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText('Thời gian sử dụng còn lại của captcha')).toBeTruthy();
  });

  it('starts over for a new captcha', () => {
    const { rerender } = render(<CaptchaCountdown expiresAt={Date.now() + 5_000} {...props} />);
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(screen.getByRole('timer').textContent).toBe('Hết hạn');
    rerender(<CaptchaCountdown expiresAt={Date.now() + 600_000} {...props} />);
    expect(screen.getByRole('timer').textContent).toBe('10:00');
  });
});
