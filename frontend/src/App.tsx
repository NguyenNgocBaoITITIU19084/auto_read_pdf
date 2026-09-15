import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './components/common/Header';
import { Tabs, TabId } from './components/common/Tabs';
import { DashboardTab } from './components/dashboard/DashboardTab';
import { BookingTab, BookingPasteRequest } from './components/booking/BookingTab';
import { VesselTab } from './components/vessel/VesselTab';
import { ContainerTab } from './components/container/ContainerTab';
import { ToastContainer } from './components/common/Toast';
import { extractClipboardFiles, isEditableTarget, isImageFile, isPdfFile } from './components/booking/clipboard';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [drilldownKeywords, setDrilldownKeywords] = useState<{
    booking?: string;
    vessel?: string;
    container?: string;
  }>({});
  const [pasteRequest, setPasteRequest] = useState<BookingPasteRequest | null>(null);
  const pasteSeqRef = useRef(0);

  const handleNavigateTab = useCallback((tabId: TabId, searchKeyword?: string) => {
    if (searchKeyword && tabId !== 'dashboard') {
      setDrilldownKeywords((prev) => ({
        ...prev,
        [tabId]: searchKeyword,
      }));
    }
    setActiveTab(tabId);
  }, []);

  const handlePasteRequestHandled = useCallback((id: number) => {
    setPasteRequest((prev) => (prev && prev.id === id ? null : prev));
  }, []);

  // Single global paste handler: images / PDFs pasted on ANY tab go to the Booking tab.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const data = e.clipboardData;
      const files = extractClipboardFiles(data);
      if (files.length === 0) return; // plain text: let inputs handle it normally

      const images = files.filter((f) => isImageFile(f) && !isPdfFile(f));
      const pdfs = files.filter(isPdfFile);
      if (images.length === 0 && pdfs.length === 0) return;

      // Pasting into a text field: when the clipboard also carries text (e.g. cells copied from
      // Excel/Word include a bitmap rendition) keep the normal text paste — unless PDFs are present.
      if (pdfs.length === 0 && isEditableTarget(e.target)) {
        const text = data?.getData('text/plain') || '';
        if (text.trim() !== '') return;
      }

      e.preventDefault();
      pasteSeqRef.current += 1;
      setPasteRequest({ id: pasteSeqRef.current, images, pdfs });
      setActiveTab('booking');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-950 font-sans">
      <Header activeTab={activeTab} onNavigateTab={handleNavigateTab} />
      <Tabs activeTab={activeTab} onChange={setActiveTab} />
      <main className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'dashboard' && (
          <DashboardTab onNavigateTab={handleNavigateTab} />
        )}
        {activeTab === 'booking' && (
          <BookingTab
            initialSearchQuery={drilldownKeywords.booking}
            onNavigateTab={handleNavigateTab}
            pasteRequest={pasteRequest}
            onPasteRequestHandled={handlePasteRequestHandled}
          />
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
