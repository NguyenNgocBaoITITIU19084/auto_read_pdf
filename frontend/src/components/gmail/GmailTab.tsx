import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Download,
  FileInput,
  FileText,
  Forward,
  Inbox,
  LogIn,
  Mail,
  MailOpen,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  Star,
  Trash2,
} from 'lucide-react';
import {
  getGmailAccounts,
  getGmailAttachmentDownloadUrl,
  getGmailConfig,
  getGmailThreadDetail,
  getGmailThreads,
  GmailAccount,
  GmailAttachment,
  GmailThread,
  GmailThreadDetail,
  importGmailAttachmentToBooking,
  patchGmailThread,
  startGmailOAuth,
  syncGmailAccount,
} from '../../services/gmailApi';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';
import { GmailComposeDraft, GmailComposeModal } from './GmailComposeModal';
import { GmailSettingsModal } from './GmailSettingsModal';
import { GmailMessageCard } from './GmailMessageCard';
import { decodeEntities, participantNames, visibleAttachments } from './gmailFormat';

interface GmailTabProps {
  onUnreadCountChange?: (count: number) => void;
}

const LABELS = [
  { id: 'INBOX', label: 'Hộp thư đến', icon: Inbox },
  { id: 'UNREAD', label: 'Chưa đọc', icon: Mail },
  { id: 'STARRED', label: 'Có gắn sao', icon: Star },
  { id: 'SENT', label: 'Đã gửi', icon: Send },
  { id: 'TRASH', label: 'Thùng rác', icon: Trash2 },
  { id: 'ALL', label: 'Tất cả thư', icon: MailOpen },
] as const;

