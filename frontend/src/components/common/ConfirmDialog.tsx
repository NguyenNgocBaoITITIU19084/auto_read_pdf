import React, { useEffect, useRef } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';

export interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Red styling for destructive actions */
  danger?: boolean;
}

interface ConfirmDialogProps extends ConfirmOptions {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Defaults (localized) used when title/confirmText/cancelText are omitted */
  defaultTitle?: string;
  defaultConfirmText?: string;
  defaultCancelText?: string;
  keyboardHint?: string;
}

/**
 * Accessible in-app replacement for window.confirm (which steals input focus in Electron on Windows).
 * Enter confirms, Esc cancels, confirm button is autofocused, Tab is trapped inside the dialog.
 * Rendered above regular modals (z-60) and swallows Esc so the underlying Modal does not close.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  danger = false,
  onConfirm,
  onCancel,
  defaultTitle = 'Xác nhận',
  defaultConfirmText = 'Xác nhận',
  defaultCancelText = 'Hủy',
  keyboardHint,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  onConfirmRef.current = onConfirm;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!isOpen) return;

    // Autofocus confirm button after paint
    const focusTimer = window.setTimeout(() => confirmBtnRef.current?.focus(), 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onCancelRef.current();
        return;
      }
      if (e.key === 'Enter' && !e.isComposing) {
        // Enter on the Cancel button cancels; anywhere else confirms
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (document.activeElement === cancelBtnRef.current) {
          onCancelRef.current();
        } else {
          onConfirmRef.current();
        }
        return;
      }
      if (e.key === 'Tab') {
        const focusables = [cancelBtnRef.current, confirmBtnRef.current].filter(Boolean) as HTMLElement[];
        if (focusables.length === 0) return;
        const idx = focusables.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        const nextIdx = e.shiftKey
          ? (idx <= 0 ? focusables.length - 1 : idx - 1)
          : (idx === -1 || idx >= focusables.length - 1 ? 0 : idx + 1);
        focusables[nextIdx].focus();
      }
    };

    // Capture phase on window: runs before Modal's window keydown listener, so Esc does not close it.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
        onMouseDown={(e) => {
          e.preventDefault();
          onCancel();
        }}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="px-5 pt-5 pb-4 flex items-start gap-3.5">
          <div
            className={`p-2 rounded-xl shrink-0 ${
              danger
                ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400'
                : 'bg-primary-100 dark:bg-primary-950/70 text-primary-600 dark:text-primary-400'
            }`}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="confirm-dialog-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {title || defaultTitle}
            </h3>
            <div
              id="confirm-dialog-message"
              className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line break-words"
            >
              {message}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50/80 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <span className="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500">
            {keyboardHint}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
            >
              {cancelText || defaultCancelText}
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              onClick={onConfirm}
              className={`px-4 py-2 text-xs font-bold rounded-xl text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900 transition-colors ${
                danger
                  ? 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500'
                  : 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500'
              }`}
            >
              {confirmText || defaultConfirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
