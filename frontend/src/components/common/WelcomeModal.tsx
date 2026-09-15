import React, { useState } from 'react';
import { Sparkles, Compass } from 'lucide-react';
import { Modal } from './Modal';
import { translations } from '../../i18n/translations';
import { setOnboardingCompleted } from '../../services/tourEvents';

type TranslationType = typeof translations.vi;

export interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  t: TranslationType;
  onStartFullTour: () => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  t,
  onStartFullTour,
}) => {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleDismiss = () => {
    if (dontShowAgain) {
      setOnboardingCompleted(true);
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleDismiss}
      title={t.tour.welcomeModalTitle}
      maxWidth="max-w-md"
    >
      <div className="space-y-4 pt-1">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-primary-50 dark:bg-primary-950/40 border border-primary-100 dark:border-primary-900/60">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-sky-400 flex items-center justify-center text-white shadow-md shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {t.tour.welcomeModalDesc}
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500"
          />
          <span>{t.tour.dontShowAgain}</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleDismiss}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            {t.tour.skipTourBtn}
          </button>
          <button
            type="button"
            onClick={() => {
              if (dontShowAgain) {
                setOnboardingCompleted(true);
              }
              onStartFullTour();
            }}
            className="px-4 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md shadow-primary-500/20 transition-all flex items-center gap-1.5"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>{t.tour.startTourBtn}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
