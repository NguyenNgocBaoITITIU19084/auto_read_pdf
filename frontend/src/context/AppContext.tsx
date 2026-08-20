import React, { createContext, useContext, useState, useEffect } from 'react';
import { Collection } from '../types';
import { Language, translations } from '../i18n/translations';
import { 
  getCollections, createCollection, deleteCollection,
  getAutoSyncStatus, toggleAutoSyncApi 
} from '../services/api';

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

interface AppContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: typeof translations.vi;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
  collections: Collection[];
  activeCollection: Collection | null;
  setActiveCollection: (col: Collection | null) => void;
  refreshCollections: () => Promise<void>;
  handleCreateCollection: (name: string) => Promise<void>;
  handleDeleteCollection: (id: number) => Promise<void>;
  toasts: ToastMessage[];
  addToast: (text: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;
  // Shared Auto Sync State
  autoSyncEnabled: boolean;
  syncInterval: number;
  toggleAutoSync: (enable?: boolean, interval?: number) => Promise<void>;
  updateSyncInterval: (newInterval: number) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem('app_lang') as Language) || 'vi';
  });

  const [isDark, setIsDarkState] = useState<boolean>(() => {
    const saved = localStorage.getItem('app_theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = useState<Collection | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Auto Sync state shared across all components (Header, Watchlist Modals, Settings)
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(false);
  const [syncInterval, setSyncInterval] = useState<number>(() => {
    const saved = localStorage.getItem('auto_sync_interval');
    return saved && !isNaN(Number(saved)) ? Number(saved) : 10;
  });

  const t = translations[language];

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('app_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('app_theme', 'light');
    }
  }, [isDark]);

  // Fetch initial auto sync status on startup
  useEffect(() => {
    getAutoSyncStatus()
      .then((res) => {
        setAutoSyncEnabled(res.enabled);
        if (res.interval_minutes) {
          setSyncInterval(res.interval_minutes);
          localStorage.setItem('auto_sync_interval', String(res.interval_minutes));
        }
      })
      .catch(console.error);
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app_lang', lang);
  };

  const setIsDark = (dark: boolean) => {
    setIsDarkState(dark);
  };

  const addToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const refreshCollections = async () => {
    try {
      const cols = await getCollections();
      setCollections(cols);
      if (cols.length > 0) {
        if (!activeCollection || !cols.some((c) => c.id === activeCollection.id)) {
          setActiveCollection(cols[0]);
        }
      } else {
        setActiveCollection(null);
      }
    } catch (e: any) {
      console.error('Failed to load collections:', e);
    }
  };

  const handleCreateCollection = async (name: string) => {
    try {
      await createCollection(name);
      addToast(t.common.success, 'success');
      await refreshCollections();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleDeleteCollection = async (id: number) => {
    try {
      await deleteCollection(id);
      addToast(t.common.success, 'success');
      await refreshCollections();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  // Toggle Auto Sync handler
  const toggleAutoSync = async (enable?: boolean, interval?: number) => {
    try {
      const nextEnable = enable !== undefined ? enable : !autoSyncEnabled;
      const targetInterval = interval !== undefined ? interval : syncInterval;
      
      const res = await toggleAutoSyncApi(nextEnable, targetInterval);
      setAutoSyncEnabled(res.enabled);
      setSyncInterval(targetInterval);
      localStorage.setItem('auto_sync_interval', String(targetInterval));

      addToast(
        nextEnable
          ? `Đã BẬT tự động đồng bộ (Đang chạy đồng bộ ngay và lặp lại mỗi ${targetInterval} phút)`
          : `Đã TẮT tự động đồng bộ`,
        nextEnable ? 'success' : 'info'
      );
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  // Update interval handler
  const updateSyncInterval = async (newInterval: number) => {
    if (isNaN(newInterval) || newInterval < 1) {
      addToast('Vui lòng nhập số phút hợp lệ (tối thiểu 1 phút)', 'info');
      return;
    }

    setSyncInterval(newInterval);
    localStorage.setItem('auto_sync_interval', String(newInterval));

    if (autoSyncEnabled) {
      try {
        await toggleAutoSyncApi(true, newInterval);
        addToast(`Đã đổi chu kỳ tự động đồng bộ: mỗi ${newInterval} phút!`, 'success');
      } catch (e: any) {
        addToast(e.message || 'Lỗi cập nhật chu kỳ', 'error');
      }
    } else {
      addToast(`Đã lưu chu kỳ: ${newInterval} phút (sẽ áp dụng khi bật Auto Sync)`, 'info');
    }
  };

  useEffect(() => {
    refreshCollections();
  }, []);

  return (
    <AppContext.Provider
      value={{
        language,
        setLanguage,
        t,
        isDark,
        setIsDark,
        collections,
        activeCollection,
        setActiveCollection,
        refreshCollections,
        handleCreateCollection,
        handleDeleteCollection,
        toasts,
        addToast,
        removeToast,
        autoSyncEnabled,
        syncInterval,
        toggleAutoSync,
        updateSyncInterval,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
