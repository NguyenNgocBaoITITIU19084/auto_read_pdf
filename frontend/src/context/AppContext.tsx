import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AutoSyncSchedule, AutoSyncStatus, Collection, ColorRule, RunSyncNowStatus } from '../types';
import { Language, translations } from '../i18n/translations';
import {
  getCollections, createCollection, deleteCollection,
  getAutoSyncStatus, toggleAutoSyncApi, runSyncNowApi,
  getColorRulesApi, createColorRuleApi, updateColorRuleApi, deleteColorRuleApi, resetColorRulesApi,
} from '../services/api';
import { buildColorRuleIndex, ColorRuleIndex, dedupeColorRules } from '../utils/colorPresets';
import { useToastActions, ToastMessage, ToastType } from './ToastContext';
import { tf } from '../services/i18nFormat';
import { describeAutoSyncSchedule, normalizeSyncTimes } from '../services/autoSync';

export type { ToastMessage, ToastType } from './ToastContext';

const AUTO_SYNC_POLL_MS = 30000;
const AUTO_SYNC_POLL_RUNNING_MS = 5000;

export interface UpdateAutoSyncScheduleOptions {
  /** Do not show the success toast (errors are still shown). */
  silent?: boolean;
}

export interface AppContextType {
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
  /** Stable reference (toasts state lives in ToastContext — use `useToast()` to read it). */
  addToast: (text: string, type?: ToastType) => void;
  /** Stable reference. */
  removeToast: (id: string) => void;
  // Shared Auto Sync State (backend is the source of truth)
  autoSyncStatus: AutoSyncStatus | null;
  /** Derived from autoSyncStatus.enabled */
  autoSyncEnabled: boolean;
  /** Derived from autoSyncStatus.interval_minutes */
  syncInterval: number;
  refreshAutoSyncStatus: () => Promise<AutoSyncStatus | null>;
  toggleAutoSync: (enable?: boolean, interval?: number) => Promise<void>;
  updateSyncInterval: (newInterval: number) => Promise<void>;
  updateAutoSyncSchedule: (
    schedule: AutoSyncSchedule,
    options?: UpdateAutoSyncScheduleOptions
  ) => Promise<AutoSyncStatus | null>;
  runSyncNow: () => Promise<RunSyncNowStatus | null>;
  // Color Rules State & Actions
  /** Deduplicated rules */
  colorRules: ColorRule[];
  /** Map-based lookup: active rules for a table/column (includes 'all' table/column rules). */
  getRulesFor: (table: string, column: string) => ColorRule[];
  refreshColorRules: () => Promise<void>;
  saveColorRule: (rule: Partial<ColorRule>) => Promise<void>;
  deleteColorRuleById: (id: number) => Promise<void>;
  toggleColorRule: (id: number, enabled: boolean) => Promise<void>;
  resetColorRulesDefault: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

// Separate, narrow context so cell components (ValueBadge) only re-render when rules change.
const ColorRuleIndexContext = createContext<ColorRuleIndex | null>(null);

const errorMessage = (e: any, fallback: string): string =>
  (e?.response?.data?.detail && typeof e.response.data.detail === 'string' ? e.response.data.detail : '') ||
  e?.message ||
  fallback;

const sameStatus = (a: AutoSyncStatus | null, b: AutoSyncStatus | null) =>
  a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addToast, removeToast } = useToastActions();

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

  const t = translations[language];
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('app_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('app_theme', 'light');
    }
  }, [isDark]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app_lang', lang);
  }, []);

  const setIsDark = useCallback((dark: boolean) => {
    setIsDarkState(dark);
  }, []);

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------
  const refreshCollections = useCallback(async () => {
    try {
      const cols = await getCollections();
      setCollections(cols);
      setActiveCollection((prev) => {
        if (cols.length === 0) return null;
        if (prev && cols.some((c) => c.id === prev.id)) return prev;
        return cols[0];
      });
    } catch (e: any) {
      console.error('Failed to load collections:', e);
    }
  }, []);

  const handleCreateCollection = useCallback(async (name: string) => {
    try {
      await createCollection(name);
      addToast(tRef.current.common.success, 'success');
      await refreshCollections();
    } catch (e: any) {
      addToast(errorMessage(e, tRef.current.common.error), 'error');
    }
  }, [addToast, refreshCollections]);

  const handleDeleteCollection = useCallback(async (id: number) => {
    try {
      await deleteCollection(id);
      addToast(tRef.current.common.success, 'success');
      await refreshCollections();
    } catch (e: any) {
      addToast(errorMessage(e, tRef.current.common.error), 'error');
    }
  }, [addToast, refreshCollections]);

  // ---------------------------------------------------------------------------
  // Auto sync (backend is the source of truth; polled while the app is visible)
  // ---------------------------------------------------------------------------
  const [autoSyncStatus, setAutoSyncStatus] = useState<AutoSyncStatus | null>(null);
  const autoSyncStatusRef = useRef<AutoSyncStatus | null>(null);
  const statusRequestRef = useRef<Promise<AutoSyncStatus | null> | null>(null);

  const applyAutoSyncStatus = useCallback((next: AutoSyncStatus | null) => {
    if (next) {
      next = { ...next, times: normalizeSyncTimes(next.times) };
    }
    const prev = autoSyncStatusRef.current;
    if (sameStatus(prev, next)) return;
    autoSyncStatusRef.current = next;
    setAutoSyncStatus(next);
  }, []);

  const refreshAutoSyncStatus = useCallback((): Promise<AutoSyncStatus | null> => {
    // Skip if a request is already in flight — reuse it.
    if (statusRequestRef.current) return statusRequestRef.current;
    const req = getAutoSyncStatus()
      .then((status) => {
        applyAutoSyncStatus(status);
        return status;
      })
      .catch((e) => {
        console.error('Failed to load auto sync status:', e);
        return null;
      })
      .finally(() => {
        statusRequestRef.current = null;
      });
    statusRequestRef.current = req;
    return req;
  }, [applyAutoSyncStatus]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Bumped on visibility change so an in-flight tick from the previous chain doesn't reschedule
    let generation = 0;

    const schedule = () => {
      if (cancelled || document.hidden) return;
      const delay = autoSyncStatusRef.current?.running ? AUTO_SYNC_POLL_RUNNING_MS : AUTO_SYNC_POLL_MS;
      timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled) return;
      const gen = generation;
      if (!document.hidden) {
        await refreshAutoSyncStatus();
      }
      if (gen !== generation) return;
      schedule();
    };

    const onVisibilityChange = () => {
      generation += 1;
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!document.hidden) tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshAutoSyncStatus]);

  const autoSyncEnabled = autoSyncStatus?.enabled ?? false;
  const syncInterval = autoSyncStatus?.interval_minutes ?? 10;

  // Tell Electron main process whether closing the window should hide to tray.
  useEffect(() => {
    if (autoSyncStatus === null) return;
    try {
      window.electronAPI?.setAutoSyncActive?.(autoSyncEnabled);
    } catch (e) {
      console.warn('setAutoSyncActive failed:', e);
    }
  }, [autoSyncEnabled, autoSyncStatus === null]);

  const toggleAutoSync = useCallback(async (enable?: boolean, interval?: number) => {
    const tt = tRef.current;
    const cur = autoSyncStatusRef.current;
    const nextEnable = enable !== undefined ? enable : !(cur?.enabled ?? false);
    const targetInterval = interval !== undefined && interval > 0 ? interval : cur?.interval_minutes ?? 10;
    const mode = cur?.mode ?? 'interval';
    const times = cur?.times ?? [];
    try {
      const res = await toggleAutoSyncApi(nextEnable, targetInterval, { mode, times });
      applyAutoSyncStatus(res);
      const fresh = await refreshAutoSyncStatus();
      const effective = fresh || res;
      addToast(
        effective.enabled
          ? tf(tt.autoSync.enabledToast, {
              schedule: describeAutoSyncSchedule(effective, tt.autoSync),
            })
          : tt.autoSync.disabledToast,
        effective.enabled ? 'success' : 'info'
      );
    } catch (e: any) {
      addToast(errorMessage(e, tt.common.error), 'error');
    }
  }, [addToast, applyAutoSyncStatus, refreshAutoSyncStatus]);

  const updateAutoSyncSchedule = useCallback(async (
    schedule: AutoSyncSchedule,
    options: UpdateAutoSyncScheduleOptions = {}
  ): Promise<AutoSyncStatus | null> => {
    const tt = tRef.current;
    const cur = autoSyncStatusRef.current;
    const intervalMinutes = Math.round(Number(schedule.interval_minutes));
    const times = normalizeSyncTimes(schedule.times);

    if (schedule.mode === 'interval' && (!Number.isFinite(intervalMinutes) || intervalMinutes < 1)) {
      addToast(tt.autoSync.invalidInterval, 'error');
      return null;
    }
    if (schedule.mode === 'times' && times.length === 0) {
      addToast(tt.autoSync.invalidTimes, 'error');
      return null;
    }

    try {
      const res = await toggleAutoSyncApi(
        cur?.enabled ?? false,
        Number.isFinite(intervalMinutes) && intervalMinutes >= 1 ? intervalMinutes : cur?.interval_minutes ?? 10,
        { mode: schedule.mode, times }
      );
      applyAutoSyncStatus(res);
      const fresh = await refreshAutoSyncStatus();
      if (!options.silent) addToast(tt.autoSync.saved, 'success');
      return fresh || res;
    } catch (e: any) {
      addToast(errorMessage(e, tt.common.error), 'error');
      return null;
    }
  }, [addToast, applyAutoSyncStatus, refreshAutoSyncStatus]);

  const updateSyncInterval = useCallback(async (newInterval: number) => {
    if (isNaN(newInterval) || newInterval < 1) {
      addToast(tRef.current.autoSync.invalidInterval, 'info');
      return;
    }
    const cur = autoSyncStatusRef.current;
    await updateAutoSyncSchedule({ mode: 'interval', interval_minutes: newInterval, times: cur?.times ?? [] });
  }, [addToast, updateAutoSyncSchedule]);

  const runSyncNow = useCallback(async (): Promise<RunSyncNowStatus | null> => {
    const tt = tRef.current;
    try {
      const res = await runSyncNowApi();
      const status: RunSyncNowStatus = res?.status === 'already_running' ? 'already_running' : 'started';
      addToast(status === 'started' ? tt.autoSync.runStarted : tt.autoSync.alreadyRunning, status === 'started' ? 'success' : 'info');
      const cur = autoSyncStatusRef.current;
      if (cur && !cur.running) applyAutoSyncStatus({ ...cur, running: true });
      setTimeout(() => {
        refreshAutoSyncStatus();
      }, 1500);
      return status;
    } catch (e: any) {
      addToast(errorMessage(e, tt.common.error), 'error');
      return null;
    }
  }, [addToast, applyAutoSyncStatus, refreshAutoSyncStatus]);

  // ---------------------------------------------------------------------------
  // Color rules
  // ---------------------------------------------------------------------------
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const colorRuleIndex = useMemo(() => buildColorRuleIndex(colorRules), [colorRules]);
  const getRulesFor = colorRuleIndex.getRulesFor;

  const refreshColorRules = useCallback(async () => {
    try {
      const rules = await getColorRulesApi();
      setColorRules(dedupeColorRules(Array.isArray(rules) ? rules : []));
    } catch (e) {
      console.error('Failed to load color rules:', e);
    }
  }, []);

  const saveColorRule = useCallback(async (rule: Partial<ColorRule>) => {
    try {
      if (rule.id) {
        await updateColorRuleApi(rule.id, rule);
      } else {
        await createColorRuleApi(rule);
      }
      await refreshColorRules();
      addToast(tRef.current.common.success, 'success');
    } catch (e: any) {
      addToast(errorMessage(e, tRef.current.common.error), 'error');
    }
  }, [addToast, refreshColorRules]);

  const deleteColorRuleById = useCallback(async (id: number) => {
    try {
      await deleteColorRuleApi(id);
      await refreshColorRules();
      addToast(tRef.current.common.success, 'success');
    } catch (e: any) {
      addToast(errorMessage(e, tRef.current.common.error), 'error');
    }
  }, [addToast, refreshColorRules]);

  const toggleColorRule = useCallback(async (id: number, enabled: boolean) => {
    try {
      await updateColorRuleApi(id, { is_enabled: enabled });
      setColorRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_enabled: enabled } : r))
      );
    } catch (e: any) {
      addToast(errorMessage(e, tRef.current.common.error), 'error');
    }
  }, [addToast]);

  const resetColorRulesDefault = useCallback(async () => {
    try {
      const reset = await resetColorRulesApi();
      setColorRules(dedupeColorRules(Array.isArray(reset) ? reset : []));
      addToast(tRef.current.common.success, 'success');
    } catch (e: any) {
      addToast(errorMessage(e, tRef.current.common.error), 'error');
    }
  }, [addToast]);

  useEffect(() => {
    refreshCollections();
    refreshColorRules();
  }, [refreshCollections, refreshColorRules]);

  const value = useMemo<AppContextType>(() => ({
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
    addToast,
    removeToast,
    autoSyncStatus,
    autoSyncEnabled,
    syncInterval,
    refreshAutoSyncStatus,
    toggleAutoSync,
    updateSyncInterval,
    updateAutoSyncSchedule,
    runSyncNow,
    colorRules,
    getRulesFor,
    refreshColorRules,
    saveColorRule,
    deleteColorRuleById,
    toggleColorRule,
    resetColorRulesDefault,
  }), [
    language, setLanguage, t, isDark, setIsDark,
    collections, activeCollection, refreshCollections, handleCreateCollection, handleDeleteCollection,
    addToast, removeToast,
    autoSyncStatus, autoSyncEnabled, syncInterval, refreshAutoSyncStatus, toggleAutoSync,
    updateSyncInterval, updateAutoSyncSchedule, runSyncNow,
    colorRules, getRulesFor, refreshColorRules, saveColorRule, deleteColorRuleById, toggleColorRule,
    resetColorRulesDefault,
  ]);

  return (
    <AppContext.Provider value={value}>
      <ColorRuleIndexContext.Provider value={colorRuleIndex}>
        {children}
      </ColorRuleIndexContext.Provider>
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

/**
 * Narrow subscription to the color rule Map lookup. Components using only this hook
 * re-render when rules change — not on collection/auto-sync/language changes.
 */
export const useColorRuleLookup = (): ((table: string, column: string) => ColorRule[]) => {
  const index = useContext(ColorRuleIndexContext);
  if (!index) {
    throw new Error('useColorRuleLookup must be used within an AppProvider');
  }
  return index.getRulesFor;
};
