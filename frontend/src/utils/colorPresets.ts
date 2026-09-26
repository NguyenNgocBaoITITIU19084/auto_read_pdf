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
  {
    id: 'cyan',
    name: 'Cyan',
    nameVi: 'Xanh lơ (Cyan)',
    bgClass: 'bg-cyan-100',
    darkBgClass: 'dark:bg-cyan-950/80',
    borderClass: 'border-cyan-200',
    darkBorderClass: 'dark:border-cyan-800',
    textClass: 'text-cyan-800',
    darkTextClass: 'dark:text-cyan-300',
    hexPreview: '#06b6d4',
    badgeClass: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/80 dark:text-cyan-300 dark:border-cyan-800',
  },
  {
    id: 'fuchsia',
    name: 'Fuchsia',
    nameVi: 'Hồng tím (Fuchsia)',
    bgClass: 'bg-fuchsia-100',
    darkBgClass: 'dark:bg-fuchsia-950/80',
    borderClass: 'border-fuchsia-200',
    darkBorderClass: 'dark:border-fuchsia-800',
    textClass: 'text-fuchsia-800',
    darkTextClass: 'dark:text-fuchsia-300',
    hexPreview: '#d946ef',
    badgeClass: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200 dark:bg-fuchsia-950/80 dark:text-fuchsia-300 dark:border-fuchsia-800',
  },
  {
    id: 'violet',
    name: 'Violet',
    nameVi: 'Tím violet (Violet)',
    bgClass: 'bg-violet-100',
    darkBgClass: 'dark:bg-violet-950/80',
    borderClass: 'border-violet-200',
    darkBorderClass: 'dark:border-violet-800',
    textClass: 'text-violet-800',
    darkTextClass: 'dark:text-violet-300',
    hexPreview: '#8b5cf6',
    badgeClass: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/80 dark:text-violet-300 dark:border-violet-800',
  },
  {
    id: 'yellow',
    name: 'Yellow',
    nameVi: 'Vàng (Yellow)',
    bgClass: 'bg-yellow-100',
    darkBgClass: 'dark:bg-yellow-950/80',
    borderClass: 'border-yellow-200',
    darkBorderClass: 'dark:border-yellow-800',
    textClass: 'text-yellow-800',
    darkTextClass: 'dark:text-yellow-300',
    hexPreview: '#eab308',
    badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/80 dark:text-yellow-300 dark:border-yellow-800',
  },
  {
    id: 'red',
    name: 'Red',
    nameVi: 'Đỏ (Red)',
    bgClass: 'bg-red-100',
    darkBgClass: 'dark:bg-red-950/80',
    borderClass: 'border-red-200',
    darkBorderClass: 'dark:border-red-800',
    textClass: 'text-red-800',
    darkTextClass: 'dark:text-red-300',
    hexPreview: '#ef4444',
    badgeClass: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/80 dark:text-red-300 dark:border-red-800',
  },
  {
    id: 'green',
    name: 'Green',
    nameVi: 'Xanh lá đậm (Green)',
    bgClass: 'bg-green-100',
    darkBgClass: 'dark:bg-green-950/80',
    borderClass: 'border-green-200',
    darkBorderClass: 'dark:border-green-800',
    textClass: 'text-green-800',
    darkTextClass: 'dark:text-green-300',
    hexPreview: '#22c55e',
    badgeClass: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950/80 dark:text-green-300 dark:border-green-800',
  },
  {
    id: 'stone',
    name: 'Stone',
    nameVi: 'Xám nâu (Stone)',
    bgClass: 'bg-stone-100',
    darkBgClass: 'dark:bg-stone-950/80',
    borderClass: 'border-stone-200',
    darkBorderClass: 'dark:border-stone-800',
    textClass: 'text-stone-800',
    darkTextClass: 'dark:text-stone-300',
    hexPreview: '#78716c',
    badgeClass: 'bg-stone-100 text-stone-800 border-stone-200 dark:bg-stone-950/80 dark:text-stone-300 dark:border-stone-800',
  },
];

const PRESET_BY_ID = new Map<string, ColorPreset>(COLOR_PRESETS.map((p) => [p.id, p]));

