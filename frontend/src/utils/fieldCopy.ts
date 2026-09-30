export interface CopyEntry {
  key: string;
  label: string;
  /** Display value; blank / "null" means nothing to copy. */
  value: string;
}

export type FieldCopyMode = 'labeled' | 'values';

const clean = (v: unknown): string =>
  v === undefined || v === null || String(v).trim().toLowerCase() === 'null'
    ? ''
    : String(v).replace(/[\t\r\n]+/g, ' ').trim();

/** Entries that actually hold a value (what can be selected / copied). */
export const copyableEntries = (entries: CopyEntry[]): CopyEntry[] => entries.filter((e) => clean(e.value) !== '');

/**
 * Text for the ticked entries, in display order.
 *  - 'labeled': one "Label: value" line per entry
 *  - 'values':  one value per line
 */
export function formatEntriesForCopy(entries: CopyEntry[], selected: ReadonlySet<string>, mode: FieldCopyMode): string {
  return copyableEntries(entries)
    .filter((e) => selected.has(e.key))
    .map((e) => (mode === 'labeled' ? `${e.label}: ${clean(e.value)}` : clean(e.value)))
    .join('\n');
}
