import React, { useState } from 'react';
import { Header } from './components/common/Header';
import { Tabs, TabId } from './components/common/Tabs';
import { BookingTab } from './components/booking/BookingTab';
import { VesselTab } from './components/vessel/VesselTab';
import { ContainerTab } from './components/container/ContainerTab';
import { ToastContainer } from './components/common/Toast';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('booking');

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-950 font-sans">
      <Header />
      <Tabs activeTab={activeTab} onChange={setActiveTab} />
      <main className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'booking' && <BookingTab />}
        {activeTab === 'vessel' && <VesselTab />}
        {activeTab === 'container' && <ContainerTab />}
      </main>
      <ToastContainer />
    </div>
  );
};

export default App;
