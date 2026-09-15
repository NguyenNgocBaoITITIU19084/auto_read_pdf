import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const ctx = vi.hoisted(() => ({
  addToast: vi.fn(),
  getLogsApi: vi.fn(),
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, addToast: ctx.addToast }) }));
vi.mock('../../services/api', () => ({ getLogsApi: ctx.getLogsApi }));

import { LogViewerPanel } from './LogViewerPanel';
const l = translations.vi.logs;

const entries = [
  { time: '2026-09-15 10:00:00', level: 'ERROR', logger: 'app', request_id: 'req-1', message: 'Boom' },
  { time: '2026-09-15 10:01:00', level: 'INFO', logger: 'app', request_id: '-', message: 'line1\nline2' },
];

beforeEach(() => {
  ctx.addToast.mockReset();
  ctx.getLogsApi.mockReset();
  ctx.getLogsApi.mockResolvedValue({ entries, log_dir: '/var/log/app' });
});

describe('LogViewerPanel', () => {
  it('loads and renders log entries on mount', async () => {
    render(<LogViewerPanel />);
    await waitFor(() => expect(ctx.getLogsApi).toHaveBeenCalledWith({ source: 'errors', level: undefined, q: undefined, limit: 300 }));
    expect(await screen.findByText('Boom')).toBeInTheDocument();
    expect(screen.getByText(/\/var\/log\/app/)).toBeInTheDocument();
  });

  it('refetches with new filters when source/level/search change', async () => {
    render(<LogViewerPanel />);
    await waitFor(() => expect(ctx.getLogsApi).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByDisplayValue(l.sourceErrors), { target: { value: 'app' } });
    await waitFor(() => expect(ctx.getLogsApi).toHaveBeenLastCalledWith({ source: 'app', level: undefined, q: undefined, limit: 300 }));

    fireEvent.change(screen.getByDisplayValue(l.levelAll), { target: { value: 'WARNING' } });
    await waitFor(() => expect(ctx.getLogsApi).toHaveBeenLastCalledWith({ source: 'app', level: 'WARNING', q: undefined, limit: 300 }));
  });

  it('shows an empty state when there are no entries', async () => {
    ctx.getLogsApi.mockResolvedValue({ entries: [], log_dir: '' });
    render(<LogViewerPanel />);
    expect(await screen.findByText(l.empty)).toBeInTheDocument();
  });

  it('surfaces an error toast when loading fails', async () => {
    ctx.getLogsApi.mockRejectedValue(new Error('network down'));
    render(<LogViewerPanel />);
    await waitFor(() => expect(ctx.addToast).toHaveBeenCalled());
  });

  it('expands a multiline entry and copies a line to the clipboard', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<LogViewerPanel />);
    await screen.findByText('Boom');

    const row = screen.getByText('line1').closest('.group') as HTMLElement;
    const buttons = within(row).getAllByRole('button');
    fireEvent.click(buttons[0]); // chevron toggle
    expect(await within(row).findByText(/line2/)).toBeInTheDocument();

    fireEvent.click(buttons[buttons.length - 1]); // copy
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(ctx.addToast).toHaveBeenCalledWith(l.copied, 'success');
  });
});
