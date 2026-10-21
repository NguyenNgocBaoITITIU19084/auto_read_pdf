import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { UpdateStatus } from '../../types';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, addToast }) }));
vi.mock('../../services/api', () => ({ getBackendVersionApi: vi.fn().mockResolvedValue('2.2.0') }));

import { UpdateButton } from './UpdateButton';

const u = translations.vi.appUpdate;
let push: (s: UpdateStatus) => void = () => undefined;
const checkForUpdates = vi.fn();
const installUpdate = vi.fn().mockResolvedValue(true);
const openExternal = vi.fn().mockResolvedValue(undefined);

const setupElectron = (initial: UpdateStatus) => {
  (window as any).electronAPI = {
    platform: 'win32',
    onUpdateStatus: (cb: (s: UpdateStatus) => void) => { push = cb; return () => undefined; },
    getUpdateStatus: vi.fn().mockResolvedValue(initial),
    checkForUpdates,
    installUpdate,
    openExternal,
  };
};

describe('UpdateButton', () => {
  beforeEach(() => {
    delete (window as any).electronAPI;
    addToast.mockReset();
    checkForUpdates.mockReset().mockResolvedValue({ state: 'checking' });
    installUpdate.mockClear();
    openExternal.mockClear();
  });

  it('shows the real app version (not a hard-coded one) and checks on click', async () => {
    setupElectron({ state: 'idle', currentVersion: '2.2.0' });
    render(<UpdateButton />);
    const btn = await screen.findByRole('button', { name: /v2\.2\.0/ });
    fireEvent.click(btn);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);

    act(() => push({ state: 'up-to-date', currentVersion: '2.2.0' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.stringContaining('2.2.0'), 'success'));
  });

  it('reports a failed check', async () => {
    setupElectron({ state: 'idle', currentVersion: '2.2.0' });
    render(<UpdateButton />);
    fireEvent.click(await screen.findByRole('button', { name: /v2\.2\.0/ }));
    act(() => push({ state: 'error', error: 'net::ERR', currentVersion: '2.2.0' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.stringContaining('net::ERR'), 'error'));
  });

  it('shows download progress', async () => {
    setupElectron({ state: 'downloading', version: '2.3.0', percent: 42, currentVersion: '2.2.0' });
    render(<UpdateButton />);
    expect(await screen.findByText('Đang tải 42%')).toBeInTheDocument();
  });

  it('announces a downloaded update in a dialog with its notes, and installs from it', async () => {
    setupElectron({ state: 'downloaded', version: '2.3.0', currentVersion: '2.2.0', releaseNotes: 'Đọc booking Topaz' });
    render(<UpdateButton />);
    expect(await screen.findByRole('dialog')).toHaveTextContent(u.dialogTitle);
    expect(screen.getByRole('dialog')).toHaveTextContent('v2.2.0 → v2.3.0');
    expect(screen.getByText('Đọc booking Topaz')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(u.installNow) }));
    await waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(1));
  });

  it('"Để sau" closes the dialog without installing; the green chip opens it again', async () => {
    setupElectron({ state: 'downloaded', version: '2.3.0', currentVersion: '2.2.0' });
    render(<UpdateButton />);
    fireEvent.click(await screen.findByRole('button', { name: u.later }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(installUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Cập nhật 2\.3\.0/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(u.dialogNoNotes)).toBeInTheDocument();             // no notes: a generic line
  });

  it('on macOS announces a newer GitHub release and opens its download page', async () => {
    setupElectron({ state: 'unsupported', currentVersion: '2.2.0', latestVersion: '2.3.0', releaseNotes: 'Mới', releasesUrl: 'https://example.com/v2.3.0' });
    render(<UpdateButton />);
    expect(await screen.findByRole('dialog')).toHaveTextContent('v2.2.0 → v2.3.0');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(u.downloadNew) }));
    expect(openExternal).toHaveBeenCalledWith('https://example.com/v2.3.0');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Có bản 2\.3\.0/ })).toBeInTheDocument();
  });

  it('falls back to the releases page where auto-update is unsupported', async () => {
    setupElectron({ state: 'unsupported', currentVersion: '2.2.0', releasesUrl: 'https://example.com/r' });
    render(<UpdateButton />);
    fireEvent.click(await screen.findByRole('button', { name: /v2\.2\.0/ }));
    expect(openExternal).toHaveBeenCalledWith('https://example.com/r');
    expect(checkForUpdates).not.toHaveBeenCalled();
  });

  it('gets the version from the backend in a plain browser and opens the download page', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<UpdateButton />);
    const btn = await screen.findByRole('button', { name: /v2\.2\.0/ });
    fireEvent.click(btn);
    expect(open).toHaveBeenCalledWith(expect.stringContaining('/releases/latest'), '_blank', 'noopener');
    open.mockRestore();
  });
});
