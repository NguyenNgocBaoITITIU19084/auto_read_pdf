import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MobileBridgeProvider, useMobileBridge } from './MobileBridgeContext';
import * as api from '../services/api';
import { MobileSession } from '../types';

vi.mock('../services/api', () => ({
  startMobileSessionApi: vi.fn(),
  getMobileSessionApi: vi.fn(),
  stopMobileSessionApi: vi.fn(),
  fetchMobilePhotoApi: vi.fn(),
  ackMobilePhotoApi: vi.fn(),
}));

const addToastMock = vi.fn();
vi.mock('./ToastContext', () => ({
  useToastActions: () => ({ addToast: addToastMock, removeToast: vi.fn() }),
}));

vi.mock('./AppContext', () => ({
  useApp: () => ({
    t: { booking: { phone: { sessionExpired: 'Phiên kết nối đã hết hạn' } } },
  }),
}));

const activeSession = (overrides: Partial<MobileSession> = {}): MobileSession => ({
  active: true,
  session_id: 's1',
  devices: [],
  pending: [],
  ...overrides,
});

const inactiveSession = (): MobileSession => ({
  active: false,
  devices: [],
  pending: [],
});

// Test harness component exposing the context value via a ref-like global so tests can
// call start/stop/takeNext and read queue/status/session without extra plumbing.
let ctxValue: ReturnType<typeof useMobileBridge> | null = null;
const Harness: React.FC = () => {
  ctxValue = useMobileBridge();
  return (
    <div>
      <span data-testid="status">{ctxValue.status}</span>
      <span data-testid="queue-len">{ctxValue.queue.length}</span>
      <span data-testid="session">{ctxValue.session ? 'has-session' : 'no-session'}</span>
    </div>
  );
};

