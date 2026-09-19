import React from 'react';
import { ExternalLink } from 'lucide-react';
import { ValueBadge } from '../common/ValueBadge';

export const CUSTOMS_CLEARED = 'Đã thông quan';
export const CUSTOMS_NOT_CLEARED = 'Chưa thông quan';

/** Normalize ePort Y/N values ('Y', 'N', legacy labels like "Đã duyệt (Y)"). */
const ynFlag = (value: unknown): 'Y' | 'N' | '' => {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s) return '';
  if (s === 'Y' || s.endsWith('(Y)') || s.includes('ĐÃ DUYỆT')) return 'Y';
  if (s === 'N' || s.endsWith('(N)') || s.includes('CHƯA DUYỆT')) return 'N';
  return '';
};

/**
 * Merged customs status ("Tình trạng thông quan"). Uses the backend-computed
 * `customs_status` when present, otherwise mirrors the backend logic client-side.
 */
export const getCustomsStatus = (row: {
  customs_status?: string | null;
  cust?: string | null;
  custom_clearance_status?: string | null;
}): string => {
  if (typeof row.customs_status === 'string') return row.customs_status;
  const flag = ynFlag(row.cust);
  if (flag === 'Y') return CUSTOMS_CLEARED;
  if (flag === 'N') return CUSTOMS_NOT_CLEARED;
  return '';
};

const HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const TAG_RE = /<[^>]*>/g;
const HTML_TAG_TEST = /<\/?[a-z][^>]*>/i;

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');

export const extractHref = (raw: string): string => {
  const m = HREF_RE.exec(raw);
  if (!m) return '';
  return decodeEntities((m[1] ?? m[2] ?? m[3] ?? '').trim());
};

export const stripHtml = (raw: string): string => decodeEntities(raw.replace(TAG_RE, '')).trim();

/** Never render raw HTML: strips tags from any string that looks like markup. */
export const sanitizeDisplayValue = <T,>(value: T): T | string => {
  if (typeof value === 'string' && value.includes('<') && HTML_TAG_TEST.test(value)) {
    return stripHtml(value);
  }
  return value;
};

export const isSafeHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url.trim());

/** HAZ text + IMDG lookup url (defensive against un-migrated raw `<a href=...>` values). */
export const getImdgInfo = (row: { haz?: string | null; imdg_url?: string | null }): { text: string; url: string } => {
  const raw = row.haz == null || row.haz === 'null' ? '' : String(row.haz);
  const looksHtml = raw.includes('<') && HTML_TAG_TEST.test(raw);
  const text = looksHtml ? stripHtml(raw) : raw.trim();
  let url = (row.imdg_url || '').trim();
  if (!url && looksHtml) url = extractHref(raw);
  return { text, url: url && isSafeHttpUrl(url) ? url : '' };
};

/** Opens a link in the system browser (Electron) or a new tab (web). */
export const openExternalUrl = (url: string) => {
  if (!url || !isSafeHttpUrl(url)) return;
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (api?.openExternal) {
    api.openExternal(url).catch(() => {
      window.open(url, '_blank', 'noopener');
    });
    return;
  }
  window.open(url, '_blank', 'noopener');
};

interface ImdgLinkProps {
  url: string;
  label: string;
  compact?: boolean;
  className?: string;
}

export const ImdgLink: React.FC<ImdgLinkProps> = ({ url, label, compact = false, className = '' }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      openExternalUrl(url);
    }}
    onDoubleClick={(e) => e.stopPropagation()}
    title={url}
    className={`inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 font-bold transition-colors shrink-0 ${
      compact ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[11px]'
    } ${className}`}
  >
    <span>{label}</span>
    <ExternalLink className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
  </button>
);

interface CustomsStatusBadgeProps {
  row: {
    customs_status?: string | null;
    cust?: string | null;
    custom_clearance_status?: string | null;
    cust_approval_date?: string | null;
  };
  /** Show approval date as subtext when cleared */
  showDate?: boolean;
  /** Fallback to raw clearance value if no merged status can be derived */
  rawFallback?: boolean;
  fallbackText?: string;
  dateClassName?: string;
}

export const CustomsStatusBadge: React.FC<CustomsStatusBadgeProps> = ({
  row,
  showDate = true,
  rawFallback = false,
  fallbackText = '-',
  dateClassName = '',
}) => {
  const status = getCustomsStatus(row);
  const date = row.cust_approval_date && row.cust_approval_date !== 'null' ? String(row.cust_approval_date) : '';
  if (!status && rawFallback) {
    const raw = row.custom_clearance_status || row.cust || '';
    return <ValueBadge table="container" columnKey="custom_clearance_status" value={raw} fallbackText={fallbackText} />;
  }
  return (
    <>
      <ValueBadge table="container" columnKey="customs_status" value={status} fallbackText={fallbackText} />
      {showDate && status === CUSTOMS_CLEARED && date && (
        <span className={`text-[10px] text-slate-400 dark:text-slate-500 font-medium ${dateClassName}`} title={date}>
          {date}
        </span>
      )}
    </>
  );
};
