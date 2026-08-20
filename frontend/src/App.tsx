import React, { useState } from 'react';
import { Header } from './components/common/Header';
import { Tabs, TabId } from './components/common/Tabs';
import { DashboardTab } from './components/dashboard/DashboardTab';
import { BookingTab } from './components/booking/BookingTab';
import { VesselTab } from './components/vessel/VesselTab';
import { ContainerTab } from './components/container/ContainerTab';
import { ToastContainer } from './components/common/Toast';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [drilldownKeywords, setDrilldownKeywords] = useState<{
    booking?: string;
    vessel?: string;
    container?: string;
  }>({});

  const handleNavigateTab = (tabId: TabId, searchKeyword?: string) => {
    if (searchKeyword && tabId !== 'dashboard') {
      setDrilldownKeywords((prev) => ({
        ...prev,
        [tabId]: searchKeyword,
      }));
    }
    setActiveTab(tabId);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-950 font-sans">
      <Header activeTab={activeTab} onNavigateTab={handleNavigateTab} />
      <Tabs activeTab={activeTab} onChange={setActiveTab} />
      <main className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'dashboard' && (
          <DashboardTab onNavigateTab={handleNavigateTab} />
        )}
        {activeTab === 'booking' && (
          <BookingTab initialSearchQuery={drilldownKeywords.booking} />
        )}
        {activeTab === 'vessel' && (
          <VesselTab initialSearchQuery={drilldownKeywords.vessel} />
        )}
        {activeTab === 'container' && (
          <ContainerTab initialSearchQuery={drilldownKeywords.container} />
        )}
      </main>
      <ToastContainer />
    </div>
  );
};

export default App;

