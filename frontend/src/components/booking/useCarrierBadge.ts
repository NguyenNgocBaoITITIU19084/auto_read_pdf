import type React from 'react';
import { useColorRuleLookup } from '../../context/AppContext';
import { findMatchingColorRule, getColorPreset } from '../../utils/colorPresets';

const NEUTRAL_BADGE =
  'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600';

/** Badge colour for a carrier, from the booking "Carrier" colour rules (same source as the table). */
export function useCarrierBadge(carrier?: string | null): { className: string; style?: React.CSSProperties } {
  const getRulesFor = useColorRuleLookup();
  const rule = carrier ? findMatchingColorRule(getRulesFor('booking', 'Carrier'), 'booking', 'Carrier', carrier) : null;
  if (rule?.custom_bg) {
    return { className: '', style: { backgroundColor: rule.custom_bg, borderColor: rule.custom_border, color: rule.custom_text } };
  }
  return { className: getColorPreset(rule?.preset_id)?.badgeClass || NEUTRAL_BADGE };
}
