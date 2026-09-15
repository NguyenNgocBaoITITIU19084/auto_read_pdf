import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';
import { PORT_OPTIONS } from '../../utils/ports';

export type BulkVesselLookupMode = 'auto' | { site: string };

const LAST_SITE_KEY = 'last_vessel_site_id';

const readLastSite = (): string | null => {
  try {
    return localStorage.getItem(LAST_SITE_KEY);
  } catch {
    return null;
  }
};

export interface BulkVesselLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  onStart: (mode: BulkVesselLookupMode) => void;
}

export const BulkVesselLookupModal: React.FC<BulkVesselLookupModalProps> = ({
  isOpen,
  onClose,
  selectedCount,
  onStart,
}) => {
  const { t, language } = useApp();
  const bv = t.booking.bulkVesselLookup;

  const [mode, setMode] = useState<'auto' | 'site'>('auto');
  const [site, setSite] = useState('CTL');

  useEffect(() => {
    if (isOpen) {
      setMode('auto');
      const lastSite = readLastSite();
      const validLast = lastSite && PORT_OPTIONS.some((p) => p.siteId === lastSite) ? lastSite : null;
      setSite(validLast || 'CTL');
    }
  }, [isOpen]);

  const handleStart = () => {
    onStart(mode === 'auto' ? 'auto' : { site });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={bv.title} maxWidth="max-w-lg">
      <div className="space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {tf(bv.selectedCount, { count: selectedCount })}
        </p>

        <div className="space-y-2">
          <label
            className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
              mode === 'auto'
                ? 'border-primary-400 bg-primary-50 dark:bg-primary-950/40'
                : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <input
              type="radio"
              name="bulk-vessel-lookup-mode"
              className="mt-0.5"
              checked={mode === 'auto'}
              onChange={() => setMode('auto')}
            />
            <span>
              <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{bv.modeAuto}</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">{bv.modeAutoDesc}</span>
            </span>
          </label>

          <label
            className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
              mode === 'site'
                ? 'border-primary-400 bg-primary-50 dark:bg-primary-950/40'
                : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <input
              type="radio"
              name="bulk-vessel-lookup-mode"
              className="mt-0.5"
              checked={mode === 'site'}
              onChange={() => setMode('site')}
            />
            <span className="flex-1">
              <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{bv.modeSite}</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-2">{bv.modeSiteDesc}</span>
              {mode === 'site' && (
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{bv.siteLabel}</span>
                  <select
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="px-2.5 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  >
                    {PORT_OPTIONS.map((p) => (
                      <option key={p.siteId} value={p.siteId}>
                        {language === 'en' ? p.nameEn : p.nameVi}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {bv.cancel}
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={selectedCount === 0}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-primary-600 hover:bg-primary-700 text-white shadow-sm disabled:opacity-50"
          >
            {bv.start}
          </button>
        </div>
      </div>
    </Modal>
  );
};
