import React, { useEffect, useState } from 'react';
import { FileText, Paperclip, Send, Sparkles, X } from 'lucide-react';
import {
  getGmailTemplates,
  GmailAccount,
  GmailTemplate,
  sendGmailMessage,
} from '../../services/gmailApi';
import { useToast } from '../../context/ToastContext';
import type { BookingTask } from '../../types';
import { BookingFillSearch } from '../zalo/BookingFillSearch';
import { fillPlaceholders, findPlaceholders, taskPlaceholderValues } from '../zalo/zaloTemplates';

export interface GmailComposeDraft {
  mode: 'new' | 'reply' | 'forward';
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  /** Outlook: the message being replied to / forwarded */
  replyToMessageId?: string;
}

export interface ComposeSendPayload {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  files: File[];
  draft: GmailComposeDraft | null;
}

interface GmailComposeModalProps {
  open: boolean;
  account: Pick<GmailAccount, 'email'> & { id: number } | null;
  /** Send through another provider (Outlook); Gmail is used when absent */
  onSend?: (payload: ComposeSendPayload) => Promise<{ thread_id?: string }>;
  draft: GmailComposeDraft | null;
  onClose: () => void;
  onSent: (threadId?: string) => void;
}

export const GmailComposeModal: React.FC<GmailComposeModalProps> = ({
  open,
  account,
  draft,
  onClose,
  onSent,
  onSend,
}) => {
  const { addToast: showToast } = useToast();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [templates, setTemplates] = useState<GmailTemplate[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTo(draft?.to || '');
    setCc(draft?.cc || '');
    setBcc('');
    setShowCcBcc(Boolean(draft?.cc));
    setSubject(draft?.subject || '');
    setBody(draft?.body || '');
    setFiles([]);
    getGmailTemplates().then(setTemplates).catch(() => {});
  }, [open, draft]);

  if (!open || !account) return null;

  const applyTemplate = (tpl: GmailTemplate) => {
    if (!subject.trim() && tpl.subject_tpl) {
      setSubject(tpl.subject_tpl);
    }
    setBody((prev) => (prev.trim() ? `${prev}\n\n${tpl.body_tpl}` : tpl.body_tpl));
  };

  // A template leaves {booking_no}, {vessel}… open; picking a booking fills them in the subject and the body.
  const openPlaceholders = findPlaceholders(`${subject}\n${body}`);
  const fillFromBooking = (task: BookingTask) => {
    const values = taskPlaceholderValues(task);
    setSubject((prev) => fillPlaceholders(prev, values));
    setBody((prev) => fillPlaceholders(prev, values));
    const left = findPlaceholders(fillPlaceholders(`${subject}\n${body}`, values));
    if (left.length > 0) showToast(`Booking này chưa có dữ liệu cho: ${left.join(', ')}`, 'info');
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length > 0) {
      setFiles((prev) => [...prev, ...picked]);
    }
    e.target.value = '';
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim()) {
      showToast('Vui lòng nhập email người nhận', 'error');
      return;
    }
    if (openPlaceholders.length > 0) {
      showToast(`Còn chỗ trống chưa điền: ${openPlaceholders.join(', ')} — chọn Booking để điền hoặc sửa tay`, 'error');
      return;
    }
    setSending(true);
    try {
      const res = onSend
        ? await onSend({ to: to.trim(), cc: cc.trim(), bcc: bcc.trim(), subject: subject.trim(), body, files, draft })
        : await sendGmailMessage({
            account_id: account.id,
            to_addrs: to.trim(),
            cc_addrs: cc.trim(),
            bcc_addrs: bcc.trim(),
            subject: subject.trim(),
            body_text: body,
            thread_id: draft?.mode === 'reply' ? draft.threadId : undefined,
            in_reply_to: draft?.mode === 'reply' ? draft.inReplyTo : undefined,
            references: draft?.mode === 'reply' ? draft.references : undefined,
            files,
          });
      showToast('Đã gửi email thành công', 'success');
      onSent(res.thread_id);
      onClose();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Không thể gửi email', 'error');
    } finally {
      setSending(false);
    }
  };

  const title =
    draft?.mode === 'reply'
      ? 'Trả lời email'
      : draft?.mode === 'forward'
        ? 'Chuyển tiếp email'
        : 'Soạn email mới';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
            <p className="text-[11px] text-slate-500">Từ: {account.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSend} className="flex-1 flex flex-col overflow-hidden text-xs">
          <div className="p-4 space-y-2.5 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-12 text-slate-500 font-medium shrink-0">Đến:</span>
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="email1@company.com, email2@company.com"
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {!showCcBcc && (
                <button
                  type="button"
                  onClick={() => setShowCcBcc(true)}
                  className="text-[11px] text-primary-600 hover:underline px-1.5 cursor-pointer"
                >
                  Cc/Bcc
                </button>
              )}
            </div>

            {showCcBcc && (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-slate-500 font-medium shrink-0">Cc:</span>
                  <input
                    type="text"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-slate-500 font-medium shrink-0">Bcc:</span>
                  <input
                    type="text"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-2">
              <span className="w-12 text-slate-500 font-medium shrink-0">Tiêu đề:</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Nhập tiêu đề email..."
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {templates.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                  <Sparkles className="w-3 h-3 text-amber-500" /> Mẫu nhanh:
                </span>
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-primary-50 dark:hover:bg-primary-950/40 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[11px] cursor-pointer"
                  >
                    {tpl.name}
                  </button>
                ))}
              </div>
            )}
            {openPlaceholders.length > 0 && (
              <div className="flex flex-col gap-1.5 p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30">
                <span className="text-[11px] text-amber-700 dark:text-amber-400">
                  Mẫu còn chỗ trống {openPlaceholders.join(', ')} — tìm Booking để điền:
                </span>
                <BookingFillSearch onPick={fillFromBooking} dropDown />
              </div>
            )}
          </div>

          <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Nhập nội dung email..."
              className="w-full flex-1 min-h-[180px] p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none leading-relaxed"
            />

            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((f, idx) => (
                  <div
                    key={`${f.name}-${idx}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  >
                    <FileText className="w-3.5 h-3.5 text-primary-600" />
                    <span className="max-w-[180px] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-rose-500 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer">
              <Paperclip className="w-3.5 h-3.5" />
              Đính kèm tệp
              <input type="file" multiple className="hidden" onChange={handleFilePick} />
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={sending}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                {sending ? 'Đang gửi...' : 'Gửi email'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
