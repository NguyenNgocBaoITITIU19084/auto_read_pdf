import type { ExportColor, ExportColumn, ExportFill, ExportTemplate, PaletteColor } from '../../types';

/** Same colours as the backend's EXPORT_PALETTE: header shade, body tint, header text. */
export const EXPORT_PALETTE: { id: PaletteColor; header: string; tint: string; text: string }[] = [
  { id: 'red', header: '#C0392B', tint: '#FDECEA', text: '#FFFFFF' },
  { id: 'orange', header: '#E67E22', tint: '#FDF2E6', text: '#FFFFFF' },
  { id: 'yellow', header: '#F1C40F', tint: '#FEF9E3', text: '#1F2937' },
  { id: 'green', header: '#27AE60', tint: '#E8F6EE', text: '#FFFFFF' },
  { id: 'teal', header: '#16A085', tint: '#E6F5F2', text: '#FFFFFF' },
  { id: 'blue', header: '#2980B9', tint: '#E8F1F9', text: '#FFFFFF' },
  { id: 'purple', header: '#8E44AD', tint: '#F3EAF7', text: '#FFFFFF' },
  { id: 'pink', header: '#D63384', tint: '#FBE9F2', text: '#FFFFFF' },
  { id: 'gray', header: '#7F8C8D', tint: '#F1F3F4', text: '#FFFFFF' },
];
export const DEFAULT_HEADER = { header: '#2C3E50', text: '#FFFFFF' };
const HEX = /^#?([0-9a-f]{6})$/i;

/** '#1e88e5' / '1E88E5' -> '#1E88E5'; null when it is not a 6-digit hex colour. */
export const normalizeHex = (value: string): `#${string}` | null => {
  const m = HEX.exec((value || '').trim());
  return m ? (`#${m[1].toUpperCase()}` as `#${string}`) : null;
};

/** Header shade, body tint and header text of a palette colour or a custom '#RRGGBB' one (as the backend does:
 *  tint = 85% towards white, dark text on light colours). */
export function colorStyle(color: ExportColor | null): { header: string; tint: string; text: string } | null {
  if (!color) return null;
  const preset = EXPORT_PALETTE.find((p) => p.id === color);
  if (preset) return preset;
  const hex = normalizeHex(color);
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const tint = '#' + [r, g, b].map((c) => Math.round(c + (255 - c) * 0.85).toString(16).padStart(2, '0')).join('').toUpperCase();
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { header: hex, tint, text: luminance > 0.6 ? '#1F2937' : '#FFFFFF' };
}
export const paletteOf = colorStyle;

export interface TabColumn {
  key: string;
  label: string;
}

/** A column in the editor: every column of the tab, ticked or not, in export order. */
export interface DraftColumn extends ExportColumn {
  label: string;
  included: boolean;
}

export interface Draft {
  name: string;
  filename: string;
  columns: DraftColumn[];
}

/** The editor's state for a template (or every column, plain, for the built-in one): the template's columns that
 *  the tab still has, in its order, then the tab's other columns unticked. */
export function buildDraft(template: Pick<ExportTemplate, 'name' | 'filename' | 'columns'> | null, all: TabColumn[],
  defaults: { name: string; filename: string }): Draft {
  const labels = new Map(all.map((c) => [c.key, c.label]));
  if (!template) {
    return {
      name: defaults.name,
      filename: defaults.filename,
      columns: all.map((c) => ({ key: c.key, label: c.label, header: '', color: null, fill: 'header', included: true })),
    };
  }
  const kept = template.columns.filter((c) => labels.has(c.key));
  const keys = new Set(kept.map((c) => c.key));
  return {
    name: template.name,
    filename: template.filename || defaults.filename,
    columns: [
      ...kept.map((c) => ({ ...c, label: labels.get(c.key) || c.key, header: c.header || '', included: true })),
      ...all.filter((c) => !keys.has(c.key))
        .map((c) => ({ key: c.key, label: c.label, header: '', color: null, fill: 'header' as ExportFill, included: false })),
    ],
  };
}

/** What a template stores: the ticked columns, in order. */
export const draftToColumns = (draft: Draft): ExportColumn[] =>
  draft.columns.filter((c) => c.included).map(({ key, header, color, fill }) => ({ key, header: header.trim(), color, fill }));

/** Comparable form of a draft, to tell whether it has unsaved changes. */
export const draftSignature = (draft: Draft) =>
  JSON.stringify({ name: draft.name.trim(), filename: draft.filename.trim(), columns: draftToColumns(draft) });

/** Move the column at `from` to `to` (drag and drop). */
export function moveColumnTo(columns: DraftColumn[], from: number, to: number): DraftColumn[] {
  if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length) return columns;
  const next = [...columns];
  const [col] = next.splice(from, 1);
  next.splice(to, 0, col);
  return next;
}

export function moveColumn(columns: DraftColumn[], index: number, delta: -1 | 1): DraftColumn[] {
  const to = index + delta;
  if (index < 0 || to < 0 || to >= columns.length) return columns;
  const next = [...columns];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Ticking a column moves it right after the last ticked one, so the export order stays at the top. */
export function toggleIncluded(columns: DraftColumn[], key: string): DraftColumn[] {
  const index = columns.findIndex((c) => c.key === key);
  if (index === -1) return columns;
  const col = { ...columns[index], included: !columns[index].included };
  const rest = columns.filter((_, i) => i !== index);
  const lastIncluded = rest.reduce((last, c, i) => (c.included ? i : last), -1);
  const at = col.included ? lastIncluded + 1 : rest.length;
  return [...rest.slice(0, at), col, ...rest.slice(at)];
}

const pad = (n: number) => String(n).padStart(2, '0');
const ILLEGAL = /[\\/:*?"<>|]+/g;

/** Today as written in file names: '16-10-2026' (day first, like the rest of the app). */
export const fileDate = (now = new Date()) => `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;

const SEPARATOR = ' - ';
const ENDS_WITH_GAP = /[\s_\-.(]$/;
const STARTS_WITH_GAP = /^[\s_\-.)]/;

/** Insert a placeholder at the caret, adding ' - ' around it when it would otherwise stick to the text. */
export function insertPlaceholder(text: string, token: string, start: number, end = start): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !ENDS_WITH_GAP.test(before) ? SEPARATOR : '';
  const trail = after && !STARTS_WITH_GAP.test(after) ? SEPARATOR : '';
  const inserted = lead + token + trail;
  return { text: before + inserted + after, caret: before.length + lead.length + token.length };
}

/** 'ke_hoach_{date}' -> 'ke_hoach_16-10-2026.xlsx': placeholders filled, characters Windows refuses removed. */
export function resolveFilename(pattern: string, ctx: { collection?: string; fallback: string }, now = new Date()): string {
  const date = fileDate(now);
  const base = (pattern || '')
    .replace(/\{date\}/gi, date)
    .replace(/\{collection\}/gi, ctx.collection || '')
    .replace(/\.xlsx$/i, '')
    .replace(ILLEGAL, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const name = base || `${ctx.fallback}_${date}`;
  return `${name}.xlsx`;
}

/** Rows keyed by column key; STT is the row's position. Blank values become "null", as the table shows them. */
export function buildExportRows(data: Record<string, unknown>[], columns: ExportColumn[]): Record<string, unknown>[] {
  return data.map((item, i) => {
    const row: Record<string, unknown> = {};
    columns.forEach(({ key }) => {
      const v = key === 'STT' ? i + 1 : item[key];
      row[key] = v === undefined || v === null || v === '' ? 'null' : v;
    });
    return row;
  });
}
