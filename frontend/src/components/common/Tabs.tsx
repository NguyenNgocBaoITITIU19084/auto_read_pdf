import React from 'react';
import { LayoutDashboard, FileText, Ship, Box } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export type TabId = 'dashboard' | 'booking' | 'vessel' | 'container';

interface TabsProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
  onHoverTab?: (tab: TabId) => void;
}

export const Tabs: React.FC<TabsProps> = ({ activeTab, onChange, onHoverTab }) => {
  const { t } = useApp();

  const tabItems: { id: TabId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'dashboard',
      label: t.tabs.dashboard,
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'booking',
      label: t.tabs.booking,
      icon: <FileText className="w-4 h-4" />,
    },
    {
      id: 'vessel',
      label: t.tabs.vessel,
      icon: <Ship className="w-4 h-4" />,
    },
    {
      id: 'container',
      label: t.tabs.container,
      icon: <Box className="w-4 h-4" />,
    },
  ];

  return (
    <div data-tour="nav-tabs" className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center gap-1 shrink-0">
      {tabItems.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            data-tour={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            onMouseEnter={() => onHoverTab?.(tab.id)}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              isActive
                ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400 bg-primary-50/50 dark:bg-primary-950/30'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};
