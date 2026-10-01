import { useEffect, useState } from 'react';
import { pdfPreviewApi, PdfPreview } from '../services/api';

/**
 * Rendered pages per PDF File, so switching back and forth between queue items never re-renders a PDF.
 * A WeakMap: entries go away with the File once its queue item is removed.
 */
const cache = new WeakMap<File, Promise<PdfPreview>>();

function loadPreview(file: File): Promise<PdfPreview> {
  let pending = cache.get(file);
  if (!pending) {
    pending = pdfPreviewApi(file);
    cache.set(file, pending);
    // A failure is not cached: selecting the item again tries once more
    pending.catch(() => cache.delete(file));
  }
  return pending;
}

export interface PdfPreviewState {
  pages: string[];
  pageCount: number;
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

const IDLE: PdfPreviewState = { pages: [], pageCount: 0, truncated: false, loading: false, error: null };

/** Page images of `file` (null = not a PDF / nothing selected). */
export function usePdfPreview(file: File | null | undefined): PdfPreviewState {
  const [state, setState] = useState<PdfPreviewState>(IDLE);
  useEffect(() => {
    if (!file) {
      setState(IDLE);
      return;
    }
    let alive = true;
    setState({ ...IDLE, loading: true });
    loadPreview(file).then(
      (res) => alive && setState({ pages: res.pages, pageCount: res.page_count, truncated: res.truncated, loading: false, error: null }),
      (e: any) => {
        if (!alive) return;
        const detail = e?.response?.data?.detail;
        setState({ ...IDLE, error: (typeof detail === 'string' && detail) || e?.message || 'PDF preview failed' });
      },
    );
    return () => {
      alive = false;
    };
  }, [file]);
  return state;
}
