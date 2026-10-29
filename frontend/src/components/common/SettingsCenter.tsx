import React, { useState } from 'react';
import { Bell, Database, FolderInput, MonitorCog, Moon, Palette, RefreshCw, ScanText, Sun } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { AutoSyncSettingsCard } from './AutoSyncSettingsCard';
import { AutoImportSettingsCard } from './AutoImportSettingsCard';
import { AISettingsCard } from './AISettingsCard';
import { UpdateSettingsCard } from './UpdateSettingsCard';
import { NotificationSettingsCard } from './NotificationSettingsCard';
import { ColorConfigPanel } from './ColorConfigPanel';
import { DataBackupPanel } from './DataBackupPanel';

export type SettingsSection = 'general' | 'sync' | 'autoImport' | 'notifications' | 'colors' | 'reading' | 'data';

const SECTIONS: { id: SettingsSection; icon: React.ReactNode }[] = [
  { id: 'general', icon: <MonitorCog className="w-4 h-4" /> },
  { id: 'sync', icon: <RefreshCw className="w-4 h-4" /> },
  { id: 'autoImport', icon: <FolderInput className="w-4 h-4" /> },
  { id: 'notifications', icon: <Bell className="w-4 h-4" /> },
  { id: 'colors', icon: <Palette className="w-4 h-4" /> },
  { id: 'reading', icon: <ScanText className="w-4 h-4" /> },
  { id: 'data', icon: <Database className="w-4 h-4" /> },
];

// The section last looked at opens again next time (only a convenience: storage may be unavailable)
const LAST_SECTION_KEY = 'settings-center-section';

const readLastSection = (): SettingsSection => {
  try {
    const saved = localStorage.getItem(LAST_SECTION_KEY);
    if (SECTIONS.some((s) => s.id === saved)) return saved as SettingsSection;
  } catch {
    /* storage blocked */
  }
  return 'general';
};

interface SettingsCenterProps {
  isOpen: boolean;
  onClose: () => void;
  /** Opens on this section instead of the last one looked at */
  initialSection?: SettingsSection;
  /** Navigate to the standalone Logs tab (closes the Settings center too) */
  onNavigateToLogs?: () => void;
}

/** Language + light/dark mode: the choices that used to sit in the header. */
const AppearanceCard: React.FC = () => {
  const { t, language, setLanguage, isDark, setIsDark } = useApp();
  const c = t.settingsCenter;

  const segment = <T,>(value: T, options: { value: T; label: React.ReactNode }[], onChange: (v: T) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="flex items-center bg-white dark:bg-slate-900 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold shrink-0">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all ${
            value === o.value
              ? 'bg-primary-50 dark:bg-slate-700 text-primary-700 dark:text-primary-300 shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  const row = (title: string, desc: string, control: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{title}</div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{desc}</p>
      </div>
      {control}
    </div>
  );

  return (
    <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 divide-y divide-slate-200/80 dark:divide-slate-700/80">
      {row(c.language, c.languageDesc, segment(language, [
        { value: 'vi', label: 'Tiếng Việt' },
        { value: 'en', label: 'English' },
      ], setLanguage, c.language))}
      {row(c.theme, c.themeDesc, segment(isDark, [
        { value: false, label: <><Sun className="w-3.5 h-3.5" />{c.themeLight}</> },
        { value: true, label: <><Moon className="w-3.5 h-3.5" />{c.themeDark}</> },
      ], setIsDark, c.theme))}
    </div>
  );
};

/** Every setting of the app in one place: a list of sections on the left, the chosen one on the right. */
export const SettingsCenter: React.FC<SettingsCenterProps> = ({ isOpen, onClose, initialSection, onNavigateToLogs }) => {
  const { t } = useApp();
  const c = t.settingsCenter;
  const [section, setSection] = useState<SettingsSection>(() => initialSection ?? readLastSection());

  const choose = (id: SettingsSection) => {
    setSection(id);
    try {
      localStorage.setItem(LAST_SECTION_KEY, id);
    } catch {
      /* storage blocked */
    }
  };

  const body: Record<SettingsSection, React.ReactNode> = {
    general: <><AppearanceCard /><UpdateSettingsCard /></>,
    sync: <AutoSyncSettingsCard />,
    autoImport: <AutoImportSettingsCard />,
    notifications: <NotificationSettingsCard />,
    colors: <ColorConfigPanel />,
    reading: <AISettingsCard />,
    data: <DataBackupPanel onRestored={onClose} onNavigateToLogs={onNavigateToLogs} />,
  };
  const current = c.sections[section];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={c.title} maxWidth="max-w-6xl">
      <div className="-mx-6 -my-5 flex flex-col md:flex-row md:h-[80vh]" data-testid="settings-center">
        <nav
          aria-label={c.title}
          className="shrink-0 md:w-56 flex md:flex-col gap-1 p-2 md:p-3 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40"
        >
          {SECTIONS.map(({ id, icon }) => {
            const active = id === section;
            return (
              <button
                key={id}
                type="button"
                onClick={() => choose(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-white dark:bg-slate-800 text-primary-700 dark:text-primary-300 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className={active ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400 dark:text-slate-500'}>{icon}</span>
                {c.sections[id].label}
              </button>
            );
          })}
        </nav>

        <section className="flex-1 min-w-0 overflow-y-auto px-4 md:px-6 py-4 md:py-5" aria-labelledby="settings-section-title">
          <div className="mb-4">
            <h4 id="settings-section-title" className="text-base font-bold text-slate-900 dark:text-slate-100">{current.label}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">{current.desc}</p>
          </div>
          <div className="space-y-4">{body[section]}</div>
        </section>
      </div>
    </Modal>
  );
};
