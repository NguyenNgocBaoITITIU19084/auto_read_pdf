import React, { useState, useEffect, lazy, Suspense } from 'react';
import { RefreshCw, ShieldCheck, Settings, HelpCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TabId } from './Tabs';
import { Tooltip } from './Tooltip';
import { CollectionSwitcher } from './CollectionSwitcher';
import { UpdateButton } from './UpdateButton';
import { NotificationBell } from './NotificationBell';
import { describeAutoSyncSchedule, formatIntervalShort } from '../../services/autoSync';
import { hasCompletedOnboarding, hasTabTour } from '../../services/tourEvents';

const SettingsCenter = lazy(() => import('./SettingsCenter').then((m) => ({ default: m.SettingsCenter })));
const CollectionManagerModal = lazy(() => import('./CollectionManagerModal').then((m) => ({ default: m.CollectionManagerModal })));
const HelpTourModal = lazy(() => import('./HelpTourModal').then((m) => ({ default: m.HelpTourModal })));
const WelcomeModal = lazy(() => import('./WelcomeModal').then((m) => ({ default: m.WelcomeModal })));

interface HeaderProps {
  activeTab?: TabId;
  onNavigateTab?: (tabId: TabId, searchKeyword?: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab = 'dashboard', onNavigateTab }) => {
  const {
    t,
    autoSyncEnabled, syncInterval, toggleAutoSync, autoSyncStatus
  } = useApp();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCollectionManagerOpen, setIsCollectionManagerOpen] = useState(false);

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
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary-600 to-sky-400 flex items-center justify-center text-white shadow-md shadow-primary-500/20 shrink-0">
            <ShieldCheck className="w-4.5 h-4.5" />
          </div>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-50 tracking-tight">
              Auto Read PDF
            </span>
            <UpdateButton />
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
        <div>
          <Tooltip content={autoSyncEnabled ? `Tự động đồng bộ đang BẬT (${scheduleText}). Nhấp để tắt hoặc vào Cấu hình › Đồng bộ ePort để đổi lịch` : `Tự động đồng bộ đang TẮT (${scheduleText}). Nhấp để bật hoặc vào Cấu hình › Đồng bộ ePort để đổi lịch`} position="bottom">
            <button
              onClick={() => toggleAutoSync()}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap shrink-0 ${
                autoSyncEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-xs shadow-emerald-500/10'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-750'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoSyncEnabled ? 'text-emerald-600' : ''} ${autoSyncRunning ? 'animate-spin' : ''}`} />
              <span><span className="hidden xl:inline">{t.common.autoSync}: </span>{autoSyncEnabled ? `ON (${intervalLabel})` : 'OFF'}</span>
            </button>
          </Tooltip>
        </div>

        {/* Settings center: every setting of the app (appearance, sync, PDF auto-import, notifications, colors, AI, backup) */}
        <div data-tour="settings">
          <Tooltip content={t.settingsCenter.open} position="bottom">
            <button
              onClick={() => setIsSettingsOpen(true)}
              aria-label={t.settingsCenter.title}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
              <span className="hidden xl:inline">{t.settingsCenter.title}</span>
            </button>
          </Tooltip>
        </div>

        {/* Help & Guided Tour Button */}
        <div data-tour="help-tour">
          <Tooltip content={t.tour.helpBtnTooltip} position="bottom">
            <button
              onClick={() => setIsHelpModalOpen(true)}
              aria-label="Hướng dẫn"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white shadow-sm shadow-primary-500/20 transition-all shrink-0 cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Hướng dẫn</span>
            </button>
          </Tooltip>
        </div>

        {/* Change notifications */}
        <NotificationBell />
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

      {/* Settings center */}
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsCenter
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onNavigateToLogs={onNavigateTab ? () => {
              setIsSettingsOpen(false);
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
            onStartTabTour={hasTabTour(activeTab) ? handleStartTabTour : undefined}
          />
        </Suspense>
      )}
    </header>
  );
};