export function getColorPreset(presetId?: string): ColorPreset | undefined {
  if (!presetId) return undefined;
  return PRESET_BY_ID.get(presetId);
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
    const ruleUpper = ruleMatchVal.toUpperCase();
    let isMatch = false;
    let matchScore = 0;

    if (rule.match_type === 'any' || ruleMatchVal === '*' || (rule.match_type as string) === 'not_empty') {
      // Matches any non-empty / non-null value in the column
      isMatch = true;
      matchScore = 5;
    } else if (rule.match_type === 'starts_with') {
      if (ruleMatchVal && upperVal.startsWith(ruleUpper)) {
        isMatch = true;
        matchScore = upperVal === ruleUpper ? 25 : 20;
      }
    } else if (rule.match_type === 'ends_with') {
      if (ruleMatchVal && upperVal.endsWith(ruleUpper)) {
        isMatch = true;
        matchScore = upperVal === ruleUpper ? 25 : 20;
      }
    } else if (rule.match_type === 'contains') {
      if (ruleMatchVal && upperVal.includes(ruleUpper)) {
        isMatch = true;
        matchScore = upperVal === ruleUpper ? 25 : 15;
      }
    } else {
      // Default exact match
      if (ruleMatchVal && upperVal === ruleUpper) {
        isMatch = true;
        matchScore = 30;
      }
    }

    if (!isMatch) return;

    // Calculate priority score (higher is better)
    // Table specificity: 100 for specific, 0 for all
    // Column specificity: 50 for specific, 0 for all
    // Match type specificity: 30 (exact) > 20 (prefix/suffix) > 15 (contains) > 5 (any)
    let score = matchScore;
    if (isSpecificTable) score += 100;
    if (isSpecificCol) score += 50;

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

// ---------------------------------------------------------------------------
// Fast lookup index (avoid scanning every rule for every table cell)
// ---------------------------------------------------------------------------

const ruleIdentity = (rule: ColorRule): string =>
  [
    rule.target_table,
    rule.column_key,
    (rule.match_value || '').trim().toUpperCase(),
    rule.match_type || 'exact',
  ].join('|');

/**
 * Removes duplicated rules (same target_table / column_key / match_value / match_type).
 * The newest rule (highest id, or latest position) is kept because it is the one that
 * would win in `findMatchingColorRule` anyway. Original relative order is preserved.
 */
export function dedupeColorRules(rules: ColorRule[]): ColorRule[] {
  if (!Array.isArray(rules) || rules.length === 0) return [];
  const winner = new Map<string, { rule: ColorRule; order: number; enabled: boolean }>();
  rules.forEach((rule, idx) => {
    if (!rule) return;
    const key = ruleIdentity(rule);
    const order = typeof rule.id === 'number' ? rule.id : idx;
    const enabled = Boolean(rule.is_enabled);
    const current = winner.get(key);
    // Prefer an enabled duplicate over a disabled one, then the newest
    if (!current || (enabled && !current.enabled) || (enabled === current.enabled && order >= current.order)) {
      winner.set(key, { rule, order, enabled });
    }
  });
  if (winner.size === rules.length) return rules;
  const keep = new Set<ColorRule>();
  winner.forEach(({ rule }) => keep.add(rule));
  return rules.filter((r) => keep.has(r));
}

export interface ColorRuleIndex {
  /** Active (enabled) rules applicable to a cell of `table`/`column`, including 'all' table/column rules. */
  getRulesFor: (table: string, column: string) => ColorRule[];
  /** Total active rules in the index */
  size: number;
}

const bucketKey = (table: string, column: string) => `${table}|${column}`;

/**
 * Builds a Map keyed `${table}|${column}` once. `getRulesFor` merges the specific bucket
 * with the 'all' table / 'all' column buckets and caches the merged array per key, so each
 * cell lookup is O(1) + O(rules for that column).
 */
export function buildColorRuleIndex(rules: ColorRule[]): ColorRuleIndex {
  const buckets = new Map<string, ColorRule[]>();
  const position = new Map<ColorRule, number>();
  let size = 0;

  rules.forEach((rule, idx) => {
    if (!rule || !rule.is_enabled) return;
    position.set(rule, idx);
    const key = bucketKey(rule.target_table || 'all', rule.column_key || 'all');
    const list = buckets.get(key);
    if (list) list.push(rule);
    else buckets.set(key, [rule]);
    size += 1;
  });

  const merged = new Map<string, ColorRule[]>();
  const EMPTY: ColorRule[] = [];

  const getRulesFor = (table: string, column: string): ColorRule[] => {
    const key = bucketKey(table, column);
    const cached = merged.get(key);
    if (cached) return cached;

    const keys = new Set<string>([
      bucketKey(table, column),
      bucketKey(table, 'all'),
      bucketKey('all', column),
      bucketKey('all', 'all'),
    ]);
    let result: ColorRule[] = [];
    keys.forEach((k) => {
      const list = buckets.get(k);
      if (list) result = result.concat(list);
    });
    if (result.length === 0) {
      result = EMPTY;
    } else if (keys.size > 1) {
      // Preserve original order so index-based tie-breaking stays identical
      result.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
    }
    merged.set(key, result);
    return result;
  };

  return { getRulesFor, size };
}
