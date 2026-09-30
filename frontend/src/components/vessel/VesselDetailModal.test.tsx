import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, language: 'vi', addToast }) }));

import { VesselDetailModal } from './VesselDetailModal';

const schedule: any = {
  id: 7, site_id: 'CTL', agent: 'HDM', vessel_name: 'HMM HOPE', in_out_voyage: '062E-062E',
  closing_time: '11:00 23/09/2026', closing_time_icd: '', queried_at: '2026-09-30 10:00:00',
};

const f = translations.vi.common.fieldCopy;
const writeText = vi.fn().mockResolvedValue(undefined);

describe('VesselDetailModal – copy several fields', () => {
  beforeEach(() => {
    addToast.mockReset();
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it('copies only the ticked fields, with names', async () => {
    render(<VesselDetailModal isOpen onClose={() => undefined} schedule={schedule} />);
    const ticks = screen.getAllByRole('checkbox', { name: f.pick });
    fireEvent.click(ticks[2]); // vessel_name (site_id, agent, vessel_name)
    fireEvent.click(ticks[3]); // in_out_voyage
    expect(screen.getByText('Đã chọn 2 ô')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: f.copyLabeled }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text.split('\n')).toEqual([
      `${translations.vi.vessel.columns['vessel_name']}: HMM HOPE`,
      `${translations.vi.vessel.columns['in_out_voyage']}: 062E-062E`,
    ]);
  });

  it('copies values only and can select / clear all', async () => {
    render(<VesselDetailModal isOpen onClose={() => undefined} schedule={schedule} />);
    fireEvent.click(screen.getByRole('button', { name: f.selectAll }));
    // site_id, agent, vessel, voyage, queried? -> only fields with a value are selectable
    fireEvent.click(screen.getByRole('button', { name: f.copyValues }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0][0] as string).split('\n')).toEqual(['CTL', 'HDM', 'HMM HOPE', '062E-062E', '11:00 23/09/2026']);

    fireEvent.click(screen.getByRole('button', { name: f.clear }));
    expect(screen.queryByRole('button', { name: f.copyValues })).toBeNull();
  });

  it('has no tick box for empty fields', () => {
    render(<VesselDetailModal isOpen onClose={() => undefined} schedule={schedule} />);
    expect(screen.getAllByRole('checkbox', { name: f.pick })).toHaveLength(5);
  });
});
