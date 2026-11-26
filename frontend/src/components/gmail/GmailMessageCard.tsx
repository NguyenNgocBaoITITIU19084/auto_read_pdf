import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { getGmailAttachmentDownloadUrl } from '../../services/gmailApi';
import {
  decodeEntities,
  formatFullDate,
  parseAddress,
  resolveCidImages,
  shortName,
  splitAddresses,
  visibleAttachments,
} from './gmailFormat';

const AVATAR_COLORS = [
  'bg-sky-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-teal-600',
  'bg-indigo-600',
  'bg-orange-600',
];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export const SenderAvatar: React.FC<{ from: string; size?: 'sm' | 'md' }> = ({ from, size = 'md' }) => {
  const name = shortName(from);
  const letter = (name.trim()[0] || '?').toUpperCase();
  const dim = size === 'sm' ? 'w-7 h-7 text-[11px]' : 'w-9 h-9 text-sm';
  return (
    <span
      className={`${dim} ${avatarColor(parseAddress(from).email || name)} shrink-0 rounded-full text-white font-semibold flex items-center justify-center select-none`}
    >
      {letter}
    </span>
  );
};

// Emails are designed for a light page, like Gmail shows them even in dark mode.
const FRAME_STYLE = `
:root{color-scheme:light}
html,body{margin:0;padding:0;background:#fff}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;color:#1e293b;padding:16px 18px;word-break:break-word;overflow-x:auto;overflow-y:hidden}
img{max-width:100%;height:auto}
table{max-width:100%}
a{color:#2563eb}
blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #cbd5e1;color:#475569}
img[src^="cid:"]{display:none}
`;

/**
 * An HTML email in a sandboxed frame that grows to fit its content, so the message pane scrolls once
 * instead of every email getting its own scrollbar. Scripts never run (no allow-scripts); links open
 * in the system browser through Electron's window-open handler.
 */
export const EmailHtmlFrame: React.FC<{ html: string; title: string }> = ({ html, title }) => {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.documentElement) return;
    const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0);
    if (h > 0) setHeight(h + 2);
  }, []);

  const observerRef = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const handleLoad = () => {
    measure();
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    // Images load after the document; each one can change the height.
    doc.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', measure, { once: true });
    });
    observerRef.current?.disconnect();
    try {
      observerRef.current = new ResizeObserver(measure);
      observerRef.current.observe(doc.body);
    } catch {
      /* measured once on load is still fine */
    }
  };

  return (
    <iframe
      ref={ref}
      title={title}
      onLoad={handleLoad}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><base target="_blank"><style>${FRAME_STYLE}</style></head><body>${html}</body></html>`}
      style={{ height }}
      className="block w-full border-0 bg-white"
    />
  );
};

export interface MailAttachmentView {
  id: number | string;
  filename: string;
  mime_type: string;
  size: number;
  is_pdf: number;
  content_id?: string;
  imported_booking_no?: string;
}

/** What a mail card needs; Gmail messages and Outlook messages both have this shape. */
export interface MailMessageView {
  message_id: string;
  from_addr: string;
  to_addrs: string;
  cc_addrs: string;
  subject: string;
  snippet: string;
  body_text: string;
  body_html: string;
  is_unread: number;
  internal_date_ms: number;
  date_iso: string;
  attachments: MailAttachmentView[];
}

interface GmailMessageCardProps {
  msg: MailMessageView;
  /** URL of an attachment, used for images the HTML shows as cid: (Gmail's download link by default) */
  attachmentUrl?: (att: MailAttachmentView) => string;
  expanded: boolean;
  onToggle: () => void;
  /** Attachment chips (download / read into booking) rendered by the tab */
  attachments?: React.ReactNode;
}

const gmailAttachmentUrl = (att: MailAttachmentView) => getGmailAttachmentDownloadUrl(Number(att.id));

export const GmailMessageCard: React.FC<GmailMessageCardProps> = ({
  msg,
  expanded,
  onToggle,
  attachments,
  attachmentUrl = gmailAttachmentUrl,
}) => {
  const sender = parseAddress(msg.from_addr);
  const when = formatFullDate(msg.date_iso, msg.internal_date_ms);
  const unread = Boolean(msg.is_unread);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
      >
        <SenderAvatar from={msg.from_addr} size="sm" />
        <span
          className={`text-xs shrink-0 max-w-[30%] truncate ${
            unread ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300'
          }`}
        >
          {sender.name || sender.email}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1">{decodeEntities(msg.snippet)}</span>
        {visibleAttachments(msg.attachments, msg.body_html).length > 0 && <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
        <span className="text-[11px] text-slate-400 shrink-0">{when}</span>
      </button>
    );
  }

  const recipients = splitAddresses(msg.to_addrs).map(shortName).join(', ');
  const ccNames = splitAddresses(msg.cc_addrs).map(shortName).join(', ');

  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        title="Thu gọn"
        className="w-full text-left flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
      >
        <SenderAvatar from={msg.from_addr} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
              {sender.name || sender.email}
            </span>
            {sender.name && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">&lt;{sender.email}&gt;</span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={msg.to_addrs}>
            đến {recipients || '—'}
            {ccNames ? ` · Cc: ${ccNames}` : ''}
          </div>
        </div>
        <span className="text-[11px] text-slate-400 shrink-0 pt-0.5">{when}</span>
      </button>

      <div className="border-t border-slate-100 dark:border-slate-800">
        {msg.body_html ? (
          <EmailHtmlFrame
            html={resolveCidImages(msg.body_html, msg.attachments, attachmentUrl)}
            title={msg.subject || msg.message_id}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed px-5 py-4">
            {msg.body_text || decodeEntities(msg.snippet)}
          </pre>
        )}
      </div>

      {attachments && (
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
            {visibleAttachments(msg.attachments, msg.body_html).length} tệp đính kèm
          </div>
          {attachments}
        </div>
      )}
    </article>
  );
};
