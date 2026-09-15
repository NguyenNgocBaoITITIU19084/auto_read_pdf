import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  text: string;
}

export interface ToastActions {
  /** Stable reference. Identical text+type already on screen is not duplicated. */
  addToast: (text: string, type?: ToastType) => void;
  /** Stable reference. */
  removeToast: (id: string) => void;
}

export interface ToastContextValue extends ToastActions {
  toasts: ToastMessage[];
}

const TOAST_DURATION_MS = 4000;
const MAX_TOASTS = 5;

// Actions and state live in separate contexts so components that only fire toasts
// (tables, modals, AppProvider) never re-render when a toast appears/disappears.
const ToastActionsContext = createContext<ToastActions | null>(null);
const ToastStateContext = createContext<ToastMessage[] | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => (prev.some((t) => t.id === id) ? prev.filter((t) => t.id !== id) : prev));
  }, []);

  const addToast = useCallback(
    (text: string, type: ToastType = 'info') => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => {
        if (prev.some((t) => t.text === text && t.type === type)) return prev;
        const next = [...prev, { id, type, text }];
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });
      // Always schedule removal; removing an id that was deduped away is a no-op.
      const timer = setTimeout(() => removeToast(id), TOAST_DURATION_MS);
      timersRef.current.set(id, timer);
    },
    [removeToast]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const actions = useMemo<ToastActions>(() => ({ addToast, removeToast }), [addToast, removeToast]);

  return (
    <ToastActionsContext.Provider value={actions}>
      <ToastStateContext.Provider value={toasts}>{children}</ToastStateContext.Provider>
    </ToastActionsContext.Provider>
  );
};

/** Stable toast actions only — does NOT re-render when toasts change. */
export const useToastActions = (): ToastActions => {
  const ctx = useContext(ToastActionsContext);
  if (!ctx) {
    throw new Error('useToastActions must be used within a ToastProvider');
  }
  return ctx;
};

/** Toasts state + actions. Re-renders whenever the toast list changes (use for the toast container). */
export const useToast = (): ToastContextValue => {
  const actions = useToastActions();
  const toasts = useContext(ToastStateContext);
  if (toasts === null) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return useMemo(() => ({ ...actions, toasts }), [actions, toasts]);
};
