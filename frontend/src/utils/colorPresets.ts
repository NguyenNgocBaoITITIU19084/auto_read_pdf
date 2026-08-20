import { ColorPreset, ColorRule, TargetTable } from '../types';

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'rose',
    name: 'Rose (Red)',
    nameVi: 'Đỏ hồng (Rose)',
    bgClass: 'bg-rose-100',
    darkBgClass: 'dark:bg-rose-950/80',
    borderClass: 'border-rose-200',
    darkBorderClass: 'dark:border-rose-800',
    textClass: 'text-rose-800',
    darkTextClass: 'dark:text-rose-300',
    hexPreview: '#f43f5e',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800',
  },
  {
    id: 'emerald',
    name: 'Emerald (Green)',
    nameVi: 'Xanh lá (Emerald)',
    bgClass: 'bg-emerald-100',
    darkBgClass: 'dark:bg-emerald-950/80',
    borderClass: 'border-emerald-200',
    darkBorderClass: 'dark:border-emerald-800',
    textClass: 'text-emerald-800',
    darkTextClass: 'dark:text-emerald-300',
    hexPreview: '#10b981',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800',
  },
  {
    id: 'sky',
    name: 'Sky (Light Blue)',
    nameVi: 'Xanh da trời (Sky)',
    bgClass: 'bg-sky-100',
    darkBgClass: 'dark:bg-sky-950/80',
    borderClass: 'border-sky-200',
    darkBorderClass: 'dark:border-sky-800',
    textClass: 'text-sky-800',
    darkTextClass: 'dark:text-sky-300',
    hexPreview: '#0ea5e9',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-800',
  },
  {
    id: 'blue',
    name: 'Blue (Ocean)',
    nameVi: 'Xanh dương (Blue)',
    bgClass: 'bg-blue-100',
    darkBgClass: 'dark:bg-blue-950/80',
    borderClass: 'border-blue-200',
    darkBorderClass: 'dark:border-blue-800',
    textClass: 'text-blue-800',
    darkTextClass: 'dark:text-blue-300',
    hexPreview: '#3b82f6',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800',
  },
  {
    id: 'amber',
    name: 'Amber (Warm Yellow)',
    nameVi: 'Vàng hổ phách (Amber)',
    bgClass: 'bg-amber-100',
    darkBgClass: 'dark:bg-amber-950/80',
    borderClass: 'border-amber-200',
    darkBorderClass: 'dark:border-amber-800',
    textClass: 'text-amber-800',
    darkTextClass: 'dark:text-amber-300',
    hexPreview: '#f59e0b',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800',
  },
  {
    id: 'purple',
    name: 'Purple (Violet)',
    nameVi: 'Tím thạch anh (Purple)',
    bgClass: 'bg-purple-100',
    darkBgClass: 'dark:bg-purple-950/80',
    borderClass: 'border-purple-200',
    darkBorderClass: 'dark:border-purple-800',
    textClass: 'text-purple-800',
    darkTextClass: 'dark:text-purple-300',
    hexPreview: '#a855f7',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-800',
  },
  {
    id: 'indigo',
    name: 'Indigo (Deep Blue)',
    nameVi: 'Chàm hiện đại (Indigo)',
    bgClass: 'bg-indigo-100',
    darkBgClass: 'dark:bg-indigo-950/80',
    borderClass: 'border-indigo-200',
    darkBorderClass: 'dark:border-indigo-800',
    textClass: 'text-indigo-800',
    darkTextClass: 'dark:text-indigo-300',
    hexPreview: '#6366f1',
    badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/80 dark:text-indigo-300 dark:border-indigo-800',
  },
  {
    id: 'teal',
    name: 'Teal (Cyan)',
    nameVi: 'Xanh ngọc (Teal)',
    bgClass: 'bg-teal-100',
    darkBgClass: 'dark:bg-teal-950/80',
    borderClass: 'border-teal-200',
    darkBorderClass: 'dark:border-teal-800',
    textClass: 'text-teal-800',
    darkTextClass: 'dark:text-teal-300',
    hexPreview: '#14b8a6',
    badgeClass: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/80 dark:text-teal-300 dark:border-teal-800',
  },
  {
    id: 'orange',
    name: 'Orange',
    nameVi: 'Cam tươi (Orange)',
    bgClass: 'bg-orange-100',
    darkBgClass: 'dark:bg-orange-950/80',
    borderClass: 'border-orange-200',
    darkBorderClass: 'dark:border-orange-800',
    textClass: 'text-orange-800',
    darkTextClass: 'dark:text-orange-300',
    hexPreview: '#f97316',
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/80 dark:text-orange-300 dark:border-orange-800',
  },
  {
    id: 'pink',
    name: 'Pink',
    nameVi: 'Hồng phấn (Pink)',
    bgClass: 'bg-pink-100',
    darkBgClass: 'dark:bg-pink-950/80',
    borderClass: 'border-pink-200',
    darkBorderClass: 'dark:border-pink-800',
    textClass: 'text-pink-800',
    darkTextClass: 'dark:text-pink-300',
    hexPreview: '#ec4899',
    badgeClass: 'bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-950/80 dark:text-pink-300 dark:border-pink-800',
  },
  {
    id: 'slate',
    name: 'Slate (Gray)',
    nameVi: 'Xám hiện đại (Slate)',
    bgClass: 'bg-slate-100',
    darkBgClass: 'dark:bg-slate-800',
    borderClass: 'border-slate-200',
    darkBorderClass: 'dark:border-slate-700',
    textClass: 'text-slate-700',
    darkTextClass: 'dark:text-slate-300',
    hexPreview: '#64748b',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
  {
    id: 'lime',
    name: 'Lime (Light Green)',
    nameVi: 'Xanh cốm (Lime)',
    bgClass: 'bg-lime-100',
    darkBgClass: 'dark:bg-lime-950/80',
    borderClass: 'border-lime-200',
    darkBorderClass: 'dark:border-lime-800',
    textClass: 'text-lime-800',
    darkTextClass: 'dark:text-lime-300',
    hexPreview: '#84cc16',
    badgeClass: 'bg-lime-100 text-lime-800 border-lime-200 dark:bg-lime-950/80 dark:text-lime-300 dark:border-lime-800',
  },
];

