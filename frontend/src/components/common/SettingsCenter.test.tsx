import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsCenter } from './SettingsCenter';
import { translations } from '../../i18n/translations';

const setLanguage = vi.fn();
const setIsDark = vi.fn();
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ t: translations.vi, language: 'vi', setLanguage, isDark: false, setIsDark }),
}));
// The cards are tested on their own: only which one shows matters here
vi.mock('./AutoSyncSettingsCard', () => ({ AutoSyncSettingsCard: () => <div>auto-sync-card</div> }));
vi.mock('./AutoImportSettingsCard', () => ({ AutoImportSettingsCard: () => <div>auto-import-card</div> }));
vi.mock('./AISettingsCard', () => ({ AISettingsCard: () => <div>ai-card</div> }));
vi.mock('./UpdateSettingsCard', () => ({ UpdateSettingsCard: () => <div>update-card</div> }));
vi.mock('./NotificationSettingsCard', () => ({ NotificationSettingsCard: () => <div>notification-card</div> }));
vi.mock('./ColorConfigPanel', () => ({ ColorConfigPanel: () => <div>color-panel</div> }));
vi.mock('./DataBackupPanel', () => ({ DataBackupPanel: () => <div>data-panel</div> }));

const s = translations.vi.settingsCenter;

describe('SettingsCenter', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('opens on the general section with appearance and updates', () => {
    render(<SettingsCenter isOpen onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: s.sections.general.label })).toBeInTheDocument();
    expect(screen.getByText('update-card')).toBeInTheDocument();
    expect(screen.queryByText('auto-sync-card')).not.toBeInTheDocument();
  });

  it('shows one section at a time and reopens on the last one', () => {
    const { unmount } = render(<SettingsCenter isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: s.sections.autoImport.label }));
    expect(screen.getByText('auto-import-card')).toBeInTheDocument();
    expect(screen.queryByText('auto-sync-card')).not.toBeInTheDocument();
    expect(screen.queryByText('update-card')).not.toBeInTheDocument();
    unmount();

    render(<SettingsCenter isOpen onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: s.sections.autoImport.label })).toBeInTheDocument();
  });

  it('opens on the section asked for', () => {
    render(<SettingsCenter isOpen onClose={() => {}} initialSection="colors" />);
    expect(screen.getByText('color-panel')).toBeInTheDocument();
  });

  it('changes language and theme from the general section', () => {
    render(<SettingsCenter isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    fireEvent.click(screen.getByRole('radio', { name: s.themeDark }));
    expect(setLanguage).toHaveBeenCalledWith('en');
    expect(setIsDark).toHaveBeenCalledWith(true);
  });
});
