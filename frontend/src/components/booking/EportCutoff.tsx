import React from 'react';
import { tf } from '../../services/i18nFormat';

export const CUTOFF_KEY = 'Port Cargo Cut-off';
export const EPORT_CUTOFF_KEY = 'Cut-off ePort';

export interface EportCutoffLabels {
  badge: string;
  tooltip: string;
  tooltipNoOriginal: string;
}

const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'null';

export const eportTooltip = (labels: EportCutoffLabels, eport: string, original: unknown): string =>
  isBlank(original)
    ? tf(labels.tooltipNoOriginal, { eport })
    : tf(labels.tooltip, { eport, original: String(original) });

/** The booking's cut-off cell once ePort has a closing time for its vessel: ePort's time leads, the booking's own is struck through. */
export const EportCutoffCell: React.FC<{ eport: string; original: unknown; badge: string }> = ({ eport, original, badge }) => (
  <span className="inline-flex items-center gap-1.5 max-w-full">
    <span className="font-semibold text-sky-700 dark:text-sky-300 truncate">{eport}</span>
    <span className="shrink-0 px-1 rounded border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 text-[9px] font-bold text-sky-700 dark:text-sky-300">
      {badge}
    </span>
    {!isBlank(original) && String(original).trim() !== eport && (
      <span className="text-[11px] text-slate-400 dark:text-slate-500 line-through truncate">{String(original)}</span>
    )}
  </span>
);
