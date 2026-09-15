import React, { createContext, useCallback, useContext, useEffect, useRef, useState, lazy, Suspense } from 'react';
import type { ConfirmOptions } from '../components/common/ConfirmDialog';
import { useApp } from '../context/AppContext';

const ConfirmDialog = lazy(() => import('../components/common/ConfirmDialog').then((m) => ({ default: m.ConfirmDialog })));

export type { ConfirmOptions } from '../components/common/ConfirmDialog';

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
  /** Element focused before the dialog opened — focus is restored to it on close */
  restoreFocus: HTMLElement | null;
}

/** Mount once near the root (inside AppProvider). */
export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useApp();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const close = useCallback((ok: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(ok);
    const el = current.restoreFocus;
    if (el) {
      // Restore after the dialog unmounts (fixes lost input focus in Electron on Windows)
      window.setTimeout(() => {
        if (el.isConnected && typeof el.focus === 'function') {
          try {
            el.focus({ preventScroll: true });
          } catch {
            el.focus();
          }
        }
      }, 0);
    }
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      // A newer request supersedes an open one (the older resolves as cancelled)
      const prev = pendingRef.current;
      if (prev) {
        prev.resolve(false);
      }
      const active = document.activeElement;
      const next: PendingConfirm = {
        options,
        resolve,
        restoreFocus: prev?.restoreFocus ?? (active instanceof HTMLElement && active !== document.body ? active : null),
      };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  // Resolve dangling promise on unmount
  useEffect(() => () => {
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Suspense fallback={null}>
          <ConfirmDialog
            isOpen={!!pending}
            title={pending?.options.title}
            message={pending?.options.message}
            confirmText={pending?.options.confirmText}
            cancelText={pending?.options.cancelText}
            danger={pending?.options.danger}
            onConfirm={() => close(true)}
            onCancel={() => close(false)}
            defaultTitle={t.confirm.title}
            defaultConfirmText={pending?.options.danger ? t.confirm.delete : t.confirm.confirm}
            defaultCancelText={t.confirm.cancel}
            keyboardHint={t.confirm.keyboardHint}
          />
        </Suspense>
      )}
    </ConfirmContext.Provider>
  );
};

/**
 * Promise-based confirm dialog.
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title, message, danger: true }))) return;
 */
export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return ctx;
};
