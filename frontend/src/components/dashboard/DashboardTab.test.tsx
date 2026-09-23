import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const app = { t: translations.vi, addToast: vi.fn(), autoSyncEnabled: false, activeCollection: { id: 1, name: 'BST 1' }, collections: [] };
vi.mock('../../context/AppContext', () => ({ useApp: () => app }));
vi.mock('./ResourceMonitor', () => ({ ResourceMonitor: () => <div data-testid="resources" /> }));

const getDashboardSummaryApi = vi.fn();
vi.mock('../../services/api', () => ({ getDashboardSummaryApi: (id?: number) => getDashboardSummaryApi(id) }));

import { DashboardTab, __clearDashboardCacheForTests } from './DashboardTab';

const summary = (bookings: number) => ({
  updated_at: '2026-09-23 12:00:00',
  scope: { collection_id: null, collection_name: 'all' },
  kpis: {
    total_bookings: bookings, total_estimated_teus: 0, customs_uncleared: 0, customs_cleared: 0, infras_unpaid: 0,
    infras_paid: 0, containers_in_yard: 0, containers_out_yard: 0, total_vessels: 0, watchlist_vessels: 0,
    total_containers: 0, watchlist_containers: 0,
  },
  alerts: { critical_cutoffs: [], uncleared_containers: [], upcoming_vessels: [] },
  distributions: { carriers: [], sites: [], equipment_types: [], container_events: [] },
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('DashboardTab', () => {
  beforeEach(() => {
    __clearDashboardCacheForTests();
    getDashboardSummaryApi.mockReset();
  });

  it('shows the cached summary instantly when coming back to the tab, then revalidates', async () => {
    getDashboardSummaryApi.mockResolvedValueOnce(summary(30));
    const first = render(<DashboardTab onNavigateTab={vi.fn()} />);
    expect(await screen.findByText('30')).toBeInTheDocument();
    first.unmount();

    const pending = deferred<ReturnType<typeof summary>>();
    getDashboardSummaryApi.mockReturnValueOnce(pending.promise);
    render(<DashboardTab onNavigateTab={vi.fn()} />);
    expect(screen.getByText('30')).toBeInTheDocument(); // no skeleton while refetching
    expect(getDashboardSummaryApi).toHaveBeenCalledTimes(2);

    await act(async () => pending.resolve(summary(31)));
    expect(screen.getByText('31')).toBeInTheDocument();
  });

  it('keeps the content visible while a manual refresh is running', async () => {
    getDashboardSummaryApi.mockResolvedValueOnce(summary(5));
    render(<DashboardTab onNavigateTab={vi.fn()} />);
    expect(await screen.findByText('5')).toBeInTheDocument();

    const pending = deferred<ReturnType<typeof summary>>();
    getDashboardSummaryApi.mockReturnValueOnce(pending.promise);
    act(() => screen.getByRole('button', { name: translations.vi.dashboard.refreshSummary }).click());
    expect(screen.getByText('5')).toBeInTheDocument();
    await act(async () => pending.resolve(summary(6)));
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('does not pass a collection id in "all" scope', async () => {
    getDashboardSummaryApi.mockResolvedValue(summary(1));
    render(<DashboardTab onNavigateTab={vi.fn()} />);
    await screen.findByText('1');
    expect(getDashboardSummaryApi).toHaveBeenCalledWith(undefined);
  });
});
