import React from 'react';
import { useColorRuleLookup } from '../../context/AppContext';
import { TargetTable } from '../../types';
import { findMatchingColorRule, getColorPreset } from '../../utils/colorPresets';

interface ValueBadgeProps {
  table: TargetTable;
  columnKey: string;
  value: any;
  fallbackText?: string;
  className?: string;
  badgeClassName?: string;
}

const DEFAULT_BADGE_CLASS =
  'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';

const ValueBadgeInner: React.FC<ValueBadgeProps> = ({
  table,
  columnKey,
  value,
  fallbackText = '-',
  className = '',
  badgeClassName = '',
}) => {
  // Map-based lookup: only the rules relevant to this table/column are scanned.
  const getRulesFor = useColorRuleLookup();

  if (value === undefined || value === null || value === '' || value === 'null') {
    return (
      <span className={`text-slate-400 dark:text-slate-500 italic text-[11px] ${className}`}>
        {fallbackText}
      </span>
    );
  }

  const strVal = String(value);
  const candidates = getRulesFor(table, columnKey);
  const matchingRule = candidates.length > 0
    ? findMatchingColorRule(candidates, table, columnKey, strVal)
    : null;

  if (matchingRule) {
    if (matchingRule.custom_bg) {
      return (
        <span
          style={{
            backgroundColor: matchingRule.custom_bg,
            borderColor: matchingRule.custom_border,
            color: matchingRule.custom_text,
          }}
          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border shadow-2xs ${badgeClassName}`}
          title={strVal}
        >
          {strVal}
        </span>
      );
    }

    const preset = getColorPreset(matchingRule.preset_id);
    const badgeClass = preset?.badgeClass || DEFAULT_BADGE_CLASS;

    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border shadow-2xs ${badgeClass} ${badgeClassName}`}
        title={strVal}
      >
        {strVal}
      </span>
    );
  }

  return (
    <span className={`text-slate-800 dark:text-slate-200 font-medium ${className}`} title={strVal}>
      {strVal}
    </span>
  );
};

export const ValueBadge = React.memo(ValueBadgeInner);
ValueBadge.displayName = 'ValueBadge';