const renderHarness = () =>
  render(
    <MobileBridgeProvider>
      <Harness />
    </MobileBridgeProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  ctxValue = null;
  vi.useFakeTimers();
  // Default: no existing session on mount.
  (api.getMobileSessionApi as any).mockResolvedValue(inactiveSession());
  // Default: ack/fetch resolve so a bare `.catch()` on the returned promise never throws
  // in tests that don't care about ack behavior specifically.
  (api.ackMobilePhotoApi as any).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MobileBridgeContext', () => {
  it('does not poll before start() is called', async () => {
    renderHarness();
    // Allow the mount-time single check to resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.getMobileSessionApi).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    // Still just the single mount-time call — no interval started.
    expect(api.getMobileSessionApi).toHaveBeenCalledTimes(1);
  });

  it('polls every 2s after start() and fetches each new pending photo exactly once, even with overlapping polls', async () => {
    (api.startMobileSessionApi as any).mockResolvedValue(activeSession());

    let resolveFetch: (f: File) => void;
    const fetchPromise = new Promise<File>((resolve) => {
      resolveFetch = resolve;
    });
    (api.fetchMobilePhotoApi as any).mockReturnValue(fetchPromise);

    (api.getMobileSessionApi as any).mockResolvedValue(
      activeSession({ pending: [{ id: 'p1', filename: 'a.jpg', size: 10, received_at: 1 }] })
    );

    renderHarness();
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await ctxValue!.start();
    });

    expect(api.startMobileSessionApi).toHaveBeenCalledWith(undefined);
    expect(screen.getByTestId('status').textContent).toBe('active');

    // First poll tick fires immediately-ish on interval; advance 2s to trigger first poll.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.fetchMobilePhotoApi).toHaveBeenCalledTimes(1);
    expect(api.fetchMobilePhotoApi).toHaveBeenCalledWith('p1', 'a.jpg');

    // Second poll tick happens before the fetch resolves — must not re-fetch p1.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.fetchMobilePhotoApi).toHaveBeenCalledTimes(1);

    // Now resolve the fetch — the file should land in the queue.
    const file = new File(['x'], 'a.jpg');
    await act(async () => {
      resolveFetch!(file);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctxValue!.queue.length).toBe(1);
    expect(ctxValue!.queue[0]).toBe(file);

    // A further poll tick (still same pending id) must still not re-fetch.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.fetchMobilePhotoApi).toHaveBeenCalledTimes(1);
  });

  it('takeNext() returns and removes the first queued File and acks its photo id', async () => {
    (api.startMobileSessionApi as any).mockResolvedValue(activeSession());
    const file1 = new File(['1'], 'one.jpg');
    const file2 = new File(['2'], 'two.jpg');

    (api.getMobileSessionApi as any)
      .mockResolvedValueOnce(inactiveSession()) // mount check
      .mockResolvedValueOnce(
        activeSession({
          pending: [
            { id: 'p1', filename: 'one.jpg', size: 1, received_at: 1 },
            { id: 'p2', filename: 'two.jpg', size: 1, received_at: 2 },
          ],
        })
      )
      .mockResolvedValue(
        activeSession({
          pending: [
            { id: 'p1', filename: 'one.jpg', size: 1, received_at: 1 },
            { id: 'p2', filename: 'two.jpg', size: 1, received_at: 2 },
          ],
        })
      );

    (api.fetchMobilePhotoApi as any).mockImplementation((id: string) =>
      Promise.resolve(id === 'p1' ? file1 : file2)
    );

    renderHarness();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await ctxValue!.start();
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    });

    expect(ctxValue!.queue.length).toBe(2);

    let taken: File | null = null;
    await act(async () => {
      taken = ctxValue!.takeNext();
      await Promise.resolve();
    });
    expect(taken!).toBe(file1);
    expect(ctxValue!.queue.length).toBe(1);
    expect(ctxValue!.queue[0]).toBe(file2);
    expect(api.ackMobilePhotoApi).toHaveBeenCalledWith('p1');

    await act(async () => {
      const taken2 = ctxValue!.takeNext();
      expect(taken2).toBe(file2);
      await Promise.resolve();
    });
    expect(ctxValue!.queue.length).toBe(0);
    expect(api.ackMobilePhotoApi).toHaveBeenCalledWith('p2');
  });

  it('stops polling, clears session and shows sessionExpired toast when poll reports active:false', async () => {
    (api.startMobileSessionApi as any).mockResolvedValue(activeSession());
    (api.getMobileSessionApi as any)
      .mockResolvedValueOnce(inactiveSession()) // mount check
      .mockResolvedValueOnce(inactiveSession()); // first poll after start -> expired

    renderHarness();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await ctxValue!.start();
    });
    expect(ctxValue!.status).toBe('active');

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ctxValue!.session).toBeNull();
    expect(addToastMock).toHaveBeenCalledWith('Phiên kết nối đã hết hạn', expect.anything());

    const callsBefore = (api.getMobileSessionApi as any).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    expect((api.getMobileSessionApi as any).mock.calls.length).toBe(callsBefore);
  });

  it('stop() calls stopMobileSessionApi, stops polling and clears the queue', async () => {
    (api.startMobileSessionApi as any).mockResolvedValue(activeSession());
    const file = new File(['1'], 'one.jpg');
    (api.getMobileSessionApi as any)
      .mockResolvedValueOnce(inactiveSession())
      .mockResolvedValue(
        activeSession({ pending: [{ id: 'p1', filename: 'one.jpg', size: 1, received_at: 1 }] })
      );
    (api.fetchMobilePhotoApi as any).mockResolvedValue(file);
    (api.stopMobileSessionApi as any).mockResolvedValue(undefined);

    renderHarness();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await ctxValue!.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctxValue!.queue.length).toBe(1);

    await act(async () => {
      await ctxValue!.stop();
    });
    expect(api.stopMobileSessionApi).toHaveBeenCalledTimes(1);
    expect(ctxValue!.queue.length).toBe(0);

    const callsBefore = (api.getMobileSessionApi as any).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    expect((api.getMobileSessionApi as any).mock.calls.length).toBe(callsBefore);
  });

  it('does not crash on a transient poll failure and resets the failure count on a subsequent success', async () => {
    (api.startMobileSessionApi as any).mockResolvedValue(activeSession());
    (api.getMobileSessionApi as any)
      .mockResolvedValueOnce(inactiveSession()) // mount check
      .mockRejectedValueOnce(new Error('network')) // 1st poll fails
      .mockResolvedValue(activeSession()); // subsequent polls succeed

    renderHarness();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await ctxValue!.start();
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Single transient failure must not flip to error.
    expect(ctxValue!.status).toBe('active');

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctxValue!.status).toBe('active');
  });

  it('flips status to error after 3 consecutive poll failures', async () => {
    (api.startMobileSessionApi as any).mockResolvedValue(activeSession());
    (api.getMobileSessionApi as any)
      .mockResolvedValueOnce(inactiveSession()) // mount check
      .mockRejectedValue(new Error('network')); // all polls after start fail

    renderHarness();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await ctxValue!.start();
    });

    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(ctxValue!.status).toBe('active');
    }

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctxValue!.status).toBe('error');
  });
});
