import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, addToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));

const getSystemResourcesApi = vi.fn();
vi.mock('../../services/api', () => ({
  getSystemResourcesApi: () => getSystemResourcesApi(),
  freeBackendMemoryApi: vi.fn(),
}));

import { ResourceMonitor } from './ResourceMonitor';

const snapshot = {
  sampled_at: '2026-09-23 10:00:00',
  system: { cpu_percent: 20, cpu_count: 8, ram_total: 8 * 1024 ** 3, ram_used: 4 * 1024 ** 3, ram_percent: 50 },
  backend: { pid: 1, rss: 300 * 1024 ** 2, cpu_percent: 2, child_count: 0 },
};

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('ResourceMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    getSystemResourcesApi.mockReset().mockResolvedValue(snapshot);
    addToast.mockReset();
    delete (window as any).electronAPI;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls every 3s and shows backend-only figures outside Electron', async () => {
    render(<ResourceMonitor />);
    await flush();
    expect(getSystemResourcesApi).toHaveBeenCalledTimes(1);
    expect(screen.getByText('300 MB')).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(3000); });
    await flush();
    expect(getSystemResourcesApi).toHaveBeenCalledTimes(2);

    const restart = screen.getByRole('button', { name: translations.vi.dashboard.resources.restartBackend });
    expect(restart).toBeDisabled();
  });

  it('stops polling while the window is hidden and resumes when visible', async () => {
    render(<ResourceMonitor />);
    await flush();
    act(() => setVisibility('hidden'));
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(getSystemResourcesApi).toHaveBeenCalledTimes(1);

    act(() => setVisibility('visible'));
    await flush();
    expect(getSystemResourcesApi).toHaveBeenCalledTimes(2);
  });

  it('stops polling on unmount', async () => {
    const { unmount } = render(<ResourceMonitor />);
    await flush();
    unmount();
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(getSystemResourcesApi).toHaveBeenCalledTimes(1);
  });

  it('shows a single inline notice (no toast spam) while the backend is down', async () => {
    getSystemResourcesApi.mockRejectedValue(new Error('Network Error'));
    render(<ResourceMonitor />);
    for (let i = 0; i < 5; i++) {
      await act(async () => { vi.advanceTimersByTime(3000); });
      await flush();
    }
    expect(screen.getAllByText(translations.vi.dashboard.resources.unavailable)).toHaveLength(1);
    expect(addToast).not.toHaveBeenCalled();
  });

  it('adds Electron process metrics when available', async () => {
    (window as any).electronAPI = {
      getAppMetrics: vi.fn().mockResolvedValue({
        processes: [{ type: 'Tab', pid: 2, cpuPercent: 1, workingSetBytes: 200 * 1024 ** 2 }],
        totalCpuPercent: 1,
        totalWorkingSetBytes: 200 * 1024 ** 2,
        cpuCount: 8,
      }),
      restartBackend: vi.fn(),
    };
    render(<ResourceMonitor />);
    await flush();
    expect(screen.getByText('500 MB')).toBeInTheDocument();
    const restart = screen.getByRole('button', { name: translations.vi.dashboard.resources.restartBackend });
    expect(restart).not.toBeDisabled();
  });
});
