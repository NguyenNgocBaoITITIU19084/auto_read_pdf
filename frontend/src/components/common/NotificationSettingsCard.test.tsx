import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, addToast }) }));

const ALL = ['container_customs', 'container_ingate', 'container_outgate', 'vessel_closing', 'vessel_closing_icd', 'vessel_open_gate', 'vessel_eta', 'vessel_etd'];
const refresh = vi.fn();
vi.mock('../../context/NotificationsContext', () => ({ useNotifications: () => ({ refresh }) }));
const sendTest = vi.fn();
const getSettings = vi.fn();
const saveSettings = vi.fn();
vi.mock('../../services/api', () => ({
  getNotificationSettingsApi: () => getSettings(),
  saveNotificationSettingsApi: (...a: unknown[]) => saveSettings(...a),
  sendTestNotificationApi: () => sendTest(),
}));

import { NotificationSettingsCard } from './NotificationSettingsCard';

const k = translations.vi.notifications.kinds;

beforeEach(() => {
  delete (window as any).electronAPI;
  addToast.mockReset();
  refresh.mockReset().mockResolvedValue(undefined);
  sendTest.mockReset().mockResolvedValue({ id: 1 });
  getSettings.mockReset().mockResolvedValue({ kinds: ALL, os_enabled: true, all_kinds: ALL });
  saveSettings.mockReset().mockImplementation(async (kinds: string[], os: boolean) => ({ kinds, os_enabled: os, all_kinds: ALL }));
});

describe('NotificationSettingsCard', () => {
  it('shows every kind, ticked as saved', async () => {
    render(<NotificationSettingsCard />);
    const box = await screen.findByLabelText(k.container_outgate);
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getAllByRole('checkbox')).toHaveLength(9);          // 8 kinds + the OS popup switch
  });

  it('saves the new selection as soon as a kind is toggled', async () => {
    render(<NotificationSettingsCard />);
    const eta = await screen.findByLabelText(k.vessel_eta);
    await waitFor(() => expect(eta).toBeChecked());
    fireEvent.click(eta);
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(ALL.filter((x) => x !== 'vessel_eta'), true));
    await waitFor(() => expect(screen.getByLabelText(k.vessel_eta)).not.toBeChecked());
  });

  it('the OS popup switch needs the desktop app', async () => {
    const { unmount } = render(<NotificationSettingsCard />);
    const os = await screen.findByLabelText(new RegExp(translations.vi.notifications.settings.os.slice(0, 12)));
    expect(os).toBeDisabled();
    expect(screen.getByText(translations.vi.notifications.settings.osBrowser)).toBeInTheDocument();
    unmount();

    (window as any).electronAPI = { platform: 'win32' };
    render(<NotificationSettingsCard />);
    const desktopOs = await screen.findByLabelText(new RegExp(translations.vi.notifications.settings.os.slice(0, 12)));
    await waitFor(() => expect(desktopOs).toBeEnabled());
    fireEvent.click(desktopOs);
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(ALL, false));
  });

  it('tells the user when saving fails', async () => {
    saveSettings.mockRejectedValueOnce(new Error('boom'));
    render(<NotificationSettingsCard />);
    const box = await screen.findByLabelText(k.container_customs);
    await waitFor(() => expect(box).toBeChecked());
    fireEvent.click(box);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(translations.vi.notifications.settings.saveFailed, 'error'));
  });

  it('the test button creates a sample, refreshes the bell and asks the desktop app to pop it up now', async () => {
    const pollNow = vi.fn().mockResolvedValue(undefined);
    (window as any).electronAPI = { platform: 'win32', pollNotificationsNow: pollNow };
    render(<NotificationSettingsCard />);
    fireEvent.click(await screen.findByRole('button', { name: translations.vi.notifications.settings.test }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(translations.vi.notifications.settings.testDone, 'success'));
    expect(sendTest).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
    expect(pollNow).toHaveBeenCalledTimes(1);
  });

  it('the test button also works in a plain browser, and reports a failure', async () => {
    render(<NotificationSettingsCard />);
    fireEvent.click(await screen.findByRole('button', { name: translations.vi.notifications.settings.test }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(translations.vi.notifications.settings.testDone, 'success'));

    sendTest.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: translations.vi.notifications.settings.test }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(translations.vi.notifications.settings.testFailed, 'error'));
  });
});