export function getColorPreset(presetId?: string): ColorPreset | undefined {
  if (!presetId) return undefined;
  return COLOR_PRESETS.find((p) => p.id === presetId);
}

/**
 * Finds the highest priority matching active ColorRule for a given cell value and table/column.
 * Priority:
 * 1. Specific table & specific column & exact match
 * 2. Specific table & specific column & contains match
 * 3. Specific table & all columns & exact match
 * 4. Specific table & all columns & contains match
 * 5. All tables & specific column & exact match
 * 6. All tables & specific column & contains match
 * 7. All tables & all columns & exact match
 * 8. All tables & all columns & contains match
 * Within the same tier, the newest rule (higher id or later index) wins.
 */
export function findMatchingColorRule(
  rules: ColorRule[],
  table: TargetTable,
  columnKey: string,
  cellValue: any
): ColorRule | null {
  if (cellValue === undefined || cellValue === null || cellValue === '') {
    return null;
  }

  const strVal = String(cellValue).trim();
  if (!strVal || strVal.toLowerCase() === 'null') {
    return null;
  }

  const upperVal = strVal.toUpperCase();

  const matchingCandidates: { rule: ColorRule; priority: number; idOrIndex: number }[] = [];

  rules.forEach((rule, idx) => {
    if (!rule.is_enabled) return;

    const isSpecificTable = rule.target_table === table;
    const isAllTable = rule.target_table === 'all';
    if (!isSpecificTable && !isAllTable) return;

    const isSpecificCol = rule.column_key === columnKey;
    const isAllCol = rule.column_key === 'all';
    if (!isSpecificCol && !isAllCol) return;

    const ruleMatchVal = (rule.match_value || '').trim();
    if (!ruleMatchVal) return;

    const ruleUpper = ruleMatchVal.toUpperCase();
    let isMatch = false;
    let isExact = false;

    if (rule.match_type === 'contains') {
      if (upperVal.includes(ruleUpper)) {
        isMatch = true;
        isExact = upperVal === ruleUpper;
      }
    } else {
      if (upperVal === ruleUpper) {
        isMatch = true;
        isExact = true;
      }
    }

    if (!isMatch) return;

    // Calculate priority score (higher is better)
    let score = 0;
    if (isSpecificTable) score += 100;
    if (isSpecificCol) score += 50;
    if (isExact) score += 20;

    const orderVal = typeof rule.id === 'number' ? rule.id : idx;
    matchingCandidates.push({ rule, priority: score, idOrIndex: orderVal });
  });

  if (matchingCandidates.length === 0) {
    return null;
  }

  // Sort by priority descending, then by id/index descending (newest rule wins)
  matchingCandidates.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return b.idOrIndex - a.idOrIndex;
  });

  return matchingCandidates[0].rule;
}
