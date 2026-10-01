import { describe, expect, it } from 'vitest';
import { copyableEntries, formatEntriesForCopy } from './fieldCopy';

const entries = [
  { key: 'a', label: 'Số booking', value: 'SGN123' },
  { key: 'b', label: 'Block', value: 'null' },
  { key: 'c', label: 'Tàu', value: 'WAN HAI 317\nW247' },
  { key: 'd', label: 'Ghi chú', value: '' },
];

describe('fieldCopy', () => {
  it('only offers entries that hold a value', () => {
    expect(copyableEntries(entries).map((e) => e.key)).toEqual(['a', 'c']);
  });

  it('formats ticked entries in display order, with or without names', () => {
    const picked = new Set(['c', 'a']);
    expect(formatEntriesForCopy(entries, picked, 'labeled')).toBe('Số booking: SGN123\nTàu: WAN HAI 317 W247');
    expect(formatEntriesForCopy(entries, picked, 'values')).toBe('SGN123\nWAN HAI 317 W247');
  });

  it('copies only the highlighted part of a field when one was picked', () => {
    const parts = new Map([['c', 'WAN HAI 317']]);
    expect(formatEntriesForCopy(entries, new Set(['a', 'c']), 'labeled', parts)).toBe('Số booking: SGN123\nTàu: WAN HAI 317');
    expect(formatEntriesForCopy(entries, new Set(['a']), 'values', parts)).toBe('SGN123'); // a part of an unticked field is not copied
  });

  it('ignores ticked entries without a value and returns "" for no selection', () => {
    expect(formatEntriesForCopy(entries, new Set(['b', 'd']), 'labeled')).toBe('');
    expect(formatEntriesForCopy(entries, new Set(), 'values')).toBe('');
  });
});
