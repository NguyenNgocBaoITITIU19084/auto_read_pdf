import { describe, it, expect } from 'vitest';
import {
  buildDraft, buildExportRows, draftSignature, draftToColumns, insertPlaceholder, moveColumn, resolveFilename, toggleIncluded,
} from './exportTemplates';

const ALL = [
  { key: 'STT', label: 'STT' },
  { key: 'Booking No', label: 'Số Booking' },
  { key: 'Carrier', label: 'Hãng tàu' },
  { key: 'Trạng thái', label: 'Trạng thái' },
];
const DEFAULTS = { name: 'Tất cả cột', filename: 'bookings_{date}' };

describe('buildDraft', () => {
  it('ticks every column, plain, for the built-in template', () => {
    const d = buildDraft(null, ALL, DEFAULTS);
    expect(d.name).toBe('Tất cả cột');
    expect(d.columns.map((c) => [c.key, c.included, c.color])).toEqual(ALL.map((c) => [c.key, true, null]));
  });

  it('keeps the template order, drops gone columns and lists new ones unticked', () => {
    const d = buildDraft({
      name: 'Đội xe', filename: '',
      columns: [
        { key: 'Carrier', header: 'Hãng', color: 'red', fill: 'column' },
        { key: 'Gone', header: '', color: null, fill: 'header' },
        { key: 'Booking No', header: '', color: null, fill: 'header' },
      ],
    }, ALL, DEFAULTS);
    expect(d.columns.map((c) => [c.key, c.included])).toEqual([
      ['Carrier', true], ['Booking No', true], ['STT', false], ['Trạng thái', false],
    ]);
    expect(d.columns[0]).toMatchObject({ label: 'Hãng tàu', header: 'Hãng', color: 'red', fill: 'column' });
    expect(d.filename).toBe('bookings_{date}');
    expect(draftToColumns(d).map((c) => c.key)).toEqual(['Carrier', 'Booking No']);
  });
});

describe('editing', () => {
  const base = buildDraft(null, ALL, DEFAULTS);

  it('moves a column up and down within bounds', () => {
    expect(moveColumn(base.columns, 1, -1).map((c) => c.key)).toEqual(['Booking No', 'STT', 'Carrier', 'Trạng thái']);
    expect(moveColumn(base.columns, 0, -1)).toBe(base.columns);
    expect(moveColumn(base.columns, 3, 1)).toBe(base.columns);
  });

  it('sends an unticked column to the end and a ticked one after the last ticked', () => {
    let cols = toggleIncluded(base.columns, 'STT');
    expect(cols.map((c) => [c.key, c.included])).toEqual([
      ['Booking No', true], ['Carrier', true], ['Trạng thái', true], ['STT', false],
    ]);
    cols = toggleIncluded(cols, 'Carrier');
    cols = toggleIncluded(cols, 'STT');
    expect(cols.map((c) => [c.key, c.included])).toEqual([
      ['Booking No', true], ['Trạng thái', true], ['STT', true], ['Carrier', false],
    ]);
  });

  it('notices changes through the signature', () => {
    const changed = { ...base, columns: base.columns.map((c) => (c.key === 'Carrier' ? { ...c, color: 'blue' as const } : c)) };
    expect(draftSignature(changed)).not.toBe(draftSignature(base));
    expect(draftSignature({ ...base, name: ` ${base.name} ` })).toBe(draftSignature(base));
  });
});

describe('resolveFilename', () => {
  const now = new Date(2026, 9, 16, 10, 0);
  it('fills placeholders (day first), strips forbidden characters and adds .xlsx once', () => {
    expect(resolveFilename('ke_hoach_{date}', { fallback: 'bookings' }, now)).toBe('ke_hoach_16-10-2026.xlsx');
    expect(resolveFilename('{collection} - {date}.xlsx', { collection: 'Kho A/B', fallback: 'x' }, now)).toBe('Kho A-B - 16-10-2026.xlsx');
    expect(resolveFilename('a:b*c?"d"<e>|f', { fallback: 'x' }, now)).toBe('a-b-c-d-e-f.xlsx');
    expect(resolveFilename('   ', { fallback: 'bookings' }, now)).toBe('bookings_16-10-2026.xlsx');
  });
});

describe('insertPlaceholder', () => {
  it('keeps a placeholder from sticking to the text around it', () => {
    expect(insertPlaceholder('Đội xe số 1', '{date}', 11)).toEqual({ text: 'Đội xe số 1 - {date}', caret: 20 });
    const twice = insertPlaceholder('Đội xe số 1 - {date}', '{collection}', 20);
    expect(twice.text).toBe('Đội xe số 1 - {date} - {collection}');
    expect(insertPlaceholder('', '{date}', 0)).toEqual({ text: '{date}', caret: 6 });
    expect(insertPlaceholder('ke_hoach_', '{date}', 9).text).toBe('ke_hoach_{date}');
    expect(insertPlaceholder('KH bản', '{date}', 2).text).toBe('KH - {date} bản');
    expect(insertPlaceholder('ABC', '{date}', 1, 2).text).toBe('A - {date} - C');
  });
});

describe('buildExportRows', () => {
  it('keys rows by column and numbers STT', () => {
    const rows = buildExportRows([{ 'Booking No': 'A', Carrier: '' }, { 'Booking No': 'B', Carrier: null }], [
      { key: 'STT', header: '', color: null, fill: 'header' },
      { key: 'Booking No', header: 'X', color: null, fill: 'header' },
      { key: 'Carrier', header: 'X', color: null, fill: 'header' },
    ]);
    expect(rows).toEqual([{ STT: 1, 'Booking No': 'A', Carrier: 'null' }, { STT: 2, 'Booking No': 'B', Carrier: 'null' }]);
  });
});

import { colorStyle, moveColumnTo, normalizeHex } from './exportTemplates';

describe('custom colours and drag moves', () => {
  it('reads hex colours like the backend does', () => {
    expect(normalizeHex('1e88e5')).toBe('#1E88E5');
    expect(normalizeHex('#12345')).toBeNull();
    expect(colorStyle('#1E88E5')).toEqual({ header: '#1E88E5', tint: '#DDEDFB', text: '#FFFFFF' });
    expect(colorStyle('#FFEB3B')?.text).toBe('#1F2937');
    expect(colorStyle('red')?.header).toBe('#C0392B');
    expect(colorStyle(null)).toBeNull();
  });

  it('moves a column to another position', () => {
    const cols = buildDraft(null, ALL, DEFAULTS).columns;
    expect(moveColumnTo(cols, 3, 0).map((c) => c.key)).toEqual(['Trạng thái', 'STT', 'Booking No', 'Carrier']);
    expect(moveColumnTo(cols, 0, 2).map((c) => c.key)).toEqual(['Booking No', 'Carrier', 'STT', 'Trạng thái']);
    expect(moveColumnTo(cols, 1, 1)).toBe(cols);
  });
});
