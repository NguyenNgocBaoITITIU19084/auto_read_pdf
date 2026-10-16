import { describe, it, expect } from 'vitest';
import { insertMissingDefaults } from './useColumnSettings';

const col = (key: string, visible = true) => ({ key, label: key, visible });

describe('insertMissingDefaults', () => {
  it('puts a new default column right after the one before it, not at the end', () => {
    const stored = [col('Booking No'), col('Carrier'), col('Added')];
    const defaults = [col('Booking No'), col('Status'), col('Carrier'), col('Added')];
    expect(insertMissingDefaults(stored, defaults).map((c) => c.key)).toEqual(['Booking No', 'Status', 'Carrier', 'Added']);
  });

  it('follows the user order and puts a column first when nothing precedes it', () => {
    const stored = [col('Carrier'), col('Booking No', false)];
    const defaults = [col('First'), col('Booking No'), col('Status'), col('Carrier')];
    const out = insertMissingDefaults(stored, defaults);
    expect(out.map((c) => c.key)).toEqual(['First', 'Carrier', 'Booking No', 'Status']);
    expect(out[2].visible).toBe(false);
  });
});

describe('migrateColumns moveAfter', () => {
  it('moves a column that sits at the far end next to its anchor', async () => {
    const { migrateColumns } = await import('./useColumnSettings');
    const stored = [col('Booking No'), col('Carrier'), col('Added'), col('Status')];
    const defaults = [col('Booking No'), col('Status'), col('Carrier'), col('Added')];
    expect(migrateColumns(stored, defaults, { moveAfter: { Status: 'Booking No' } }).map((c) => c.key))
      .toEqual(['Booking No', 'Status', 'Carrier', 'Added']);
  });
});
