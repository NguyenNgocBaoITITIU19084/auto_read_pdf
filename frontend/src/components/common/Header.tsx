import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  Moon, Sun, Database,
  RefreshCw, ShieldCheck, Palette,
  HelpCircle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TabId } from './Tabs';
import { Tooltip } from './Tooltip';
import { CollectionSwitcher } from './CollectionSwitcher';
import { describeAutoSyncSchedule, formatIntervalShort } from '../../services/autoSync';
import {
  hasCompletedOnboarding,
  subscribeTourActions
} from '../../services/tourEvents';

const BackupModal = lazy(() => import('./BackupModal').then((m) => ({ default: m.BackupModal })));
const CollectionManagerModal = lazy(() => import('./CollectionManagerModal').then((m) => ({ default: m.CollectionManagerModal })));
const ColorConfigModal = lazy(() => import('./ColorConfigModal').then((m) => ({ default: m.ColorConfigModal })));
const HelpTourModal = lazy(() => import('./HelpTourModal').then((m) => ({ default: m.HelpTourModal })));
const WelcomeModal = lazy(() => import('./WelcomeModal').then((m) => ({ default: m.WelcomeModal })));

interface HeaderProps {
  activeTab?: TabId;
  onNavigateTab?: (tabId: TabId, searchKeyword?: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab = 'dashboard', onNavigateTab }) => {
  const {
    t, language, setLanguage, isDark, setIsDark,
    autoSyncEnabled, syncInterval, toggleAutoSync, autoSyncStatus
  } = useApp();

  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isCollectionManagerOpen, setIsCollectionManagerOpen] = useState(false);
  const [isColorConfigOpen, setIsColorConfigOpen] = useState(false);

  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isWelcomeModalOpen, setIsWelcomeModalOpen] = useState(false);

  // First time onboarding check
  useEffect(() => {
    const isCompleted = hasCompletedOnboarding();
    if (!isCompleted) {
      // Delay slightly for smooth initial rendering
      const timer = setTimeout(() => {
        setIsWelcomeModalOpen(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Listen to interactive tour triggers (open/close color config)
  useEffect(() => {
    const unsubscribe = subscribeTourActions((action) => {
      if (action === 'openColorConfig') {
        setIsColorConfigOpen(true);
      } else if (action === 'closeColorConfig') {
        setIsColorConfigOpen(false);
      }
    });
    return unsubscribe;
  }, []);

  const syncTimes = autoSyncStatus?.mode === 'times' ? autoSyncStatus.times : null;
  const intervalLabel = syncTimes
    ? (syncTimes.length <= 2 ? syncTimes.join(', ') : `${syncTimes[0]} +${syncTimes.length - 1}`) || '--:--'
    : formatIntervalShort(syncInterval);
  const scheduleText = describeAutoSyncSchedule(
    autoSyncStatus ?? { mode: 'interval', interval_minutes: syncInterval, times: [] },
    t.autoSync
  );
  const autoSyncRunning = !!autoSyncStatus?.running;

  const handleStartFullTour = async () => {
    setIsHelpModalOpen(false);
    setIsWelcomeModalOpen(false);
    const { startFullAppTour } = await import('../../services/tourService');
    setTimeout(() => {
      startFullAppTour({
        t,
        onTabChange: (tab) => onNavigateTab && onNavigateTab(tab),
      });
    }, 150);
  };

  const handleStartTabTour = async () => {
    setIsHelpModalOpen(false);
    const { startTabTour } = await import('../../services/tourService');
    setTimeout(() => {
      startTabTour(activeTab, { t });
    }, 150);
  };

  const activeTabName = t.tabs[activeTab] || activeTab;

  return (
    <header className="h-13 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between shrink-0 shadow-sm gap-3 select-none z-30">
      {/* Left: Brand & Collection Selector */}
      <div className="flex items-center gap-4 shrink-0">
        {/* Brand */}
        <div data-tour="brand" className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary-600 to-sky-400 flex items-center justify-center text-white shadow-md shadow-primary-500/20 shrink-0">
            <ShieldCheck className="w-4.5 h-4.5" />
          </div>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-50 tracking-tight">
              Auto Read PDF
            </span>
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-primary-50 dark:bg-primary-950 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800/80">
              v2.0
            </span>
          </div>
        </div>

        {/* Collection Switcher */}
        <div className="pl-4 border-l border-slate-200 dark:border-slate-800 shrink-0">
          <CollectionSwitcher onManage={() => setIsCollectionManagerOpen(true)} />
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Auto Sync Toggle */}
        <div data-tour="auto-sync">
          <Tooltip content={autoSyncEnabled ? `Tự động đồng bộ đang BẬT (${scheduleText}). Nhấp để tắt hoặc vào Cài đặt / Watchlist để đổi lịch` : `Tự động đồng bộ đang TẮT (${scheduleText}). Nhấp để bật hoặc vào Cài đặt / Watchlist để đổi lịch`} position="bottom">
            <button
              onClick={() => toggleAutoSync()}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap shrink-0 ${
                autoSyncEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-xs shadow-emerald-500/10'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-750'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoSyncEnabled ? 'text-emerald-600' : ''} ${autoSyncRunning ? 'animate-spin' : ''}`} />
              <span>{t.common.autoSync}: {autoSyncEnabled ? `ON (${intervalLabel})` : 'OFF'}</span>
            </button>
          </Tooltip>
        </div>

        {/* Color Rules Configuration */}
        <div data-tour="color-rules">
          <Tooltip content={t.common.colorConfig} position="bottom">
            <button
              onClick={() => setIsColorConfigOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Palette className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
              <span>{t.common.colorConfig}</span>
            </button>
          </Tooltip>
        </div>

        {/* Backup & Restore Modal */}
        <div data-tour="settings">
          <Tooltip content="Cài đặt & Sao lưu/Khôi phục dữ liệu JSON" position="bottom">
            <button
              onClick={() => setIsBackupOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>{t.common.settings}</span>
            </button>
          </Tooltip>
        </div>

        {/* Help & Guided Tour Button */}
        <div data-tour="help-tour">
          <Tooltip content={t.tour.helpBtnTooltip} position="bottom">
            <button
              onClick={() => setIsHelpModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white shadow-sm shadow-primary-500/20 transition-all shrink-0 cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Hướng dẫn</span>
            </button>
          </Tooltip>
        </div>

        {/* Language Switcher */}
        <div data-tour="lang-toggle">
          <Tooltip content="Chuyển đổi ngôn ngữ Tiếng Việt / English" position="bottom">
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold shrink-0">
              <button
                onClick={() => setLanguage('vi')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  language === 'vi'
                    ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-300 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                VI
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  language === 'en'
                    ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-300 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                EN
              </button>
            </div>
          </Tooltip>
        </div>

        {/* Dark / Light Toggle */}
        <div data-tour="theme-toggle">
          <Tooltip content={isDark ? "Chuyển sang giao diện Sáng" : "Chuyển sang giao diện Tối"} position="bottom">
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Welcome Onboarding Modal for First Time Users */}
      {isWelcomeModalOpen && (
        <Suspense fallback={null}>
          <WelcomeModal
            isOpen={isWelcomeModalOpen}
            onClose={() => setIsWelcomeModalOpen(false)}
            t={t}
            onStartFullTour={handleStartFullTour}
          />
        </Suspense>
      )}

      {/* Backup & Restore Modal */}
      {isBackupOpen && (
        <Suspense fallback={null}>
          <BackupModal
            isOpen={isBackupOpen}
            onClose={() => setIsBackupOpen(false)}
            onNavigateToLogs={onNavigateTab ? () => {
              setIsBackupOpen(false);
              onNavigateTab('logs');
            } : undefined}
          />
        </Suspense>
      )}

      {/* Collection Manager Modal */}
      {isCollectionManagerOpen && (
        <Suspense fallback={null}>
          <CollectionManagerModal
            isOpen={isCollectionManagerOpen}
            onClose={() => setIsCollectionManagerOpen(false)}
          />
        </Suspense>
      )}

      {/* Color Config Modal */}
      {isColorConfigOpen && (
        <Suspense fallback={null}>
          <ColorConfigModal
            isOpen={isColorConfigOpen}
            onClose={() => setIsColorConfigOpen(false)}
          />
        </Suspense>
      )}

      {/* Interactive Help & Tour Center Modal */}
      {isHelpModalOpen && (
        <Suspense fallback={null}>
          <HelpTourModal
            isOpen={isHelpModalOpen}
            onClose={() => setIsHelpModalOpen(false)}
            activeTab={activeTab}
            activeTabName={activeTabName}
            t={t}
            onStartFullTour={handleStartFullTour}
            onStartTabTour={handleStartTabTour}
          />
        </Suspense>
      )}
    </header>
  );
};
