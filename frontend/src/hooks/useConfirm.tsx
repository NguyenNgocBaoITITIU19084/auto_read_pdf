import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import type { ConfirmOptions } from '../components/common/ConfirmDialog';
import { useApp } from '../context/AppContext';

const ConfirmDialog = lazy(() => import('../components/common/ConfirmDialog').then((m) => ({ default: m.ConfirmDialog })));

export type { ConfirmOptions } from '../components/common/ConfirmDialog';

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export type ConfirmChoice = 'confirm' | 'alternative' | 'cancel';
/** Like ConfirmFn, for a dialog with a third button (`alternativeText`). */
export type ConfirmChoiceFn = (options: ConfirmOptions) => Promise<ConfirmChoice>;

const ConfirmContext = createContext<{ confirm: ConfirmFn; choose: ConfirmChoiceFn } | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (choice: ConfirmChoice) => void;
  /** Element focused before the dialog opened — focus is restored to it on close */
  restoreFocus: HTMLElement | null;
}

/** Mount once near the root (inside AppProvider). */
export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useApp();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const close = useCallback((choice: ConfirmChoice) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(choice);
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

  const choose = useCallback<ConfirmChoiceFn>((options) => {
    return new Promise<ConfirmChoice>((resolve) => {
      // A newer request supersedes an open one (the older resolves as cancelled)
      const prev = pendingRef.current;
      if (prev) {
        prev.resolve('cancel');
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

  const confirm = useCallback<ConfirmFn>(
    async (options) => (await choose({ ...options, alternativeText: undefined })) === 'confirm',
    [choose]
  );
  const value = useMemo(() => ({ confirm, choose }), [confirm, choose]);

  // Resolve dangling promise on unmount
  useEffect(() => () => {
    pendingRef.current?.resolve('cancel');
    pendingRef.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={value}>
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
            alternativeText={pending?.options.alternativeText}
            onConfirm={() => close('confirm')}
            onCancel={() => close('cancel')}
            onAlternative={() => close('alternative')}
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
  return ctx.confirm;
};

/**
 * Confirm dialog with a third button:
 *   const choose = useConfirmChoice();
 *   const choice = await choose({ message, confirmText, alternativeText }); // 'confirm' | 'alternative' | 'cancel'
 */
export const useConfirmChoice = (): ConfirmChoiceFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirmChoice must be used within a ConfirmProvider');
  }
  return ctx.choose;
};
