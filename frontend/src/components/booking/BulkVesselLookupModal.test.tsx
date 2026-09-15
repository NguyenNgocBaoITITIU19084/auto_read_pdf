import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ t: translations.vi, language: 'vi' }),
}));

import { BulkVesselLookupModal } from './BulkVesselLookupModal';

const bv = translations.vi.booking.bulkVesselLookup;

beforeEach(() => {
  localStorage.clear();
});

describe('BulkVesselLookupModal', () => {
  it('defaults to automatic mode and calls onStart with "auto"', () => {
    const onStart = vi.fn();
    const onClose = vi.fn();
    render(
      <BulkVesselLookupModal isOpen selectedCount={3} onClose={onClose} onStart={onStart} />
    );
    expect(screen.getByText(bv.title)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: new RegExp(bv.modeAuto) })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: bv.start }));
    expect(onStart).toHaveBeenCalledWith('auto');
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to single-site mode and reports the chosen site', () => {
    const onStart = vi.fn();
    render(
      <BulkVesselLookupModal isOpen selectedCount={5} onClose={() => {}} onStart={onStart} />
    );
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(bv.modeSite) }));
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'GNL' } });
    fireEvent.click(screen.getByRole('button', { name: bv.start }));
    expect(onStart).toHaveBeenCalledWith({ site: 'GNL' });
  });

  it('resets to automatic mode and last saved site each time it opens', () => {
    localStorage.setItem('last_vessel_site_id', 'THP');
    const onStart = vi.fn();
    const { rerender } = render(
      <BulkVesselLookupModal isOpen={false} selectedCount={2} onClose={() => {}} onStart={onStart} />
    );
    rerender(<BulkVesselLookupModal isOpen selectedCount={2} onClose={() => {}} onStart={onStart} />);
    expect(screen.getByRole('radio', { name: new RegExp(bv.modeAuto) })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(bv.modeSite) }));
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('THP');
  });
});
