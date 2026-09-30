import { useCallback, useEffect, useState } from 'react';

/** Ticked field keys of a detail modal; cleared whenever `resetKey` changes (other record / modal closed). */
export function useFieldSelection(resetKey: unknown) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
  }, [resetKey]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const setAll = useCallback((keys: string[]) => setSelected(new Set(keys)), []);
  const clear = useCallback(() => setSelected((prev) => (prev.size === 0 ? prev : new Set())), []);

  return { selected, toggle, setAll, clear };
}
