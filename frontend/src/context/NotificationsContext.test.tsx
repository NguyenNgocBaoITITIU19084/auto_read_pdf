import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { translations } from '../i18n/translations';
import type { AppNotification } from '../types';

const addToast = vi.fn();
let autoSyncStatus: { last_run_at: string | null } | null = { last_run_at: null };
vi.mock('./AppContext', () => ({ useApp: () => ({ t: translations.vi, autoSyncStatus }) }));
vi.mock('./ToastContext', () => ({ useToastActions: () => ({ addToast }) }));

const getNotifications = vi.fn();
const markRead = vi.fn();
const clearRead = vi.fn();
vi.mock('../services/api', () => ({
  getNotificationsApi: (...a: unknown[]) => getNotifications(...a),
  markNotificationsReadApi: (...a: unknown[]) => markRead(...a),
  clearNotificationsApi: (...a: unknown[]) => clearRead(...a),
}));

import { NotificationsProvider, POLL_MS, useNotifications } from './NotificationsContext';

const wrapper = ({ children }: { children: React.ReactNode }) => <NotificationsProvider>{children}</NotificationsProvider>;
const note = (id: number, over: Partial<AppNotification> = {}): AppNotification => ({
  id, collection_id: 1, kind: 'container_outgate', title: `Cont C${id} đã OUTGATE`, old_value: '', new_value: '26/09/2026 09:46',
  detail: { container: `C${id}` }, nav_tab: 'container', nav_query: `C${id}`, source: 'auto_sync', created_at: '2026-09-30 10:00:00', read: false, ...over,
});
const reply = (items: AppNotification[]) => ({ items, unread: items.filter((i) => !i.read).length });

let visibility: DocumentVisibilityState = 'visible';

describe('NotificationsProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    addToast.mockReset();
    getNotifications.mockReset().mockResolvedValue(reply([]));
    markRead.mockReset().mockResolvedValue(undefined);
    clearRead.mockReset().mockResolvedValue(undefined);
    autoSyncStatus = { last_run_at: null };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads on mount without toasting what already exists', async () => {
    getNotifications.mockResolvedValue(reply([note(5), note(4)]));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.unread).toBe(2));
    expect(result.current.items.map((n) => n.id)).toEqual([5, 4]);
    expect(addToast).not.toHaveBeenCalled();
  });

  it('toasts each new unread change once, in order, and folds a burst into one toast', async () => {
    getNotifications.mockResolvedValueOnce(reply([note(1)]));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    getNotifications.mockResolvedValueOnce(reply([note(3), note(2), note(1)]));
    await act(async () => { await result.current.refresh(); });
    expect(addToast.mock.calls.map((c) => c[0])).toEqual(['Cont C2 đã OUTGATE', 'Cont C3 đã OUTGATE']);

    addToast.mockClear();
    getNotifications.mockResolvedValueOnce(reply([note(3), note(2), note(1)]));
    await act(async () => { await result.current.refresh(); });
    expect(addToast).not.toHaveBeenCalled();                                     // nothing new: no repeat

    getNotifications.mockResolvedValueOnce(reply([note(7), note(6), note(5), note(4), note(3)]));
    await act(async () => { await result.current.refresh(); });
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast.mock.calls[0][0]).toBe('Có 4 thay đổi mới về tàu và cont');
  });

  it('does not toast a change that was already read, or while the window is hidden', async () => {
    getNotifications.mockResolvedValueOnce(reply([note(1)]));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    getNotifications.mockResolvedValueOnce(reply([note(2, { read: true }), note(1)]));
    await act(async () => { await result.current.refresh(); });
    visibility = 'hidden';
    getNotifications.mockResolvedValueOnce(reply([note(3), note(2, { read: true }), note(1)]));
    await act(async () => { await result.current.refresh(); });
    expect(addToast).not.toHaveBeenCalled();
  });

  it('polls while visible, pauses while hidden and reloads right after an auto-sync run', async () => {
    const { rerender } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(1));
    await act(async () => { vi.advanceTimersByTime(POLL_MS); });
    await waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(2));

    autoSyncStatus = { last_run_at: '2026-09-30 10:10:00' };
    rerender();
    await waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(3));

    act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { vi.advanceTimersByTime(POLL_MS * 3); });
    expect(getNotifications).toHaveBeenCalledTimes(3);
    act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(4));
  });

  it('marks read optimistically, marks all, and clears the read ones', async () => {
    getNotifications.mockResolvedValue(reply([note(2), note(1)]));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.unread).toBe(2));

    getNotifications.mockResolvedValue(reply([note(2), note(1, { read: true })]));
    await act(async () => { await result.current.markRead([1]); });
    expect(markRead).toHaveBeenCalledWith([1]);
    expect(result.current.unread).toBe(1);

    getNotifications.mockResolvedValue(reply([note(2, { read: true }), note(1, { read: true })]));
    await act(async () => { await result.current.markAllRead(); });
    expect(markRead).toHaveBeenLastCalledWith();
    expect(result.current.unread).toBe(0);

    await act(async () => { await result.current.clearRead(); });
    expect(clearRead).toHaveBeenCalledWith(true);
  });

  it('stays quiet when the backend is unavailable', async () => {
    getNotifications.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(getNotifications).toHaveBeenCalled());
    expect(result.current.items).toEqual([]);
    expect(addToast).not.toHaveBeenCalled();
  });
});
