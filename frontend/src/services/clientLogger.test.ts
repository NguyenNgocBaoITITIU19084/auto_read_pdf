import { describe, expect, it, vi, beforeEach } from 'vitest';
import { reportClientLog, installGlobalErrorLogging, setClientLogTransport, __resetClientLoggerForTests, ClientLogPayload } from './clientLogger';

describe('clientLogger', () => {
  const transport = vi.fn(async (_payload: ClientLogPayload) => undefined);

  beforeEach(() => {
    __resetClientLoggerForTests();
    transport.mockClear();
    setClientLogTransport(transport);
  });

  it('sends a payload with url and version', () => {
    reportClientLog('error', 'boom', { stack: 'at X' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toMatchObject({ level: 'error', message: 'boom', stack: 'at X' });
    expect(transport.mock.calls[0][0].url).toBeTruthy();
  });

  it('dedupes the same message within 30s', () => {
    vi.useFakeTimers();
    reportClientLog('error', 'same');
    reportClientLog('error', 'same');
    expect(transport).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    reportClientLog('error', 'same');
    expect(transport).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('never throws when the transport fails', () => {
    setClientLogTransport(() => { throw new Error('offline'); });
    expect(() => reportClientLog('error', 'x')).not.toThrow();
  });

  it('captures window errors and unhandled rejections', () => {
    const uninstall = installGlobalErrorLogging();
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error A', error: new Error('A') }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('B rejected') });
    window.dispatchEvent(rejection);
    uninstall();
    const messages = transport.mock.calls.map((c) => c[0].message);
    expect(messages).toContain('Script error A');
    expect(messages.some((m: string) => m.includes('B rejected'))).toBe(true);
  });
});
