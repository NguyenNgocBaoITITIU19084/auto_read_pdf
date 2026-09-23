import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';

vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));
vi.mock('../common/ValueBadge', () => ({ ValueBadge: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('../container/customs', () => ({ CustomsStatusBadge: () => null }));

import { AlertsSection, timeLeft } from './AlertsSection';

const a = translations.vi.dashboard.alerts;

describe('AlertsSection', () => {
  it('opens the first non-empty list and uses backend totals', () => {
    render(
      <AlertsSection
        onNavigateTab={vi.fn()}
        alerts={{
          critical_cutoffs: [],
          uncleared_containers: [{ id: 1, containerno: 'TCNU1234567' }],
          upcoming_vessels: [{ id: 2, vessel_name: 'SHIP A' }],
          totals: { critical_cutoffs: 0, uncleared_containers: 12, upcoming_vessels: 1 },
          window_days: 7,
        }}
      />,
    );
    expect(screen.getByRole('tab', { name: new RegExp(a.tabContainers) })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('TCNU1234567')).toBeInTheDocument();
    expect(screen.getByText('Hiển thị 1/12')).toBeInTheDocument();
    expect(screen.getByText('13 mục cần lưu ý')).toBeInTheDocument();
  });

  it('falls back to list lengths on older backends and drills down with a keyword', () => {
    const onNavigateTab = vi.fn();
    render(
      <AlertsSection
        onNavigateTab={onNavigateTab}
        alerts={{ critical_cutoffs: [{ id: 3, booking_no: 'SGN1', cutoff_time: '25/09/2026 10:00' }], uncleared_containers: [], upcoming_vessels: [] }}
      />,
    );
    fireEvent.click(screen.getByText('SGN1'));
    expect(onNavigateTab).toHaveBeenCalledWith('booking', 'SGN1');
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(a.tabVessels) }));
    expect(screen.getByText('Không có tàu nào cập bến trong 7 ngày tới.')).toBeInTheDocument();
  });

  it('computes time left from a VN wall-clock timestamp regardless of the machine timezone', () => {
    const now = Date.parse('2026-09-23T05:00:00Z'); // 12:00 in Vietnam
    expect(timeLeft('2026-09-23T18:00', now)?.hours).toBe(6);
    expect(timeLeft(undefined, now)).toBeNull();
  });
});