function formatShortDate(iso: string, ms: number): string {
  const d = iso ? new Date(iso) : ms ? new Date(ms) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const GmailTab: React.FC<GmailTabProps> = ({ onUnreadCountChange }) => {
  const { addToast: showToast } = useToast();
  const { activeCollection } = useApp();
  const activeCollectionId = activeCollection?.id;

  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [activeLabel, setActiveLabel] = useState<string>('INBOX');
  const [search, setSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyPdf, setOnlyPdf] = useState(false);

  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<GmailThreadDetail | null>(null);
  // Messages shown in full; older read ones collapse to one line, like Gmail.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const detailThreadId = threadDetail?.thread_id;
  useEffect(() => {
    const msgs = threadDetail?.messages || [];
    const open = new Set(msgs.filter((m) => m.is_unread).map((m) => m.message_id));
    if (msgs.length > 0) open.add(msgs[msgs.length - 1].message_id);
    setExpandedIds(open);
    // Only when another thread opens — refreshing the same thread keeps what the user expanded.
  }, [detailThreadId]);
  const toggleMessage = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [importingAttId, setImportingAttId] = useState<number | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState<GmailComposeDraft | null>(null);
  const [hasOAuthConfig, setHasOAuthConfig] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const oauthPollRef = useRef<number | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  const loadAccounts = useCallback(async () => {
    try {
      const res = await getGmailAccounts();
      setAccounts(res.items);
      onUnreadCountChange?.(res.total_unread || 0);
      setSelectedAccountId((prev) => {
        if (prev && res.items.some((a) => a.id === prev)) return prev;
        return res.items[0]?.id ?? null;
      });
    } catch {
      // ignore transient startup errors
    }
  }, [onUnreadCountChange]);

  const loadThreads = useCallback(async () => {
    if (!selectedAccountId) {
      setThreads([]);
      return;
    }
    setLoadingThreads(true);
    try {
      const res = await getGmailThreads({
        account_id: selectedAccountId,
        label: activeLabel,
        search,
        only_unread: onlyUnread,
        only_pdf: onlyPdf,
        limit: 80,
      });
      setThreads(res.items);
    } catch {
      showToast('Không tải được danh sách email', 'error');
    } finally {
      setLoadingThreads(false);
    }
  }, [selectedAccountId, activeLabel, search, onlyUnread, onlyPdf, showToast]);

  useEffect(() => {
    loadAccounts();
    getGmailConfig()
      .then((cfg) => setHasOAuthConfig(Boolean(cfg.has_oauth_config)))
      .catch(() => {});
    return () => {
      if (oauthPollRef.current) window.clearInterval(oauthPollRef.current);
    };
  }, [loadAccounts]);

  const handleOneClickGoogleLogin = async () => {
    setConnectingGoogle(true);
    try {
      const { auth_url } = await startGmailOAuth();
      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(auth_url);
      } else {
        window.open(auth_url, '_blank', 'noopener,noreferrer');
      }
      showToast('Đã mở trình duyệt để đăng nhập Google...', 'info');
      if (oauthPollRef.current) window.clearInterval(oauthPollRef.current);
      let ticks = 0;
      oauthPollRef.current = window.setInterval(async () => {
        ticks += 1;
        await loadAccounts();
        if (ticks >= 45 && oauthPollRef.current) {
          window.clearInterval(oauthPollRef.current);
          oauthPollRef.current = null;
          setConnectingGoogle(false);
        }
      }, 2000);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Không khởi tạo được đăng nhập Google', 'error');
      setConnectingGoogle(false);
    }
  };

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const openThread = useCallback(
    async (thread: GmailThread) => {
      setSelectedThreadId(thread.thread_id);
      setLoadingDetail(true);
      try {
        const detail = await getGmailThreadDetail(thread.account_id, thread.thread_id);
        setThreadDetail(detail);
        if (thread.is_unread) {
          await patchGmailThread(thread.account_id, thread.thread_id, 'read');
          setThreads((prev) =>
            prev.map((t) => (t.thread_id === thread.thread_id ? { ...t, is_unread: 0 } : t))
          );
          loadAccounts();
        }
      } catch {
        showToast('Không mở được nội dung email', 'error');
      } finally {
        setLoadingDetail(false);
      }
    },
    [loadAccounts, showToast]
  );

  const handleSync = async () => {
    if (!selectedAccountId) return;
    setSyncing(true);
    try {
      const res = await syncGmailAccount(selectedAccountId, { max_results: 40 });
      showToast(`Đã đồng bộ ${res.synced_threads} hội thoại Gmail`, 'success');
      await Promise.all([loadAccounts(), loadThreads()]);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Đồng bộ Gmail thất bại', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleThreadAction = async (
    action: 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'trash' | 'untrash'
  ) => {
    if (!selectedAccountId || !threadDetail) return;
    try {
      const res = await patchGmailThread(selectedAccountId, threadDetail.thread_id, action);
      setThreadDetail(res.thread);
      if (action === 'archive' || action === 'trash') {
        setSelectedThreadId(null);
        setThreadDetail(null);
      }
      await Promise.all([loadAccounts(), loadThreads()]);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Thao tác thất bại', 'error');
    }
  };

  const handleImportPdf = async (att: GmailAttachment) => {
    setImportingAttId(att.id);
    try {
      const res = await importGmailAttachmentToBooking(att.id, activeCollectionId || undefined);
      showToast(res.message, res.status === 'duplicate' ? 'info' : 'success');
      if (threadDetail) {
        const refreshed = await getGmailThreadDetail(threadDetail.account_id, threadDetail.thread_id);
        setThreadDetail(refreshed);
      }
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Không đọc được PDF vào Booking', 'error');
    } finally {
      setImportingAttId(null);
    }
  };

  const openCompose = (mode: 'new' | 'reply' | 'forward') => {
    if (!selectedAccount) return;
    if (mode === 'new' || !threadDetail) {
      setComposeDraft({ mode: 'new' });
      setComposeOpen(true);
      return;
    }
    const lastMsg = threadDetail.messages[threadDetail.messages.length - 1];
    if (mode === 'reply') {
      const subj = threadDetail.subject.toLowerCase().startsWith('re:')
        ? threadDetail.subject
        : `Re: ${threadDetail.subject}`;
      setComposeDraft({
        mode: 'reply',
        to: lastMsg?.from_addr || '',
        subject: subj,
        body: '',
        threadId: threadDetail.thread_id,
        inReplyTo: lastMsg?.rfc_message_id || '',
        references: lastMsg?.references_header || '',
      });
    } else {
      const subj = threadDetail.subject.toLowerCase().startsWith('fwd:')
        ? threadDetail.subject
        : `Fwd: ${threadDetail.subject}`;
      setComposeDraft({
        mode: 'forward',
        to: '',
        subject: subj,
        body: `\n\n---------- Forwarded message ----------\nFrom: ${lastMsg?.from_addr || ''}\nSubject: ${threadDetail.subject}\n\n${lastMsg?.body_text || ''}`,
      });
    }
    setComposeOpen(true);
  };

  if (accounts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-7 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-primary-50 dark:bg-primary-950/40 text-primary-600 flex items-center justify-center mx-auto">
            <Mail className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Quản lý Gmail ngay trong Auto Read PDF Pro
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Kết nối tài khoản Gmail để đọc, tìm kiếm, trả lời email và nhập trực tiếp file PDF đính kèm vào danh sách Booking.
            </p>
          </div>
          <div className="flex flex-col items-center gap-2 pt-1">
            {hasOAuthConfig ? (
              <>
                <button
                  type="button"
                  onClick={handleOneClickGoogleLogin}
                  disabled={connectingGoogle}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-semibold shadow-sm cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  {connectingGoogle ? 'Đang chờ đăng nhập trên trình duyệt...' : 'Đăng nhập bằng Google'}
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:underline cursor-pointer"
                >
                  Cài đặt nâng cao
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Settings className="w-4 h-4" />
                Cấu hình & Kết nối Gmail
              </button>
            )}
          </div>
        </div>

        <GmailSettingsModal
          open={settingsOpen}
          accounts={accounts}
          onClose={() => {
            setSettingsOpen(false);
            getGmailConfig()
              .then((cfg) => setHasOAuthConfig(Boolean(cfg.has_oauth_config)))
              .catch(() => {});
          }}
          onAccountsChanged={loadAccounts}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-white dark:bg-slate-900 m-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
      {/* Left Sidebar: Account + Compose + Labels */}
      <aside className="w-56 shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/60 dark:bg-slate-950/40">
        <div className="p-3 space-y-2.5 border-b border-slate-200 dark:border-slate-800">
          <select
            value={selectedAccountId ?? ''}
            onChange={(e) => {
              setSelectedAccountId(Number(e.target.value));
              setSelectedThreadId(null);
              setThreadDetail(null);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-800 dark:text-slate-200 truncate"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.email} {acc.unread_count > 0 ? `(${acc.unread_count})` : ''}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => openCompose('new')}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
          >
            <PenSquare className="w-3.5 h-3.5" />
            Soạn thư mới
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {LABELS.map((item) => {
            const Icon = item.icon;
            const active = activeLabel === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveLabel(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Đang đồng bộ' : 'Đồng bộ'}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
            title="Cài đặt Gmail"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* Middle Pane: Search + Thread List */}
      <section className="w-80 lg:w-96 shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm người gửi, tiêu đề, booking..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOnlyUnread((v) => !v)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer ${
                onlyUnread
                  ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-950/40 dark:border-primary-700 dark:text-primary-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              Chưa đọc
            </button>
            <button
              type="button"
              onClick={() => setOnlyPdf((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer ${
                onlyPdf
                  ? 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950/40 dark:border-rose-700 dark:text-rose-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <FileText className="w-3 h-3" />
              Có file PDF
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
          {loadingThreads && threads.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">Đang tải hộp thư...</div>
          ) : threads.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 space-y-2">
              <p>Chưa có email nào trong mục này.</p>
              <button
                type="button"
                onClick={handleSync}
                className="text-primary-600 hover:underline font-medium cursor-pointer"
              >
                Bấm Đồng bộ để tải thư từ Gmail
              </button>
            </div>
          ) : (
            threads.map((t) => {
              const selected = t.thread_id === selectedThreadId;
              const unread = Boolean(t.is_unread);
              return (
                <button
                  key={t.thread_id}
                  type="button"
                  onClick={() => openThread(t)}
                  className={`relative w-full text-left pl-4 pr-3 py-2.5 transition-colors cursor-pointer ${
                    selected
                      ? 'bg-primary-50 dark:bg-primary-950/50'
                      : unread
                        ? 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                        : 'bg-slate-50/70 dark:bg-slate-950/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {(selected || unread) && (
                    <span
                      className={`absolute left-0 top-0 bottom-0 w-[3px] ${selected ? 'bg-primary-600' : 'bg-primary-500/80'}`}
                    />
                  )}
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={`text-xs truncate flex-1 ${
                        unread
                          ? 'font-bold text-slate-900 dark:text-white'
                          : 'font-normal text-slate-600 dark:text-slate-400'
                      }`}
                      title={t.participants}
                    >
                      {participantNames(t.participants) || '(Không rõ người gửi)'}
                      {t.message_count > 1 && (
                        <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">{t.message_count}</span>
                      )}
                    </span>
                    <span
                      className={`text-[10px] shrink-0 ${
                        unread ? 'font-bold text-primary-600 dark:text-primary-400' : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {formatShortDate(t.last_message_at, t.last_message_ms)}
                    </span>
                  </div>
                  <div
                    className={`text-xs truncate mb-0.5 ${
                      unread ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {t.subject}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] truncate flex-1 ${
                        unread ? 'text-slate-600 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {decodeEntities(t.snippet)}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {Boolean(t.is_starred) && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                      {Boolean(t.has_pdf) && (
                        <span className="px-1 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[9px] font-bold">
                          PDF
                        </span>
                      )}
                      {!t.has_pdf && Boolean(t.has_attachments) && <Paperclip className="w-3 h-3 text-slate-400" />}
                      {unread && <span className="w-2 h-2 rounded-full bg-primary-500" title="Chưa đọc" />}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Right Pane: Thread Detail */}
      <section className="flex-1 flex flex-col overflow-hidden bg-slate-50/40 dark:bg-slate-950/30">
        {!threadDetail ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
            <MailOpen className="w-8 h-8 opacity-40" />
            <span>{loadingDetail ? 'Đang tải nội dung...' : 'Chọn một email để xem chi tiết'}</span>
          </div>
        ) : (
          <>
            {/* Thread Action Bar */}
            <div className="px-5 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {threadDetail.subject}
              </h2>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openCompose('reply')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 text-xs font-semibold hover:bg-primary-100 cursor-pointer"
                >
                  <Reply className="w-3.5 h-3.5" />
                  Trả lời
                </button>
                <button
                  type="button"
                  onClick={() => openCompose('forward')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Forward className="w-3.5 h-3.5" />
                  Chuyển tiếp
                </button>
                <button
                  type="button"
                  onClick={() => handleThreadAction(threadDetail.is_starred ? 'unstar' : 'star')}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 cursor-pointer"
                  title={threadDetail.is_starred ? 'Bỏ gắn sao' : 'Gắn sao'}
                >
                  <Star
                    className={`w-3.5 h-3.5 ${threadDetail.is_starred ? 'text-amber-400 fill-amber-400' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => handleThreadAction(threadDetail.is_unread ? 'read' : 'unread')}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 cursor-pointer"
                  title={threadDetail.is_unread ? 'Đánh dấu đã đọc' : 'Đánh dấu chưa đọc'}
                >
                  {threadDetail.is_unread ? <MailOpen className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleThreadAction('archive')}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 cursor-pointer"
                  title="Lưu trữ (Archive)"
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleThreadAction(activeLabel === 'TRASH' ? 'untrash' : 'trash')}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 hover:bg-slate-50 cursor-pointer"
                  title={activeLabel === 'TRASH' ? 'Khôi phục từ thùng rác' : 'Chuyển vào thùng rác'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
              {threadDetail.messages.map((msg) => (
                <GmailMessageCard
                  key={msg.message_id}
                  msg={msg}
                  expanded={expandedIds.has(msg.message_id)}
                  onToggle={() => toggleMessage(msg.message_id)}
                  attachments={
                    visibleAttachments(msg.attachments, msg.body_html).length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                      {visibleAttachments(msg.attachments, msg.body_html).map((att) => (
                        <div
                          key={att.id}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs"
                        >
                          <FileText className={`w-4 h-4 ${att.is_pdf ? 'text-rose-500' : 'text-slate-400'}`} />
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800 dark:text-slate-200 max-w-[200px] truncate">
                              {att.filename}
                            </div>
                            <div className="text-[10px] text-slate-400">{formatBytes(att.size)}</div>
                          </div>
                          <a
                            href={getGmailAttachmentDownloadUrl(att.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 rounded hover:bg-white dark:hover:bg-slate-700 text-slate-500 hover:text-primary-600"
                            title="Tải xuống / Xem"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          {Boolean(att.is_pdf) && (
                            att.imported_booking_no ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold">
                                <CheckCircle2 className="w-3 h-3" />
                                Đã nhập: {att.imported_booking_no}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleImportPdf(att)}
                                disabled={importingAttId === att.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                <FileInput className="w-3 h-3" />
                                {importingAttId === att.id ? 'Đang đọc...' : 'Đọc vào Booking'}
                              </button>
                            )
                          )}
                        </div>
                      ))}
                      </div>
                    ) : undefined
                  }
                />
              ))}
            </div>
          </>
        )}
      </section>

      <GmailSettingsModal
        open={settingsOpen}
        accounts={accounts}
        onClose={() => setSettingsOpen(false)}
        onAccountsChanged={() => {
          loadAccounts();
          loadThreads();
        }}
      />

      <GmailComposeModal
        open={composeOpen}
        account={selectedAccount}
        draft={composeDraft}
        onClose={() => setComposeOpen(false)}
        onSent={() => {
          loadThreads();
          if (selectedThreadId && selectedAccountId) {
            getGmailThreadDetail(selectedAccountId, selectedThreadId, true)
              .then(setThreadDetail)
              .catch(() => {});
          }
        }}
      />
    </div>
  );
};
