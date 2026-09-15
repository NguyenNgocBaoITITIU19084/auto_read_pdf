import React from 'react';
import { Sparkles, BookOpen, ChevronRight } from 'lucide-react';
import { Modal } from './Modal';
import { TabId } from './Tabs';
import { translations } from '../../i18n/translations';

type TranslationType = typeof translations.vi;

export interface HelpTourModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabId;
  activeTabName: string;
  t: TranslationType;
  onStartFullTour: () => void;
  onStartTabTour: () => void;
}

export const HelpTourModal: React.FC<HelpTourModalProps> = ({
  isOpen,
  onClose,
  activeTabName,
  t,
  onStartFullTour,
  onStartTabTour,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t.tour.helpMenuTitle}
      maxWidth="max-w-lg"
    >
      <div className="space-y-3 pt-1">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t.tour.helpMenuTitle}:
        </p>

        <div className="grid grid-cols-1 gap-2.5">
          <button
            type="button"
            onClick={onStartFullTour}
            className="w-full text-left p-3.5 rounded-2xl bg-gradient-to-r from-primary-50 to-sky-50 dark:from-primary-950/40 dark:to-sky-950/30 border border-primary-200 dark:border-primary-800/80 hover:border-primary-400 dark:hover:border-primary-600 transition-all flex items-start gap-3.5 group cursor-pointer shadow-xs"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-sky-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-primary-500/20 group-hover:scale-105 transition-transform">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                <span className="text-primary-700 dark:text-primary-300 font-extrabold">{t.tour.fullTourTitle}</span>
                <ChevronRight className="w-4 h-4 text-primary-500 group-hover:translate-x-1 transition-transform" />
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                {t.tour.fullTourSubtitle}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={onStartTabTour}
            className="w-full text-left p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 hover:border-primary-400 dark:hover:border-primary-600 transition-all flex items-start gap-3.5 group cursor-pointer shadow-xs"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                <span>{t.tour.tabTourTitle} ({activeTabName})</span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {t.tour.tabTourSubtitle}
              </p>
            </div>
          </button>
        </div>

        <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </Modal>
  );
};
