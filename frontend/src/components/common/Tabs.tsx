import React, { useEffect, useRef } from 'react';
import { LayoutDashboard, FileText, Ship, Box, ScrollText, CalendarClock, Container, Package, Truck, Users, MessageCircle, Mail, Inbox } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export type TabId = 'dashboard' | 'booking' | 'vessel' | 'container' | 'tasks' | 'fleet' | 'trucks' | 'drivers' | 'trailers' | 'zalo' | 'gmail' | 'outlook' | 'logs';

interface TabsProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
  onHoverTab?: (tab: TabId) => void;
  zaloUnreadCount?: number;
  gmailUnreadCount?: number;
  outlookUnreadCount?: number;
}

export const Tabs: React.FC<TabsProps> = ({ activeTab, onChange, onHoverTab, zaloUnreadCount = 0, gmailUnreadCount = 0, outlookUnreadCount = 0 }) => {
  const { t } = useApp();

  const titles: Partial<Record<TabId, string>> = t.tabTitles ?? {};
  // In a narrow window keep the open tab in view (it can be opened from elsewhere, e.g. a dashboard alert)
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);
  // Grouped like the work: shipping, fleet, messages, then the app's own log
  const groups: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[][] = [
    [
      { id: 'dashboard', label: t.tabs.dashboard, icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: 'booking', label: t.tabs.booking, icon: <FileText className="w-4 h-4" /> },
      { id: 'vessel', label: t.tabs.vessel, icon: <Ship className="w-4 h-4" /> },
      { id: 'container', label: t.tabs.container, icon: <Box className="w-4 h-4" /> },
      { id: 'tasks', label: t.tabs.tasks, icon: <CalendarClock className="w-4 h-4" /> },
    ],
    [
      { id: 'fleet', label: t.tabs.fleet, icon: <Truck className="w-4 h-4" /> },
      { id: 'trucks', label: t.tabs.trucks, icon: <Package className="w-4 h-4" /> },
      { id: 'drivers', label: t.tabs.drivers, icon: <Users className="w-4 h-4" /> },
      { id: 'trailers', label: t.tabs.trailers, icon: <Container className="w-4 h-4" /> },
    ],
    [
      { id: 'zalo', label: t.tabs.zalo, icon: <MessageCircle className="w-4 h-4" />, badge: zaloUnreadCount > 0 ? zaloUnreadCount : undefined },
      { id: 'gmail', label: t.tabs.gmail, icon: <Mail className="w-4 h-4" />, badge: gmailUnreadCount > 0 ? gmailUnreadCount : undefined },
      { id: 'outlook', label: t.tabs.outlook, icon: <Inbox className="w-4 h-4" />, badge: outlookUnreadCount > 0 ? outlookUnreadCount : undefined },
    ],
    [{ id: 'logs', label: t.tabs.logs, icon: <ScrollText className="w-4 h-4" /> }],
  ];

  return (
    // One line whatever the width: labels never wrap, the bar scrolls sideways when the window is narrow
    <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 flex items-stretch shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-stretch shrink-0">
          {gi > 0 && <span aria-hidden className="w-px my-2.5 mx-1.5 bg-slate-200 dark:bg-slate-700" />}
          {group.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={isActive ? activeRef : undefined}
                type="button"
                data-tour={`tab-${tab.id}`}
                aria-current={isActive ? 'page' : undefined}
                title={titles[tab.id]}
                onClick={() => onChange(tab.id)}
                onMouseEnter={() => onHoverTab?.(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  isActive
                    ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400 bg-primary-50/50 dark:bg-primary-950/30'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className="min-w-[18px] px-1.5 rounded-full text-[10px] font-bold bg-rose-500 text-white leading-[18px] text-center tabular-nums">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
};
