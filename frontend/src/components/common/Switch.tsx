import React from 'react';
import { Loader2 } from 'lucide-react';

interface SwitchProps {
  checked: boolean;
  onChange: () => void;
  /** Accessible name (the visible title next to it says what it turns on) */
  label: string;
  disabled?: boolean;
  /** Spinner in the knob while the choice is being saved */
  busy?: boolean;
}

/** On/off track with a knob, for the settings cards. */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, disabled = false, busy = false }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50 ${
      checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
    }`}
  >
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`}
    >
      {busy && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
    </span>
  </button>
);
